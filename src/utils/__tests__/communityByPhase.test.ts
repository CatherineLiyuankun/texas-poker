import {
  getCardsToCome,
  getCommunityByPhase,
  getStreetsLeft,
} from '../communityByPhase';
import type { Card, GamePhase } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

const BOARD = [
  card('♠', 'A'),
  card('♥', 'K'),
  card('♦', 'Q'),
  card('♣', 'J'),
  card('♠', '2'),
];

const PHASES: GamePhase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

describe('getCommunityByPhase — 各街可见的公共牌', () => {
  it('按街切开，河牌才给满五张', () => {
    expect(getCommunityByPhase(BOARD, 'preflop')).toEqual([]);
    expect(getCommunityByPhase(BOARD, 'flop')).toHaveLength(3);
    expect(getCommunityByPhase(BOARD, 'turn')).toHaveLength(4);
    expect(getCommunityByPhase(BOARD, 'river')).toHaveLength(5);
  });

  it('翻牌 / 转牌是河牌的前缀（发牌顺序累积）', () => {
    const river = getCommunityByPhase(BOARD, 'river');
    expect(getCommunityByPhase(BOARD, 'flop')).toEqual(river.slice(0, 3));
    expect(getCommunityByPhase(BOARD, 'turn')).toEqual(river.slice(0, 4));
  });
});

describe('getStreetsLeft — 剩余下注街数（≠ 还要发的牌数）', () => {
  it('翻前 3 条街、翻牌 2、转牌 1、河牌 0', () => {
    expect(getStreetsLeft('preflop')).toBe(3);
    expect(getStreetsLeft('flop')).toBe(2);
    expect(getStreetsLeft('turn')).toBe(1);
    expect(getStreetsLeft('river')).toBe(0);
    expect(getStreetsLeft('showdown')).toBe(0);
  });

  it('与 getCardsToCome 只在翻牌 / 转牌 / 河牌相等 —— 翻前是 5 vs 3', () => {
    // 这两个数极容易被混用：翻牌往后恰好一致，只有翻前露馅。
    // 隐含赔率的「按街展开」必须用街数，用牌数会把翻前放大一倍以上。
    expect(getCardsToCome('flop')).toBe(getStreetsLeft('flop'));
    expect(getCardsToCome('turn')).toBe(getStreetsLeft('turn'));
    expect(getCardsToCome('river')).toBe(getStreetsLeft('river'));
    expect(getCardsToCome('preflop')).not.toBe(getStreetsLeft('preflop'));
    expect(getCardsToCome('preflop')).toBe(5);
  });

  it('街数恒不大于牌数（不可能有比牌还多的下注街）', () => {
    for (const phase of PHASES) {
      expect(getStreetsLeft(phase)).toBeLessThanOrEqual(getCardsToCome(phase));
    }
  });
});
