/**
 * P1：机器人决策 golden 基线（**无 persona**）。
 *
 * 见 `./helpers/botDecisionBaseline.ts` 的模块注释 —— 那里解释了为什么需要它、
 * 冻结的粒度（action/amount + 随机消费 + 权益调用次数）、两个随机源如何分别固定、
 * 以及为什么每个 case 要用唯一牌面。
 *
 * ## 两种**互斥**模式（各自独立 jest 运行）
 *
 * - 生成：`UPDATE_BOT_DECISION_BASELINE=1 npx jest botAI.decisionBaseline`
 * - 校验：`npx jest botAI.decisionBaseline`
 *
 * ⚠️ **不要**在同一次运行里又生成又校验：那会把每个 case 执行两遍，第二遍命中
 * `boardTexture` 的牌面 memo，`equityCalls` 随之减少。两种模式各跑一遍是刻意的。
 *
 * 生成是**显式**动作：默认（无 env）绝不写盘，避免「为失败随手刷新快照」。
 */

import * as equityCalculator from '../equityCalculator';
import { getBotAction } from '../botAI';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig, setRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';

import fs from 'node:fs';

import {
  BASELINE_CASES,
  BASELINE_FIXTURE_PATH,
  SESSION_STORAGE_KEY,
  currentGitSha,
  materializeState,
  readBaselineFixture,
  writeBaselineFixture,
  type BaselineCase,
  type BaselineEvidence,
  type BaselineFixture,
  type BaselineRecord,
} from './helpers/botDecisionBaseline';

const UPDATE = process.env.UPDATE_BOT_DECISION_BASELINE === '1';

/**
 * 执行一个 case 并收集可复现证据。
 *
 * 所有会跨 case 泄漏的全局状态都在这里复位：引擎/赛制（gtoConfig）、抽水（rake）、
 * 会话画像（opponentModel 的内存 + localStorage）、策略随机源。两个随机源分别固定。
 */
function runCase(c: BaselineCase): BaselineEvidence {
  const state = materializeState(c);

  resetGtoConfig();
  resetRakeConfig();
  resetOpponentStats();
  resetRandomSource();

  setGtoConfig(c.config);
  if (c.rake) setRakeConfig(c.rake);
  if (c.session) {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, ...c.session }),
    );
  }

  const mathSpy = jest
    .spyOn(Math, 'random')
    .mockImplementation(mulberry32(c.seeds.mathRandom));
  const equitySpy = jest.spyOn(equityCalculator, 'calculateEquity');

  let strategyRandomCalls = 0;
  const strategyStream = mulberry32(c.seeds.strategy);
  setRandomSource(() => {
    strategyRandomCalls += 1;
    return strategyStream();
  });

  try {
    const player = state.players.find((p) => p.id === c.playerId);
    if (!player) {
      throw new Error(`case ${c.caseId}：playerId ${c.playerId} 不在 state.players 中`);
    }
    const decision = getBotAction(player, state);

    return {
      action: decision.action,
      amount: decision.amount ?? null,
      equityCalls: equitySpy.mock.calls.length,
      // calculateEquity(holeCards, community, numOpponents, iterations, options?)
      equityIterations: equitySpy.mock.calls.map((call) => call[3] as number),
      equityNumOpponents: equitySpy.mock.calls.map((call) => call[2] as number),
      strategyRandomCalls,
    };
  } finally {
    mathSpy.mockRestore();
    equitySpy.mockRestore();
    resetRandomSource();
    resetGtoConfig();
    resetRakeConfig();
    resetOpponentStats();
  }
}

function buildFixture(): BaselineFixture {
  const cases: BaselineRecord[] = BASELINE_CASES.map((c) => ({
    ...c,
    expected: runCase(c),
  }));
  return {
    meta: {
      baselineSha: currentGitSha(),
      generatedAt: new Date().toISOString().slice(0, 10),
      persona: 'off（性格系统未接线；P1 阶段）',
      note: '前置统计/合法性修复（P0a–P0g）完成后的无 persona 决策基线；性格接线后用于零回归对比。',
    },
    cases,
  };
}

describe('Bot 决策基线 fixture（P1）', () => {
  beforeEach(() => {
    localStorage.clear();
    resetOpponentStats();
    resetRandomSource();
    resetGtoConfig();
    resetRakeConfig();
  });

  afterAll(() => {
    localStorage.clear();
    resetOpponentStats();
    resetRandomSource();
    resetGtoConfig();
    resetRakeConfig();
  });

  if (UPDATE) {
    it('【生成模式】执行全部 case 并写出 fixture', () => {
      const fixture = buildFixture();
      writeBaselineFixture(fixture);
      expect(fixture.cases).toHaveLength(BASELINE_CASES.length);
      expect(fs.existsSync(BASELINE_FIXTURE_PATH)).toBe(true);
    });
  } else {
    it('fixture 存在且 case 清单逐条对齐（无遗漏、无多余）', () => {
      const fixture = readBaselineFixture();
      expect(fixture.cases.map((r) => r.caseId)).toEqual(
        BASELINE_CASES.map((c) => c.caseId),
      );
    });

    for (const c of BASELINE_CASES) {
      it(`${c.caseId}：${c.description}`, () => {
        const fixture = readBaselineFixture();
        const record = fixture.cases.find((r) => r.caseId === c.caseId);
        expect(record).toBeDefined();
        if (!record) return;

        // 输入也逐条相等 —— 防止 fixture 与 case 定义悄悄漂移
        expect(record.state).toEqual(JSON.parse(JSON.stringify(c.state)));
        expect(record.playerId).toBe(c.playerId);
        expect(record.config).toEqual(c.config);
        expect(record.rake).toEqual(c.rake);
        expect(record.session).toEqual(c.session);
        expect(record.seeds).toEqual(c.seeds);

        expect(runCase(c)).toEqual(record.expected);
      });
    }
  }
});
