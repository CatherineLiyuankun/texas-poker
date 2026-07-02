import {
  getGtoPreflopRecommendation,
  getRfiPositionForDisplay,
  getOpenerPosition,
} from '../gtoPreflop';
import type { Card, Player, GameState, PlayerId } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

function countActions(
  position: 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB',
): { raises: number; folds: number; total: number } {
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  let raises = 0;
  let folds = 0;

  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      if (i === j) {
        const hand = [card('♠', ranks[i]), card('♥', ranks[j])];
        const rec = getGtoPreflopRecommendation(hand, position, 'rfi');
        if (rec.action === 'R') raises++;
        else folds++;
      } else {
        const suited = [card('♠', ranks[i]), card('♠', ranks[j])];
        const recS = getGtoPreflopRecommendation(suited, position, 'rfi');
        if (recS.action === 'R') raises++;
        else folds++;
        const offsuit = [card('♠', ranks[i]), card('♥', ranks[j])];
        const recO = getGtoPreflopRecommendation(offsuit, position, 'rfi');
        if (recO.action === 'R') raises++;
        else folds++;
      }
    }
  }

  const total = 169;
  return { raises, folds, total };
}

describe('GTO Preflop Engine', () => {
  describe('RFI Range Percentages', () => {
    it('UTG opens ~15-20% of hands', () => {
      const { raises, total } = countActions('UTG');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.13);
      expect(pct).toBeLessThan(0.22);
    });

    it('MP opens ~17-26% of hands', () => {
      const { raises, total } = countActions('MP');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.15);
      expect(pct).toBeLessThan(0.28);
    });

    it('CO opens ~25-38% of hands', () => {
      const { raises, total } = countActions('CO');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.22);
      expect(pct).toBeLessThan(0.40);
    });

    it('BTN opens ~40-55% of hands', () => {
      const { raises, total } = countActions('BTN');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.38);
      expect(pct).toBeLessThan(0.58);
    });

    it('SB opens ~35-50% of hands', () => {
      const { raises, total } = countActions('SB');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.33);
      expect(pct).toBeLessThan(0.53);
    });

    it('later positions open wider than earlier positions', () => {
      const utg = countActions('UTG').raises;
      const mp = countActions('MP').raises;
      const co = countActions('CO').raises;
      const btn = countActions('BTN').raises;
      expect(mp).toBeGreaterThan(utg);
      expect(co).toBeGreaterThan(mp);
      expect(btn).toBeGreaterThan(co);
    });
  });

  describe('RFI Hand Selection', () => {
    it('AA is always opened from any position', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation(aa, pos, 'rfi').action).toBe('R');
      }
    });

    it('KK is always opened from any position', () => {
      const kk = [card('♠', 'K'), card('♥', 'K')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation(kk, pos, 'rfi').action).toBe('R');
      }
    });

    it('72o is folded from all positions', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation(garbage, pos, 'rfi').action).toBe('F');
      }
    });

    it('AKs is opened from all positions', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation(aks, pos, 'rfi').action).toBe('R');
      }
    });

    it('22 is opened from CO and later but not from UTG', () => {
      const lowPair = [card('♠', '2'), card('♥', '2')];
      expect(getGtoPreflopRecommendation(lowPair, 'UTG', 'rfi').action).toBe('F');
      expect(getGtoPreflopRecommendation(lowPair, 'CO', 'rfi').action).toBe('R');
      expect(getGtoPreflopRecommendation(lowPair, 'BTN', 'rfi').action).toBe('R');
    });

    it('A5s is opened from UTG (wheel draw value)', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(getGtoPreflopRecommendation(a5s, 'UTG', 'rfi').action).toBe('R');
    });
  });

  describe('Facing Open - 3-bet Range', () => {
    it('QQ is always 3-bet vs any open', () => {
      const qq = [card('♠', 'Q'), card('♥', 'Q')];
      const openerPositions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const oPos of openerPositions) {
        expect(
          getGtoPreflopRecommendation(qq, 'CO', 'facing_open', oPos).action,
        ).toBe('R');
      }
    });

    it('AKs is 3-bet vs opens', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      expect(
        getGtoPreflopRecommendation(aks, 'CO', 'facing_open', 'MP').action,
      ).toBe('R');
    });

    it('A5s is used as 3-bet bluff vs late position opens', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(
        getGtoPreflopRecommendation(a5s, 'BB', 'facing_open', 'CO').action,
      ).toBe('R');
      expect(
        getGtoPreflopRecommendation(a5s, 'BB', 'facing_open', 'BTN').action,
      ).toBe('R');
    });

    it('72o is folded vs any open', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const openerPositions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const oPos of openerPositions) {
        expect(
          getGtoPreflopRecommendation(garbage, 'BB', 'facing_open', oPos).action,
        ).toBe('F');
      }
    });
  });

  describe('Facing Open - Call Range', () => {
    it('small pairs are called vs UTG open (set mining)', () => {
      const pairs = [
        [card('♠', '2'), card('♥', '2')],
        [card('♠', '3'), card('♥', '3')],
        [card('♠', '4'), card('♥', '4')],
      ];
      for (const pair of pairs) {
        const rec = getGtoPreflopRecommendation(pair, 'BB', 'facing_open', 'UTG');
        expect(rec.action).toBe('C');
      }
    });

    it('suited connectors are called vs opens', () => {
      const connectors = [
        [card('♠', '10'), card('♠', '9')],
        [card('♠', '9'), card('♠', '8')],
      ];
      for (const hand of connectors) {
        const rec = getGtoPreflopRecommendation(hand, 'BB', 'facing_open', 'CO');
        expect(rec.action).not.toBe('F');
      }
    });

    it('BB defends wider vs BTN open than vs UTG open', () => {
      const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
      let vsUtg = 0;
      let vsBtn = 0;

      for (let i = 0; i < ranks.length; i++) {
        for (let j = i; j < ranks.length; j++) {
          const hands: Card[][] = i === j
            ? [[card('♠', ranks[i]), card('♥', ranks[j])]]
            : [
                [card('♠', ranks[i]), card('♠', ranks[j])],
                [card('♠', ranks[i]), card('♥', ranks[j])],
              ];
          for (const hand of hands) {
            const recUtg = getGtoPreflopRecommendation(hand, 'BB', 'facing_open', 'UTG', 5, 'BB');
            const recBtn = getGtoPreflopRecommendation(hand, 'BB', 'facing_open', 'BTN', 5, 'BB');
            if (recUtg.action !== 'F') vsUtg++;
            if (recBtn.action !== 'F') vsBtn++;
          }
        }
      }

      expect(vsBtn).toBeGreaterThan(vsUtg);
    });
  });

  describe('4-bet vs 3-bet', () => {
    it('AA is 4-bet vs 3-bet', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      expect(
        getGtoPreflopRecommendation(aa, 'CO', 'facing_3bet').action,
      ).toBe('R');
    });

    it('KK is 4-bet vs 3-bet', () => {
      const kk = [card('♠', 'K'), card('♥', 'K')];
      expect(
        getGtoPreflopRecommendation(kk, 'CO', 'facing_3bet').action,
      ).toBe('R');
    });

    it('A5s is 4-bet bluff vs 3-bet', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(
        getGtoPreflopRecommendation(a5s, 'CO', 'facing_3bet').action,
      ).toBe('R');
    });

    it('AQs is called vs 3-bet from UTG', () => {
      const aqs = [card('♠', 'A'), card('♠', 'Q')];
      expect(
        getGtoPreflopRecommendation(aqs, 'UTG', 'facing_3bet').action,
      ).toBe('C');
    });

    it('AQs is 4-bet vs 3-bet from CO/BTN', () => {
      const aqs = [card('♠', 'A'), card('♠', 'Q')];
      expect(
        getGtoPreflopRecommendation(aqs, 'CO', 'facing_3bet').action,
      ).toBe('R');
      expect(
        getGtoPreflopRecommendation(aqs, 'BTN', 'facing_3bet').action,
      ).toBe('R');
    });

    it('72o is folded vs 3-bet', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      expect(
        getGtoPreflopRecommendation(garbage, 'CO', 'facing_3bet').action,
      ).toBe('F');
    });
  });

  describe('Sizing', () => {
    it('UTG/MP/CO open 2.5BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const recUtg = getGtoPreflopRecommendation(aa, 'UTG', 'rfi', undefined, 5);
      expect(recUtg.sizingBB).toBe(2.5);
      const recCo = getGtoPreflopRecommendation(aa, 'CO', 'rfi', undefined, 5);
      expect(recCo.sizingBB).toBe(2.5);
    });

    it('BTN open 2.0BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation(aa, 'BTN', 'rfi', undefined, 5);
      expect(rec.sizingBB).toBe(2.0);
    });

    it('SB open 3.0BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation(aa, 'SB', 'rfi', undefined, 5);
      expect(rec.sizingBB).toBe(3.0);
    });
  });

  describe('Position Mapping', () => {
    it('BTN maps to BTN', () => {
      const ctx = {
        position: 0,
        totalPlayers: 6,
        isButton: true,
        isCutoff: false,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: false,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('BTN');
    });

    it('CO maps to CO', () => {
      const ctx = {
        position: 5,
        totalPlayers: 6,
        isButton: false,
        isCutoff: true,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: false,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('CO');
    });

    it('SB maps to SB', () => {
      const ctx = {
        position: 1,
        totalPlayers: 6,
        isButton: false,
        isCutoff: false,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: true,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('SB');
    });

    it('early position maps to UTG', () => {
      const ctx = {
        position: 3,
        totalPlayers: 6,
        isButton: false,
        isCutoff: false,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: true,
        isBlind: false,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('UTG');
    });
  });

  describe('Position Awareness - Defender Type', () => {
    it('BB defends wider than IP vs BTN open', () => {
      const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
      const suits = ['♠', '♥'];
      let bbCount = 0;
      let ipCount = 0;

      for (let i = 0; i < ranks.length; i++) {
        for (let j = i; j < ranks.length; j++) {
          const hand = [card(suits[0], ranks[i]), card(suits[1], ranks[j])];
          const recBB = getGtoPreflopRecommendation(hand, 'BB', 'facing_open', 'BTN', 5, 'BB');
          const recIP = getGtoPreflopRecommendation(hand, 'CO', 'facing_open', 'BTN', 5, 'CO');
          if (recBB.action !== 'F') bbCount++;
          if (recIP.action !== 'F') ipCount++;
        }
      }

      expect(bbCount).toBeGreaterThan(ipCount);
    });

    it('SB has almost no flat calls vs opens (3-bet or fold)', () => {
      const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
      const suits = ['♠', '♥'];
      let sbCalls = 0;

      for (let i = 0; i < ranks.length; i++) {
        for (let j = i; j < ranks.length; j++) {
          const hand = [card(suits[0], ranks[i]), card(suits[1], ranks[j])];
          const rec = getGtoPreflopRecommendation(hand, 'SB', 'facing_open', 'BTN', 5, 'SB');
          if (rec.action === 'C') sbCalls++;
        }
      }

      expect(sbCalls).toBe(0);
    });

    it('BB calls small pairs vs UTG but SB does not', () => {
      const lowPair = [card('♠', '4'), card('♥', '4')];
      const bbRec = getGtoPreflopRecommendation(lowPair, 'BB', 'facing_open', 'UTG', 5, 'BB');
      const sbRec = getGtoPreflopRecommendation(lowPair, 'SB', 'facing_open', 'UTG', 5, 'SB');
      expect(bbRec.action).toBe('C');
      expect(sbRec.action).toBe('F');
    });
  });

  describe('Position Awareness - 3-bet Response', () => {
    it('UTG open has tighter 4-bet range than BTN open', () => {
      const tt = [card('♠', '10'), card('♥', '10')];
      const recUtg = getGtoPreflopRecommendation(tt, 'UTG', 'facing_3bet');
      const recBtn = getGtoPreflopRecommendation(tt, 'BTN', 'facing_3bet');
      expect(recUtg.action).toBe('C');
      expect(recBtn.action).toBe('R');
    });

    it('A5s is 4-bet bluff from BTN but not from UTG', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      const recUtg = getGtoPreflopRecommendation(a5s, 'UTG', 'facing_3bet');
      const recBtn = getGtoPreflopRecommendation(a5s, 'BTN', 'facing_3bet');
      expect(recUtg.action).toBe('F');
      expect(recBtn.action).toBe('R');
    });
  });

  describe('Bug Fixes', () => {
    function mkPlayer(
      id: PlayerId,
      chips: number,
      bet: number,
      folded = false,
    ): Player {
      return {
        id,
        chips,
        bet,
        totalBet: bet,
        hand: [],
        hasActed: bet > 0,
        folded,
        revealed: false,
        isRealPlayer: id === 1,
        buyInCount: 0,
        allIn: false,
      };
    }

    function mkState(
      players: Player[],
      dealer: PlayerId,
      lastBet: number,
      sb: number,
    ): GameState {
      return {
        phase: 'preflop',
        mainPot: players.reduce((s, p) => s + p.bet, 0),
        sidePots: [],
        communityCards: [],
        players,
        currentPlayer: 1 as PlayerId,
        dealer,
        lastBet,
        lastRaiseBet: lastBet - sb * 2,
        raiseRightsOpened: true,
        winner: null,
        handRank: null,
        winningCards: [],
        realPlayerCount: 1,
        botPlayerCount: players.length - 1,
        smallBlind: sb,
        chipsAtRoundStart: [],
        chipsBeforeSettlement: [],
        potDistribution: [],
      };
    }

    it('getOpenerPosition returns highest-bet player (latest aggressor)', () => {
      const players = [
        mkPlayer(1, 900, 0),
        mkPlayer(2, 975, 25),
        mkPlayer(3, 960, 60),
      ];
      const state = mkState(players, 1 as PlayerId, 60, 5);
      const result = getOpenerPosition(state, players[0]);
      const pos3 = (3 - 1 + 3) % 3;
      expect(pos3).toBe(2);
      expect(result).toBe('BB');
    });

    it('getOpenerPosition ignores folded players', () => {
      const players = [
        mkPlayer(1, 900, 0),
        mkPlayer(2, 975, 25, true),
        mkPlayer(3, 960, 60),
      ];
      const state = mkState(players, 1 as PlayerId, 60, 5);
      const result = getOpenerPosition(state, players[0]);
      expect(result).not.toBeNull();
    });

    it('facing_3bet scenario returns 4-bet sizing based on currentBet', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec80 = getGtoPreflopRecommendation(
        aa, 'CO', 'facing_3bet', undefined, 5, undefined, 80,
      );
      const rec120 = getGtoPreflopRecommendation(
        aa, 'CO', 'facing_3bet', undefined, 5, undefined, 120,
      );
      expect(rec80.action).toBe('R');
      expect(rec120.action).toBe('R');
      expect(rec80.sizingBB).not.toBe(rec120.sizingBB);
      expect(rec80.sizingBB).toBeLessThan(rec120.sizingBB!);
    });

    it('defender position changes facing_open recommendation', () => {
      const kjs = [card('♠', 'K'), card('♠', 'J')];
      const recBB = getGtoPreflopRecommendation(
        kjs, 'BB', 'facing_open', 'CO', 5, 'BB',
      );
      const recIP = getGtoPreflopRecommendation(
        kjs, 'BTN', 'facing_open', 'CO', 5, 'BTN',
      );
      expect(recBB.action).not.toBe('F');
      expect(recIP.action).not.toBe('F');
    });

    it('BB option returns Check not Fold for weak hands', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const rec = getGtoPreflopRecommendation(garbage, 'BB', 'rfi');
      expect(rec.action).toBe('C');
    });

    it('BB option returns Raise for strong hands', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation(aa, 'BB', 'rfi');
      expect(rec.action).toBe('R');
    });

    it('facing_open 3-bet sizing uses actual currentBet', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const recSmall = getGtoPreflopRecommendation(
        aks, 'BB', 'facing_open', 'BTN', 5, 'BB', 20,
      );
      const recLarge = getGtoPreflopRecommendation(
        aks, 'BB', 'facing_open', 'BTN', 5, 'BB', 50,
      );
      expect(recSmall.action).toBe('R');
      expect(recLarge.action).toBe('R');
      expect(recSmall.sizingBB).toBeLessThan(recLarge.sizingBB!);
    });
  });

  describe('Small Game Position Mapping (3/4 players)', () => {
    it('3-player: BB position maps to BB not CO', () => {
      const ctx = {
        position: 2,
        totalPlayers: 3,
        isButton: false,
        isCutoff: true,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: true,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('BB');
    });

    it('4-player: BB position maps to BB not MP', () => {
      const ctx = {
        position: 2,
        totalPlayers: 4,
        isButton: false,
        isCutoff: false,
        isHijack: true,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: true,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('BB');
    });

    it('3-player: SB position maps to SB not MP', () => {
      const ctx = {
        position: 1,
        totalPlayers: 3,
        isButton: false,
        isCutoff: false,
        isHijack: true,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: true,
      };
      expect(getRfiPositionForDisplay(ctx)).toBe('SB');
    });

    it('6-player: all positions map correctly', () => {
      const positions = [
        { pos: 0, expected: 'BTN' as const, flags: { isButton: true, isCutoff: false, isHijack: false, isBlind: false } },
        { pos: 1, expected: 'SB' as const, flags: { isButton: false, isCutoff: false, isHijack: false, isBlind: true } },
        { pos: 2, expected: 'BB' as const, flags: { isButton: false, isCutoff: false, isHijack: false, isBlind: true } },
        { pos: 3, expected: 'UTG' as const, flags: { isButton: false, isCutoff: false, isHijack: false, isBlind: false } },
        { pos: 4, expected: 'MP' as const, flags: { isButton: false, isCutoff: false, isHijack: true, isBlind: false } },
        { pos: 5, expected: 'CO' as const, flags: { isButton: false, isCutoff: true, isHijack: false, isBlind: false } },
      ];
      for (const { pos, expected, flags } of positions) {
        const ctx = {
          position: pos,
          totalPlayers: 6,
          isMiddlePosition: pos >= 2 && pos < 4,
          isEarlyPosition: pos > 0 && pos < 2,
          ...flags,
        };
        expect(getRfiPositionForDisplay(ctx)).toBe(expected);
      }
    });
  });
});
