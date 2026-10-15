/**
 * `scripts/calibrationCore.ts` 的单测。
 *
 * 为什么只测这一层：一次真实校准是分钟级长跑，不能进默认 Jest（方案 §10.4
 * 「不新增自动收集的 30 分钟 calibration.test.ts」）。但 runner 的逻辑**必须**有测试
 * ——否则「跑一遍看到数字就签收」正是校准最容易犯的错。所以把能确定性断言的部分
 * （参数解析、Wilson 区间、目标区间判定、代理策略、报告格式）全部抽到 core 并覆盖在这里。
 *
 * 驱动生产 reducer 的那部分（`calibrationRunner.ts`）靠**自校验**而不是单测：
 * 座位直方图必须等于聚合内核的 player-hand 数、代理策略给出的动作必须被
 * `isActionAccepted` 接受、Bot 给出被拒动作会被计数并写进报告 —— 任何一条破了都会当场报错。
 */

import {
  DEFAULT_CALIBRATION_CONFIG,
  TARGET_INTERVALS,
  TYPE_ORDER,
  evaluateTargets,
  formatReport,
  parseCalibrationArgs,
  proxyDecide,
  wilsonInterval,
  type CalibrationReport,
  type ProxyContext,
  type TypeMetrics,
  type TypeReport,
} from '../calibrationCore';

// ── 参数解析 ─────────────────────────────────────────────────────────────────

describe('parseCalibrationArgs', () => {
  it('无参数时返回默认配置的副本（不共享数组引用）', () => {
    const cfg = parseCalibrationArgs([]);
    expect(cfg).toEqual(DEFAULT_CALIBRATION_CONFIG);
    expect(cfg.seeds).not.toBe(DEFAULT_CALIBRATION_CONFIG.seeds);
  });

  it('解析数字键、布尔键、赛制与 label', () => {
    const cfg = parseCalibrationArgs([
      '--handsPerSeed=120',
      '--handsPerSession=40',
      '--minPlayerHandsPerType=500',
      '--gto=true',
      '--scenario=tournament',
      '--label=p9-4',
    ]);
    expect(cfg.handsPerSeed).toBe(120);
    expect(cfg.handsPerSession).toBe(40);
    expect(cfg.minPlayerHandsPerType).toBe(500);
    expect(cfg.gto).toBe(true);
    expect(cfg.scenario).toBe('tournament');
    expect(cfg.label).toBe('p9-4');
  });

  it('equityIterations 支持正整数与 production', () => {
    expect(parseCalibrationArgs(['--equityIterations=40']).equityIterations).toBe(40);
    expect(
      parseCalibrationArgs(['--equityIterations=production']).equityIterations,
    ).toBeNull();
  });

  it('seeds 按逗号切分', () => {
    expect(parseCalibrationArgs(['--seeds=1,2,3,4,5']).seeds).toEqual([1, 2, 3, 4, 5]);
  });

  it('未知键报错而不是静默忽略', () => {
    expect(() => parseCalibrationArgs(['--hands=100'])).toThrow(/未知参数键/);
  });

  it('缺少 -- 前缀 / 缺少 = 报错', () => {
    expect(() => parseCalibrationArgs(['handsPerSeed=1'])).toThrow(/-- 前缀/);
    expect(() => parseCalibrationArgs(['--handsPerSeed'])).toThrow(/--key=value/);
  });

  it('决策 43：少于 5 个 seed 直接报错', () => {
    expect(() => parseCalibrationArgs(['--seeds=1,2,3,4'])).toThrow(/≥5 个独立 seed/);
  });

  it('非法取值报错', () => {
    expect(() => parseCalibrationArgs(['--gto=yes'])).toThrow(/true\/false/);
    expect(() => parseCalibrationArgs(['--scenario=hu'])).toThrow(/cash\/tournament/);
    expect(() => parseCalibrationArgs(['--handsPerSeed=abc'])).toThrow(/必须是数字/);
    expect(() => parseCalibrationArgs(['--equityIterations=0'])).toThrow(/正整数/);
  });

  it('总人数超过 10 报错（PlayerId 域）', () => {
    expect(() =>
      parseCalibrationArgs(['--realPlayers=5', '--botPlayers=6']),
    ).toThrow(/不得超过 10/);
  });
});

// ── Wilson 区间 ──────────────────────────────────────────────────────────────

