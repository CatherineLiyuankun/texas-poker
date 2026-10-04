import {
  parseHandClass,
  expandHandClass,
  expandRange,
  chenScore,
  allHandClasses,
  handClassesByStrength,
  topHandClasses,
  combosInClass,
  getContinuingRangeClasses,
  estimateOpponentCombos,
  calculateRangeAwareEquity,
  reconstructPreflopRoleFromEvents,
  currentHandEventSignature,
} from '../rangeEquity';
import type { Card, Player, GameState, PlayerId } from '../../types/poker';
import type { ActionEvent } from '../../types/stats';
import { startNewHand, recordAction, resetOpponentStats } from '../opponentModel';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function createPlayer(
  id: PlayerId,
  hand: Card[],
  totalBet: number,
  folded = false,
): Player {
  return {
    id,
    chips: 1000 - totalBet,
    bet: 0,
    totalBet,
    hand,
    hasActed: true,
    folded,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn: false,
  };
}

function createState(
  players: Player[],
  community: Card[],
  phase: GameState['phase'] = 'flop',
): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 0,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: players.length - 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

describe('Range Equity', () => {
  describe('parseHandClass', () => {
    it('parses suited, offsuit and pair notation', () => {
      const suited = parseHandClass('AKs');
      expect(suited).toEqual({ high: 'A', low: 'K', suited: true, isPair: false });

      const offsuit = parseHandClass('Q9o');
      expect(offsuit).toEqual({ high: 'Q', low: '9', suited: false, isPair: false });

      const pair = parseHandClass('TT');
      expect(pair).toEqual({ high: '10', low: '10', suited: false, isPair: true });
    });

    it('rejects invalid notation', () => {
      expect(parseHandClass('X9s')).toBeNull();
      expect(parseHandClass('')).toBeNull();
      expect(parseHandClass('A')).toBeNull();
    });
  });

  describe('expandHandClass', () => {
    it('expands pairs to 6 combos', () => {
      expect(expandHandClass('AA', [])).toHaveLength(6);
      expect(expandHandClass('22', [])).toHaveLength(6);
    });

    it('expands suited hands to 4 combos', () => {
      const combos = expandHandClass('AKs', []);
      expect(combos).toHaveLength(4);
      for (const combo of combos) {
        expect(combo[0].suit).toBe(combo[1].suit);
      }
    });

    it('expands offsuit hands to 12 combos', () => {
      const combos = expandHandClass('AKo', []);
      expect(combos).toHaveLength(12);
      for (const combo of combos) {
        expect(combo[0].suit).not.toBe(combo[1].suit);
      }
    });

    it('applies card removal for dead cards', () => {
      const dead = [card('♠', 'A')];
      const combos = expandHandClass('AA', dead);
      expect(combos).toHaveLength(3);
      for (const combo of combos) {
        expect(combo.some((c) => c.suit === '♠' && c.rank === 'A')).toBe(false);
      }
    });

    it('maps T notation to rank 10', () => {
      const combos = expandHandClass('T9s', []);
      expect(combos).toHaveLength(4);
      expect(combos[0].some((c) => c.rank === '10')).toBe(true);
    });
  });

  describe('expandRange', () => {
    it('expands multiple classes and removes dead-card combos', () => {
      const combos = expandRange(['AA', 'KK'], [card('♠', 'A')]);
      expect(combos).toHaveLength(9); // 3 AA combos + 6 KK combos
    });
  });

  describe('chenScore ordering', () => {
    it('ranks premium hands above junk', () => {
      expect(chenScore('AA')).toBeGreaterThan(chenScore('KK'));
      expect(chenScore('KK')).toBeGreaterThan(chenScore('AKs'));
      expect(chenScore('AKs')).toBeGreaterThan(chenScore('72o'));
    });

    it('ranks suited above offsuit for the same ranks', () => {
      expect(chenScore('98s')).toBeGreaterThan(chenScore('98o'));
    });
  });

  describe('hand class universe', () => {
    it('contains exactly 169 classes totalling 1326 combos', () => {
      const classes = allHandClasses();
      expect(classes).toHaveLength(169);
      const total = classes.reduce((sum, c) => sum + combosInClass(c), 0);
      expect(total).toBe(1326);
    });

    it('orders classes strongest first', () => {
      const ordered = handClassesByStrength();
      expect(ordered[0]).toBe('AA');
      expect(ordered.indexOf('72o')).toBeGreaterThan(ordered.indexOf('AKs'));
    });

    it('topHandClasses scales with fraction', () => {
      const top5 = topHandClasses(0.05);
      expect(top5).toContain('AA');
      expect(top5).not.toContain('72o');
      expect(topHandClasses(0.5).length).toBeGreaterThan(top5.length);
    });
  });

  describe('getContinuingRangeClasses', () => {
    it('UTG opener range is tight and excludes junk', () => {
      const classes = getContinuingRangeClasses({
        position: 'UTG',
        role: 'opener',
      });
      expect(classes).toContain('AA');
      expect(classes).toContain('AKs');
      expect(classes).not.toContain('72o');
      expect(classes).not.toContain('32o');
    });

    it('BTN opener range is wider than UTG', () => {
      const utg = getContinuingRangeClasses({ position: 'UTG', role: 'opener' });
      const btn = getContinuingRangeClasses({ position: 'BTN', role: 'opener' });
      expect(btn.length).toBeGreaterThan(utg.length);
    });

    it('BB caller vs UTG continues with a defined range', () => {
      const classes = getContinuingRangeClasses({
        position: 'BB',
        role: 'caller',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(classes.length).toBeGreaterThan(5);
      expect(classes).not.toContain('72o');
    });

    it('3bettor range is narrower than caller range', () => {
      const caller = getContinuingRangeClasses({
        position: 'BB',
        role: 'caller',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      const threeBet = getContinuingRangeClasses({
        position: 'BB',
        role: 'threebettor',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(threeBet.length).toBeLessThan(caller.length);
    });

    it('vpip narrows a range for tight players', () => {
      const base = getContinuingRangeClasses({
        position: 'BTN',
        role: 'opener',
      });
      const tight = getContinuingRangeClasses({
        position: 'BTN',
        role: 'opener',
        vpip: 0.12,
      });
      expect(tight.length).toBeLessThan(base.length);
    });
  });

  describe('estimateOpponentCombos', () => {
    const heroHand = [card('♠', 'A'), card('♥', 'K')];
    const community = [card('♦', '7'), card('♣', '2'), card('♥', '9')];

    it('returns concrete combos excluding hero and board cards', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const range = estimateOpponentCombos(hero, createState([hero, opponent], community), community);
      expect(range).not.toBeNull();
      expect(range!.combos.length).toBeGreaterThan(10);

      const deadKeys = new Set(
        [...heroHand, ...community].map((c) => `${c.suit}${c.rank}`),
      );
      for (const entry of range!.combos) {
        expect(entry.cards).toHaveLength(2);
        expect(entry.weight).toBeGreaterThan(0);
        for (const c of entry.cards) {
          expect(deadKeys.has(`${c.suit}${c.rank}`)).toBe(false);
        }
      }
    });

    it('returns null when no opponents remain', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const folded = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20, true);
      expect(estimateOpponentCombos(hero, createState([hero, folded], community), community)).toBeNull();
    });

    it('models the most-invested opponent in multiway pots', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const caller = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 10);
      const raiser = createPlayer(3 as PlayerId, [card('♣', '8'), card('♦', '8')], 25);
      const combos = estimateOpponentCombos(
        hero,
        createState([hero, caller, raiser], community),
        community,
      );
      expect(combos).not.toBeNull();
    });
  });

  // 翻前（community 为空）是 HandAnalysis 面板新启用的路径，
  // 上面几条用例都传了 3 张公共牌，无法覆盖它。
  describe('翻前无公共牌（community = []）', () => {
    const heroHand = [card('♠', 'A'), card('♥', 'K')];

    it('estimateOpponentCombos 在翻前仍能推断出对手范围', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const range = estimateOpponentCombos(
        hero,
        createState([hero, opponent], [], 'preflop'),
        [],
      );

      expect(range).not.toBeNull();
      expect(range!.combos.length).toBeGreaterThan(10);
      // 翻前没有翻后行动线，所有 combo 权重应为 1
      expect(range!.narrowedByPostflop).toBe(false);
      for (const entry of range!.combos) {
        expect(entry.weight).toBe(1);
      }

      // 范围里不能出现英雄自己的手牌
      const heroKeys = new Set(heroHand.map((c) => `${c.suit}${c.rank}`));
      for (const entry of range!.combos) {
        expect(entry.cards).toHaveLength(2);
        for (const c of entry.cards) {
          expect(heroKeys.has(`${c.suit}${c.rank}`)).toBe(false);
        }
      }
    });

    it('calculateRangeAwareEquity 在翻前返回合法概率，且 AA 显著领先', () => {
      const hero = createPlayer(1 as PlayerId, [card('♠', 'A'), card('♥', 'A')], 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const state = createState([hero, opponent], [], 'preflop');

      const equity = calculateRangeAwareEquity(hero, state, [], 1, 300);

      expect(equity).toBeGreaterThanOrEqual(0);
      expect(equity).toBeLessThanOrEqual(1);
      // AA 翻前对任何继续范围都应明显领先
      expect(equity).toBeGreaterThan(0.6);
    });
  });

  describe('calculateRangeAwareEquity', () => {
    it('returns a valid equity value', () => {
      const hero = createPlayer(
        1 as PlayerId,
        [card('♠', 'A'), card('♥', 'A')],
        10,
      );
      const opponent = createPlayer(
        2 as PlayerId,
        [card('♣', '2'), card('♦', '3')],
        20,
      );
      const community = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const equity = calculateRangeAwareEquity(
        hero,
        createState([hero, opponent], community),
        community,
        1,
        150,
      );
      expect(equity).toBeGreaterThanOrEqual(0);
      expect(equity).toBeLessThanOrEqual(1);
    });
  });

  describe('reconstructPreflopRoleFromEvents', () => {
    // 6-max, dealer = player 1. Seat 4 is UTG, seat 2 is SB, seat 3 is BB.
    const dealer = 1 as PlayerId;
    const total = 6;

    function ev(
      playerId: number,
      action: string,
      timestamp: number,
      phase: 'preflop' | 'flop' = 'preflop',
    ): ActionEvent {
      return {
        handId: 'h1',
        playerId: playerId as PlayerId,
        phase,
        action: action as ActionEvent['action'],
        toCall: 0,
        currentBet: 0,
        potSize: 0,
        position: 0,
        isFacingRaise: false,
        timestamp,
      };
    }

    it('identifies the first raiser as the opener', () => {
      const events = [
        ev(4, 'raise', 1),
        ev(2, 'call', 2),
      ];
      const recon = reconstructPreflopRoleFromEvents(events, 4, dealer, total);
      expect(recon).toEqual({ role: 'opener' });
    });

    it('identifies a later raiser as a threebettor with opener position', () => {
      const events = [
        ev(4, 'raise', 1),
        ev(2, 'raise', 2),
      ];
      const recon = reconstructPreflopRoleFromEvents(events, 2, dealer, total);
      expect(recon?.role).toBe('threebettor');
      expect(recon?.openerPosition).toBe('UTG');
    });

    it('identifies a caller facing a raise, with opener position', () => {
      const events = [
        ev(4, 'raise', 1),
        ev(2, 'call', 2),
      ];
      const recon = reconstructPreflopRoleFromEvents(events, 2, dealer, total);
      expect(recon?.role).toBe('caller');
      expect(recon?.openerPosition).toBe('UTG');
    });

    it('treats a call in a limped pot as a caller without opener', () => {
      const events = [ev(4, 'call', 1), ev(2, 'call', 2)];
      const recon = reconstructPreflopRoleFromEvents(events, 2, dealer, total);
      expect(recon).toEqual({ role: 'caller' });
    });

    it('returns null when the opponent has no preflop events', () => {
      const events = [ev(4, 'raise', 1)];
      expect(reconstructPreflopRoleFromEvents(events, 2, dealer, total)).toBeNull();
    });

    it('returns null for empty events', () => {
      expect(reconstructPreflopRoleFromEvents([], 2, dealer, total)).toBeNull();
    });

    it('orders events by timestamp even if provided out of order', () => {
      const events = [ev(2, 'call', 5), ev(4, 'raise', 1)];
      const recon = reconstructPreflopRoleFromEvents(events, 2, dealer, total);
      expect(recon?.role).toBe('caller');
      expect(recon?.openerPosition).toBe('UTG');
    });
  });

  // 本次新增：范围必须随翻后行动收窄，否则会系统性高估我方权益。
  describe('翻后行动收窄范围', () => {
    const board = [card('♦', 'K'), card('♦', '8'), card('♣', '3')];

    function postflopEvent(
      action: ActionEvent['action'],
      opts: { amount?: number; toCall?: number; timestamp?: number } = {},
    ): ActionEvent {
      return {
        handId: 'h-flop',
        playerId: 2 as PlayerId,
        phase: 'flop',
        action,
        amount: opts.amount,
        toCall: opts.toCall ?? 0,
        currentBet: opts.toCall ?? 0,
        potSize: 100,
        position: 0,
        isFacingRaise: (opts.toCall ?? 0) > 0,
        timestamp: opts.timestamp ?? 1,
      };
    }

    // Seeds the session store that `estimateOpponentCombos` reads through.
    function seedHand(events: ActionEvent[]): void {
      startNewHand('h-flop', [1, 2]);
      for (const e of events) recordAction(e);
    }

    beforeEach(() => {
      resetOpponentStats();
    });

    afterEach(() => {
      resetOpponentStats();
    });

    it('没有翻后行动时所有 combo 权重为 1', () => {
      seedHand([]);
      const hero = createPlayer(1 as PlayerId, [card('♠', 'A'), card('♥', 'A')], 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);

      const range = estimateOpponentCombos(hero, createState([hero, opponent], board), board);
      expect(range).not.toBeNull();
      expect(range!.narrowedByPostflop).toBe(false);
      for (const entry of range!.combos) expect(entry.weight).toBe(1);
    });

    it('对手翻牌加注后，强牌权重保持、弱牌权重下降', () => {
      seedHand([postflopEvent('raise', { amount: 60, toCall: 20 })]);
      const hero = createPlayer(1 as PlayerId, [card('♠', 'A'), card('♥', 'A')], 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);

      const range = estimateOpponentCombos(hero, createState([hero, opponent], board), board);
      expect(range).not.toBeNull();
      expect(range!.narrowedByPostflop).toBe(true);

      const weights = range!.combos.map((c) => c.weight);
      const max = Math.max(...weights);
      const min = Math.min(...weights);

      // 收窄确实发生了，且没有把任何 combo 清零
      expect(min).toBeLessThan(max);
      expect(min).toBeGreaterThanOrEqual(0.05);
      expect(range!.combos.length).toBeGreaterThan(10);
    });

    it('对手加注比我方过牌后的下注收窄得更狠', () => {
      const hero = createPlayer(1 as PlayerId, [card('♠', 'A'), card('♥', 'A')], 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const state = createState([hero, opponent], board);

      seedHand([postflopEvent('raise', { amount: 50, toCall: 0 })]);
      const betRange = estimateOpponentCombos(hero, state, board)!;

      seedHand([postflopEvent('raise', { amount: 80, toCall: 30 })]);
      const raiseRange = estimateOpponentCombos(hero, state, board)!;

      const avg = (r: typeof betRange): number =>
        r.combos.reduce((s, c) => s + c.weight, 0) / r.combos.length;

      expect(avg(raiseRange)).toBeLessThan(avg(betRange));
    });

    it('面对对手加注时，范围权益显著低于无翻后行动时', () => {
      const hero = createPlayer(1 as PlayerId, [card('♠', 'A'), card('♥', 'A')], 20);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const state = createState([hero, opponent], board);

      seedHand([]);
      const before = calculateRangeAwareEquity(hero, state, board, 1, 600);

      seedHand([postflopEvent('raise', { amount: 80, toCall: 30 })]);
      const after = calculateRangeAwareEquity(hero, state, board, 1, 600);

      // 对手加注意味着范围更强，我方 AA 的权益必须下降
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThanOrEqual(0);
      expect(after).toBeLessThanOrEqual(1);
    });

    it('事件签名会随行动变化，可用于 React 依赖', () => {
      seedHand([]);
      const before = currentHandEventSignature();

      seedHand([postflopEvent('check')]);
      const afterCheck = currentHandEventSignature();
      expect(afterCheck).not.toBe(before);

      // 关键场景：双方连续过牌不改变任何 GameState 字段，
      // 但事件条数变了，签名必须跟着变。
      recordAction(postflopEvent('check', { timestamp: 2 }));
      expect(currentHandEventSignature()).not.toBe(afterCheck);
    });
  });
});
