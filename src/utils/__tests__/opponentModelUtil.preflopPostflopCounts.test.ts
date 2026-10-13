/**
 * P0a 前置统计修复的聚焦测试（plan §9.2 / §9.3，决策 37/39）。
 *
 * 锁住四件事：
 *  1. VPIP/PFR 是**整手**语义 —— 先 call 后 raise（limp-reraise）、BB check 后
 *     raise 不再被「只看第一个翻前动作」的旧口径漏记；
 *  2. 强制盲注 / 0 金额动作不算自愿投入；
 *  3. AF 区分加注式与跟注式 all-in，三态（no-actions / finite / no-calls）
 *     分开，`A>0, C=0` 不再与「没打到翻后」混为同一个 null（不持久化 Infinity）；
 *  4. 旧事件（allin 无 amount）按 legacy 规则处理：toCall=0 视为进攻，
 *     toCall>0 视为证据缺失（不进 A/C，单独计数）。
 */
import {
  computeVPIPFromEvents,
  computePFRFromEvents,
  computeAFDetailFromEvents,
  computeAFFromEvents,
  computeAFqFromEvents,
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
  extra: { amount?: number; toCall?: number } = {},
): ActionEvent {
  return {
    handId,
    playerId,
    phase,
    action,
    amount: extra.amount,
    toCall: extra.toCall ?? 0,
    currentBet: 0,
    potSize: 0,
    position: 0,
    isFacingRaise: false,
    timestamp,
  };
}

describe('VPIP / PFR：整手语义', () => {
  it('先 call 后 raise（limp-reraise）计 VPIP 也计 PFR', () => {
    // 旧口径只看第一个动作 call → PFR 漏记
    const events = [
      ev('h1', P1, 'preflop', 'call', 1, { toCall: 10 }),
      ev('h1', P2, 'preflop', 'raise', 2),
      ev('h1', P1, 'preflop', 'raise', 3, { toCall: 20 }),
    ];
    expect(computeVPIPFromEvents(events, 1)).toBe(1);
    expect(computePFRFromEvents(events, 1)).toBe(1);
  });

  it('BB 先 check 后 raise 计 PFR', () => {
    const events = [
      ev('h1', P2, 'preflop', 'call', 1, { toCall: 10 }),
      ev('h1', P1, 'preflop', 'check', 2),
      ev('h1', P1, 'preflop', 'raise', 3),
    ];
    // check 不是自愿投入，但后面的 raise 是 → VPIP 1、PFR 1
    expect(computeVPIPFromEvents(events, 1)).toBe(1);
    expect(computePFRFromEvents(events, 1)).toBe(1);
  });

  it('翻前只 fold 的手不计 VPIP / PFR', () => {
    const events = [ev('h1', P1, 'preflop', 'fold', 1, { toCall: 10 })];
    expect(computeVPIPFromEvents(events, 1)).toBe(0);
    expect(computePFRFromEvents(events, 1)).toBe(0);
  });

  it('跟注式 all-in（amount <= toCall）计 VPIP 不计 PFR', () => {
    const events = [
      ev('h1', P1, 'preflop', 'allin', 1, { amount: 50, toCall: 80 }),
    ];
    expect(computeVPIPFromEvents(events, 1)).toBe(1);
    expect(computePFRFromEvents(events, 1)).toBe(0);
  });

  it('加注式 all-in（amount > toCall）计 VPIP 也计 PFR', () => {
    const events = [
      ev('h1', P1, 'preflop', 'allin', 1, { amount: 120, toCall: 80 }),
    ];
    expect(computeVPIPFromEvents(events, 1)).toBe(1);
    expect(computePFRFromEvents(events, 1)).toBe(1);
  });

  it('legacy all-in（无 amount）：toCall=0 计加注，toCall>0 保守不计', () => {
    const open = [ev('h1', P1, 'preflop', 'allin', 1, { toCall: 0 })];
    expect(computePFRFromEvents(open, 1)).toBe(1);
    expect(computeVPIPFromEvents(open, 1)).toBe(1);

    const facing = [ev('h2', P1, 'preflop', 'allin', 1, { toCall: 30 })];
    expect(computePFRFromEvents(facing, 1)).toBe(0);
    // 主动决策路径产生的事件 → 仍算自愿投入
    expect(computeVPIPFromEvents(facing, 1)).toBe(1);
  });

  it('多手分母正确：2 手入池 1 手加注 → VPIP 1.0 / PFR 0.5（handsDealt=2）', () => {
    const events = [
      ev('h1', P1, 'preflop', 'call', 1, { toCall: 10 }),
      ev('h2', P1, 'preflop', 'raise', 2),
    ];
    expect(computeVPIPFromEvents(events, 2)).toBe(1);
    expect(computePFRFromEvents(events, 2)).toBe(0.5);
  });

  it('翻后动作不污染翻前统计', () => {
    const events = [
      ev('h1', P1, 'preflop', 'fold', 1, { toCall: 10 }),
      ev('h1', P1, 'flop', 'raise', 2), // 理论上不可能，但要确保只看 preflop
    ];
    expect(computeVPIPFromEvents(events, 1)).toBe(0);
    expect(computePFRFromEvents(events, 1)).toBe(0);
  });
});

