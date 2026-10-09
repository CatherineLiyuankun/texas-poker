/**
 * `computePlayerStatsFromEvents` 的入参契约测试。
 *
 * 这个函数过去接受「按玩家过滤过」的手牌记录，导致需要对手上下文的
 * `3-bet` / `fold-to-c-bet` 静默恒为 `null`；而长期路径传的又是完整记录，
 * 于是 `c-bet` / `WTSD` / `WSD` 被算到了「最后一个翻前加注者」头上。
 * 现在统一为「只接受完整记录，过滤自己做」。
 */
import { computePlayerStatsFromEvents } from '../opponentModelUtil';
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
): ActionEvent {
  return {
    handId,
    playerId,
    phase,
    action,
    toCall: 0,
    currentBet: 0,
    potSize: 0,
    position: 0,
    isFacingRaise: false,
    timestamp,
  };
}

/** A：P2 开池、P1 跟注；翻牌 P2 持续下注、P1 弃牌 → P1 面对 c-bet 弃牌 1/1 */
const handA: HandRecord = {
  handId: 'A',
  timestamp: 1,
  players: [P1, P2],
  events: [
    ev('A', P2, 'preflop', 'raise', 1),
    ev('A', P1, 'preflop', 'call', 2),
    ev('A', P2, 'flop', 'raise', 3),
    ev('A', P1, 'flop', 'fold', 4),
  ],
  result: { winner: P2, potAmount: 100 },
};

/** B：P2 开池、P1 3-bet → P1 3-bet 机会 1/1 */
const handB: HandRecord = {
  handId: 'B',
  timestamp: 2,
  players: [P1, P2],
  events: [
    ev('B', P2, 'preflop', 'raise', 1),
    ev('B', P1, 'preflop', 'raise', 2),
  ],
};

/**
 * C：P2 开池、P1 跟注；翻牌与转牌双方过牌，P1 进摊获胜。
 * 翻牌 P2 是 check（不是 c-bet），所以不给 P1 增加 foldToCbet 机会。
 * → P1 见到翻牌 2 手（A、C），进摊 1 手 → WTSD 50%；摊牌 1 手全胜 → WSD 100%
 */
const handC: HandRecord = {
  handId: 'C',
  timestamp: 3,
  players: [P1, P2],
  events: [
    ev('C', P2, 'preflop', 'raise', 1),
    ev('C', P1, 'preflop', 'call', 2),
    ev('C', P2, 'flop', 'check', 3),
    ev('C', P1, 'flop', 'check', 4),
    ev('C', P2, 'turn', 'check', 5),
    ev('C', P1, 'turn', 'check', 6),
  ],
  showdownPlayers: [P1],
  result: { winner: P1, potAmount: 300 },
};

/** D：与 P1 无关的一手牌（P1 既不在 players 里，也没有动作） */
const handD: HandRecord = {
  handId: 'D',
  timestamp: 4,
  players: [P2, 3],
  events: [
    ev('D', P2, 'preflop', 'raise', 1),
    ev('D', 3, 'preflop', 'call', 2),
  ],
};

const fullHands = [handA, handB, handC];

describe('computePlayerStatsFromEvents（完整手牌记录口径）', () => {
  it('foldToCbet / threeBet 在有对手动作时算得出来', () => {
    const stats = computePlayerStatsFromEvents(P1, fullHands);

    // 唯一一次面对 c-bet 就弃牌了
    expect(stats.foldToCbet).toBe(100);
    // 3 手牌都有人在自己之前加注 → 机会 3 次；只在 B 手里 3-bet → 1/3
    expect(stats.threeBet).toBeCloseTo((1 / 3) * 100, 10);
  });

  it('cbet / WTSD / WSD 只算该玩家自己的动作', () => {
    const stats = computePlayerStatsFromEvents(P1, fullHands);

    // P1 从未成为最后一个翻前加注者 → 没有 c-bet 机会
    expect(stats.cbet).toBeNull();
    expect(stats.turnCbet).toBeNull();
    // 见到翻牌 2 手（A、C），进摊 1 手
    expect(stats.wtsd).toBe(50);
    expect(stats.wsd).toBe(100);
  });

  it('VPIP / PFR / 其他比率按自己的动作算', () => {
    const stats = computePlayerStatsFromEvents(P1, fullHands);

    expect(stats.handsDealt).toBe(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBeCloseTo(1 / 3, 10);
    // 翻牌弃牌、转牌过牌 —— 没有跟注也没有加注
    expect(stats.af).toBeNull();
    expect(stats.afq).toBe(0);
    expect(stats.checkRaise).toBe(0);
  });

  it('handsDealt 只算该玩家参与过的手牌', () => {
    const stats = computePlayerStatsFromEvents(P1, [...fullHands, handD]);
    expect(stats.handsDealt).toBe(3);

    // 对手视角：D 手牌里 P2 有动作，所以要算进去
    const p2Stats = computePlayerStatsFromEvents(P2, [...fullHands, handD]);
    expect(p2Stats.handsDealt).toBe(4);
  });

  it('入参若被提前按玩家过滤，3-bet / fold-to-c-bet 就退化成 null（契约的反例）', () => {
    // 模拟旧 session 路径：每手只留 P1 自己的事件
    const preFiltered = fullHands.map((hand) => ({
      handId: hand.handId,
      events: hand.events.filter((e) => e.playerId === P1),
      showdownPlayers: hand.showdownPlayers,
      result: hand.result,
    }));

    const stats = computePlayerStatsFromEvents(P1, preFiltered);
    expect(stats.foldToCbet).toBeNull();
    expect(stats.threeBet).toBeNull();
    // 只看自己的那几项不受影响
    expect(stats.wtsd).toBe(50);
  });

  it('翻前就弃牌的手牌不算 fold-to-c-bet 机会', () => {
    /** E：P1 翻前直接弃牌，P2 独自在翻牌下注 */
    const handE: HandRecord = {
      handId: 'E',
      timestamp: 5,
      players: [P1, P2],
      events: [
        ev('E', P2, 'preflop', 'raise', 1),
        ev('E', P1, 'preflop', 'fold', 2),
        ev('E', P2, 'flop', 'raise', 3),
      ],
    };

    const stats = computePlayerStatsFromEvents(P1, [...fullHands, handE]);
    // P1 没走到翻牌 → 不构成一次机会，比率仍是唯一那一次的 100%
    expect(stats.foldToCbet).toBe(100);
    expect(stats.handsDealt).toBe(4);
  });

  it('没有手牌时全部为 null / Unknown', () => {
    const stats = computePlayerStatsFromEvents(P1, []);

    expect(stats.handsDealt).toBe(0);
    expect(stats.vpip).toBe(0);
    expect(stats.pfr).toBe(0);
    expect(stats.playerType).toBe('Unknown');
    expect(stats.af).toBeNull();
    expect(stats.cbet).toBeNull();
    expect(stats.wtsd).toBeNull();
    expect(stats.wsd).toBeNull();
    expect(stats.checkRaise).toBeNull();
    expect(stats.threeBet).toBeNull();
    expect(stats.foldToCbet).toBeNull();
    expect(stats.afq).toBeNull();
    expect(stats.turnCbet).toBeNull();
  });
});
