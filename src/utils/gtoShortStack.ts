import type { Card, GameState, Player } from '../types/poker';
import type { ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { evaluateHand } from './handEvaluator';
import { calculateRangeAwareEquity } from './rangeEquity';
import {
  classifyPostflopHand,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
} from './handStrength';
// 筹码深度的唯一来源：bb 换算与分档都从 stackDepth 取，本文件不再自己写。
import { effectiveStackBB, stackBand } from './stackDepth';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { random } from './random';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数。
import { equityIterations } from './equityIterations';
// 赛制开关的单一真相（现金局 / 锦标赛）。
import { isTournamentScenario } from './gtoConfig';
// ICM 风险溢价与泡沫判定的单一来源 —— 与 `botAI` 的 ICM 分支同源。
import { BUBBLE_PREMIUM_THRESHOLD, riskPremiumFor } from './gtoICM';
// 翻前分档的唯一来源（泡沫期收紧范围时按档位卡）。
import { getPreflopTier } from './preflopHandStrength';

/**
 * 本模块的手牌分档规则。分档实现统一在 `handStrength.classifyPostflopHand`，
 * 这里只声明「本调用方用哪套规则」。
 *
 * - `madeHandFloors: MADE_HAND_FLOORS` —— 有条件的成牌类别下限（A3）。旧行为是
 *   `promoteMadeHandsByRank: true`（两对及以上无条件 `strong`），于是 4 花面上的
 *   底两对会被判 `strong` → 短筹码引擎直接加注。
 * - `drawOutsThreshold: 0` —— **不产出 `'draw'` 档**（给单个数字表示两条街同值）。
 *   短筹码（≤20bb）主要走全下/弃牌，听牌的价值已经由权益本身体现，
 *   再单列一个半诈唬档没有意义；这里保留既有行为（短筹码原本只有四档）。
 *
 * 这是三处调用方里**唯一**与 `gtoPostflop` 不同的规则，差异只在档位集合
 * （没有 `'draw'`），不在判定口径。
 */
export const HAND_STRENGTH_RULES: HandStrengthRules = {
  madeHandFloors: MADE_HAND_FLOORS,
  drawOutsThreshold: 0,
};

interface ShortStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  position: Position;
  numOpponents: number;
  action: 'rfi' | 'facing_open' | 'facing_3bet';
  /** 赛制：锦标赛才叠加 ICM 风险溢价与泡沫期收紧。 */
  isTournament: boolean;
  /** 是否处在 ICM 意义上的泡沫期（见 `gtoICM.isIcmBubble`）。 */
  isBubble: boolean;
}

/**
 * 泡沫期允许推注 / 防守的**最差档位**（档位来自 `preflopHandStrength.getPreflopTier`，
 * 1 最好、6 最差）。泡沫期只用 tier ≤ 3 的牌（99+, Axs, KTs+, ATo+, KQo 这一档）
 * 去冒险，边缘牌一律放弃。
 */
const BUBBLE_MAX_TIER = 3;

type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

interface ShortStackRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸 (bb)
  pushRange?: string;            // 推注范围描述
  callRange?: string;            // 跟注范围描述
  reasoning: string;
}

