/**
 * 闭环校准 runner 的**纯逻辑层**（方案 §10.4 / §12.3 的 P9 行）。
 *
 * 这里只放「无副作用、可单测」的东西：配置解析、Wilson 区间、目标区间判定、
 * 真人代理策略、报告格式化。真正驱动生产 reducer 的循环在
 * `calibrationRunner.ts`（它 import 本模块）。
 *
 * 拆开的目的很直接：**runner 本身必须单测**，但一次真实校准是分钟级长跑，
 * 不能塞进默认 Jest（方案 §10.4：「不新增自动收集的 30 分钟 calibration.test.ts」）。
 * 于是把能确定性断言的部分抽到这里，测试只覆盖这一层。
 */

import type { Action } from '../src/types/poker';
import { BOT_PERSONALITY_TYPES } from '../src/utils/botPersonality';
import type { BotPersonality } from '../src/utils/botPersonality';

// ── 配置 ─────────────────────────────────────────────────────────────────────

/** 真人代理策略的固定常数（**公开记录**，方案 §10.4「固定一种公开记录的代理策略」）。 */
export const PROXY_POLICY = {
  /** 权益 ≥ 此值且可加注 → 价值加注。 */
  valueRaiseEquity: 0.7,
  /** 无跟注压力（`toCall === 0`）且权益落在 [诈唬下限, 价值下限) 时按此频率下注。 */
  bluffEquityFloor: 0.3,
  bluffFrequency: 0.06,
  /** 跟注需要超过底池赔率的余量（避免零边际跟注）。 */
  callMargin: 0.02,
} as const;

export interface CalibrationConfig {
  /** ≥5 个独立种子（决策 43）。 */
  seeds: number[];
  realPlayers: number;
  botPlayers: number;
  smallBlind: number;
  /** 每个种子跑多少手（固定预算；机会数是否达标在跑完后判定，不提前停）。 */
  handsPerSeed: number;
  /**
   * 每个「盘」（会话）的手数。
   *
   * ⚠️ 这是**runner 参数**，不是生产常数：生产里一个盘的长度由用户决定。
   * 它同时是性能护栏 —— 会话画像（`opponentModel`）每手累积，而
   * `botAI.getBotAction` 每次都按会话全量重算对手统计，成本随会话手数线性增长。
   */
  handsPerSession: number;
  /** `null` = 用生产迭代数（`equityIterations`）；数字 = 低迭代初筛。 */
  equityIterations: number | null;
  gto: boolean;
  scenario: 'cash' | 'tournament';
  /** 停止规则的资源下限（方案 §10.4 初值）。 */
  minPlayerHandsPerType: number;
  minFlopOpportunities: number;
  minAfCalls: number;
  minOtherOpportunities: number;
  /** 报告里的说明文字（由 CLI 传入，进报告头）。 */
  label: string;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  // 决策 43：≥5 seed。取质数避免与 mulberry32 的 32 位状态产生同相位采样。
  seeds: [101, 211, 307, 401, 503],
  // 决策 33：首轮完整验收桌型 = 六人 1 真人 + 5 Bot（无 Maniac）。
  realPlayers: 1,
  botPlayers: 5,
  smallBlind: 10,
  // 5 seed × 600 手 = 3000 手；六人桌下每类恰有 1 个座位 ⇒ 池化后每类约 3000
  // player-hand，刚好越过 §10.4 的 2000 下限（初筛用 --handsPerSeed 调小）。
  handsPerSeed: 600,
  handsPerSession: 200,
  equityIterations: null,
  gto: false,
  scenario: 'cash',
  minPlayerHandsPerType: 2000,
  minFlopOpportunities: 400,
  minAfCalls: 100,
  minOtherOpportunities: 100,
  label: 'default',
};

const NUMBER_KEYS = [
  'realPlayers',
  'botPlayers',
  'smallBlind',
  'handsPerSeed',
  'handsPerSession',
  'minPlayerHandsPerType',
  'minFlopOpportunities',
  'minAfCalls',
  'minOtherOpportunities',
] as const;

/**
 * 解析 `--key=value` 形式的 CLI 参数。
 *
 * 只认白名单键：写错一个键名**报错**而不是静默忽略 —— 静默忽略会让一次「改了参数」
 * 的校准其实跑的默认值，报告里的数字与意图不符却看不出来。
 */
