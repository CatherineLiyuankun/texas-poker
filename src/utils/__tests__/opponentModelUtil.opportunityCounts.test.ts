/**
 * P0c 机会分母修复的聚焦测试（plan §9.2 聚合计数表 / §9.4 反例，决策 39）。
 *
 * 锁住五件事（每项都对应一个旧实现会算错的反例）：
 *  1. CBet：必须用**全桌真实的最后翻前进攻者**（不能先按玩家过滤再找），
 *     被对手 donk 抢先下注不算机会；自己开池后被 3-bet、翻牌由对手下注，
 *     不算我的 c-bet 机会（旧实现给 0，应为 null）。
 *  2. 3Bet：机会 = 轮到我行动时前面**恰好一次**由别人做出的自愿加注；自己先
 *     open 后别人 3-bet 再加注不算我的 3-bet（那是 4-bet）；先 limp 面对 open
 *     算机会；低于 toCall 的全下是 call 不是 3-bet；每手最多 1。
 *  3. FoldToCbet：先 check 后面对 c-bet 弃牌也算；c-bet 后被插入加注不再是
 *     「直接面对 c-bet」机会；每手最多 1。
 *  4. TurnCBet：仅 flop c-bet 但没见 turn 不计入分母（旧实现会给 0，应为 null）；
 *     turn 被对手 donk 抢先下注非机会。
 *  5. CheckRaise：玩家身份**显式传入**（旧实现用 `events[0].playerId` 猜目标，
 *     完整记录下会算到别人头上）；所有人 check 过牌不是机会。
 */
import {
  computeCBetFromEvents,
  compute3BetFromEvents,
  computeFoldToCbetFromEvents,
  computeTurnCbetFromEvents,
  computeCheckRaiseFromEvents,
  computePlayerStatsFromEvents,
} from '../opponentModelUtil';
import type { ActionEvent, HandRecord } from '../../types/stats';
import type { PlayerId, Action, GamePhase } from '../../types/poker';

const P1: PlayerId = 1;
const P2: PlayerId = 2;
const P3: PlayerId = 3;

function ev(
  handId: string,
  playerId: PlayerId,
  phase: GamePhase,
  action: Action,
  timestamp: number,
  extra: { amount?: number; toCall?: number } = {},
): ActionEvent {
  const toCall = extra.toCall ?? 0;
  return {
    handId,
    playerId,
    phase,
    action,
    amount: extra.amount,
    toCall,
    currentBet: toCall,
    potSize: 0,
    position: 0,
    isFacingRaise: toCall > 0,
    timestamp,
  };
}

function hand(
  handId: string,
  players: PlayerId[],
  events: ActionEvent[],
): HandRecord {
  return { handId, timestamp: 1, players, events };
}

// ---------------------------------------------------------------------------
// CBet
// ---------------------------------------------------------------------------

