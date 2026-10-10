import {
  getGtoPreflopRecommendation,
  getRfiPositionForDisplay,
  getOpenerPosition,
  getPreflopRangeClasses,
  positionLabelFor,
  decidePreflopGTO,
  detectPreflopScenario,
  type Position,
} from '../gtoPreflop';
import type { Card, Player, GameState, PlayerId } from '../../types/poker';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { allHandClasses, combosInClass } from '../rangeEquity';
import { getPreflopStrength, getPreflopTier } from '../preflopHandStrength';
import { resetRandomSource, setRandomSource } from '../random';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

function mkBotPlayer(id: PlayerId, chips: number, bet: number): Player {
  return {
    id,
    chips,
    bet,
    totalBet: bet,
    hand: [],
    hasActed: bet > 0,
    folded: false,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn: false,
  };
}

function mkBotState(
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
    lastRaiseBet: Math.max(lastBet - sb * 2, 0),
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

function countActions(
  position: 'UTG' | 'HJ' | 'MP' | 'CO' | 'BTN' | 'SB',
): { raises: number; folds: number; total: number } {
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  let raises = 0;
  let folds = 0;

  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      if (i === j) {
        const hand = [card('♠', ranks[i]), card('♥', ranks[j])];
        const rec = getGtoPreflopRecommendation({ hand, rfiPosition: position, spot: 'rfi' });
        if (rec.action === 'R') raises++;
        else folds++;
      } else {
        const suited = [card('♠', ranks[i]), card('♠', ranks[j])];
        const recS = getGtoPreflopRecommendation({ hand: suited, rfiPosition: position, spot: 'rfi' });
        if (recS.action === 'R') raises++;
        else folds++;
        const offsuit = [card('♠', ranks[i]), card('♥', ranks[j])];
        const recO = getGtoPreflopRecommendation({ hand: offsuit, rfiPosition: position, spot: 'rfi' });
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
      const hj = countActions('HJ').raises;
      const co = countActions('CO').raises;
      const btn = countActions('BTN').raises;
      expect(mp).toBeGreaterThan(utg);
      expect(hj).toBeGreaterThan(mp);
      expect(co).toBeGreaterThan(hj);
      expect(btn).toBeGreaterThan(co);
    });

    it('HJ opens ~22-30% of hands', () => {
      const { raises, total } = countActions('HJ');
      const pct = raises / total;
      expect(pct).toBeGreaterThan(0.20);
      expect(pct).toBeLessThan(0.32);
    });
  });

  describe('RFI Hand Selection', () => {
    it('AA is always opened from any position', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation({ hand: aa, rfiPosition: pos, spot: 'rfi' }).action).toBe('R');
      }
    });

    it('KK is always opened from any position', () => {
      const kk = [card('♠', 'K'), card('♥', 'K')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation({ hand: kk, rfiPosition: pos, spot: 'rfi' }).action).toBe('R');
      }
    });

    it('72o is folded from all positions', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation({
          hand: garbage,
          rfiPosition: pos,
          spot: 'rfi',
        }).action).toBe('F');
      }
    });

    it('AKs is opened from all positions', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const pos of positions) {
        expect(getGtoPreflopRecommendation({ hand: aks, rfiPosition: pos, spot: 'rfi' }).action).toBe('R');
      }
    });

    it('22 is opened from CO and later but not from UTG', () => {
      const lowPair = [card('♠', '2'), card('♥', '2')];
      expect(getGtoPreflopRecommendation({
        hand: lowPair,
        rfiPosition: 'UTG',
        spot: 'rfi',
      }).action).toBe('F');
      expect(getGtoPreflopRecommendation({ hand: lowPair, rfiPosition: 'CO', spot: 'rfi' }).action).toBe('R');
      expect(getGtoPreflopRecommendation({
        hand: lowPair,
        rfiPosition: 'BTN',
        spot: 'rfi',
      }).action).toBe('R');
    });

    it('A5s is opened from UTG (wheel draw value)', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(getGtoPreflopRecommendation({ hand: a5s, rfiPosition: 'UTG', spot: 'rfi' }).action).toBe('R');
    });
  });

  describe('Facing Open - 3-bet Range', () => {
    it('QQ is always 3-bet vs any open', () => {
      const qq = [card('♠', 'Q'), card('♥', 'Q')];
      const openerPositions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const oPos of openerPositions) {
        expect(
          getGtoPreflopRecommendation({
            hand: qq,
            rfiPosition: 'CO',
            spot: 'facing_open',
            openerPosition: oPos,
          }).action,
        ).toBe('R');
      }
    });

    it('AKs is 3-bet vs opens', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      expect(
        getGtoPreflopRecommendation({
          hand: aks,
          rfiPosition: 'CO',
          spot: 'facing_open',
          openerPosition: 'MP',
        }).action,
      ).toBe('R');
    });

    it('A5s is used as 3-bet bluff vs late position opens', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(
        getGtoPreflopRecommendation({
          hand: a5s,
          rfiPosition: 'BB',
          spot: 'facing_open',
          openerPosition: 'CO',
        }).action,
      ).toBe('R');
      expect(
        getGtoPreflopRecommendation({
          hand: a5s,
          rfiPosition: 'BB',
          spot: 'facing_open',
          openerPosition: 'BTN',
        }).action,
      ).toBe('R');
    });

    it('72o is folded vs any open', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const openerPositions = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
      for (const oPos of openerPositions) {
        expect(
          getGtoPreflopRecommendation({
            hand: garbage,
            rfiPosition: 'BB',
            spot: 'facing_open',
            openerPosition: oPos,
          }).action,
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
        const rec = getGtoPreflopRecommendation({
          hand: pair,
          rfiPosition: 'BB',
          spot: 'facing_open',
          openerPosition: 'UTG',
        });
        expect(rec.action).toBe('C');
      }
    });

    it('suited connectors are called vs opens', () => {
      const connectors = [
        [card('♠', '10'), card('♠', '9')],
        [card('♠', '9'), card('♠', '8')],
      ];
      for (const hand of connectors) {
        const rec = getGtoPreflopRecommendation({
          hand,
          rfiPosition: 'BB',
          spot: 'facing_open',
          openerPosition: 'CO',
        });
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
            const recUtg = getGtoPreflopRecommendation({
              hand,
              rfiPosition: 'BB',
              spot: 'facing_open',
              openerPosition: 'UTG',
              smallBlind: 5,
              defenderPosition: 'BB',
            });
            const recBtn = getGtoPreflopRecommendation({
              hand,
              rfiPosition: 'BB',
              spot: 'facing_open',
              openerPosition: 'BTN',
              smallBlind: 5,
              defenderPosition: 'BB',
            });
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
        getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'CO', spot: 'facing_3bet' }).action,
      ).toBe('R');
    });

    it('KK is 4-bet vs 3-bet', () => {
      const kk = [card('♠', 'K'), card('♥', 'K')];
      expect(
        getGtoPreflopRecommendation({ hand: kk, rfiPosition: 'CO', spot: 'facing_3bet' }).action,
      ).toBe('R');
    });

    it('A5s is 4-bet bluff vs 3-bet', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      expect(
        getGtoPreflopRecommendation({ hand: a5s, rfiPosition: 'CO', spot: 'facing_3bet' }).action,
      ).toBe('R');
    });

    it('AQs is called vs 3-bet from UTG', () => {
      const aqs = [card('♠', 'A'), card('♠', 'Q')];
      expect(
        getGtoPreflopRecommendation({ hand: aqs, rfiPosition: 'UTG', spot: 'facing_3bet' }).action,
      ).toBe('C');
    });

    it('AQs is 4-bet vs 3-bet from CO/BTN', () => {
      const aqs = [card('♠', 'A'), card('♠', 'Q')];
      expect(
        getGtoPreflopRecommendation({ hand: aqs, rfiPosition: 'CO', spot: 'facing_3bet' }).action,
      ).toBe('R');
      expect(
        getGtoPreflopRecommendation({ hand: aqs, rfiPosition: 'BTN', spot: 'facing_3bet' }).action,
      ).toBe('R');
    });

    it('72o is folded vs 3-bet', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      expect(
        getGtoPreflopRecommendation({ hand: garbage, rfiPosition: 'CO', spot: 'facing_3bet' }).action,
      ).toBe('F');
    });
  });

  describe('Sizing', () => {
    it('UTG/MP/CO open 2.5BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const recUtg = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'UTG',
        spot: 'rfi',
        smallBlind: 5,
      });
      expect(recUtg.sizingBB).toBe(2.5);
      const recCo = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'CO', spot: 'rfi', smallBlind: 5 });
      expect(recCo.sizingBB).toBe(2.5);
    });

    it('BTN open 2.0BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'BTN', spot: 'rfi', smallBlind: 5 });
      expect(rec.sizingBB).toBe(2.0);
    });

    it('SB open 3.0BB', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'SB', spot: 'rfi', smallBlind: 5 });
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
          const recBB = getGtoPreflopRecommendation({
            hand,
            rfiPosition: 'BB',
            spot: 'facing_open',
            openerPosition: 'BTN',
            smallBlind: 5,
            defenderPosition: 'BB',
          });
          const recIP = getGtoPreflopRecommendation({
            hand,
            rfiPosition: 'CO',
            spot: 'facing_open',
            openerPosition: 'BTN',
            smallBlind: 5,
            defenderPosition: 'CO',
          });
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
          const rec = getGtoPreflopRecommendation({
            hand,
            rfiPosition: 'SB',
            spot: 'facing_open',
            openerPosition: 'BTN',
            smallBlind: 5,
            defenderPosition: 'SB',
          });
          if (rec.action === 'C') sbCalls++;
        }
      }

      expect(sbCalls).toBe(0);
    });

    it('BB calls small pairs vs UTG but SB does not', () => {
      const lowPair = [card('♠', '4'), card('♥', '4')];
      const bbRec = getGtoPreflopRecommendation({
        hand: lowPair,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'UTG',
        smallBlind: 5,
        defenderPosition: 'BB',
      });
      const sbRec = getGtoPreflopRecommendation({
        hand: lowPair,
        rfiPosition: 'SB',
        spot: 'facing_open',
        openerPosition: 'UTG',
        smallBlind: 5,
        defenderPosition: 'SB',
      });
      expect(bbRec.action).toBe('C');
      expect(sbRec.action).toBe('F');
    });
  });

  describe('Position Awareness - 3-bet Response', () => {
    it('UTG open has tighter 4-bet range than BTN open', () => {
      const tt = [card('♠', '10'), card('♥', '10')];
      const recUtg = getGtoPreflopRecommendation({ hand: tt, rfiPosition: 'UTG', spot: 'facing_3bet' });
      const recBtn = getGtoPreflopRecommendation({ hand: tt, rfiPosition: 'BTN', spot: 'facing_3bet' });
      expect(recUtg.action).toBe('C');
      expect(recBtn.action).toBe('R');
    });

    it('A5s is 4-bet bluff from BTN but not from UTG', () => {
      const a5s = [card('♠', 'A'), card('♠', '5')];
      const recUtg = getGtoPreflopRecommendation({ hand: a5s, rfiPosition: 'UTG', spot: 'facing_3bet' });
      const recBtn = getGtoPreflopRecommendation({ hand: a5s, rfiPosition: 'BTN', spot: 'facing_3bet' });
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
      const rec80 = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 80,
      });
      const rec120 = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 120,
      });
      expect(rec80.action).toBe('R');
      expect(rec120.action).toBe('R');
      expect(rec80.sizingBB).not.toBe(rec120.sizingBB);
      expect(rec80.sizingBB).toBeLessThan(rec120.sizingBB!);
    });

    it('defender position changes facing_open recommendation', () => {
      const kjs = [card('♠', 'K'), card('♠', 'J')];
      const recBB = getGtoPreflopRecommendation({
        hand: kjs,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'CO',
        smallBlind: 5,
        defenderPosition: 'BB',
      });
      const recIP = getGtoPreflopRecommendation({
        hand: kjs,
        rfiPosition: 'BTN',
        spot: 'facing_open',
        openerPosition: 'CO',
        smallBlind: 5,
        defenderPosition: 'BTN',
      });
      expect(recBB.action).not.toBe('F');
      expect(recIP.action).not.toBe('F');
    });

    it('BB option returns Check not Fold for weak hands', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const rec = getGtoPreflopRecommendation({ hand: garbage, rfiPosition: 'BB', spot: 'rfi' });
      expect(rec.action).toBe('C');
    });

    it('BB option returns Raise for strong hands', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'BB', spot: 'rfi' });
      expect(rec.action).toBe('R');
    });

    it('facing_open 3-bet sizing uses actual currentBet', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const recSmall = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'BTN',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 20,
      });
      const recLarge = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'BTN',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 50,
      });
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
        { pos: 4, expected: 'HJ' as const, flags: { isButton: false, isCutoff: false, isHijack: true, isBlind: false } },
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

  describe('SPR-based All-in Detection', () => {
    it('short stack facing 3-bet shows All-in (SPR < 2)', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 80,
        stackContext: { chips: 170, toCall: 55, totalPot: 120, bet: 25 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBe(true);
    });

    it('deep stack facing 3-bet shows normal Raise (SPR > 2)', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 80,
        stackContext: { chips: 900, toCall: 55, totalPot: 120, bet: 25 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBeUndefined();
    });

    it('short stack facing open shows All-in for 3-bet (SPR < 2)', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const rec = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'BTN',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 25,
        stackContext: { chips: 80, toCall: 15, totalPot: 35, bet: 10 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBe(true);
    });

    it('deep stack facing open shows normal 3-bet sizing', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const rec = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'BTN',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 25,
        stackContext: { chips: 900, toCall: 15, totalPot: 35, bet: 10 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBeUndefined();
      expect(rec.sizingBB).toBeGreaterThan(0);
    });
  });

  describe('Cold 3-bet Defense', () => {
    it('BB cold 3-bet: AA shows 4-bet', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'BB',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 100,
      });
      expect(rec.action).toBe('R');
    });

    it('BB cold 3-bet: 72o shows fold', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const rec = getGtoPreflopRecommendation({
        hand: garbage,
        rfiPosition: 'BB',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 100,
      });
      expect(rec.action).toBe('F');
    });

    it('SB cold 3-bet: AKs shows 4-bet', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const rec = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'SB',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'SB',
        currentBet: 80,
      });
      expect(rec.action).toBe('R');
    });

    it('IP cold 3-bet: QQ shows 4-bet, 55 shows fold', () => {
      const qq = [card('♠', 'Q'), card('♥', 'Q')];
      const recQQ = getGtoPreflopRecommendation({
        hand: qq,
        rfiPosition: 'CO',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'CO',
        currentBet: 80,
      });
      expect(recQQ.action).toBe('R');
      const fiveFive = [card('♠', '5'), card('♥', '5')];
      const rec55 = getGtoPreflopRecommendation({
        hand: fiveFive,
        rfiPosition: 'CO',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'CO',
        currentBet: 80,
      });
      expect(rec55.action).toBe('F');
    });

    it('BB cold 3-bet: AJs shows call', () => {
      const ajs = [card('♠', 'A'), card('♠', 'J')];
      const rec = getGtoPreflopRecommendation({
        hand: ajs,
        rfiPosition: 'BB',
        spot: 'cold_3bet',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 100,
      });
      expect(rec.action).toBe('C');
    });
  });

  describe('BB Option Raise', () => {
    it('BB option: AA raises (UTG-tier hand)', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'BB', spot: 'rfi', smallBlind: 5 });
      expect(rec.action).toBe('R');
    });

    it('BB option: 72o checks (not UTG-tier)', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      const rec = getGtoPreflopRecommendation({
        hand: garbage,
        rfiPosition: 'BB',
        spot: 'rfi',
        smallBlind: 5,
      });
      expect(rec.action).toBe('C');
    });

    it('BB option: AKs raises', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const rec = getGtoPreflopRecommendation({ hand: aks, rfiPosition: 'BB', spot: 'rfi', smallBlind: 5 });
      expect(rec.action).toBe('R');
    });
  });

  describe('HJ Position', () => {
    it('HJ opens 33 (wider than MP)', () => {
      const lowPair = [card('♠', '3'), card('♥', '3')];
      expect(getGtoPreflopRecommendation({ hand: lowPair, rfiPosition: 'HJ', spot: 'rfi' }).action).toBe('R');
    });

    it('HJ opens A2s (wider than MP)', () => {
      const a2s = [card('♠', 'A'), card('♠', '2')];
      expect(getGtoPreflopRecommendation({ hand: a2s, rfiPosition: 'HJ', spot: 'rfi' }).action).toBe('R');
    });

    it('HJ opens K9s (wider than MP)', () => {
      const k9s = [card('♠', 'K'), card('♠', '9')];
      expect(getGtoPreflopRecommendation({ hand: k9s, rfiPosition: 'HJ', spot: 'rfi' }).action).toBe('R');
    });

    it('HJ folds 72o', () => {
      const garbage = [card('♣', '7'), card('♦', '2')];
      expect(getGtoPreflopRecommendation({ hand: garbage, rfiPosition: 'HJ', spot: 'rfi' }).action).toBe('F');
    });
  });

  describe('Preflop range extraction', () => {
    it('opener range contains premium hands and excludes junk', () => {
      const classes = getPreflopRangeClasses({ role: 'opener', position: 'UTG' });
      expect(classes).toContain('AA');
      expect(classes).toContain('AKs');
      expect(classes).not.toContain('72o');
    });

    it('later position opens a wider range', () => {
      const utg = getPreflopRangeClasses({ role: 'opener', position: 'UTG' });
      const btn = getPreflopRangeClasses({ role: 'opener', position: 'BTN' });
      expect(btn.length).toBeGreaterThan(utg.length);
    });

    it('BB caller range vs UTG includes calls and 3-bets', () => {
      const classes = getPreflopRangeClasses({
        role: 'caller',
        position: 'BB',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(classes).toContain('AA'); // 3-bet hands are part of continuing range
      expect(classes.length).toBeGreaterThan(10);
    });

    it('threebettor range is a subset of caller range', () => {
      const caller = getPreflopRangeClasses({
        role: 'caller',
        position: 'BB',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      const threebettor = getPreflopRangeClasses({
        role: 'threebettor',
        position: 'BB',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(threebettor.length).toBeLessThan(caller.length);
      for (const cls of threebettor) expect(caller).toContain(cls);
    });

    it('positionLabelFor maps seats relative to the dealer', () => {
      expect(positionLabelFor(0, 6)).toBe('BTN');
      expect(positionLabelFor(1, 6)).toBe('SB');
      expect(positionLabelFor(2, 6)).toBe('BB');
    });
  });

  describe('筹码深度分层（低深度下加注降级为全下）', () => {
    it('≤15bb 开池直接全下，不给小尺度', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'BTN',
        spot: 'rfi',
        smallBlind: 5,
        stackContext: { chips: 140, toCall: 0, totalPot: 15, bet: 0 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBe(true);
      expect(rec.sizingBB).toBe(14);
    });

    it('16–25bb 面对开池的 3bet 直接全下', () => {
      const aks = [card('♠', 'A'), card('♠', 'K')];
      const rec = getGtoPreflopRecommendation({
        hand: aks,
        rfiPosition: 'BB',
        spot: 'facing_open',
        openerPosition: 'BTN',
        smallBlind: 5,
        defenderPosition: 'BB',
        currentBet: 25,
        stackContext: { chips: 200, toCall: 15, totalPot: 35, bet: 10 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBe(true);
    });

    it('26–40bb 面对 3bet 的 4bet 直接全下', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 80,
        stackContext: { chips: 350, toCall: 55, totalPot: 120, bet: 25 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBe(true);
    });

    it('>40bb 面对 3bet 仍是定尺 4bet', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({
        hand: aa,
        rfiPosition: 'CO',
        spot: 'facing_3bet',
        smallBlind: 5,
        currentBet: 80,
        stackContext: { chips: 600, toCall: 55, totalPot: 120, bet: 25 },
      });
      expect(rec.action).toBe('R');
      expect(rec.isAllIn).toBeUndefined();
    });

    it('没有筹码信息时保持原有定尺行为（无回归）', () => {
      const aa = [card('♠', 'A'), card('♥', 'A')];
      const rec = getGtoPreflopRecommendation({ hand: aa, rfiPosition: 'BTN', spot: 'rfi', smallBlind: 5 });
      expect(rec.action).toBe('R');
      expect(rec.sizingBB).toBe(2.0);
      expect(rec.isAllIn).toBeUndefined();
    });

    it('机器人：≤15bb 开池也直接全下', () => {
      const hero = mkBotPlayer(1, 140, 0);
      hero.hand = [card('♠', 'A'), card('♥', 'A')];
      const state = mkBotState(
        [hero, mkBotPlayer(2, 900, 10), mkBotPlayer(3, 900, 5)],
        1 as PlayerId,
        0,
        5,
      );
      const decision = decidePreflopGTO(
        hero,
        state,
        {
          canCheckResult: true,
          canCallResult: false,
          canRaiseResult: true,
          canFoldResult: true,
          canAllInResult: true,
        },
        {
          toCall: 0, totalPot: 15, potOdds: 0, position: 0, totalPlayers: 3,
          numOpponents: 2, isHeadsUp: false, isLatePosition: true, isButton: true,
          isCutoff: false, isHijack: false, isMiddlePosition: false,
          isEarlyPosition: false, isBlind: false, hasLimpers: false,
        },
        { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 },
      );
      expect(decision.action).toBe('allin');
    });
  });
});

/**
 * `detectPreflopScenario` 是机器人与面板**唯一**的翻前场景判定。
 *
 * 面板（GameBoard 的 gtoRecommendation IIFE）原先把 `facing_3bet` 简化成
 * `player.bet > sb*2 && lastBet > player.bet`，漏掉 `player.bet === lastRaiseBet`，
 * 于是「我加注过、对手又加注到我之上、但最后加注者不是我」的局面上会误报
 * 4bet 场景、查错范围表。这里把四条分支与那条回归用例一起钉住。
 */
describe('detectPreflopScenario 场景判定（机器人与面板共用）', () => {
  const SB = 5;

  function mkScenario(
    heroBet: number,
    lastBet: number,
    lastRaiseBet: number,
    opponentBets: number[] = [],
  ) {
    const hero = mkBotPlayer(1, 1000, heroBet);
    const players = [
      hero,
      ...opponentBets.map((b, i) => mkBotPlayer((i + 2) as PlayerId, 1000, b)),
    ];
    const state: GameState = {
      ...mkBotState(players, 1 as PlayerId, lastBet, SB),
      lastRaiseBet,
    };
    return { state, hero };
  }

  it('无人加注 → rfi', () => {
    const { state, hero } = mkScenario(10, 10, 10);
    expect(detectPreflopScenario(state, hero)).toBe('rfi');
  });

  it('面对单个开池 → facing_open', () => {
    const { state, hero } = mkScenario(10, 30, 30, [30]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');
  });

  it('我加注后被加注，且我恰是最后加注者 → facing_3bet', () => {
    // hero 加到 30，对手加注到 40（增量 30 = hero 本轮投入）→ 满足
    // `player.bet === state.lastRaiseBet`
    const { state, hero } = mkScenario(30, 40, 30, [40]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_3bet');
  });

  it('回归：我加注后对手 3bet 到 60（增量 50 ≠ 我投入 30）→ 仍是 facing_open', () => {
    // 面板旧逻辑只看 `player.bet > sb*2 && lastBet > player.bet`，
    // 这里会误判成 facing_3bet；共享判定要求 `player.bet === lastRaiseBet`。
    const { state, hero } = mkScenario(30, 60, 50, [60]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');
  });

  it('未投入筹码且面对两个不同注额的加注 → cold_3bet', () => {
    const { state, hero } = mkScenario(0, 90, 80, [30, 90]);
    expect(detectPreflopScenario(state, hero)).toBe('cold_3bet');
  });

  it('两个对手注额相同不构成 cold_3bet → facing_open', () => {
    const { state, hero } = mkScenario(0, 30, 30, [30, 30]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');
  });

  it('只有一个人加注不构成 cold_3bet → facing_open', () => {
    const { state, hero } = mkScenario(0, 30, 30, [30]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');
  });

  it('已投入筹码时不会是 cold_3bet（cold 3bet 要求本轮未投入）', () => {
    const { state, hero } = mkScenario(10, 90, 80, [30, 90]);
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');
  });

  it('decidePreflopGTO 走同一判定：回归局面按 facing_open 处理而非 4bet 全下', () => {
    // hero 本轮已投 20、对手加到 40（增量 30 ≠ hero 的 20）→ 共享判定是
    // facing_open；面板旧逻辑会误判成 facing_3bet。
    // 30bb（band=medium）下两者动作不同：
    //   facing_3bet → jamInsteadOfSizing 为 true（band !== deep）→ allin
    //   facing_open → jamInsteadOfSizing 为 false，且 SPR 2.0 / 目标 140
    //                 未达 all-in 条件 → raise
    const hero = mkBotPlayer(1, 300, 20);
    hero.hand = [card('♠', 'A'), card('♥', 'A')];
    const state: GameState = {
      ...mkBotState(
        [hero, mkBotPlayer(2, 700, 40), mkBotPlayer(3, 700, 0)],
        1 as PlayerId,
        40,
        SB,
      ),
      lastRaiseBet: 30,
    };
    expect(detectPreflopScenario(state, hero)).toBe('facing_open');

    const decision = decidePreflopGTO(
      hero,
      state,
      {
        canCheckResult: false,
        canCallResult: true,
        canRaiseResult: true,
        canFoldResult: true,
        canAllInResult: true,
      },
      {
        toCall: 20, totalPot: 80, potOdds: 0.2, position: 0, totalPlayers: 3,
        numOpponents: 2, isHeadsUp: false, isLatePosition: true, isButton: true,
        isCutoff: false, isHijack: false, isMiddlePosition: false,
        isEarlyPosition: false, isBlind: false, hasLimpers: false,
      },
      { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 },
    );
    expect(decision.action).toBe('raise');
  });
});

/**
 * B4：锦标赛范围收紧。
 *
 * 实现是**从现金局表派生**（不新增一套手编表），所以这里钉的是派生方案的三条
 * 性质，加上几处具体的变化清单：
 *   1. 锦标赛范围 ⊆ 现金局范围（不引入任何新牌）
 *   2. 每张非空表都严格变窄
 *   3. 现金局 / 不传赛制 → 与收紧前逐位一致
 *
 * 「哪些牌被裁掉」是这一批的**预期行为变更**，所以下面有几条硬编码清单。将来
 * 若改了强度序（`getPreflopTier` / Chen），这些清单会失败 —— 那是**提醒你这
 * 是一次行为变更**，不是测试写错了。
 */
describe('锦标赛范围收紧（B4）', () => {
  const TOTAL_COMBOS = 1326;
  const OPENERS = ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB'] as const;
  // 防守位：seat 决定 `defenderType`（`getDefenderType`），IP 用 CO 座代表示。
  const DEFENDERS = [
    ['BB', 'BB'],
    ['SB', 'SB'],
    ['CO', 'IP'],
  ] as const;

  const widthOf = (classes: string[]): number =>
    classes.reduce((sum, c) => sum + combosInClass(c), 0) / TOTAL_COMBOS;

  /**
   * 类记法 → 两张牌。
   *
   * `getPreflopTier` / `getPreflopStrength` 的 rank 表用的是 `'10'`，而类记法
   * （本文件与 `rangeEquity`）用 `'T'` —— 这里做一次归一，别让 `'T'` 悄悄
   * 查不到（`RI['T']` 是 `undefined`，档位会变成 `NaN`）。
   */
  function classToHand(cls: string): Card[] {
    const suited = cls.endsWith('s');
    const offsuit = cls.endsWith('o');
    const body = suited || offsuit ? cls.slice(0, -1) : cls;
    const rank = (r: string) => (r === 'T' ? '10' : r);
    return [
      card('♠', rank(body[0])),
      card(suited ? '♠' : '♥', rank(body[1])),
    ];
  }

  /** 强度序的键（与实现同一口径：档位升序 → Chen 降序），越小越强。 */
  const strengthKey = (cls: string): number => {
    const hand = classToHand(cls);
    return getPreflopTier(hand) * 100 - getPreflopStrength(hand);
  };

  type RangeQuery = Parameters<typeof getPreflopRangeClasses>[0];

  const ALL_QUERIES: { label: string; query: RangeQuery }[] = [];
  for (const position of OPENERS) {
    ALL_QUERIES.push({
      label: `opener:${position}`,
      query: { role: 'opener', position },
    });
  }
  for (const openerPosition of OPENERS) {
    for (const [position, defenderType] of DEFENDERS) {
      for (const role of ['caller', 'threebettor'] as const) {
        ALL_QUERIES.push({
          label: `${role}:${openerPosition}/${defenderType}`,
          query: { role, position, defenderType, openerPosition },
        });
      }
    }
  }

  /** 在指定赛制下取某类查询的范围。 */
  const classesIn = (
    scenario: 'cash' | 'tournament',
    query: RangeQuery,
  ): string[] => {
    resetGtoConfig();
    if (scenario === 'tournament') setGtoConfig({ scenario });
    return getPreflopRangeClasses(query);
  };

  const openerQuery = (position: Position): RangeQuery => ({
    role: 'opener',
    position,
  });
  const bbVsBtnQuery: RangeQuery = {
    role: 'caller',
    position: 'BB',
    defenderType: 'BB',
    openerPosition: 'BTN',
  };

  beforeEach(() => {
    resetGtoConfig();
    resetRandomSource();
  });
  afterEach(() => {
    resetGtoConfig();
    resetRandomSource();
  });

  it('锦标赛范围 ⊆ 现金局范围，且每张非空表都严格变窄（遍历全部 42 个查询）', () => {
    const violations: string[] = [];
    let nonEmpty = 0;

    for (const { label, query } of ALL_QUERIES) {
      const cash = classesIn('cash', query);
      const tour = classesIn('tournament', query);

      if (cash.length === 0) {
        if (tour.length !== 0) violations.push(`${label}: 现金局为空但锦标赛非空`);
        continue;
      }
      nonEmpty++;

      const cashSet = new Set(cash);
      for (const cls of tour) {
        if (!cashSet.has(cls)) {
          violations.push(`${label}: 锦标赛引入了现金局没有的 ${cls}`);
        }
      }
      const wCash = widthOf(cash);
      const wTour = widthOf(tour);
      if (!(wTour < wCash)) {
        violations.push(
          `${label}: 宽度没有下降（${(wCash * 100).toFixed(1)}% → ${(wTour * 100).toFixed(1)}%）`,
        );
      }
    }

    expect(violations).toEqual([]);
    expect(nonEmpty).toBe(ALL_QUERIES.length);
  });

  it('现金局：类数与收紧前一致（证明默认口径没被动过）', () => {
    expect(classesIn('cash', openerQuery('UTG'))).toHaveLength(34);
    expect(classesIn('cash', openerQuery('BTN'))).toHaveLength(96);
    expect(classesIn('cash', bbVsBtnQuery)).toHaveLength(163);
  });

  it('锦标赛：类数下降（UTG 34→29 / BTN 96→84 / BB 对 BTN 163→114）', () => {
    expect(classesIn('tournament', openerQuery('UTG'))).toHaveLength(29);
    expect(classesIn('tournament', openerQuery('BTN'))).toHaveLength(84);
    expect(classesIn('tournament', bbVsBtnQuery)).toHaveLength(114);
  });

  it('开池表全由「加注」组成，所以裁掉的一定比留下的弱（强度序单调）', () => {
    const violations: string[] = [];
    for (const position of OPENERS) {
      const cash = classesIn('cash', openerQuery(position));
      const tour = new Set(classesIn('tournament', openerQuery(position)));
      const kept = cash.filter((c) => tour.has(c));
      const cut = cash.filter((c) => !tour.has(c));
      if (cut.length === 0) continue;

      const weakestKept = Math.max(...kept.map(strengthKey));
      const strongestCut = Math.min(...cut.map(strengthKey));
      // 允许相等（键相同的牌由稳定排序决定谁留下），但不允许裁掉更强的。
      if (strongestCut < weakestKept) {
        violations.push(
          `${position}: 裁掉的比留下的强（cut ${strongestCut} < kept ${weakestKept}）`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('UTG 开池：锦标赛裁掉 ATo / 98s / 87s / 76s / 66（预期行为变更）', () => {
    const cash = classesIn('cash', openerQuery('UTG'));
    const tour = new Set(classesIn('tournament', openerQuery('UTG')));
    expect(cash.filter((c) => !tour.has(c)).sort()).toEqual(
      ['66', '76s', '87s', '98s', 'ATo'].sort(),
    );
  });

  it('BTN 开池：裁掉的是最弱的那些（A2o / A3o / K6o / Q8o …），不是强牌', () => {
    const cash = classesIn('cash', openerQuery('BTN'));
    const tour = classesIn('tournament', openerQuery('BTN'));
    expect(cash.filter((c) => !tour.includes(c)).sort()).toEqual(
      [
        'A2o', 'A3o', 'A4o', 'A5o', 'J5s', 'J6s',
        'K5o', 'K6o', 'K7o', 'K8o', 'Q8o', 'T6s',
      ].sort(),
    );
    // 价值牌一张都没动
    for (const cls of ['AA', 'KK', 'AKs', 'AQs', 'KQs', 'JJ']) {
      expect(tour).toContain(cls);
    }
  });

  /**
   * 用面板 API 逐类问一遍，把某张防守表的「加注」与「跟注」两个集合分开拿到 ——
   * `getPreflopRangeClasses` 会把 R 与 C 合并，看不出两个比例各自的作用。
   */
  function facingOpenSets(
    scenario: 'cash' | 'tournament',
    opener: Position,
    defender: Position,
  ): { r: Set<string>; c: Set<string> } {
    const r = new Set<string>();
    const c = new Set<string>();
    for (const cls of allHandClasses()) {
      const rec = getGtoPreflopRecommendation({
        hand: classToHand(cls),
        rfiPosition: defender,
        spot: 'facing_open',
        openerPosition: opener,
        smallBlind: 5,
        defenderPosition: defender,
        gameScenario: scenario,
      });
      if (rec.action === 'R') r.add(cls);
      else if (rec.action === 'C') c.add(cls);
    }
    return { r, c };
  }

  it('跟注比加注收紧得多（ICM 惩罚跟注，不惩罚弃牌）', () => {
    const cash = facingOpenSets('cash', 'BTN', 'BB');
    const tour = facingOpenSets('tournament', 'BTN', 'BB');
    const shrink = (before: Set<string>, after: Set<string>) =>
      1 - widthOf([...after]) / widthOf([...before]);

    // 两边都确实收紧了
    expect(shrink(cash.r, tour.r)).toBeGreaterThan(0);
    expect(shrink(cash.c, tour.c)).toBeGreaterThan(0);
    // 跟注收得比加注狠
    expect(shrink(cash.c, tour.c)).toBeGreaterThan(shrink(cash.r, tour.r));
  });

  it('3bet 范围保住轮子 A 诈唬：A5s 仍在，只裁掉 A4s / A3s / A2s', () => {
    const query: RangeQuery = {
      role: 'threebettor',
      position: 'BB',
      defenderType: 'BB',
      openerPosition: 'CO',
    };
    const cash = classesIn('cash', query);
    const tour = classesIn('tournament', query);
    expect(cash.filter((c) => !tour.includes(c)).sort()).toEqual(
      ['A2s', 'A3s', 'A4s'].sort(),
    );
    expect(tour).toContain('A5s');
    expect(tour).toContain('AKs');
    expect(tour).toContain('AA');
  });

  it('不传赛制 == 现金局（渲染层的缺省语义）', () => {
    const hand = [card('♠', 'A'), card('♥', '2')];
    const omitted = getGtoPreflopRecommendation({ hand, rfiPosition: 'BTN', spot: 'rfi' });
    const cash = getGtoPreflopRecommendation({
      hand,
      rfiPosition: 'BTN',
      spot: 'rfi',
      smallBlind: 5,
      gameScenario: 'cash',
    });
    const tour = getGtoPreflopRecommendation({
      hand,
      rfiPosition: 'BTN',
      spot: 'rfi',
      smallBlind: 5,
      gameScenario: 'tournament',
    });
    expect(omitted).toEqual(cash);
    expect(omitted.action).toBe('R');
    expect(tour.action).toBe('F');
  });

  it('机器人决策跟全局赛制走：BTN 开池 A2o 现金局加注、锦标赛弃牌', () => {
    // 让混合频率分支确定性触发（`random() < 1.0 + stealBoost`）。
    setRandomSource(() => 0);

    const hero = mkBotPlayer(1, 1000, 0);
    hero.hand = [card('♠', 'A'), card('♥', '2')];
    // dealer === hero.id → hero 在 BTN；lastBet 0 → 无人加注（rfi）。
    const state = mkBotState(
      [hero, mkBotPlayer(2, 1000, 0), mkBotPlayer(3, 1000, 0)],
      1 as PlayerId,
      0,
      5,
    );
    const flags = {
      canCheckResult: false,
      canCallResult: false,
      canRaiseResult: true,
      canFoldResult: true,
      canAllInResult: true,
    };
    const ctx = {
      toCall: 0, totalPot: 15, potOdds: 0, position: 0, totalPlayers: 3,
      numOpponents: 2, isHeadsUp: false, isLatePosition: true, isButton: true,
      isCutoff: false, isHijack: false, isMiddlePosition: false,
      isEarlyPosition: false, isBlind: false, hasLimpers: false,
    };
    const adj = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

    resetGtoConfig();
    expect(decidePreflopGTO(hero, state, flags, ctx, adj).action).toBe('raise');

    setGtoConfig({ scenario: 'tournament' });
    expect(decidePreflopGTO(hero, state, flags, ctx, adj).action).toBe('fold');
  });

  it('面板与机器人同口径：锦标赛下面板给弃牌的那手牌，机器人也弃牌', () => {
    setRandomSource(() => 0);
    const hero = mkBotPlayer(1, 1000, 0);
    hero.hand = [card('♠', 'A'), card('♥', '2')];
    const state = mkBotState(
      [hero, mkBotPlayer(2, 1000, 0), mkBotPlayer(3, 1000, 0)],
      1 as PlayerId,
      0,
      5,
    );
    const flags = {
      canCheckResult: false,
      canCallResult: false,
      canRaiseResult: true,
      canFoldResult: true,
      canAllInResult: true,
    };
    const ctx = {
      toCall: 0, totalPot: 15, potOdds: 0, position: 0, totalPlayers: 3,
      numOpponents: 2, isHeadsUp: false, isLatePosition: true, isButton: true,
      isCutoff: false, isHijack: false, isMiddlePosition: false,
      isEarlyPosition: false, isBlind: false, hasLimpers: false,
    };
    const adj = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

    for (const scenario of ['cash', 'tournament'] as const) {
      setGtoConfig({ scenario });
      const panel = getGtoPreflopRecommendation({
        hand: hero.hand,
        rfiPosition: 'BTN',
        spot: 'rfi',
        smallBlind: 5,
        gameScenario: scenario,
      });
      const bot = decidePreflopGTO(hero, state, flags, ctx, adj).action;
      if (panel.action === 'F') expect(bot).toBe('fold');
      if (panel.action === 'R') expect(bot).toBe('raise');
    }
  });
});
