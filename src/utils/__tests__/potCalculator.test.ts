import { calculatePots, validateTotalPots } from '../potCalculator';
import type { Player, PlayerId } from '../../types/poker';

function createMockPlayer(
  id: number,
  bet: number,
  folded: boolean = false,
): Player {
  return {
    id: id as PlayerId,
    bet,
    chips: 1000,
    totalBet: bet,
    hand: [],
    hasActed: true,
    folded,
    revealed: false,
    isRealPlayer: true,
    lastAction: folded ? 'fold' : 'allin',
    buyInCount: 0,
    allIn: !folded && bet > 0,
  };
}

describe('PotCalculator - 6标准场景验证', () => {
  describe('场景1：弃牌筹码进主池', () => {
    it('A弃牌10，B弃牌20，C全下50，D跟注50 → Main=130', () => {
      const players = [
        createMockPlayer(1, 10, true),
        createMockPlayer(2, 20, true),
        createMockPlayer(3, 50, false),
        createMockPlayer(4, 50, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(130);
      expect(result.sidePots.length).toBe(0);
      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('场景2：短码全下产生边池', () => {
    it('A弃10，B弃20，C全下50，D下注100 → Main=130, Side1=50', () => {
      const players = [
        createMockPlayer(1, 10, true),
        createMockPlayer(2, 20, true),
        createMockPlayer(3, 50, false),
        createMockPlayer(4, 100, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(130);
      expect(result.sidePots.length).toBe(1);
      expect(result.sidePots[0].amount).toBe(50);
      expect(result.sidePots[0].eligiblePlayers).toEqual([4]);
      expect(result.sidePots[0].level).toBe(1);
      expect(result.sidePots[0].threshold).toBe(100);
      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('场景3：两人全下不同金额', () => {
    it('A弃10，B弃20，C全下50，D全下100 → Main=130, Side1=50', () => {
      const players = [
        createMockPlayer(1, 10, true),
        createMockPlayer(2, 20, true),
        createMockPlayer(3, 50, false),
        createMockPlayer(4, 100, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(130);
      expect(result.sidePots.length).toBe(1);
      expect(result.sidePots[0].amount).toBe(50);
      expect(result.sidePots[0].eligiblePlayers).toEqual([4]);
      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('场景4：三人全下不同金额（三层级）', () => {
    it('A全下30，B全下60，C全下100 → Main=90, Side1=60, Side2=40', () => {
      const players = [
        createMockPlayer(1, 30, false),
        createMockPlayer(2, 60, false),
        createMockPlayer(3, 100, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(90);
      expect(result.sidePots.length).toBe(2);

      expect(result.sidePots[0].amount).toBe(60);
      expect(result.sidePots[0].eligiblePlayers).toEqual([2, 3]);
      expect(result.sidePots[0].level).toBe(1);
      expect(result.sidePots[0].threshold).toBe(60);

      expect(result.sidePots[1].amount).toBe(40);
      expect(result.sidePots[1].eligiblePlayers).toEqual([3]);
      expect(result.sidePots[1].level).toBe(2);
      expect(result.sidePots[1].threshold).toBe(100);

      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('场景5：中途弃牌筹码进主池', () => {
    it('A全下30，B弃牌30，C全下30，D跟注80 → Main=120, Side1=50', () => {
      const players = [
        createMockPlayer(1, 30, false),
        createMockPlayer(2, 30, true),
        createMockPlayer(3, 30, false),
        createMockPlayer(4, 80, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(120);
      expect(result.sidePots.length).toBe(1);
      expect(result.sidePots[0].amount).toBe(50);
      expect(result.sidePots[0].eligiblePlayers).toEqual([4]);
      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('场景6：四人完整多层全下', () => {
    it('A全下20，B全下50，C全下80，D跟注80 → Main=80, Side1=90, Side2=60', () => {
      const players = [
        createMockPlayer(1, 20, false),
        createMockPlayer(2, 50, false),
        createMockPlayer(3, 80, false),
        createMockPlayer(4, 80, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(80);
      expect(result.sidePots.length).toBe(2);

      expect(result.sidePots[0].amount).toBe(90);
      expect(result.sidePots[0].eligiblePlayers).toEqual([2, 3, 4]);
      expect(result.sidePots[0].level).toBe(1);

      expect(result.sidePots[1].amount).toBe(60);
      expect(result.sidePots[1].eligiblePlayers).toEqual([3, 4]);
      expect(result.sidePots[1].level).toBe(2);

      expect(validateTotalPots(players, result, 0)).toBe(true);
    });
  });

  describe('总和验证', () => {
    it('所有池总和必须等于所有玩家bet总和', () => {
      const players = [
        createMockPlayer(1, 20, false),
        createMockPlayer(2, 50, false),
        createMockPlayer(3, 80, false),
        createMockPlayer(4, 80, false),
      ];

      const result = calculatePots(players, 0);
      const totalBet = players.reduce((sum, p) => sum + p.bet, 0);
      const totalPots =
        result.mainPot +
        result.sidePots.reduce((sum, sp) => sum + sp.amount, 0);

      expect(totalPots).toBe(totalBet);
      expect(validateTotalPots(players, result, 0)).toBe(true);
    });

    it('包含currentPot的总和验证', () => {
      const players = [
        createMockPlayer(1, 30, false),
        createMockPlayer(2, 50, false),
      ];

      const currentPot = 20;
      const result = calculatePots(players, currentPot);
      const totalBet = players.reduce((sum, p) => sum + p.bet, 0);
      const totalPots =
        result.mainPot +
        result.sidePots.reduce((sum, sp) => sum + sp.amount, 0);

      expect(totalPots).toBe(totalBet + currentPot);
      expect(validateTotalPots(players, result, currentPot)).toBe(true);
    });
  });

  describe('边缘场景', () => {
    it('所有玩家bet相同 → 无边池', () => {
      const players = [
        createMockPlayer(1, 50, false),
        createMockPlayer(2, 50, false),
        createMockPlayer(3, 50, false),
      ];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(150);
      expect(result.sidePots.length).toBe(0);
    });

    it('只有一个玩家有bet → 无边池', () => {
      const players = [createMockPlayer(1, 100, false)];

      const result = calculatePots(players, 0);

      expect(result.mainPot).toBe(100);
      expect(result.sidePots.length).toBe(0);
    });

    it('所有玩家bet=0 → 只有currentPot', () => {
      const players = [
        createMockPlayer(1, 0, false),
        createMockPlayer(2, 0, false),
      ];

      const currentPot = 30;
      const result = calculatePots(players, currentPot);

      expect(result.mainPot).toBe(30);
      expect(result.sidePots.length).toBe(0);
    });
  });
});