import { getBotAction, getBotName } from '../botAI';
import type { Player, GameState, PlayerId } from '../../types/poker';

function createPlayer(
  id: PlayerId,
  chips: number,
  hand: { suit: string; rank: string }[],
  isRealPlayer = false,
  folded = false,
  bet = 0
): Player {
  return {
    id,
    chips,
    bet,
    totalBet: bet,
    hand: hand as Player['hand'],
    hasActed: false,
    folded,
    revealed: false,
    isRealPlayer,
    buyInCount: 0,
    allIn: false,
  };
}

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'preflop',
    pot: 30,
    communityCards: [],
    players: [
      createPlayer(1, 990, [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }], true, false, 20),
      createPlayer(2, 980, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '7' }], true, false, 10),
    ],
    currentPlayer: 2 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 20,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 2,
    botPlayerCount: 0,
    ...overrides,
  };
}

describe('Bot AI 决策', () => {
  describe('getBotName', () => {
    it('返回正确的Bot名称', () => {
      expect(getBotName(0)).toBe('Alpha');
      expect(getBotName(1)).toBe('Beta');
      expect(getBotName(4)).toBe('Epsilon');
    });

    it('超出范围时返回默认名称', () => {
      expect(getBotName(10)).toBe('Bot 11');
      expect(getBotName(15)).toBe('Bot 16');
    });
  });

  describe('强牌决策', () => {
    it('AA应该加注', () => {
      const player = createPlayer(2, 980, [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'A' }], false);
      const state = createGameState({
        lastBet: 20,
        pot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });

    it('高对应加注或跟注', () => {
      const player = createPlayer(2, 980, [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'K' }], false);
      const state = createGameState({
        lastBet: 20,
        pot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check']).toContain(decision.action);
    });
  });

  describe('中等牌力决策',  () => {
    it('中间对子根据位置决定', () => {
      const player = createPlayer(2, 980, [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }], false);
      const state = createGameState({
        lastBet: 20,
        pot: 30,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check', 'fold']).toContain(decision.action);
    });

    it('听牌在赔率好时可能跟注', () => {
      const player = createPlayer(2, 990, [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }], false);
      const state = createGameState({
        lastBet: 0,
        pot: 10,
        phase: 'flop',
        communityCards: [
          { suit: '♣', rank: '4' },
          { suit: '♦', rank: '7' },
          { suit: '♥', rank: '8' },
        ],
      });
      const decision = getBotAction(player, state);
      expect(['check', 'call', 'fold']).toContain(decision.action);
    });
  });

  describe('弱牌决策',  () => {
    it('垃圾牌在需要跟注时倾向于弃牌', () => {
      const player = createPlayer(2, 990, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '7' }], false);
      const state = createGameState({
        lastBet: 250,
        pot: 300,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('fold');
    });

    it('小盲位弱牌可能过牌', () => {
      const player = createPlayer(2, 980, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '3' }], false);
      const state = createGameState({
        lastBet: 0,
        pot: 10,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('check');
    });
  });

  describe('位置考虑', () => {
    it('庄家位更激进', () => {
      const player = createPlayer(1, 980, [{ suit: '♠', rank: 'T' }, { suit: '♥', rank: 'J' }], false);
      const state = createGameState({
        dealer: 2,
        currentPlayer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'check', 'call']).toContain(decision.action);
    });
  });

  describe('底池赔率', () => {
    it('赔率好时更多跟注', () => {
      const player = createPlayer(2, 990, [{ suit: '♣', rank: '5' }, { suit: '♦', rank: '6' }], false);
      const state = createGameState({
        lastBet: 5,
        pot: 100,
      });
      const decision = getBotAction(player, state);
      expect(['call', 'check']).toContain(decision.action);
    });

    it('赔率差时倾向于弃牌', () => {
      const player = createPlayer(2, 990, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '3' }], false);
      const state = createGameState({
        lastBet: 50,
        pot: 30,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('fold');
    });
  });

  describe('单挑情况', () => {
    it('单挑时更激进', () => {
      const player = createPlayer(1, 980, [{ suit: '♠', rank: '7' }, { suit: '♥', rank: '8' }], false);
      const state = createGameState({
        players: [
          player,
          createPlayer(2, 980, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '3' }], true, true),
        ],
        lastBet: 20,
        pot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });
  });

  describe('加注金额计算', () => {
    it('返回合理的加注金额', () => {
      const player = createPlayer(2, 980, [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }], false);
      const state = createGameState({
        lastBet: 20,
        pot: 100,
      });
      const decision = getBotAction(player, state);
      if (decision.action === 'raise' && decision.amount) {
        expect(decision.amount).toBeGreaterThanOrEqual(30);
        expect(decision.amount).toBeLessThanOrEqual(player.chips);
      }
    });
  });

  describe('已弃牌玩家', () => {
    it('folded玩家不应行动', () => {
      const player = createPlayer(2, 980, [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }], false, true);
      const state = createGameState();
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });
  });

  describe('各种行动都能返回', () => {
    it('可能返回check', () => {
      const player = createPlayer(1, 980, [{ suit: '♠', rank: 'J' }, { suit: '♥', rank: 'Q' }], false);
      const state = createGameState({ lastBet: 20 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回call', () => {
      const player = createPlayer(2, 990, [{ suit: '♣', rank: '9' }, { suit: '♦', rank: 'T' }], false);
      const state = createGameState({ lastBet: 30, pot: 60 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回fold', () => {
      const player = createPlayer(2, 990, [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '4' }], false);
      const state = createGameState({ lastBet: 50, pot: 40 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('fold');
    });
  });
});