describe('wilsonInterval', () => {
  it('分母为 0 返回 null（不伪造 [0,100]）', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('p=0.5, n=100 落在已知的 [40.4, 59.6] 附近', () => {
    const w = wilsonInterval(50, 100)!;
    expect(w.low).toBeCloseTo(40.38, 1);
    expect(w.high).toBeCloseTo(59.62, 1);
  });

  it('边界比例不会越界，且下界仍大于 0（正态近似在这里会给出负值）', () => {
    const zero = wilsonInterval(0, 10)!;
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(27.75, 1);
    const all = wilsonInterval(10, 10)!;
    expect(all.high).toBe(100);
    expect(all.low).toBeCloseTo(72.25, 1);
  });

  it('样本变大时间隔变窄', () => {
    const small = wilsonInterval(5, 10)!;
    const big = wilsonInterval(500, 1000)!;
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
  });
});

// ── 目标区间判定（方案 §4） ──────────────────────────────────────────────────

const targetInput = (
  vpip: number,
  pfr: number,
  af: number | null = 2,
  afState: 'no-actions' | 'finite' | 'no-calls' = af === null ? 'no-actions' : 'finite',
  wtsd: number | null = 28,
) => ({ vpip, pfr, af, afState, wtsd });

const verdictOf = (
  type: Parameters<typeof evaluateTargets>[0],
  input: ReturnType<typeof targetInput>,
  metric: string,
): string | undefined => evaluateTargets(type, input).find((c) => c.metric === metric)?.verdict;

describe('evaluateTargets', () => {
  it('TAG：VPIP/PFR 命中但 ratio 0.77 < 0.78 判 fail（§4「联合成立」）', () => {
    const input = targetInput(0.22, 0.17);
    expect(verdictOf('TAG', input, 'VPIP%')).toBe('pass');
    expect(verdictOf('TAG', input, 'PFR%')).toBe('pass');
    expect(verdictOf('TAG', input, 'ratio')).toBe('fail');
  });

  it('TAG：ratio 恰为 0.78 判 pass（下界含）', () => {
    expect(verdictOf('TAG', targetInput(0.25, 0.195), 'ratio')).toBe('pass');
  });

  it('Nit：VPIP 12 判 pass、13 判 pass、14 判 fail（上界含）', () => {
    expect(verdictOf('Nit', targetInput(0.12, 0.09), 'VPIP%')).toBe('pass');
    expect(verdictOf('Nit', targetInput(0.13, 0.09), 'VPIP%')).toBe('pass');
    expect(verdictOf('Nit', targetInput(0.14, 0.09), 'VPIP%')).toBe('fail');
  });

  it('Fish：WTSD 恰为 30 判 pass（§4 写 `<=30`）', () => {
    expect(verdictOf('Fish', targetInput(0.4, 0.14, 1.0, 'finite', 30), 'WTSD%')).toBe('pass');
    expect(verdictOf('Fish', targetInput(0.4, 0.14, 1.0, 'finite', 31), 'WTSD%')).toBe('fail');
  });

  it('Fish：AF 恰为 1.5 判 fail（§4 写 `<1.5`，上界**不含**）', () => {
    expect(verdictOf('Fish', targetInput(0.4, 0.14, 1.5), 'AF')).toBe('fail');
    expect(verdictOf('Fish', targetInput(0.4, 0.14, 1.49), 'AF')).toBe('pass');
  });

  it('CS：WTSD 恰为 36 判 pass（下界含）；35 判 fail', () => {
    expect(verdictOf('Calling Station', targetInput(0.4, 0.14, 1.0, 'finite', 36), 'WTSD%')).toBe('pass');
    expect(verdictOf('Calling Station', targetInput(0.4, 0.14, 1.0, 'finite', 35), 'WTSD%')).toBe('fail');
  });

  it('LAG：AF 恰为 2.0 判 pass（下界含）', () => {
    expect(verdictOf('LAG', targetInput(0.32, 0.26, 2.0), 'AF')).toBe('pass');
    expect(verdictOf('LAG', targetInput(0.32, 0.26, 1.99), 'AF')).toBe('fail');
  });

  it('缺 AF 证据判 no-evidence（不是 fail）', () => {
    expect(verdictOf('LAG', targetInput(0.32, 0.26, null, 'no-actions'), 'AF')).toBe('no-evidence');
  });

  it('零跟注态（no-calls）按 §9.3 视为 ∞：下界判 pass、上界判 fail', () => {
    const noCalls = targetInput(0.32, 0.26, null, 'no-calls');
    expect(verdictOf('LAG', noCalls, 'AF')).toBe('pass');
    const fishNoCalls = targetInput(0.4, 0.14, null, 'no-calls');
    expect(verdictOf('Fish', fishNoCalls, 'AF')).toBe('fail');
  });

  it('没有目标区间的类型（Nit 无 WTSD 项）不产出该条', () => {
    expect(evaluateTargets('Nit', targetInput(0.12, 0.09)).map((c) => c.metric)).toEqual([
      'VPIP%',
      'PFR%',
    ]);
  });

  it('六个类型的区间都覆盖到 §4 的每一列（防止漏抄）', () => {
    expect(TARGET_INTERVALS.Nit.wtsdMin ?? TARGET_INTERVALS.Nit.wtsdMax).toBeUndefined();
    expect(TARGET_INTERVALS.Maniac.afMin).toBe(4.0);
    expect(TARGET_INTERVALS['Calling Station'].wtsdMin).toBe(36);
    expect(TARGET_INTERVALS.Fish.wtsdMax).toBe(30);
    expect(TARGET_INTERVALS.LAG.ratioMin).toBe(0.8);
    expect(TARGET_INTERVALS.TAG.ratioMin).toBe(0.78);
  });
});

// ── 代理策略 ─────────────────────────────────────────────────────────────────

const proxyCtx = (over: Partial<ProxyContext> = {}): ProxyContext => ({
  toCall: 0,
  pot: 100,
  canCheck: true,
  canCall: false,
  canRaise: true,
  minRaiseAdditional: 20,
  shortOfCall: false,
  ...over,
});

const never = () => 0.99;
const always = () => 0;

describe('proxyDecide', () => {
  it('权益 ≥0.70 且可加注 → 价值加注（最小合法追加额）', () => {
    const d = proxyDecide(proxyCtx(), 0.8, never);
    expect(d.action).toBe('raise');
    expect(d.amount).toBe(20);
  });

  it('无跟注压力、权益在诈唬区间、随机数低于频率 → 诈唬加注', () => {
    expect(proxyDecide(proxyCtx(), 0.4, always).action).toBe('raise');
    expect(proxyDecide(proxyCtx(), 0.4, never).action).toBe('check');
  });

  it('权益低于诈唬下限时即使随机数命中也不诈唬', () => {
    expect(proxyDecide(proxyCtx(), 0.2, always).action).toBe('check');
  });

  it('可加注为假时不加注，退回过牌', () => {
    expect(proxyDecide(proxyCtx({ canRaise: false }), 0.9, never).action).toBe('check');
  });

  it('权益 ≥ 底池赔率 + 余量 → 跟注', () => {
    // toCall 25 / (pot 100 + toCall 25) = 0.2，+0.02 余量 = 0.22
    const ctx = proxyCtx({ toCall: 25, canCheck: false, canCall: true });
    expect(proxyDecide(ctx, 0.25, never).action).toBe('call');
  });

  it('权益刚好等于赔率（差 0.02 余量）→ 弃牌', () => {
    const ctx = proxyCtx({ toCall: 25, canCheck: false, canCall: true });
    expect(proxyDecide(ctx, 0.2, never).action).toBe('fold');
  });

  it('筹码不足以跟注但权益够 → 全下（等同跟注）', () => {
    const ctx = proxyCtx({
      toCall: 500,
      pot: 100,
      canCheck: false,
      canCall: false,
      canRaise: false,
      shortOfCall: true,
    });
    expect(proxyDecide(ctx, 0.9, never).action).toBe('allin');
  });

  it('筹码不足以跟注且权益不够 → 弃牌', () => {
    const ctx = proxyCtx({
      toCall: 500,
      pot: 100,
      canCheck: false,
      canCall: false,
      canRaise: false,
      shortOfCall: true,
    });
    expect(proxyDecide(ctx, 0.1, never).action).toBe('fold');
  });

  it('无跟注压力且不可过牌时不会产出过牌（防御性）', () => {
    // toCall === 0 但 canCheck 为假属于构造异常；策略应落到 fold 而不是非法 check。
    const ctx = proxyCtx({ toCall: 0, canCheck: false, canCall: false, canRaise: false });
    expect(proxyDecide(ctx, 0.1, never).action).toBe('fold');
  });
});

// ── 报告格式 ─────────────────────────────────────────────────────────────────

const metricsFixture = (over: Partial<TypeMetrics> = {}): TypeMetrics => ({
  handsDealt: 200,
  playerType: 'TAG',
  vpip: 0.22,
  pfr: 0.18,
  af: 2.5,
  afState: 'finite',
  afAggressive: 50,
  afCalls: 20,
  wtsd: 28,
  wsd: 55,
  cbet: 60,
  threeBet: 7,
  foldToCbet: 45,
  turnCbet: 50,
  checkRaise: 8,
  afq: 60,
  counts: {
    vpip: { num: 44, den: 200 },
    pfr: { num: 36, den: 200 },
    wtsd: { num: 28, den: 100 },
    wsd: { num: 11, den: 20 },
    cbet: { num: 30, den: 50 },
    threeBet: { num: 7, den: 100 },
    foldToCbet: { num: 9, den: 20 },
    turnCbet: { num: 5, den: 10 },
    checkRaise: { num: 4, den: 50 },
    afq: { num: 60, den: 100 },
  },
  ...over,
});

const typeFixture = (over: Partial<TypeReport> = {}): TypeReport => ({
  groupType: 'TAG',
  observedPlayerType: 'TAG',
  metrics: metricsFixture(),
  checks: evaluateTargets('TAG', targetInput(0.22, 0.18)),
  seatHistogram: { '2': 100, '3': 100 },
  vpipBySeed: { '101': 21, '211': 23 },
  ...over,
});

const reportFixture = (over: Partial<CalibrationReport> = {}): CalibrationReport => ({
  label: 'unit',
  generatedAt: '2026-01-01T00:00:00.000Z',
  gitSha: 'abc1234',
  config: DEFAULT_CALIBRATION_CONFIG,
  notes: ['备注一'],
  hands: 200,
  decisions: 1000,
  rejectedBotDecisions: 0,
  rejectedBotByKind: {},
  elapsedMs: 12_345,
  equityIterations: null,
  stoppedBy: 'opportunities',
  types: [typeFixture()],
  confusion: { TAG: { TAG: 200 } },
  ...over,
});

describe('formatReport', () => {
  it('报告头带出配置、规模与机会数判定', () => {
    const text = formatReport(reportFixture());
    expect(text).toContain('# Bot 性格闭环校准报告 — unit');
    expect(text).toContain('- git SHA：abc1234');
    expect(text).toContain('R1/B5');
    expect(text).toContain('生产值（preflop400/flop350/turn300/river300）');
    expect(text).toContain('机会数判定：达标（样本充分）');
    expect(text).toContain('12.3s');
  });

  it('未达机会数时明确写「样本不充分」而不是「通过」', () => {
    const text = formatReport(reportFixture({ stoppedBy: 'hand-limit' }));
    expect(text).toContain('样本不充分');
    expect(text).not.toContain('达标（样本充分）');
  });

  it('每类型小节带原始分子/分母、Wilson 区间与座位分布', () => {
    const text = formatReport(reportFixture());
    expect(text).toContain('### TAG（分配）→ 实测 TAG');
    expect(text).toContain('| VPIP% | 44/200 | 22.0 |');
    expect(text).toContain('座位2:100  座位3:100');
    expect(text).toContain('分 seed VPIP%：seed101:21.0  seed211:23.0');
  });

  it('混淆矩阵按 分配 → 实测 渲染', () => {
    const text = formatReport(reportFixture());
    expect(text).toContain('## 分类回归（分配 → 实测）');
    expect(text).toContain('| TAG | 200 |');
  });

  it('被拒 Bot 决策为 0 时不出现告警小节', () => {
    const text = formatReport(reportFixture());
    expect(text).not.toContain('生产缺陷信号');
  });

  it('被拒 Bot 决策 > 0 时列出归类（> 0 即生产缺陷）', () => {
    const text = formatReport(
      reportFixture({
        rejectedBotDecisions: 3,
        rejectedBotByKind: { 'raise@flop/TAG :: amount=undefined': 3 },
      }),
    );
    expect(text).toContain('生产缺陷信号');
    expect(text).toContain('**3**');
    expect(text).toContain('`raise@flop/TAG :: amount=undefined`：3 次');
  });

  it('CS 的 WTSD 区间下界 ≤35 时按决策 43 判「样本不充分」', () => {
    const cs = typeFixture({
      groupType: 'Calling Station',
      observedPlayerType: 'Fish',
      metrics: metricsFixture({
        wtsd: 40,
        counts: { ...metricsFixture().counts, wtsd: { num: 2, den: 5 } },
      }),
      checks: evaluateTargets('Calling Station', targetInput(0.4, 0.14, 1.0, 'finite', 40)),
    });
    const text = formatReport(reportFixture({ types: [cs] }));
    expect(text).toContain('CS WTSD 区间下界');
    expect(text).toContain('样本不充分');
    expect(text).toContain('追加样本，不改阈值');
  });

  it('TYPE_ORDER 是六类 + Unknown（Unknown 恒在最后）', () => {
    expect(TYPE_ORDER).toEqual([
      'TAG',
      'LAG',
      'Fish',
      'Nit',
      'Calling Station',
      'Maniac',
      'Unknown',
    ]);
  });
});
