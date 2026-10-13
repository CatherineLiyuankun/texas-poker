/**
 * P0b 前置统计修复的聚焦测试（plan §8.2 / §9.2）。
 *
 * 锁住三件事：
 *  1. WTSD 用 `flopSeenPlayers`（翻牌发出时冻结的未弃牌名单）——
 *     翻前 all-in 后无动作的 runout 也算「看到翻牌」；
 *  2. WSD 用 `showdownWinners`（结算时从 potDistribution 汇总）——
 *     能表达多赢家 / 边池 / 平分；
 *  3. 两个新字段缺失时（历史记录）回退到旧口径，不改变历史数值。
 */
import {
  computeWTSDFromEvents,
  computeWSDFromEvents,
  computePlayerStatsFromEvents,
} from '../opponentModelUtil';
import type { ActionEvent, HandRecord } from '../../types/stats';
import type { PlayerId, Action, GamePhase } from '../../types/poker';

const P1: PlayerId = 1;
const P2: PlayerId = 2;

function ev(
  handId: string,
  playerId: PlayerId,
  phase: GamePhase,
  action: Action,
  timestamp: number,
  toCall: number = 0,
): ActionEvent {
  return {
    handId,
    playerId,
    phase,
    action,
    toCall,
    currentBet: toCall,
    potSize: 0,
    position: 0,
    isFacingRaise: toCall > 0,
    timestamp,
  };
}

describe('WTSD：flopSeenPlayers 事实', () => {
  it('翻前 all-in 的 runout（无翻后动作）仍算看到翻牌', () => {
    const hand: HandRecord = {
      handId: 'allin-runout',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('allin-runout', P1, 'preflop', 'allin', 1),
        ev('allin-runout', P2, 'preflop', 'call', 2, 100),
      ],
      // 翻牌发出时两人都未弃牌
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P1, P2],
      showdownWinners: [P2],
    };

    // 旧口径会漏（P1 没有 flop 动作），新口径必须算上
    expect(computeWTSDFromEvents(P1, [hand])).toBe(100);
    expect(computeWTSDFromEvents(P2, [hand])).toBe(100);
  });

  it('翻前弃牌的玩家不在 flopSeenPlayers 里 → 不计机会', () => {
    const hand: HandRecord = {
      handId: 'folded-pre',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('folded-pre', P1, 'preflop', 'fold', 1, 10),
        ev('folded-pre', P2, 'preflop', 'raise', 2),
      ],
      flopSeenPlayers: [P2],
      showdownPlayers: [P2],
      showdownWinners: [P2],
    };

    expect(computeWTSDFromEvents(P1, [hand])).toBeNull();
    expect(computeWTSDFromEvents(P2, [hand])).toBe(100);
  });

  it('看到翻牌但翻后弃牌 → 计机会、不计摊牌', () => {
    const hand: HandRecord = {
      handId: 'saw-flop-folded',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('saw-flop-folded', P1, 'preflop', 'call', 1, 10),
        ev('saw-flop-folded', P2, 'preflop', 'raise', 2),
        ev('saw-flop-folded', P2, 'flop', 'raise', 3),
        ev('saw-flop-folded', P1, 'flop', 'fold', 4, 20),
      ],
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P2],
      showdownWinners: [P2],
    };

    expect(computeWTSDFromEvents(P1, [hand])).toBe(0); // 1 次机会、0 次摊牌
    expect(computeWTSDFromEvents(P2, [hand])).toBe(100);
  });

  it('字段缺失（历史记录）回退旧口径：有翻后动作才算看翻牌', () => {
    const legacy: HandRecord = {
      handId: 'legacy',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('legacy', P1, 'preflop', 'call', 1, 10),
        ev('legacy', P2, 'preflop', 'raise', 2),
        ev('legacy', P1, 'turn', 'check', 3), // 有 turn 动作 → 必然见过 flop
      ],
      // 无 flopSeenPlayers
      showdownPlayers: [P1, P2],
      result: { winner: P2, potAmount: 100 },
    };

    expect(computeWTSDFromEvents(P1, [legacy])).toBe(100);
    // P2 翻前加注后无翻后动作、无 flopSeenPlayers → 旧口径漏掉
    expect(computeWTSDFromEvents(P2, [legacy])).toBeNull();
  });
});

describe('WSD：showdownWinners 事实（含平分/边池）', () => {
  it('多人平分：两个获奖者都算胜', () => {
    const hand: HandRecord = {
      handId: 'split',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('split', P1, 'preflop', 'call', 1, 10),
        ev('split', P2, 'preflop', 'check', 2),
      ],
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P1, P2],
      showdownWinners: [P1, P2], // 平分
      result: { winner: null, potAmount: 100 }, // 单 winner 表达不了平分
    };

    expect(computeWSDFromEvents(P1, [hand])).toBe(100);
    expect(computeWSDFromEvents(P2, [hand])).toBe(100);
  });

  it('边池：主池输、边池赢 → 仍算胜', () => {
    const hand: HandRecord = {
      handId: 'sidepot',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('sidepot', P1, 'preflop', 'allin', 1),
        ev('sidepot', P2, 'preflop', 'call', 2, 100),
      ],
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P1, P2],
      showdownWinners: [P2], // 例如 P1 只赢回部分，若 >0 也会出现在这里
      result: { winner: null, potAmount: 200 },
    };

    expect(computeWSDFromEvents(P1, [hand])).toBe(0);
    expect(computeWSDFromEvents(P2, [hand])).toBe(100);
  });

  it('字段缺失（历史记录）回退到单个 result.winner', () => {
    const legacy: HandRecord = {
      handId: 'legacy-wsd',
      timestamp: 1,
      players: [P1, P2],
      events: [],
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P1, P2],
      // 无 showdownWinners
      result: { winner: P1, potAmount: 100 },
    };

    expect(computeWSDFromEvents(P1, [legacy])).toBe(100);
    expect(computeWSDFromEvents(P2, [legacy])).toBe(0);
  });
});

describe('computePlayerStatsFromEvents 透传新事实字段', () => {
  it('flopSeenPlayers / showdownWinners 参与 WTSD / WSD', () => {
    const hand: HandRecord = {
      handId: 'carry',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('carry', P1, 'preflop', 'allin', 1),
        ev('carry', P2, 'preflop', 'call', 2, 100),
      ],
      flopSeenPlayers: [P1, P2],
      showdownPlayers: [P1, P2],
      showdownWinners: [P1, P2],
      result: { winner: null, potAmount: 200 },
    };

    const stats = computePlayerStatsFromEvents(P1, [hand]);
    expect(stats.wtsd).toBe(100);
    expect(stats.wsd).toBe(100);
  });

  it('缺字段的旧记录仍按旧口径算（回归）', () => {
    const legacy: HandRecord = {
      handId: 'legacy-carry',
      timestamp: 1,
      players: [P1, P2],
      events: [
        ev('legacy-carry', P1, 'preflop', 'call', 1, 10),
        ev('legacy-carry', P2, 'preflop', 'raise', 2),
        ev('legacy-carry', P1, 'flop', 'check', 3),
        ev('legacy-carry', P2, 'flop', 'check', 4),
      ],
      showdownPlayers: [P1],
      result: { winner: P1, potAmount: 100 },
    };

    const stats = computePlayerStatsFromEvents(P1, [legacy]);
    expect(stats.wtsd).toBe(100);
    expect(stats.wsd).toBe(100);
  });
});