describe('AF：三态与 all-in 归类（决策 37）', () => {
  it('A>0 且 C>0 → finite，af = A/C', () => {
    const events = [
      ev('h1', P1, 'flop', 'raise', 1),
      ev('h1', P1, 'turn', 'call', 2, { toCall: 20 }),
      ev('h1', P1, 'river', 'call', 3, { toCall: 20 }),
    ];
    const d = computeAFDetailFromEvents(events);
    expect(d).toEqual({
      af: 0.5,
      state: 'finite',
      aggressive: 1,
      calls: 2,
      unknownAllIns: 0,
    });
  });

  it('A>0 且 C=0 → no-calls，af 保持 null（不是 Infinity）', () => {
    const events = [
      ev('h1', P1, 'flop', 'raise', 1),
      ev('h1', P1, 'turn', 'raise', 2),
    ];
    const d = computeAFDetailFromEvents(events);
    expect(d.state).toBe('no-calls');
    expect(d.af).toBeNull();
    expect(d.aggressive).toBe(2);
    expect(d.calls).toBe(0);
    expect(computeAFFromEvents(events)).toBeNull();
  });

  it('只有 check/fold → no-actions', () => {
    const events = [
      ev('h1', P1, 'flop', 'check', 1),
      ev('h1', P1, 'turn', 'fold', 2, { toCall: 10 }),
    ];
    const d = computeAFDetailFromEvents(events);
    expect(d.state).toBe('no-actions');
    expect(d.af).toBeNull();
  });

  it('没有任何翻后事件 → no-actions（与旧 null 行为兼容）', () => {
    const d = computeAFDetailFromEvents([ev('h1', P1, 'preflop', 'raise', 1)]);
    expect(d.state).toBe('no-actions');
    expect(d.af).toBeNull();
  });

  it('加注式 all-in 计 A、跟注式 all-in 计 C', () => {
    const events = [
      ev('h1', P1, 'flop', 'allin', 1, { amount: 100, toCall: 0 }),   // 下注式 → A
      ev('h2', P1, 'turn', 'allin', 2, { amount: 50, toCall: 80 }),   // 跟注式 → C
    ];
    const d = computeAFDetailFromEvents(events);
    expect(d.aggressive).toBe(1);
    expect(d.calls).toBe(1);
    expect(d.state).toBe('finite');
    expect(d.af).toBe(1);
  });

  it('legacy all-in：toCall=0 计 A；toCall>0 无 amount 计 unknown，不进 A/C', () => {
    const events = [
      ev('h1', P1, 'flop', 'allin', 1, { toCall: 0 }),    // legacy 下注式 → A
      ev('h2', P1, 'turn', 'allin', 2, { toCall: 40 }),   // 证据缺失 → unknown
      ev('h3', P1, 'river', 'call', 3, { toCall: 10 }),   // C
    ];
    const d = computeAFDetailFromEvents(events);
    expect(d).toEqual({
      af: 1,
      state: 'finite',
      aggressive: 1,
      calls: 1,
      unknownAllIns: 1,
    });
  });
});

describe('AFq：all-in 语义同步修正', () => {
  it('跟注式 all-in 不再计入分子', () => {
    const events = [
      ev('h1', P1, 'flop', 'raise', 1),                                    // A
      ev('h1', P1, 'turn', 'allin', 2, { amount: 30, toCall: 50 }),        // 跟注式
      ev('h1', P1, 'river', 'check', 3),                                   // 非进攻
    ];
    // 1 / 3 决策点
    expect(computeAFqFromEvents(events)).toBeCloseTo((1 / 3) * 100, 10);
  });

  it('legacy 无 amount 且 toCall>0 的 all-in 不进分子也不进分母', () => {
    const events = [
      ev('h1', P1, 'flop', 'raise', 1),
      ev('h1', P1, 'turn', 'allin', 2, { toCall: 50 }), // unknown
    ];
    expect(computeAFqFromEvents(events)).toBe(100); // 1/1
  });

  it('全是 unknown all-in → null（无可判定动作）', () => {
    const events = [ev('h1', P1, 'flop', 'allin', 1, { toCall: 50 })];
    expect(computeAFqFromEvents(events)).toBeNull();
  });
});

describe('computePlayerStatsFromEvents 透传 AF 明细', () => {
  const hand: HandRecord = {
    handId: 'h1',
    timestamp: 1,
    players: [P1, P2],
    events: [
      ev('h1', P1, 'preflop', 'raise', 1),
      ev('h1', P2, 'preflop', 'call', 2, { toCall: 20 }),
      ev('h1', P1, 'flop', 'raise', 3),
      ev('h1', P2, 'flop', 'fold', 4, { toCall: 30 }),
    ],
  };

  it('afState / afAggressive / afCalls / afUnknownAllIns 出现在结果里', () => {
    const stats = computePlayerStatsFromEvents(P1, [hand]);
    expect(stats.afState).toBe('no-calls');
    expect(stats.af).toBeNull();
    expect(stats.afAggressive).toBe(1);
    expect(stats.afCalls).toBe(0);
    expect(stats.afUnknownAllIns).toBe(0);
  });

  it('整手 PFR：先 call 后 raise 的玩家在完整统计里也不再漏记', () => {
    const limpReraise: HandRecord = {
      handId: 'h2',
      timestamp: 2,
      players: [P1, P2],
      events: [
        ev('h2', P1, 'preflop', 'call', 1, { toCall: 10 }),
        ev('h2', P2, 'preflop', 'raise', 2),
        ev('h2', P1, 'preflop', 'raise', 3, { toCall: 20 }),
      ],
    };
    const stats = computePlayerStatsFromEvents(P1, [limpReraise]);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(1);
  });
});