export function parseCalibrationArgs(
  argv: readonly string[],
  base: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationConfig {
  const cfg: CalibrationConfig = { ...base, seeds: [...base.seeds] };

  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      throw new Error(`未知参数（缺少 -- 前缀）：${raw}`);
    }
    const eq = raw.indexOf('=');
    if (eq < 0) throw new Error(`参数必须是 --key=value 形式：${raw}`);
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);

    if (key === 'seeds') {
      const seeds = value.split(',').map((s) => Number(s.trim()));
      if (seeds.length === 0 || seeds.some((s) => !Number.isFinite(s))) {
        throw new Error(`seeds 必须是逗号分隔的数字：${value}`);
      }
      cfg.seeds = seeds;
      continue;
    }
    if (key === 'equityIterations') {
      if (value === 'production' || value === 'null') {
        cfg.equityIterations = null;
      } else {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`equityIterations 必须是正整数或 production：${value}`);
        }
        cfg.equityIterations = n;
      }
      continue;
    }
    if (key === 'gto') {
      if (value !== 'true' && value !== 'false') {
        throw new Error(`gto 必须是 true/false：${value}`);
      }
      cfg.gto = value === 'true';
      continue;
    }
    if (key === 'scenario') {
      if (value !== 'cash' && value !== 'tournament') {
        throw new Error(`scenario 必须是 cash/tournament：${value}`);
      }
      cfg.scenario = value;
      continue;
    }
    if (key === 'label') {
      cfg.label = value;
      continue;
    }
    if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${key} 必须是数字：${value}`);
      (cfg as unknown as Record<string, number>)[key] = n;
      continue;
    }
    throw new Error(`未知参数键：${key}`);
  }

  if (cfg.seeds.length < 5) {
    throw new Error(
      `决策 43 要求 ≥5 个独立 seed，当前只有 ${cfg.seeds.length} 个：${cfg.seeds.join(',')}`,
    );
  }
  if (cfg.realPlayers + cfg.botPlayers > 10) {
    throw new Error(
      `总人数不得超过 10（PlayerId 域）：${cfg.realPlayers}+${cfg.botPlayers}`,
    );
  }
  if (cfg.handsPerSession < 1) throw new Error('handsPerSession 必须 ≥1');
  return cfg;
}

// ── Wilson 区间 ──────────────────────────────────────────────────────────────

export interface Interval {
  low: number;
  high: number;
}

/**
 * 比例的 95% Wilson 置信区间（**百分数**口径，与报告里的比率一致）。
 *
 * 用 Wilson 而不是正态近似：`num=0` 或 `num=den` 时正态近似会给出越界区间，
 * 而 WSD / 3-bet 这类指标在小样本下经常落在边界上。
 *
 * `den === 0` 返回 `null`（无机会 ⇒ 没有区间可谈，**不伪造** [0,100]）。
 */
export function wilsonInterval(
  num: number,
  den: number,
  z = 1.96,
): Interval | null {
  if (den <= 0) return null;
  const n = den;
  const p = num / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, (center - half) * 100),
    high: Math.min(100, (center + half) * 100),
  };
}

// ── 目标区间（方案 §4，工作目标，非分类硬边界） ───────────────────────────────

/**
 * 目标区间。上下界的**开闭**逐条照抄 §4，不做统一：那里 ratio/WTSD 写 `<=` / `>=`，
 * AF 写 `<`，混用是有意的（AF 的上界是「不到 1.5」而不是「不超过 1.5」）。
 * 统一成闭区间会让 1.5 这个恰值两边都判错，而 §3.5 的反例表正是在恰值上做区分。
 */
export interface TargetInterval {
  vpip?: [number, number];
  pfr?: [number, number];
  /** ratio 下界（含）。 */
  ratioMin?: number;
  /** ratio 上界（含）。 */
  ratioMax?: number;
  /** AF 下界（含）。 */
  afMin?: number;
  /** AF 上界（**不含**）。 */
  afMaxExclusive?: number;
  /** WTSD 下界（含）。 */
  wtsdMin?: number;
  /** WTSD 上界（含）。 */
  wtsdMax?: number;
}

export const TARGET_INTERVALS: Readonly<Record<BotPersonality, TargetInterval>> = {
  Nit: { vpip: [10, 13], pfr: [7, 11] },
  TAG: { vpip: [20, 25], pfr: [16, 20], ratioMin: 0.78 },
  LAG: { vpip: [28, 36], pfr: [24, 30], ratioMin: 0.8, afMin: 2.0 },
  Fish: {
    vpip: [38, 45],
    pfr: [12, 17],
    ratioMax: 0.45,
    afMaxExclusive: 1.5,
    wtsdMax: 30,
  },
  'Calling Station': {
    vpip: [38, 45],
    pfr: [12, 17],
    ratioMax: 0.45,
    afMaxExclusive: 1.5,
    wtsdMin: 36,
  },
  Maniac: { vpip: [40, 50], pfr: [32, 45], ratioMin: 0.78, afMin: 4.0 },
};

export type Verdict = 'pass' | 'fail' | 'no-evidence';

export interface TargetCheck {
  metric: string;
  /** 展示值（VPIP/PFR/WTSD 为百分数；ratio/AF 为比率）。`Infinity` 表示零跟注态。 */
  value: number | null;
  /** 人类可读的目标描述。 */
  target: string;
  verdict: Verdict;
}

/** 判定所需的实测事实。 */
export interface TargetInput {
  vpip: number;
  pfr: number;
  af: number | null;
  afState: 'no-actions' | 'finite' | 'no-calls';
  wtsd: number | null;
}

/**
 * 逐条判定某类型的实测指标是否落在 §4 目标区间。
 *
 * ⚠️ §4 明确「所有条件必须**联合**满足」——所以返回的是一组 check，
 * 调用方必须整体看，不能挑着看。
 *
 * 两种「没有数字」要分开处理：
 * - **缺证据**（`null`，例如该类型一次摊牌都没走到）判 `no-evidence` —— 那是样本问题，
 *   不是行为不达标，按 §10.4 的口径应判「不充分」而不是 fail；
 * - **零跟注态**（`afState === 'no-calls'`）按 §9.3 / 决策 37：数学比较中视为
 *   「高于任意有限阈值」，所以 `afMin` 判 pass、`afMaxExclusive` 判 fail。
 *   报告里显示 `Infinity` 而不是把它当缺失。
 */
export function evaluateTargets(
  type: BotPersonality,
  m: TargetInput,
): TargetCheck[] {
  const t = TARGET_INTERVALS[type];
  const ratio = m.vpip > 0 ? m.pfr / m.vpip : null;
  const checks: TargetCheck[] = [];

  const push = (metric: string, value: number | null, target: string, ok: boolean | null): void => {
    checks.push({
      metric,
      value,
      target,
      verdict: ok === null ? 'no-evidence' : ok ? 'pass' : 'fail',
    });
  };

  const inRange = (
    metric: string,
    value: number | null,
    range: [number, number] | undefined,
  ): void => {
    if (!range) return;
    const target = `${range[0]}–${range[1]}`;
    if (value === null) push(metric, value, target, null);
    else push(metric, value, target, value >= range[0] && value <= range[1]);
  };

  /** ratio：上界含、下界含（§4 写 `<=` / `>=`）。 */
  const ratioBound = (value: number | null): void => {
    if (t.ratioMin === undefined && t.ratioMax === undefined) return;
    const target =
      t.ratioMin !== undefined ? `≥ ${t.ratioMin}` : `≤ ${t.ratioMax}`;
    if (value === null) push('ratio', value, target, null);
    else
      push(
        'ratio',
        value,
        target,
        (t.ratioMin === undefined || value >= t.ratioMin) &&
          (t.ratioMax === undefined || value <= t.ratioMax),
      );
  };

  /** AF：下界含、上界**不含**（§4 的 `< 1.5`）；零跟注态视为 +∞。 */
  const afBound = (): void => {
    if (t.afMin === undefined && t.afMaxExclusive === undefined) return;
    const target =
      t.afMin !== undefined ? `≥ ${t.afMin}` : `< ${t.afMaxExclusive}`;
    if (m.af === null && m.afState !== 'no-calls') {
      push('AF', null, target, null);
      return;
    }
    const value = m.afState === 'no-calls' ? Infinity : (m.af as number);
    push(
      'AF',
      value,
      target,
      (t.afMin === undefined || value >= t.afMin) &&
        (t.afMaxExclusive === undefined || value < t.afMaxExclusive),
    );
  };

  const wtsdBound = (value: number | null): void => {
    if (t.wtsdMin === undefined && t.wtsdMax === undefined) return;
    const target =
      t.wtsdMin !== undefined ? `≥ ${t.wtsdMin}` : `≤ ${t.wtsdMax}`;
    if (value === null) push('WTSD%', value, target, null);
    else
      push(
        'WTSD%',
        value,
        target,
        (t.wtsdMin === undefined || value >= t.wtsdMin) &&
          (t.wtsdMax === undefined || value <= t.wtsdMax),
      );
  };

  inRange('VPIP%', m.vpip * 100, t.vpip);
  inRange('PFR%', m.pfr * 100, t.pfr);
  ratioBound(ratio);
  afBound();
  wtsdBound(m.wtsd);
  return checks;
}

// ── 真人代理策略 ─────────────────────────────────────────────────────────────

/** 代理策略做决定所需的**最小**局面事实（由 runner 从 `GameState` 提炼）。 */
export interface ProxyContext {
  toCall: number;
  /** 底池总额（主池 + 边池），跟注赔率的分母用 `pot + toCall`。 */
  pot: number;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  /** 最小合法加注的**追加额**（`toCall + lastRaiseBet`）。 */
  minRaiseAdditional: number;
  /** 筹码不足以跟注（只能弃牌或全下）。 */
  shortOfCall: boolean;
}

export interface ProxyDecision {
  action: Action;
  amount?: number;
  reason: string;
}

/**
 * 真人座位的**固定代理策略**（方案 §10.4）。
 *
 * 它是「测试对手」，不是产品分配的一部分，也不读任何 persona 参数 —— 这样校准
 * 测到的差异只来自 Bot 性格，不来自代理策略本身。规则公开且确定：
 *
 * 1. 权益 ≥ `valueRaiseEquity` 且可加注 → 价值加注（最小合法追加额）；
 * 2. `toCall === 0`（无跟注压力）时，权益落在诈唬区间 → 按固定频率下注；
 * 3. `toCall === 0` → 过牌；
 * 4. 权益 ≥ 底池赔率 + `callMargin` → 跟注；筹码不够跟注时以全下代替（等同跟注）；
 * 5. 其余 → 弃牌。
 *
 * 纯函数：权益与随机源都由调用方注入 ⇒ 可以逐分支单测。
 */
export function proxyDecide(
  ctx: ProxyContext,
  equity: number,
  rng: () => number,
): ProxyDecision {
  const potOdds = ctx.toCall > 0 ? ctx.toCall / (ctx.pot + ctx.toCall) : 0;

  if (ctx.canRaise && equity >= PROXY_POLICY.valueRaiseEquity) {
    return {
      action: 'raise',
      amount: ctx.minRaiseAdditional,
      reason: `equity ${equity.toFixed(3)} ≥ ${PROXY_POLICY.valueRaiseEquity} → 价值加注`,
    };
  }

  if (ctx.toCall === 0) {
    if (
      ctx.canRaise &&
      equity >= PROXY_POLICY.bluffEquityFloor &&
      rng() < PROXY_POLICY.bluffFrequency
    ) {
      return {
        action: 'raise',
        amount: ctx.minRaiseAdditional,
        reason: `无跟注压力 + 固定频率诈唬（equity ${equity.toFixed(3)}）`,
      };
    }
    if (ctx.canCheck) return { action: 'check', reason: '无跟注压力 → 过牌' };
  }

  if (equity >= potOdds + PROXY_POLICY.callMargin) {
    if (ctx.canCall) return { action: 'call', reason: `equity ${equity.toFixed(3)} ≥ 赔率 ${potOdds.toFixed(3)}` };
    if (ctx.shortOfCall) {
      return { action: 'allin', reason: '筹码不足跟注 → 全下等同跟注' };
    }
  }

  return { action: 'fold', reason: `equity ${equity.toFixed(3)} < 赔率 ${potOdds.toFixed(3)}` };
}

// ── 报告 ─────────────────────────────────────────────────────────────────────

/** 与 `TypeStats` 结构兼容的**最小**指标集（不 import 统计模块，便于单测）。 */
export interface TypeMetrics {
  handsDealt: number;
  /** **实测**分类（由池化计数过分类树得出，与分配组是两种身份，§8.1）。 */
  playerType: string;
  vpip: number;
  pfr: number;
  af: number | null;
  afState: 'no-actions' | 'finite' | 'no-calls';
  afAggressive: number;
  afCalls: number;
  wtsd: number | null;
  wsd: number | null;
  cbet: number | null;
  threeBet: number | null;
  foldToCbet: number | null;
  turnCbet: number | null;
  checkRaise: number | null;
  afq: number | null;
  counts: {
    vpip: { num: number; den: number };
    pfr: { num: number; den: number };
    wtsd: { num: number; den: number };
    wsd: { num: number; den: number };
    cbet: { num: number; den: number };
    threeBet: { num: number; den: number };
    foldToCbet: { num: number; den: number };
    turnCbet: { num: number; den: number };
    checkRaise: { num: number; den: number };
    afq: { num: number; den: number };
  };
}

export interface TypeReport {
  groupType: BotPersonality | 'Unknown';
  observedPlayerType: string;
  metrics: TypeMetrics;
  checks: TargetCheck[];
  /** 该组在每个座位的 player-hand 数（决策 43「全位置」）。 */
  seatHistogram: Record<string, number>;
  /** 该组在分 seed 上的 VPIP%（稳定性）。 */
  vpipBySeed: Record<string, number>;
}

export interface CalibrationReport {
  label: string;
  generatedAt: string;
  gitSha: string;
  config: CalibrationConfig;
  /** 报告头里的额外说明（代理策略、停止规则等）。 */
  notes: string[];
  hands: number;
  decisions: number;
  /**
   * 被 `isActionAccepted` 拒掉的 Bot 决策总数。
   *
   * **> 0 即生产缺陷**：`GameBoard` 的机器人 effect 在动作被拒时只 `return`，
   * effect 依赖（`state`）没变化 ⇒ 不重跑 ⇒ 真人视角里机器人卡住。
   */
  rejectedBotDecisions: number;
  /** 上述拒绝按 `动作@街道` 的归类（定位用）。 */
  rejectedBotByKind: Record<string, number>;
  elapsedMs: number;
  /** 实际生效的权益迭代数（`null` = 生产值）。 */
  equityIterations: number | null;
  stoppedBy: 'opportunities' | 'hand-limit';
  types: TypeReport[];
  /** 分配 → 实测 的混淆矩阵（分类回归）。 */
  confusion: Record<string, Record<string, number>>;
}

const METRIC_ROWS: readonly {
  label: string;
  key: keyof TypeMetrics['counts'];
  value: (m: TypeMetrics) => number | null;
  unit: 'percent' | 'ratio';
}[] = [
  { label: 'VPIP%', key: 'vpip', value: (m) => m.vpip * 100, unit: 'percent' },
  { label: 'PFR%', key: 'pfr', value: (m) => m.pfr * 100, unit: 'percent' },
  { label: 'WTSD%', key: 'wtsd', value: (m) => m.wtsd, unit: 'percent' },
  { label: 'WSD%', key: 'wsd', value: (m) => m.wsd, unit: 'percent' },
  { label: 'CBet%', key: 'cbet', value: (m) => m.cbet, unit: 'percent' },
  { label: '3Bet%', key: 'threeBet', value: (m) => m.threeBet, unit: 'percent' },
  { label: 'FoldToCBet%', key: 'foldToCbet', value: (m) => m.foldToCbet, unit: 'percent' },
  { label: 'TurnCBet%', key: 'turnCbet', value: (m) => m.turnCbet, unit: 'percent' },
  { label: 'CheckRaise%', key: 'checkRaise', value: (m) => m.checkRaise, unit: 'percent' },
  { label: 'AFq%', key: 'afq', value: (m) => m.afq, unit: 'percent' },
];

const f = (n: number | null, digits = 2): string => {
  if (n === null) return '—';
  if (n === Infinity) return '∞';
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
};

const ci = (num: number, den: number): string => {
  const w = wilsonInterval(num, den);
  return w ? `[${f(w.low, 1)}, ${f(w.high, 1)}]` : '—';
};

/**
 * 固定格式的报告（方案 §12.3 P9「固定报告格式」）。
 *
 * 刻意不用表格库：报告要能直接贴进 PR / issue，纯文本最稳。每行都带
 * **原始分子/分母**（§9.1「先加分子/机会分母再除」的可见证据），比率本身只是派生。
 */
export function formatReport(r: CalibrationReport): string {
  const L: string[] = [];
  L.push(`# Bot 性格闭环校准报告 — ${r.label}`);
  L.push('');
  L.push(`- 生成时间：${r.generatedAt}`);
  L.push(`- git SHA：${r.gitSha}`);
  L.push(
    `- 桌型：R${r.config.realPlayers}/B${r.config.botPlayers}` +
      `（${r.config.realPlayers + r.config.botPlayers} 人，SB=${r.config.smallBlind}）`,
  );
  L.push(`- 引擎：${r.config.gto ? 'GTO' : 'heuristic'}；赛制：${r.config.scenario}；抽水：none`);
  L.push(
    `- 权益迭代：${r.equityIterations === null ? '生产值（preflop400/flop350/turn300/river300）' : `低迭代 ${r.equityIterations}`}`,
  );
  L.push(`- 种子：${r.config.seeds.join(', ')}（${r.config.seeds.length} 个）`);
  L.push(
    `- 规模：每 seed ${r.config.handsPerSeed} 手；每盘 ${r.config.handsPerSession} 手`,
  );
  L.push(
    `- 机会数判定：${r.stoppedBy === 'opportunities' ? '达标（样本充分）' : '未达标（样本不充分 → 追加样本或调参重跑，不改阈值）'}`,
  );
  for (const n of r.notes) L.push(`- ${n}`);
  L.push(
    `- 实际：${r.hands} 手 / ${r.decisions} 次决策 / 耗时 ${(r.elapsedMs / 1000).toFixed(1)}s` +
      ` / ${(r.elapsedMs / Math.max(1, r.hands)).toFixed(0)}ms 每手`,
  );
  const rejectedKinds = Object.entries(r.rejectedBotByKind)
    .map(([k, n]) => `${k}×${n}`)
    .join('  ');
  L.push(
    `- 被 reducer 拒绝的 Bot 决策：**${r.rejectedBotDecisions}**` +
      `${r.rejectedBotDecisions > 0 ? `（${rejectedKinds}）⚠️ > 0 即生产缺陷：机器人会卡住（详见报告末）` : ''}`,
  );
  L.push('');

  L.push('## 每类型结果');
  L.push('');
  for (const t of r.types) {
    const m = t.metrics;
    L.push(`### ${t.groupType}（分配）→ 实测 ${t.observedPlayerType}`);
    L.push('');
    L.push(`- player-hand：${m.handsDealt}`);
    const seats = Object.entries(t.seatHistogram)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([seat, n]) => `座位${seat}:${n}`)
      .join('  ');
    L.push(`- 座位分布：${seats || '—'}`);
    L.push(
      `- AF：${f(m.af, 3)}（${m.afState}；A=${m.afAggressive} / C=${m.afCalls}）`,
    );
    L.push('');
    const checkOf = (metric: string): TargetCheck | undefined =>
      t.checks.find((c) => c.metric === metric);
    L.push('| 指标 | 分子/分母 | 值 | 95% Wilson | 目标 | 判定 |');
    L.push('| --- | --- | ---: | --- | --- | --- |');
    for (const row of METRIC_ROWS) {
      const c = m.counts[row.key];
      const v = row.value(m);
      const chk = checkOf(row.label);
      L.push(
        `| ${row.label} | ${c.num}/${c.den} | ${f(v, row.unit === 'percent' ? 1 : 3)} | ` +
          `${ci(c.num, c.den)} | ${chk?.target ?? '—'} | ${chk?.verdict ?? '—'} |`,
      );
    }
    const ratio = m.vpip > 0 ? m.pfr / m.vpip : null;
    const ratioChk = checkOf('ratio');
    L.push(
      `| ratio | — | ${f(ratio, 3)} | — | ${ratioChk?.target ?? '—'} | ${ratioChk?.verdict ?? '—'} |`,
    );
    const afChk = checkOf('AF');
    L.push(
      `| AF | A=${m.afAggressive}/C=${m.afCalls} | ${f(m.af, 3)} | — | ` +
        `${afChk?.target ?? '—'} | ${afChk?.verdict ?? '—'}${m.afState === 'no-calls' ? '（零跟注态，视为 ∞）' : ''} |`,
    );
    L.push('');
    if (t.checks.length > 0) {
      L.push(
        `目标区间判定（§4，**联合**成立才算通过）：` +
          `${t.checks.filter((c) => c.verdict === 'pass').length}/${t.checks.length} 条通过` +
          `，${t.checks.filter((c) => c.verdict === 'fail').length} 条未达标` +
          `，${t.checks.filter((c) => c.verdict === 'no-evidence').length} 条缺证据`,
      );
      L.push('');
    }
    const bySeed = Object.entries(t.vpipBySeed)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([s, v]) => `seed${s}:${f(v, 1)}`)
      .join('  ');
    L.push(`分 seed VPIP%：${bySeed || '—'}`);
    L.push('');
  }

  L.push('## 分类回归（分配 → 实测）');
  L.push('');
  const observed = new Set<string>();
  for (const row of Object.values(r.confusion)) for (const k of Object.keys(row)) observed.add(k);
  const cols = [...observed].sort();
  L.push(`| 分配 \\ 实测 | ${cols.join(' | ')} |`);
  L.push(`| --- | ${cols.map(() => '---:').join(' | ')} |`);
  for (const [assigned, row] of Object.entries(r.confusion)) {
    L.push(`| ${assigned} | ${cols.map((c) => row[c] ?? 0).join(' | ')} |`);
  }
  L.push('');

  L.push('## 结论');
  L.push('');
  for (const t of r.types) {
    const fails = t.checks.filter((c) => c.verdict === 'fail').map((c) => c.metric);
    const noEv = t.checks.filter((c) => c.verdict === 'no-evidence').map((c) => c.metric);
    const csWtsd = t.groupType === 'Calling Station' ? wilsonInterval(
      t.metrics.counts.wtsd.num,
      t.metrics.counts.wtsd.den,
    ) : null;
    const csNote =
      csWtsd === null
        ? ''
        : `；CS WTSD 区间下界 ${f(csWtsd.low, 1)} ${csWtsd.low <= 35 ? '≤35 ⇒ **样本不充分**（决策 43：追加样本，不改阈值）' : '>35'}`;
    L.push(
      `- ${t.groupType}：${fails.length === 0 && noEv.length === 0 ? '目标区间全部通过' : ''}` +
        `${fails.length > 0 ? `未达标 → ${fails.join(', ')}` : ''}` +
        `${noEv.length > 0 ? `${fails.length > 0 ? '；' : ''}缺证据 → ${noEv.join(', ')}` : ''}${csNote}`,
    );
  }
  L.push('');

  if (r.rejectedBotDecisions > 0) {
    L.push('## ⚠️ 生产缺陷信号：被 reducer 拒绝的 Bot 决策');
    L.push('');
    L.push(
      `${r.rejectedBotDecisions} / ${r.decisions} 次 Bot 决策被 \`isActionAccepted\` 拒绝。` +
        '`GameBoard` 的机器人 effect 在动作被拒时只 `return`，而 effect 的依赖（`state`）' +
        '没有变化 ⇒ 不会重跑 ⇒ **真人视角里机器人卡住、牌局停在那里**。' +
        'runner 用兜底动作让对局继续（否则整次运行会被打断），但统计结论因此可能受轻微污染，' +
        '而且这是**独立于性格系统的生产缺陷**，必须单独定位与修复。',
    );
    L.push('');
    for (const [kind, n] of Object.entries(r.rejectedBotByKind)) {
      L.push(`- \`${kind}\`：${n} 次`);
    }
    L.push('');
  }
  return L.join('\n');
}

/** 类型组报告的稳定顺序（六类按 `BOT_PERSONALITY_TYPES`，`Unknown` 最后）。 */
export const TYPE_ORDER: readonly (BotPersonality | 'Unknown')[] = [
  ...BOT_PERSONALITY_TYPES,
  'Unknown',
];