describe('CBet：真实最后进攻者 + 机会口径', () => {
  it('进攻者翻牌首次合法主动下注 → 1/1', () => {
    const h = hand('cb-normal', [P1, P2], [
      ev('cb-normal', P2, 'preflop', 'raise', 1),
      ev('cb-normal', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cb-normal', P2, 'flop', 'raise', 3),
      ev('cb-normal', P1, 'flop', 'fold', 4),
    ]);
    expect(computeCBetFromEvents(P2, [h])).toBe(100);
    expect(computeCBetFromEvents(P1, [h])).toBeNull();
  });

  it('进攻者翻牌只是 check（有机会没下注）→ 分母 +1、分子 0', () => {
    const h = hand('cb-check', [P1, P2], [
      ev('cb-check', P2, 'preflop', 'raise', 1),
      ev('cb-check', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cb-check', P2, 'flop', 'check', 3),
      ev('cb-check', P1, 'flop', 'check', 4),
    ]);
    expect(computeCBetFromEvents(P2, [h])).toBe(0);
  });

  it('被对手 donk 抢先下注 → 不是机会（旧实现会算进分母）', () => {
    const h = hand('cb-donk', [P1, P2, P3], [
      ev('cb-donk', P2, 'preflop', 'raise', 1),
      ev('cb-donk', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cb-donk', P3, 'preflop', 'call', 3, { toCall: 20 }),
      ev('cb-donk', P3, 'flop', 'raise', 4), // P3 抢先下注（donk）
      ev('cb-donk', P2, 'flop', 'call', 5, { toCall: 20 }),
      ev('cb-donk', P1, 'flop', 'fold', 6),
    ]);
    expect(computeCBetFromEvents(P2, [h])).toBeNull();
  });

  it('自己开池后被 3-bet，翻牌由对手下注 → 不是我的 c-bet 机会', () => {
    // 旧实现只在自己事件里找「最后一次加注」→ 取到自己的开池 → 误给机会（0）
    const h = hand('cb-3bet', [P1, P2], [
      ev('cb-3bet', P1, 'preflop', 'raise', 1),
      ev('cb-3bet', P2, 'preflop', 'raise', 2, { toCall: 20 }),
      ev('cb-3bet', P1, 'preflop', 'call', 3, { toCall: 40 }),
      ev('cb-3bet', P2, 'flop', 'raise', 4),
      ev('cb-3bet', P1, 'flop', 'fold', 5),
    ]);
    expect(computeCBetFromEvents(P1, [h])).toBeNull();
    // 真正的最后进攻者 P2 才拿得到这次机会
    expect(computeCBetFromEvents(P2, [h])).toBe(100);
  });

  it('翻前全下 runout：进攻者没有翻牌动作 → 不是机会', () => {
    const h = hand('cb-allin', [P1, P2], [
      ev('cb-allin', P2, 'preflop', 'raise', 1),
      ev('cb-allin', P1, 'preflop', 'allin', 2, { amount: 200, toCall: 20 }),
      ev('cb-allin', P2, 'preflop', 'call', 3, { toCall: 180 }),
    ]);
    expect(computeCBetFromEvents(P2, [h])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3Bet
// ---------------------------------------------------------------------------

describe('3Bet：真实面对一次 open', () => {
  it('面对对手一次 open 后 3-bet → 1/1', () => {
    const h = hand('tb-open', [P1, P2], [
      ev('tb-open', P2, 'preflop', 'raise', 1),
      ev('tb-open', P1, 'preflop', 'raise', 2, { toCall: 20 }),
    ]);
    expect(compute3BetFromEvents(P1, [h])).toBe(100);
  });

  it('先 limp 后面对 open 再 3-bet → 算机会（1/1）', () => {
    const h = hand('tb-limp', [P1, P2], [
      ev('tb-limp', P1, 'preflop', 'call', 1, { toCall: 10 }), // limp
      ev('tb-limp', P2, 'preflop', 'raise', 2),
      ev('tb-limp', P1, 'preflop', 'raise', 3, { toCall: 20 }),
    ]);
    expect(compute3BetFromEvents(P1, [h])).toBe(100);
  });

  it('自己先 open、别人 3-bet 后再加注 → 不是我的 3-bet 机会', () => {
    const h = hand('tb-own', [P1, P2], [
      ev('tb-own', P1, 'preflop', 'raise', 1),
      ev('tb-own', P2, 'preflop', 'raise', 2, { toCall: 20 }),
      ev('tb-own', P1, 'preflop', 'raise', 3, { toCall: 60 }),
    ]);
    // 我是面对两个加注（4-bet），没有 3-bet 机会
    expect(compute3BetFromEvents(P1, [h])).toBeNull();
    // 而 P2 面对我的 open 完成了一次 3-bet
    expect(compute3BetFromEvents(P2, [h])).toBe(100);
  });

  it('低于 toCall 的全下是跟注，不是 3-bet（机会 +1、分子 0）', () => {
    const h = hand('tb-short', [P1, P2], [
      ev('tb-short', P2, 'preflop', 'raise', 1),
      ev('tb-short', P1, 'preflop', 'allin', 2, { amount: 5, toCall: 20 }),
    ]);
    expect(compute3BetFromEvents(P1, [h])).toBe(0);
  });

  it('每手最多 1：先 call、再面对第二次加注的再加注不算 3-bet', () => {
    const h = hand('tb-once', [P1, P2, P3], [
      ev('tb-once', P2, 'preflop', 'raise', 1),
      ev('tb-once', P1, 'preflop', 'call', 2, { toCall: 20 }), // 面对 open：机会（未 3-bet）
      ev('tb-once', P3, 'preflop', 'raise', 3, { toCall: 60 }),
      ev('tb-once', P1, 'preflop', 'raise', 4, { toCall: 180 }), // cold 4-bet，不重复计机会
    ]);
    expect(compute3BetFromEvents(P1, [h])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FoldToCbet
// ---------------------------------------------------------------------------

describe('FoldToCbet：直接面对 c-bet', () => {
  it('先 check 后面对 c-bet 弃牌 → 算机会且计弃牌（1/1）', () => {
    const h = hand('fc-check', [P1, P2], [
      ev('fc-check', P2, 'preflop', 'raise', 1),
      ev('fc-check', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('fc-check', P1, 'flop', 'check', 3),
      ev('fc-check', P2, 'flop', 'raise', 4), // c-bet
      ev('fc-check', P1, 'flop', 'fold', 5),
    ]);
    expect(computeFoldToCbetFromEvents(P1, [h])).toBe(100);
  });

  it('c-bet 后被插入加注 → 不再是「直接面对 c-bet」机会', () => {
    const h = hand('fc-raise', [P1, P2, P3], [
      ev('fc-raise', P2, 'preflop', 'raise', 1),
      ev('fc-raise', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('fc-raise', P3, 'preflop', 'call', 3, { toCall: 20 }),
      ev('fc-raise', P2, 'flop', 'raise', 4), // c-bet
      ev('fc-raise', P3, 'flop', 'raise', 5, { toCall: 40 }), // 插入加注
      ev('fc-raise', P1, 'flop', 'fold', 6),
    ]);
    expect(computeFoldToCbetFromEvents(P1, [h])).toBeNull();
  });

  it('进攻者翻牌只是 check（不是 c-bet）→ 无机会', () => {
    const h = hand('fc-nocb', [P1, P2], [
      ev('fc-nocb', P2, 'preflop', 'raise', 1),
      ev('fc-nocb', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('fc-nocb', P2, 'flop', 'check', 3),
      ev('fc-nocb', P1, 'flop', 'check', 4),
    ]);
    expect(computeFoldToCbetFromEvents(P1, [h])).toBeNull();
  });

  it('翻前就弃牌 → 没走到翻牌，不算机会', () => {
    const h = hand('fc-foldpf', [P1, P2], [
      ev('fc-foldpf', P2, 'preflop', 'raise', 1),
      ev('fc-foldpf', P1, 'preflop', 'fold', 2),
      ev('fc-foldpf', P2, 'flop', 'raise', 3),
    ]);
    expect(computeFoldToCbetFromEvents(P1, [h])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TurnCBet
// ---------------------------------------------------------------------------

describe('TurnCBet：必须打到转牌才算分母', () => {
  it('仅 flop c-bet、翻牌就结束（未见 turn）→ null 而不是 0', () => {
    const h = hand('tc-noturn', [P1, P2], [
      ev('tc-noturn', P2, 'preflop', 'raise', 1),
      ev('tc-noturn', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('tc-noturn', P2, 'flop', 'raise', 3),
      ev('tc-noturn', P1, 'flop', 'fold', 4),
    ]);
    expect(computeTurnCbetFromEvents(P2, [h])).toBeNull();
  });

  it('flop c-bet 后到转牌继续下注 → 1/1', () => {
    const h = hand('tc-bet', [P1, P2], [
      ev('tc-bet', P2, 'preflop', 'raise', 1),
      ev('tc-bet', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('tc-bet', P2, 'flop', 'raise', 3),
      ev('tc-bet', P1, 'flop', 'call', 4, { toCall: 20 }),
      ev('tc-bet', P2, 'turn', 'raise', 5),
      ev('tc-bet', P1, 'turn', 'fold', 6),
    ]);
    expect(computeTurnCbetFromEvents(P2, [h])).toBe(100);
  });

  it('到转牌但被对手 donk 抢先下注 → 不是机会', () => {
    const h = hand('tc-donk', [P1, P2], [
      ev('tc-donk', P2, 'preflop', 'raise', 1),
      ev('tc-donk', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('tc-donk', P2, 'flop', 'raise', 3),
      ev('tc-donk', P1, 'flop', 'call', 4, { toCall: 20 }),
      ev('tc-donk', P1, 'turn', 'raise', 5), // donk
      ev('tc-donk', P2, 'turn', 'call', 6, { toCall: 20 }),
    ]);
    expect(computeTurnCbetFromEvents(P2, [h])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CheckRaise
// ---------------------------------------------------------------------------

describe('CheckRaise：显式目标 + 必须真实面对下注', () => {
  it('用显式 playerId，不再把统计算到「全局第一个动作的人」头上', () => {
    const h = hand('cr-explicit', [P1, P2, P3], [
      ev('cr-explicit', P2, 'preflop', 'raise', 1), // 全局第一个动作是 P2
      ev('cr-explicit', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cr-explicit', P3, 'preflop', 'call', 3, { toCall: 20 }),
      ev('cr-explicit', P1, 'flop', 'check', 4),
      ev('cr-explicit', P2, 'flop', 'raise', 5),
      ev('cr-explicit', P1, 'flop', 'raise', 6, { toCall: 20 }),
      ev('cr-explicit', P2, 'flop', 'fold', 7),
    ]);
    // 旧实现取 events[0].playerId = P2 → P2 翻牌首个动作是 raise → null
    expect(computeCheckRaiseFromEvents(P1, [h])).toBe(100);
  });

  it('所有人互相 check 过牌 → 不是机会（null）', () => {
    const h = hand('cr-check', [P1, P2], [
      ev('cr-check', P2, 'preflop', 'raise', 1),
      ev('cr-check', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cr-check', P1, 'flop', 'check', 3),
      ev('cr-check', P2, 'flop', 'check', 4),
      ev('cr-check', P1, 'turn', 'check', 5),
      ev('cr-check', P2, 'turn', 'check', 6),
    ]);
    expect(computeCheckRaiseFromEvents(P1, [h])).toBeNull();
  });

  it('每街独立计数：翻牌 check-raise、转牌 check-call → 1/2', () => {
    const h = hand('cr-street', [P1, P2], [
      ev('cr-street', P2, 'preflop', 'raise', 1),
      ev('cr-street', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cr-street', P1, 'flop', 'check', 3),
      ev('cr-street', P2, 'flop', 'raise', 4),
      ev('cr-street', P1, 'flop', 'raise', 5, { toCall: 20 }),
      ev('cr-street', P2, 'flop', 'call', 6, { toCall: 20 }),
      ev('cr-street', P1, 'turn', 'check', 7),
      ev('cr-street', P2, 'turn', 'raise', 8),
      ev('cr-street', P1, 'turn', 'call', 9, { toCall: 20 }),
    ]);
    expect(computeCheckRaiseFromEvents(P1, [h])).toBe(50);
  });

  it('先 check 后面对下注弃牌 → 有 check-raise 机会但没 raise（0）', () => {
    const h = hand('cr-fold', [P1, P2], [
      ev('cr-fold', P2, 'preflop', 'raise', 1),
      ev('cr-fold', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cr-fold', P1, 'flop', 'check', 3),
      ev('cr-fold', P2, 'flop', 'raise', 4),
      ev('cr-fold', P1, 'flop', 'fold', 5),
    ]);
    expect(computeCheckRaiseFromEvents(P1, [h])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 集成：computePlayerStatsFromEvents 用完整记录
// ---------------------------------------------------------------------------

describe('computePlayerStatsFromEvents 集成（完整记录口径）', () => {
  it('check-raise 需要看到对手的下注 —— 传入完整记录才算得出来', () => {
    const h = hand('cr-integration', [P1, P2], [
      ev('cr-integration', P2, 'preflop', 'raise', 1),
      ev('cr-integration', P1, 'preflop', 'call', 2, { toCall: 20 }),
      ev('cr-integration', P1, 'flop', 'check', 3),
      ev('cr-integration', P2, 'flop', 'raise', 4),
      ev('cr-integration', P1, 'flop', 'raise', 5, { toCall: 20 }),
      ev('cr-integration', P2, 'flop', 'fold', 6),
    ]);
    expect(computePlayerStatsFromEvents(P1, [h]).checkRaise).toBe(100);

    // 反例：先把每手过滤成只有自己的动作 → 看不到对手的下注 → null
    const preFiltered = [
      {
        handId: h.handId,
        events: h.events.filter(e => e.playerId === P1),
      },
    ];
    expect(computePlayerStatsFromEvents(P1, preFiltered).checkRaise).toBeNull();
  });
});
