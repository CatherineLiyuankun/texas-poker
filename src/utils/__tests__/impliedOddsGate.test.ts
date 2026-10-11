import { shouldShowImpliedOdds } from '../potOdds';
import type { Card } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

/** 翻牌后的三张公共牌（`cardsToCome` 用 2 / 1 / 0 分别代表翻牌 / 转牌 / 河牌）。 */
const FLOP_CARDS_TO_COME = 2;
const TURN_CARDS_TO_COME = 1;
const RIVER_CARDS_TO_COME = 0;
const PREFLOP_CARDS_TO_COME = 5;

describe('shouldShowImpliedOdds — 隐含赔率行的显示门', () => {
  describe('成员 1：drawDetector 认的听牌', () => {
    it('同花听（恰好 4 张同花）→ 显示', () => {
      // A♥Q♥ + 9♥7♥2♣ → 红桃 A Q 9 7 = 4 张
      expect(
        shouldShowImpliedOdds(
          [card('♥', 'A'), card('♥', 'Q')],
          [card('♥', '9'), card('♥', '7'), card('♣', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('两头顺 → 显示', () => {
      // 9♠8♦ + 7♥6♣K♦ → 6-7-8-9 缺 5 或 10，两端都活着
      expect(
        shouldShowImpliedOdds(
          [card('♠', '9'), card('♦', '8')],
          [card('♥', '7'), card('♣', '6'), card('♦', 'K')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('卡顺 → 显示', () => {
      // A♠K♦ + Q♥J♣2♦ → A-K-Q-J 只差一张 10（顶端没有更大的顺子补牌）
      expect(
        shouldShowImpliedOdds(
          [card('♠', 'A'), card('♦', 'K')],
          [card('♥', 'Q'), card('♣', 'J'), card('♦', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('河牌恒不显示 —— 没有牌可发，听牌形状再完整也不算', () => {
      // 形状上是同花听（A♥Q♥ + 两张红桃），但 cardsToCome = 0
      expect(
        shouldShowImpliedOdds(
          [card('♥', 'A'), card('♥', 'Q')],
          [
            card('♥', '9'),
            card('♥', '7'),
            card('♣', '2'),
            card('♠', '3'),
            card('♦', '4'),
          ],
          RIVER_CARDS_TO_COME,
        ),
      ).toBe(false);
    });
  });

  describe('成员 2：后门同花听', () => {
    it('恰好 3 张同花且我持该花色 → 显示', () => {
      // A♥8♦ + 9♥3♥2♣ → 红桃 A 9 3 = 3 张，A♥ 在我手里；顺子/三条都不成立，
      // 所以这一条是唯一被点亮的成员
      expect(
        shouldShowImpliedOdds(
          [card('♥', 'A'), card('♦', '8')],
          [card('♥', '9'), card('♥', '3'), card('♣', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('牌面自己 3 张同花、我一张都没有 → 不显示', () => {
      // 9♥7♥2♥ 摆着三张红桃，但 A♠K♦ 里没有红桃：再发两张谁都成花，
      // 那不是我一个人的变强路径（成了也赢不到钱）
      expect(
        shouldShowImpliedOdds(
          [card('♠', 'A'), card('♦', 'K')],
          [card('♥', '9'), card('♥', '7'), card('♥', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(false);
    });

    it('转牌只剩一张牌可发 → 后门听不成立（后门需要再发两张）', () => {
      // 同一手牌走到转牌：红桃仍是 A 9 3 三张，但只剩一张牌可发
      expect(
        shouldShowImpliedOdds(
          [card('♥', 'A'), card('♦', '8')],
          [card('♥', '9'), card('♥', '3'), card('♣', '2'), card('♠', 'J')],
          TURN_CARDS_TO_COME,
        ),
      ).toBe(false);
    });
  });

  describe('成员 3：三条（暗三条 / 明三条 / 牌面三条）', () => {
    it('暗三条（口袋对中牌面）→ 显示', () => {
      expect(
        shouldShowImpliedOdds(
          [card('♠', '7'), card('♥', '7')],
          [card('♦', '7'), card('♣', 'K'), card('♠', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('明三条（牌面对子 + 我一张）→ 显示', () => {
      expect(
        shouldShowImpliedOdds(
          [card('♦', '7'), card('♠', 'K')],
          [card('♠', '7'), card('♥', '7'), card('♣', '2')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('牌面三条（公共牌自己三张同点）→ 显示 —— 我打牌面也至少是三条', () => {
      expect(
        shouldShowImpliedOdds(
          [card('♠', 'A'), card('♦', 'K')],
          [card('♠', '7'), card('♥', '7'), card('♦', '7')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('成型但不会再变强的牌不显示（对子 / 两对 / 顺子 / 同花 / 葫芦）', () => {
      const cases: Array<[string, Card[], Card[]]> = [
        [
          '对子',
          [card('♠', 'A'), card('♦', 'K')],
          [card('♥', 'A'), card('♣', '9'), card('♦', '4')],
        ],
        [
          '两对',
          [card('♠', 'A'), card('♦', 'K')],
          [card('♥', 'A'), card('♣', 'K'), card('♦', '4')],
        ],
        [
          '顺子',
          [card('♠', '9'), card('♦', '8')],
          [card('♥', '7'), card('♣', '6'), card('♦', '5')],
        ],
        [
          // 5 张红桃已经成花：`drawDetector` 只认「恰好 4 张」，这里连听牌都不是
          '同花',
          [card('♥', 'A'), card('♥', 'Q')],
          [card('♥', '9'), card('♥', '7'), card('♥', '2')],
        ],
        [
          // 葫芦只剩 1 张补牌能变四条，跟「空气追对子」是一个量级，不算变强路径
          '葫芦',
          [card('♠', '7'), card('♥', '7')],
          [card('♦', '7'), card('♣', 'K'), card('♠', 'K')],
        ],
      ];

      for (const [name, hole, community] of cases) {
        expect([name, shouldShowImpliedOdds(hole, community, FLOP_CARDS_TO_COME)])
          .toEqual([name, false]);
      }
    });
  });

  describe('成员 4：翻前口袋对（set mining）', () => {
    it('翻前口袋对 → 显示 —— 中三条约 12%，隐含赔率最经典的场景', () => {
      expect(
        shouldShowImpliedOdds(
          [card('♠', '7'), card('♥', '7')],
          [],
          PREFLOP_CARDS_TO_COME,
        ),
      ).toBe(true);
    });

    it('翻前非对子 → 不显示', () => {
      expect(
        shouldShowImpliedOdds(
          [card('♠', 'A'), card('♦', 'K')],
          [],
          PREFLOP_CARDS_TO_COME,
        ),
      ).toBe(false);
    });

    it('翻后已错过牌面的口袋对 → 不显示（只剩 2 张补牌，撑不起一整行）', () => {
      // 7♠7♥ 遇到 K♣9♦4♠：只成了对子，既没听牌也没三条
      expect(
        shouldShowImpliedOdds(
          [card('♠', '7'), card('♥', '7')],
          [card('♣', 'K'), card('♦', '9'), card('♠', '4')],
          FLOP_CARDS_TO_COME,
        ),
      ).toBe(false);
    });
  });

  it('干净牌面 + 空气手牌 → 不显示（这一行没东西可算）', () => {
    expect(
      shouldShowImpliedOdds(
        [card('♠', '2'), card('♦', '7')],
        [card('♠', 'K'), card('♥', '9'), card('♣', '4')],
        FLOP_CARDS_TO_COME,
      ),
    ).toBe(false);
  });
});
