import {
  analyzeBoard,
  analyzeBoardWithEquity,
  calibrateWetnessWithEquity,
} from '../boardTexture';
import type { Card } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

describe('Board Texture Analysis', () => {
  describe('Very Dry Boards (wetness 0-2)', () => {
    it('K♠7♦2♣ is very dry', () => {
      const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_dry');
      expect(texture.wetness).toBeLessThanOrEqual(2);
      expect(texture.isPaired).toBe(false);
      expect(texture.isMonotone).toBe(false);
      expect(texture.isConnected).toBe(false);
    });

    it('A♠9♦4♣ is very dry', () => {
      const board = [card('♠', 'A'), card('♦', '9'), card('♣', '4')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_dry');
      expect(texture.wetness).toBeLessThanOrEqual(2);
    });

    it('Q♣Q♦5♠ is paired and dry', () => {
      const board = [card('♣', 'Q'), card('♦', 'Q'), card('♠', '5')];
      const texture = analyzeBoard(board);
      expect(texture.isPaired).toBe(true);
      expect(texture.wetness).toBeLessThanOrEqual(4);
    });
  });

  describe('Dry Boards (wetness 3-4)', () => {
    it('A♠8♦5♣ is dry', () => {
      const board = [card('♠', 'A'), card('♦', '8'), card('♣', '5')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('dry');
      expect(texture.wetness).toBeGreaterThanOrEqual(3);
      expect(texture.wetness).toBeLessThanOrEqual(4);
    });

    it('K♣6♦3♠ is dry', () => {
      const board = [card('♣', 'K'), card('♦', '6'), card('♠', '3')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('dry');
    });
  });

  describe('Medium Boards (wetness 5-6)', () => {
    it('J♠8♦5♣ is dry (no flush draw, 1-gap connectivity)', () => {
      const board = [card('♠', 'J'), card('♦', '8'), card('♣', '5')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('dry');
      expect(texture.wetness).toBeGreaterThanOrEqual(3);
      expect(texture.wetness).toBeLessThanOrEqual(4);
    });

    it('T♣8♠4♦ is dry (no flush draw, 1-gap connectivity)', () => {
      const board = [card('♣', '10'), card('♠', '8'), card('♦', '4')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('dry');
    });

    it('Q♠9♦6♣ is medium (two-tone + some connectivity)', () => {
      const board = [card('♠', 'Q'), card('♠', '9'), card('♦', '6')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('medium');
      expect(texture.isTwoTone).toBe(true);
    });
  });

  describe('Wet Boards (wetness 7-8)', () => {
    it('T♠9♠7♦ is wet', () => {
      const board = [card('♠', '10'), card('♠', '9'), card('♦', '7')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('wet');
      expect(texture.wetness).toBeGreaterThanOrEqual(7);
      expect(texture.wetness).toBeLessThanOrEqual(8);
      expect(texture.isTwoTone).toBe(true);
      expect(texture.isConnected).toBe(true);
    });

    it('J♣T♦8♣ is wet', () => {
      const board = [card('♣', 'J'), card('♦', '10'), card('♣', '8')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('wet');
      expect(texture.isTwoTone).toBe(true);
      expect(texture.isConnected).toBe(true);
    });
  });

  describe('Very Wet Boards (wetness 9-10)', () => {
    it('J♠T♠9♠ is very wet (monotone + connected)', () => {
      const board = [card('♠', 'J'), card('♠', '10'), card('♠', '9')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_wet');
      expect(texture.wetness).toBeGreaterThanOrEqual(9);
      expect(texture.isMonotone).toBe(true);
      expect(texture.isConnected).toBe(true);
    });

    it('8♣7♣6♣ is very wet (monotone + connected)', () => {
      const board = [card('♣', '8'), card('♣', '7'), card('♣', '6')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_wet');
      expect(texture.isMonotone).toBe(true);
      expect(texture.isConnected).toBe(true);
    });

    it('K♠Q♠J♠ is very wet (monotone + connected + high cards)', () => {
      const board = [card('♠', 'K'), card('♠', 'Q'), card('♠', 'J')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_wet');
      expect(texture.isMonotone).toBe(true);
      expect(texture.isConnected).toBe(true);
      expect(texture.highCards).toBe(2); // K and Q are high (A/K/Q)
    });
  });

  describe('Edge Cases', () => {
    it('less than 3 cards returns very_dry', () => {
      const board = [card('♠', 'A'), card('♦', 'K')];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_dry');
      expect(texture.wetness).toBe(0);
    });

    it('empty board returns very_dry', () => {
      const texture = analyzeBoard([]);
      expect(texture.classification).toBe('very_dry');
    });

    it('turn (4 cards) is analyzed correctly', () => {
      const board = [
        card('♠', '10'),
        card('♠', '9'),
        card('♦', '7'),
        card('♣', '2'),
      ];
      const texture = analyzeBoard(board);
      expect(texture.wetness).toBeGreaterThanOrEqual(5);
      expect(texture.isTwoTone).toBe(true);
    });

    it('river (5 cards) is analyzed correctly', () => {
      const board = [
        card('♠', 'A'),
        card('♠', 'K'),
        card('♠', 'Q'),
        card('♠', 'J'),
        card('♠', '10'),
      ];
      const texture = analyzeBoard(board);
      expect(texture.classification).toBe('very_wet');
      expect(texture.isMonotone).toBe(true);
      expect(texture.isConnected).toBe(true);
      expect(texture.highCards).toBe(3); // A, K, Q
    });

    it('paired board with flush draw', () => {
      const board = [card('♠', 'K'), card('♠', 'K'), card('♠', '7')];
      const texture = analyzeBoard(board);
      expect(texture.isPaired).toBe(true);
      expect(texture.isTwoTone).toBe(true);
      expect(texture.wetness).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Wetness Scoring Components', () => {
    it('monotone adds 4', () => {
      const mono = [card('♠', '8'), card('♠', '5'), card('♠', '2')];
      const nonMono = [card('♠', '8'), card('♦', '5'), card('♣', '2')];
      expect(analyzeBoard(mono).wetness).toBeGreaterThan(
        analyzeBoard(nonMono).wetness,
      );
    });

    it('connected cards add wetness', () => {
      const connected = [card('♠', '8'), card('♦', '9'), card('♣', '10')];
      const disconnected = [card('♠', '2'), card('♦', '8'), card('♣', 'K')];
      expect(analyzeBoard(connected).wetness).toBeGreaterThan(
        analyzeBoard(disconnected).wetness,
      );
    });

    it('paired board reduces wetness', () => {
      const paired = [card('♠', 'K'), card('♦', 'K'), card('♣', '7')];
      const unpaired = [card('♠', 'K'), card('♦', 'Q'), card('♣', '7')];
      expect(analyzeBoard(paired).wetness).toBeLessThan(
        analyzeBoard(unpaired).wetness,
      );
    });

    it('high cards reduce wetness', () => {
      const highBoard = [card('♠', 'A'), card('♦', 'K'), card('♣', '2')];
      const lowBoard = [card('♠', '8'), card('♦', '6'), card('♣', '4')];
      expect(analyzeBoard(highBoard).highCards).toBeGreaterThan(
        analyzeBoard(lowBoard).highCards,
      );
    });
  });

  describe('Ace-low wheel handling', () => {
    it('A-2-3 counts wheel connectivity', () => {
      const wheel = [card('♠', 'A'), card('♠', '2'), card('♦', '3')];
      const texture = analyzeBoard(wheel);
      expect(texture.isConnected).toBe(true);
      expect(texture.wetness).toBeGreaterThanOrEqual(6);
    });

    it('A-2-x without a 3 does not inflate connectivity', () => {
      const noWheel = [card('♠', 'A'), card('♦', '2'), card('♣', '7')];
      const wheel = [card('♠', 'A'), card('♠', '2'), card('♦', '3')];
      expect(analyzeBoard(noWheel).isConnected).toBe(false);
      expect(analyzeBoard(noWheel).wetness).toBeLessThan(
        analyzeBoard(wheel).wetness,
      );
      expect(analyzeBoard(noWheel).classification).toBe('very_dry');
    });

    it('A-2-3-4 turn keeps wheel connectivity', () => {
      const wheelTurn = [
        card('♠', 'A'),
        card('♠', '2'),
        card('♦', '3'),
        card('♣', '4'),
      ];
      expect(analyzeBoard(wheelTurn).isConnected).toBe(true);
    });
  });

  describe('Low-card bonus requires connectivity', () => {
    it('connected low board gets low bonus, disconnected does not', () => {
      const connectedLow = [card('♠', '7'), card('♠', '6'), card('♦', '2')];
      const disconnectedLow = [card('♠', 'J'), card('♠', '7'), card('♦', '2')];
      const connectedTexture = analyzeBoard(connectedLow);
      const disconnectedTexture = analyzeBoard(disconnectedLow);
      expect(connectedTexture.wetness).toBeGreaterThan(
        disconnectedTexture.wetness,
      );
      expect(disconnectedTexture.classification).toBe('very_dry');
    });

    it('disconnected low board is not marked wet', () => {
      const disconnectedLow = [card('♠', 'J'), card('♠', '7'), card('♦', '2')];
      expect(analyzeBoard(disconnectedLow).wetness).toBeLessThanOrEqual(2);
    });
  });

  describe('Street-aware river evaluation', () => {
    it('classifies street by card count', () => {
      const flop = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const turn = [...flop, card('♥', '9')];
      const river = [...turn, card('♠', '4')];
      expect(analyzeBoard(flop).street).toBe('flop');
      expect(analyzeBoard(turn).street).toBe('turn');
      expect(analyzeBoard(river).street).toBe('river');
    });

    it('four-flush river is wet', () => {
      const fourFlush = [
        card('♠', 'K'),
        card('♠', '9'),
        card('♠', '5'),
        card('♠', '2'),
        card('♦', '7'),
      ];
      const texture = analyzeBoard(fourFlush);
      expect(texture.street).toBe('river');
      expect(texture.classification).toBe('wet');
      expect(texture.wetness).toBeGreaterThanOrEqual(7);
    });

    it('paired rainbow river with no straight is very dry', () => {
      const pairedRainbow = [
        card('♠', 'K'),
        card('♦', 'K'),
        card('♣', '7'),
        card('♠', '2'),
        card('♥', '9'),
      ];
      const texture = analyzeBoard(pairedRainbow);
      expect(texture.street).toBe('river');
      expect(texture.classification).toBe('very_dry');
    });

    it('river with one-card straight possibility is wetter than a dead board', () => {
      const straightPossible = [
        card('♥', '9'),
        card('♦', '8'),
        card('♣', '7'),
        card('♠', '6'),
        card('♣', '2'),
      ];
      const deadBoard = [
        card('♠', 'K'),
        card('♦', '9'),
        card('♣', '5'),
        card('♠', '3'),
        card('♥', '7'),
      ];
      expect(analyzeBoard(straightPossible).isStraightPossible).toBe(true);
      expect(analyzeBoard(straightPossible).wetness).toBeGreaterThan(
        analyzeBoard(deadBoard).wetness,
      );
    });

    it('monotone straight river is very wet with straight on board', () => {
      const royal = [
        card('♠', 'A'),
        card('♠', 'K'),
        card('♠', 'Q'),
        card('♠', 'J'),
        card('♠', '10'),
      ];
      const texture = analyzeBoard(royal);
      expect(texture.classification).toBe('very_wet');
      expect(texture.isStraightOnBoard).toBe(true);
    });
  });

  describe('Equity-based wetness calibration', () => {
    it('wet board calibrates wetter than dry board', () => {
      const dry = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const wet = [card('♠', 'J'), card('♠', '10'), card('♠', '9')];
      const dryCal = calibrateWetnessWithEquity(dry, 300);
      const wetCal = calibrateWetnessWithEquity(wet, 300);
      expect(wetCal.equityWetness).toBeGreaterThan(dryCal.equityWetness);
      expect(wetCal.topSetEquity).toBeLessThan(dryCal.topSetEquity);
    });

    it('returns empty calibration for river and preflop boards', () => {
      const river = [
        card('♠', 'A'),
        card('♠', 'K'),
        card('♠', 'Q'),
        card('♠', 'J'),
        card('♠', '10'),
      ];
      const preflop = [card('♠', 'A'), card('♦', 'K')];
      expect(calibrateWetnessWithEquity(river, 100).iterations).toBe(0);
      expect(calibrateWetnessWithEquity(preflop, 100).iterations).toBe(0);
    });

    it('analyzeBoardWithEquity caches results per board', () => {
      const board = [card('♠', 'J'), card('♠', '10'), card('♠', '9')];
      const first = analyzeBoardWithEquity(board);
      const second = analyzeBoardWithEquity(board);
      expect(second).toBe(first);
    });

    it('analyzeBoardWithEquity falls back to heuristic on river', () => {
      const river = [
        card('♠', 'A'),
        card('♠', 'K'),
        card('♠', 'Q'),
        card('♠', 'J'),
        card('♠', '10'),
      ];
      expect(analyzeBoardWithEquity(river)).toEqual(analyzeBoard(river));
    });
  });
});
