import { getBotAction, getBotName } from '../botAI';
import { resetRandomSource, setRandomSeed, setRandomSource } from '../random';
import type { Player, GameState, PlayerId } from '../../types/poker';

function createPlayer(
  id: PlayerId,
  chips: number,
  hand: { suit: string; rank: string }[],
  isRealPlayer = false,
  folded = false,
  bet = 0,
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
    mainPot: 30,
    sidePots: [],
    communityCards: [],
    players: [
      createPlayer(
        1,
        990,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        true,
        false,
        20,
      ),
      createPlayer(
        2,
        980,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '7' },
        ],
        true,
        false,
        10,
      ),
    ],
    currentPlayer: 2 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 20,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 2,
    botPlayerCount: 0,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    ...overrides,
  };
}

describe('Bot AI 决策', () => {
  describe('getBotName', () => {
    it('返回 bot + 序号 格式的名称', () => {
      expect(getBotName(0)).toBe('Bot1');
      expect(getBotName(1)).toBe('Bot2');
      expect(getBotName(4)).toBe('Bot5');
      expect(getBotName(10)).toBe('Bot11');
      expect(getBotName(15)).toBe('Bot16');
    });
  });

  describe('强牌决策', () => {
    it('AA应该加注', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'A' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });

    it('高对应加注或跟注', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'K' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check']).toContain(decision.action);
    });
  });

  describe('中等牌力决策', () => {
    it('中间对子根据位置决定', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: '8' },
          { suit: '♥', rank: '8' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check', 'fold']).toContain(decision.action);
    });

    it('听牌在赔率好时可能跟注', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♠', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 10,
        mainPot: 100,
        phase: 'flop',
        communityCards: [
          { suit: '♠', rank: '2' },
          { suit: '♠', rank: '3' },
          { suit: '♦', rank: '7' },
        ],
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'check', 'call', 'fold']).toContain(decision.action);
    });
  });

  describe('弱牌决策', () => {
    it('垃圾牌在需要跟注时倾向于弃牌', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '7' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 250,
        mainPot: 300,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('fold');
    });

    it('小盲位弱牌可能过牌', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '3' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 0,
        mainPot: 10,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('check');
    });
  });

  describe('位置考虑', () => {
    it('庄家位更激进', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'Q' },
        ],
        false,
      );
      const state = createGameState({
        dealer: 2,
        currentPlayer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });
  });

  describe('底池赔率', () => {
    it('赔率好时更多跟注', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '5' },
          { suit: '♦', rank: '6' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 5,
        mainPot: 100,
      });

      // getBotAction 内部有大量 Math.random 分支（加注 / 诈唬 / 混合频率），
      // 单次采样会以约 10% 的概率抽到 raise，使这条断言随机失败。
      // 「更多跟注」本身是统计命题，因此多次采样后比较各行动的比例。
      const N = 100;
      const counts = { call: 0, raise: 0, fold: 0 };
      for (let i = 0; i < N; i += 1) {
        const action = getBotAction(player, state).action;
        if (action === 'raise') counts.raise += 1;
        else if (action === 'fold') counts.fold += 1;
        else counts.call += 1;
      }

      // 赔率极好（5 跟 100）时跟注应显著多于加注与弃牌
      expect(counts.call).toBeGreaterThan(counts.raise + counts.fold);
    });

    it('赔率差时倾向于弃牌', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '3' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 50,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['fold', 'call', 'raise']).toContain(decision.action);
    });
  });

  describe('单挑情况', () => {
    it('单挑时更激进', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        players: [
          player,
          createPlayer(
            2,
            980,
            [
              { suit: '♣', rank: '2' },
              { suit: '♦', rank: '3' },
            ],
            true,
            true,
          ),
        ],
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });
  });

  describe('加注金额计算', () => {
    it('返回合理的加注金额', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 100,
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
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
        true,
      );
      const state = createGameState();
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });
  });

  describe('各种行动都能返回', () => {
    it('可能返回check', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'J' },
          { suit: '♥', rank: 'Q' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 20 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回call', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '9' },
          { suit: '♦', rank: '10' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 30, mainPot: 60 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回fold', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '4' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 50, mainPot: 40 });
      const decision = getBotAction(player, state);
      expect(['fold', 'call', 'raise']).toContain(decision.action);
    });
  });

  describe('筹码深度分档（stackDepth 唯一来源）', () => {
    const AKs = [
      { suit: '♠', rank: 'A' },
      { suit: '♠', rank: 'K' },
    ];

    it('21–25bb 归入 short 档，走短筹码引擎', () => {
      // 220 筹码 / (5 × 2) = 22bb。旧代码用 `isShortStack(≤20bb)` 判断，
      // 21–25bb 会被漏掉、落进默认引擎（与 gtoPreflop 的 ≤25bb 分档矛盾）。
      const player = createPlayer(2, 220, AKs, false);
      const state = createGameState({ smallBlind: 5, dealer: 1, currentPlayer: 2 });
      const decision = getBotAction(player, state);
      expect(decision.reasoning ?? '').toContain('Short stack');
    });

    it('26bb 及以上不再走短筹码引擎', () => {
      const player = createPlayer(2, 260, AKs, false); // 26bb → medium 档
      const state = createGameState({ smallBlind: 5, dealer: 1, currentPlayer: 2 });
      const decision = getBotAction(player, state);
      expect(decision.reasoning ?? '').not.toContain('Short stack');
    });

    it('深筹码引擎只在 >150bb 启用，且 bb 换算用真实小盲', () => {
      const flopState = (smallBlind: number) => createGameState({
        phase: 'flop',
        smallBlind,
        communityCards: [
          { suit: '♥', rank: '2' },
          { suit: '♦', rank: '7' },
          { suit: '♣', rank: 'J' },
        ],
        lastBet: 10,
        mainPot: 100,
      });

      // smallBlind = 5 → bb = 10；2000 筹码 = 200bb → veryDeep → 深筹码引擎
      const deep = getBotAction(createPlayer(2, 2000, AKs, false), flopState(5));
      expect(deep.reasoning ?? '').toContain('Deep stack');

      // smallBlind = 10 → bb = 20；2000 筹码 = 100bb → standard 档。
      // 旧代码把筹码换算硬编码成 `chips / 10`，会把它读成 200bb 而误入深筹码引擎。
      const notDeep = getBotAction(createPlayer(2, 2000, AKs, false), flopState(10));
      expect(notDeep.reasoning ?? '').not.toContain('Deep stack');
    });
  });

  describe('策略随机数可注入（P2-d）', () => {
    const JJ = [
      { suit: '♠', rank: 'J' },
      { suit: '♥', rank: 'J' },
    ];

    // JJ 是 tier 2（`preflopHandStrength.T[3][3]`）。tier 2 分支的第一件事就是
    // `random() < 0.12` 的「设陷阱仅跟注」判定 —— 该路径不碰权益计算，
    // 所以决策**完全**由注入的随机源决定，是验证接线的理想探针。
    const jjState = () => createGameState({ dealer: 1, currentPlayer: 2 });
    const jjPlayer = () => createPlayer(2, 1000, JJ, false);

    afterEach(() => {
      resetRandomSource();
    });

    it('决策确实由注入的随机源驱动（同输入同输出）', () => {
      const decide = (value: number) => {
        setRandomSource(() => value);
        return getBotAction(jjPlayer(), jjState()).action;
      };

      // 0.05 < 0.12 → 设陷阱跟注；0.5 不满足 → 落到「优先加注」
      expect(decide(0.05)).toBe('call');
      expect(decide(0.5)).toBe('raise');
      // 可复现：同样的注入值得到同样的决策
      expect(decide(0.05)).toBe('call');
    });

    it('setRandomSeed 让同一批决策完全可复现', () => {
      const run = () => {
        setRandomSeed(2026);
        return Array.from({ length: 30 }, () => getBotAction(jjPlayer(), jjState()).action);
      };

      const first = run();
      const second = run();

      // 两次同种子 → 逐条一致
      expect(second).toEqual(first);
      // 30 次里两种决策都出现过 → 证明这条路径真的在掷随机，而不是常量分支
      expect(new Set(first).size).toBeGreaterThan(1);
    });
  });
});