const PUSH_RANGES: Record<number, Record<Position, string>> = {
  10: {
    UTG: '22+, A8s+, ATo+, KQs, KJo+',
    MP: '22+, A7s+, ATo+, K9s+, KJo+, Q9s+, J9s+',
    CO: '22+, A2s+, A2o+, K5s+, K9o+, Q8s+, Q9o+, J8s+, T7s+',
    BTN: '22+, A2s+, A2o+, K2s+, K6o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, 96s+, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q7o+, J3s+, J8o+, T4s+, T8o+, 95s+, 97o+, 84s+, 87o+, 74s+, 76o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  12: {
    UTG: '22+, A9s+, ATo+, KQs, KJo+',
    MP: '22+, A8s+, AJo+, K9s+, KJo+, Q9s+, J9s+',
    CO: '22+, A2s+, A7o+, K5s+, K9o+, Q8s+, Q9o+, J8s+, T7s+',
    BTN: '22+, A2s+, A5o+, K2s+, K7o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, 96s+, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  15: {
    UTG: '22+, A9s+, AJo+, KQs, KJo+, QJs',
    MP: '22+, A8s+, AJo+, K9s+, KQo, Q9s+, QJo, J9s+, T9s',
    CO: '22+, A2s+, A8o+, K5s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s',
    BTN: '22+, A2s+, A5o+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 96s+, 98o, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  20: {
    UTG: '22+, A9s+, AJo+, KQs, KQo, QJs, JTs',
    MP: '22+, A7s+, AJo+, K9s+, KQo, Q9s+, QJo, J9s+, JTo, T9s',
    CO: '22+, A2s+, A7o+, K5s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, T9o, 98s',
    BTN: '22+, A2s+, A5o+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 96s+, 98o, 86s+, 87o, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
};

const DEFEND_RANGES: Record<number, Partial<Record<Position, string>>> = {
  10: {
    BB: 'A2s+, K9o+, Q9s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
    SB: 'A2s+, K5s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
  },
  12: {
    BB: 'A2s+, K9o+, Q9s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
    SB: 'A2s+, K5s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
  },
  15: {
    BB: 'A2s+, KJo+, QJs, JTs, T9s, 98s, 22+',
    SB: 'A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 22+',
  },
  20: {
    BB: 'A2s+, KJo+, QJs, JTs, T9s, 98s, 22+',
    SB: 'A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 22+',
  },
};

function getPositionName(position: number, totalPlayers: number): Position {
  if (totalPlayers === 6) {
    const positions: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
    return positions[position] || 'BTN';
  }
  
  if (position === 0) return 'BTN';
  if (position === 1) return 'SB';
  if (position === 2) return 'BB';
  if (position <= Math.floor(totalPlayers * 0.3)) return 'UTG';
  if (position <= Math.floor(totalPlayers * 0.6)) return 'MP';
  return 'CO';
}

function parseRange(rangeStr: string): string[] {
  return rangeStr.split(',').map(s => s.trim());
}

function handMatchesRange(hand: Card[], rangeStr: string): boolean {
  const ranges = parseRange(rangeStr);
  const handStr = getHandString(hand);
  
  return ranges.some(range => {
    if (range.endsWith('s')) {
      const base = range.slice(0, -1);
      return handStr === base || handStr.startsWith(base);
    }
    if (range.endsWith('o')) {
      const base = range.slice(0, -1);
      return handStr === base || handStr.startsWith(base);
    }
    if (range.includes('+')) {
      const base = range.replace('+', '');
      return handStr === base || isHandHigher(handStr, base);
    }
    return handStr === range;
  });
}

function getHandString(hand: Card[]): string {
  if (hand.length !== 2) return '';
  
  const rank1 = hand[0].rank;
  const rank2 = hand[1].rank;
  const suit1 = hand[0].suit;
  const suit2 = hand[1].suit;
  
  const isSuited = suit1 === suit2;
  
  const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const mapRank = (r: string) => r === '10' ? 'T' : r;
  const r1 = mapRank(rank1);
  const r2 = mapRank(rank2);
  const idx1 = rankOrder.indexOf(r1);
  const idx2 = rankOrder.indexOf(r2);
  
  if (idx1 > idx2) {
    return r1 + r2 + (isSuited ? 's' : 'o');
  } else if (idx1 < idx2) {
    return r2 + r1 + (isSuited ? 's' : 'o');
  } else {
    return r1 + r2;
  }
}

function isHandHigher(hand1: string, hand2: string): boolean {
  const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

  const r1a = hand1.charAt(0);
  const r1b = hand1.charAt(1);
  const r2a = hand2.charAt(0);
  const r2b = hand2.charAt(1);

  const isPair1 = r1a === r1b;
  const isPair2 = r2a === r2b;

  if (isPair1 && isPair2) {
    return rankOrder.indexOf(r1a) > rankOrder.indexOf(r2a);
  }

  if (!isPair1 && !isPair2) {
    const idx1a = rankOrder.indexOf(r1a);
    const idx1b = rankOrder.indexOf(r1b);
    const idx2a = rankOrder.indexOf(r2a);
    const idx2b = rankOrder.indexOf(r2b);
    if (idx1a !== idx2a) return idx1a > idx2a;
    return idx1b > idx2b;
  }

  return false;
}

/**
 * 取推注范围。
 *
 * **深度被夹到 `[10, 20]`**：本模块只维护 10 / 12 / 15 / 20bb 四张表，
 * 没有 25bb 的表。调用方（`botAI`）在 `push` / `short` 两档（≤25bb）都会进来，
 * 21–25bb 因此复用 20bb 的表 —— 方向上偏松一点，但好过臆造一张没有依据的表。
 * 要改的话应该先补真实的 25bb 推注范围，而不是在这里线性外推。
 */
function getPushRange(
  effectiveStack: number,
  position: Position,
): string {
  const stackDepth = Math.min(Math.max(effectiveStack, 10), 20);
  
  for (const depth of [10, 12, 15, 20]) {
    if (stackDepth <= depth) {
      return PUSH_RANGES[depth]?.[position] || '';
    }
  }
  
  return PUSH_RANGES[20]?.[position] || '';
}

/** 同上，深度同样夹到 `[10, 20]`。 */
function getDefendRange(
  effectiveStack: number,
  heroPosition: Position,
): string {
  const stackDepth = Math.min(Math.max(effectiveStack, 10), 20);
  
  for (const depth of [10, 12, 15, 20]) {
    if (stackDepth <= depth) {
      return DEFEND_RANGES[depth]?.[heroPosition] || '';
    }
  }
  
  return DEFEND_RANGES[20]?.[heroPosition] || '';
}

function shouldPush(
  hand: Card[],
  effectiveStack: number,
  position: Position,
): boolean {
  const pushRange = getPushRange(effectiveStack, position);
  return handMatchesRange(hand, pushRange);
}

function shouldDefend(
  hand: Card[],
  effectiveStack: number,
  heroPosition: Position,
): boolean {
  const defendRange = getDefendRange(effectiveStack, heroPosition);
  return handMatchesRange(hand, defendRange);
}



function getShortStackSizing(effectiveStack: number): number {
  if (effectiveStack <= 10) return effectiveStack;
  if (effectiveStack <= 15) return effectiveStack * 0.9;
  return effectiveStack * 0.8;
}

function getCommunityByPhase(state: GameState): Card[] {
  const community = state.communityCards || [];
  switch (state.phase) {
    case 'flop':
      return community.slice(0, 3);
    case 'turn':
      return community.slice(0, 4);
    case 'river':
      return community.slice(0, 5);
    default:
      return [];
  }
}

export function getShortStackRecommendation(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): ShortStackRecommendation {
  const effectiveStack = effectiveStackBB(player.chips, state.smallBlind);
  const position = getPositionName(ctx.position, state.players.length);

  // 锦标赛 ICM 风险溢价（现金局恒为 0）—— 与 `botAI` 的 ICM 分支**同源**，
  // 都出自 `gtoICM.riskPremiumFor`。泡沫期 = 溢价超过显著阈值。
  //
  // ⚠️ 本函数的**唯一**调用点是 `botAI.decidePreflop`（启发式翻前），所以这里
  // 与 ICM 相关的一切（`isTournament` / `isBubble` / 门槛叠溢价）都只在 **GTO OFF**
  // 时生效；GTO ON 的翻前走 `gtoPreflop.decidePreflopGTO`，用收紧范围表代替。
  const riskPremium = riskPremiumFor(state, player);
  const isBubble = riskPremium > BUBBLE_PREMIUM_THRESHOLD;

  const config: ShortStackConfig = {
    effectiveStack,
    position,
    numOpponents: ctx.numOpponents,
    action: 'rfi',
    // 这两个字段以前写死 `true` / `false` 且**从未被读过** —— 等于没有。现在接上
    // `gtoConfig` 的赛制开关与 `gtoICM` 的泡沫判定，并真正参与下面的决策。
    isTournament: isTournamentScenario(),
    isBubble,
  };

  // 泡沫期把推注 / 防守范围整体收紧（现金局不做这个收紧）：
  // 泡沫期用筹码换名次的代价最高，边缘牌不值得为一个小底池冒淘汰风险。
  //
  // 注意 `isBubble` 用的是**有符号**的溢价 —— 只有溢价为正（筹码高于桌均）才收紧。
  // 筹码低于桌均时溢价为负，短筹码该多赌而不是收紧，那时 `bubbleTighten` 为假。
  const bubbleTighten = config.isTournament && config.isBubble;
  const bubbleAllows = !bubbleTighten || getPreflopTier(player.hand) <= BUBBLE_MAX_TIER;

  if (ctx.toCall > 0) {
    config.action = 'facing_open';
  }

  const community = getCommunityByPhase(state);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents,
    equityIterations(state.phase));
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyPostflopHand(
    equity, evaluated.rank, null, HAND_STRENGTH_RULES,
  );

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const defendTighten = adj.callPenalty > 0 ? 0.05 : 0;

  // 推注 / 弃牌只适用于 push、short 两档（≤25bb）。档位来自 stackDepth，与
  // `botAI` 的路由阈值同源 —— 以前这里写死 `<= 20`，而调用方已按 ≤25bb 路由，
  // 21–25bb 于是被送进来却又跳过这段逻辑，落到下面「按牌力」的分支
  // （那本是翻后的成牌逻辑，用在翻前并不合适）。
  //
  // 注：下面「按牌力」块**并非完全不可达** —— 它的真实可达范围、以及它现在的
  // 实际后果（能过牌却弃牌），见该块前的长注释，别凭这段历史描述下结论。
  const band = stackBand(effectiveStack);

  if (band === 'push' || band === 'short') {
    if (config.action === 'rfi') {
      if (shouldPush(player.hand, effectiveStack, position) && bubbleAllows) {
        const sizing = getShortStackSizing(effectiveStack);
        // 对手弃牌率高时，加注偷盲概率提升
        if (flags.canAllInResult && random() < (1.0 + stealBoost)) {
          return {
            action: 'allin',
            sizing,
            pushRange: getPushRange(effectiveStack, position),
            reasoning: `Short stack push: ${effectiveStack}bb from ${position} (opponent fold boost)`,
          };
        }
        if (flags.canRaiseResult && random() < (1.0 + stealBoost)) {
          return {
            action: 'raise',
            sizing,
            pushRange: getPushRange(effectiveStack, position),
            reasoning: `Short stack raise: ${effectiveStack}bb from ${position} (opponent fold boost)`,
          };
        }
      }
      
      if (flags.canFoldResult) {
        return {
          action: 'fold',
          pushRange: getPushRange(effectiveStack, position),
          reasoning: `Short stack fold: ${effectiveStack}bb from ${position}`,
        };
      }
    }

    if (config.action === 'facing_open') {
      // 对手激进时收紧防守范围，对手被动时放宽
      const shouldDefendAdjusted = shouldDefend(player.hand, effectiveStack, position) &&
        bubbleAllows &&
        random() >= defendTighten;

      if (shouldDefendAdjusted) {
        if (flags.canAllInResult) {
          const sizing = getShortStackSizing(effectiveStack);
          return {
            action: 'allin',
            sizing,
            callRange: getDefendRange(effectiveStack, position),
            reasoning: `Short stack defend: ${effectiveStack}bb from ${position} (adjusted for opponent)`,
          };
        }
        if (flags.canCallResult) {
          return {
            action: 'call',
            callRange: getDefendRange(effectiveStack, position),
            reasoning: `Short stack call: ${effectiveStack}bb from ${position} (adjusted for opponent)`,
          };
        }
      }
      
      if (flags.canFoldResult) {
        return {
          action: 'fold',
          callRange: getDefendRange(effectiveStack, position),
          reasoning: `Short stack fold to open: ${effectiveStack}bb from ${position}`,
        };
      }
    }
  }

  // ─── 下面这一块是「按牌力」兜底。它**不是死代码**，但可达范围极窄 ──────────
  //
  // 结论来自穷举实测（169 手牌类 × 6 座 × 4 深度 × 5 种 (heroBet, lastBet) 局面
  // × {现金局, 锦标赛泡沫期}；标志位一律由生产侧的 `canCheck` / `canCall` /
  // `canRaise` / `canFold` / `canAllIn` 推导，不手写 —— 手写 all-true 会造出
  // 翻前不存在的局面，这正是既有用例当初看错这块的原因）。
  //
  // 1) `facing_open` 侧**必然**在上面的档位块内返回。因为
  //    `canFoldResult ≡ (ctx.toCall > 0)`（`canFold` 就是 `lastBet > playerBet`），
  //    而 `config.action` 只有 `'rfi'` / `'facing_open'` 两个取值 —— 后者意味着
  //    `toCall > 0`，于是那两个 `if (flags.canFoldResult)` 兜住了所有漏网路径。
  //
  // 2) 只有 `rfi` 侧能掉到这里。而翻前 `toCall === 0` 物理上只有一个来源：
  //    **大盲在「人人平跟」的底池里有说话权**（hero.bet 已等于 lastBet = 大盲）。
  //    此时 `canFoldResult` 与 `canCallResult` **恒假**（见
  //    `gtoShortStack.test.ts` 的「按牌力兜底的可达性」一节），于是：
  //      - `strength === 'strong'` 且 `canRaiseResult` → `value bet`（加注）
  //      - 其余一律落到最后的 `fallback`
  //
  // 3) 用**真实权益**实测（非 mock）在生产可达局面下只出现 `fallback` 一种：
  //    锦标赛泡沫期 + 大盲 + 平跟底池共 676 个样本（4 深度 × 169 手牌），
  //    136 个走上推注、**540 个落到 `fallback`**，`strong` / `medium` 一次都没出现。
  //    原因是 6 人桌翻前对 5 个对手的权益上限很低（AA 也只有约 49%），够不到
  //    `STRONG_EQUITY` 的 0.70。所以：
  //      - `strong→call` / `medium→call` / `medium→fold` / `默认 fold`
  //        这四条是**结构上不可达**的（都要求 `canCallResult` 或 `canFoldResult` 为真）；
  //      - `strong→raise`（`value bet`）是**理论上可达、实际够不到**。
  //
  // 4) ⚠️ 于是实际后果只剩一个，而且是个真 bug：
  //    `fallback` 返回 `action: flags.canCallResult ? 'call' : 'fold'`，rfi 下
  //    `canCallResult` 为假 → **返回 `'fold'`，而此时 `canCheckResult` 为真，
  //    大盲本可以免费过牌**。`playerAction` 不做权限校验（`canPlayerAct` 只用来
  //    禁 UI 按钮），所以这个 fold 会被真的执行。
  //    （`value bet` 那行 `Math.min(effectiveStack, ctx.totalPot * 0.75)` 的单位也是
  //    混的：前者 bb、后者筹码。因为该分支实际够不到，一并留到下一批。）
  //
  // **本块暂不改行为**：修法（rfi 侧补 `check` 兜底、并修 sizing 单位）另开一批。
  // 这里只把可达范围与两个已知问题钉住。**改这块之前先看那组可达性用例。**
  if (strength === 'strong') {
    if (flags.canRaiseResult) {
      const sizing = Math.min(effectiveStack, ctx.totalPot * 0.75);
      return {
        action: 'raise',
        sizing,
        reasoning: `Short stack value bet: ${effectiveStack}bb`,
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        reasoning: `Short stack call with strong hand: ${effectiveStack}bb`,
      };
    }
  }

  if (strength === 'medium') {
    // 锦标赛泡沫期：跟注的**有效**赔率更差 → 门槛抬高一个风险溢价
    // （现金局 `riskPremiumFor` 恒为 0，所以这里与以前逐位一致）。
    if (equity >= ctx.potOdds + riskPremium && flags.canCallResult) {
      return {
        action: 'call',
        reasoning: `Short stack call with medium hand: ${effectiveStack}bb`,
      };
    }
    if (flags.canFoldResult) {
      return {
        action: 'fold',
        reasoning: `Short stack fold with medium hand: ${effectiveStack}bb`,
      };
    }
  }

  if (flags.canFoldResult) {
    return {
      action: 'fold',
      reasoning: `Short stack default fold: ${effectiveStack}bb`,
    };
  }

  return {
    action: flags.canCallResult ? 'call' : 'fold',
    reasoning: `Short stack fallback: ${effectiveStack}bb`,
  };
}

export function getShortStackPushRange(
  effectiveStack: number,
  position: Position,
): string {
  return getPushRange(effectiveStack, position);
}

export function getShortStackDefendRange(
  effectiveStack: number,
  heroPosition: Position,
): string {
  return getDefendRange(effectiveStack, heroPosition);
}
