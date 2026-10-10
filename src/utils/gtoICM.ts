import type { Card, GameState, Player } from '../types/poker';
// 翻前手牌分档的**唯一**来源。本文件原先自带一份 `getHandStrengthTier`，与
// `preflopHandStrength.getPreflopTier` 并存且**结果不一致**（见下方注释），已删除。
import { getPreflopTier } from './preflopHandStrength';
// 赛制开关的单一真相：现金局不叠加 ICM 风险溢价（`riskPremiumFor` 里据此返回 0）。
import { isTournamentScenario } from './gtoConfig';

export type TournamentStage = 'early' | 'middle' | 'bubble' | 'final_table';
export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export interface ICMConfig {
  tournamentStage: TournamentStage;
  payoutStructure: number[];
  playerStacks: number[];
  heroStack: number;
  blinds: number;
  ante: number;
  numPlayers: number;
  averageStack: number;
}

export interface ICMRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold' | 'check';
  sizing?: number;
  riskPremium: number;
  bubbleFactor: number;
  icmAdjustment: number;
  /** 加价后的跟注门槛 = `potOdds + riskPremium`（决策就是拿它与 `handEquity` 比）。 */
  requiredEquity: number;
  /** 该手牌档位对应的**代表权益**（见 `TIER_EQUITY`）。 */
  handEquity: number;
  reasoning: string;
}

/**
 * 档位 → **代表权益**：面对随机牌时的翻前权益，取该档位的中位数量级。
 *
 * 为什么用一张显式的常量表而不是每次跑蒙特卡洛：ICM 的门槛比较只需要「这手牌大约
 * 值多少」这一个量，而翻前跑一次 `calculateRangeAwareEquity` 要几十毫秒、还带随机噪声
 * —— 那会让「门槛可断言」变成「门槛可断言但结果不可复现」。表是显式列出的，
 * 便于审计与测试钉住。
 *
 * 档位定义见 `preflopHandStrength.T` 的表头注释。
 */
const TIER_EQUITY: Record<number, number> = {
  1: 0.68, // AA,KK,QQ,AKs,AQs,AKo
  2: 0.56, // JJ,TT,AJs,ATs,KQs,KJs,QJs,AJo
  3: 0.48, // 99,88,77,Axs,KTs,QTs,JTs,T9s,ATo,KQo,KJo
  4: 0.42, // 66-44,K9s-K2s,scs,KTo,QJo,JTo
  5: 0.36, // 33,22,Q9s-Q2s,A9o,Q9o,J9o,T9o,98o,87o,76o,65o,54o
  6: 0.30, // 其余
};

/**
 * 加注（而非仅跟注）所需的**额外**权益余量。面对 3bet 时要求更高。
 *
 * 含义：只有明显领先门槛才值得把底池做大；否则跟注控池。
 */
const RAISE_MARGIN: Record<string, number> = {
  rfi: 0,
  facing_open: 0.06,
  facing_3bet: 0.10,
  facing_shove: Number.POSITIVE_INFINITY, // 面对全下没有「加注」这个选项
};

/** 各动作的开池 / 加注尺度（bb）。 */
const RAISE_SIZING: Record<string, number> = {
  rfi: 2.5,
  facing_open: 3.0,
  facing_3bet: 4.0,
};

/**
 * 开池（rfi）的**基础门槛** —— 开池时没人下注，没有「跟注赔率」可加价，
 * 门槛只能来自位置：越靠前越容易被后面的人拿到强牌，要求越强。
 *
 * 锦标赛里风险溢价再加到它上面，于是**开池范围随溢价收紧**。
 */
const OPEN_THRESHOLD: Record<Position, number> = {
  UTG: 0.55,
  MP: 0.52,
  CO: 0.49,
  BTN: 0.46,
  SB: 0.50,
  BB: 0.50,
};

function getPositionAdjustment(position: Position): number {
  const adjustments: Record<Position, number> = {
    UTG: 1.2,
    MP: 1.1,
    CO: 1.0,
    BTN: 0.9,
    SB: 1.1,
    BB: 1.0,
  };
  return adjustments[position] || 1.0;
}

export function calculateICMEquity(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const equity = new Array(n).fill(0);
  const totalChips = stacks.reduce((a, b) => a + b, 0);

  if (totalChips === 0) return equity;

  function calculatePositionProbs(
    remainingIndices: number[],
    remainingPayouts: number[],
    probSoFar: number,
    position: number,
  ) {
    if (remainingPayouts.length === 0 || remainingIndices.length === 0) return;

    const activeIndices = remainingIndices.filter(idx => stacks[idx] > 0);
    if (activeIndices.length === 0) return;

    const totalRemaining = activeIndices.reduce((sum, idx) => sum + stacks[idx], 0);
    if (totalRemaining === 0) return;

    for (let i = 0; i < activeIndices.length; i++) {
      const playerIdx = activeIndices[i];
      const winProb = (stacks[playerIdx] / totalRemaining) * probSoFar;

      if (position < payouts.length) {
        equity[playerIdx] += winProb * payouts[position];
      }

      const newRemaining = activeIndices.filter((_, idx) => idx !== i);
      calculatePositionProbs(newRemaining, remainingPayouts.slice(1), winProb, position + 1);
    }
  }

  const allIndices = Array.from({ length: n }, (_, i) => i);
  calculatePositionProbs(allIndices, payouts, 1, 0);

  return equity;
}

export function calculateBubbleFactor(
  heroStack: number,
  villainStack: number,
  totalChips: number,
  payoutStructure: number[],
  numPlayers: number,
): number {
  if (heroStack === 0 || villainStack === 0) return 1.0;

  const currentStacks: number[] = [];
  const avgStack = totalChips / numPlayers;

  for (let i = 0; i < numPlayers; i++) {
    currentStacks.push(avgStack);
  }
  currentStacks[0] = heroStack;

  const currentEquity = calculateICMEquity(currentStacks, payoutStructure);
  const heroCurrentEquity = currentEquity[0];

  const winStacks = [...currentStacks];
  winStacks[0] += villainStack;
  const winEquity = calculateICMEquity(winStacks, payoutStructure);
  const heroWinEquity = winEquity[0];

  const loseStacks = [...currentStacks];
  loseStacks[0] = 0;
  const loseEquity = calculateICMEquity(loseStacks, payoutStructure);
  const heroLoseEquity = loseEquity[0];

  const evGained = heroWinEquity - heroCurrentEquity;
  const evLost = heroCurrentEquity - heroLoseEquity;

  if (evGained <= 0) return 1.0;
  return Math.abs(evLost) / evGained;
}

export function calculateRiskPremium(bubbleFactor: number): number {
  if (bubbleFactor <= 0) return 0;
  return bubbleFactor / (bubbleFactor + 1) - 0.5;
}

export function getTournamentStage(
  numPlayersRemaining: number,
  numPlayersPaid: number,
): TournamentStage {
  if (numPlayersPaid <= 0) return 'early';

  const percentRemaining = numPlayersRemaining / numPlayersPaid;

  if (percentRemaining > 0.35) return 'early';
  if (percentRemaining > 0.20) return 'middle';
  if (percentRemaining > 0.10) return 'bubble';
  return 'final_table';
}

function getStageAdjustment(stage: TournamentStage): number {
  const adjustments: Record<TournamentStage, number> = {
    early: 1.0,
    middle: 1.1,
    bubble: 1.3,
    final_table: 1.2,
  };
  return adjustments[stage];
}

/**
 * 本模块原先自带的 `getHandStrengthTier` 已删除，改用
 * `preflopHandStrength.getPreflopTier`（13×13 表，全仓库唯一的翻前分档）。
 *
 * 删它的两个理由：
 *
 * 1. **两份实现结果不一致**。原实现里 `highIdx === 12 && lowIdx >= 10` 这条
 *    （A + 10 以上）**先于**同花规则命中，于是 AKs / AKo / AQs 被判成 2，
 *    而 13×13 表把它们判成 1（T1 Premium：AA,KK,QQ,AKs,AQs,AKo）。
 * 2. **原实现对 `'10'` 是错的**：它的 `rankOrder` 用 `'T'` 表示 10，而本仓库
 *    （`preflopHandStrength.RI`、`useGameState.RANKS`）一律用 `'10'`，
 *    于是 `rankOrder.indexOf('10') === -1` → 任何含 10 的手牌都取到 -1 下标，
 *    **口袋 TT 被错分成 3**（应为 2）。
 *
 * 换成 13×13 表后分档口径与 `botAI`、`gtoShortStack` 等其它翻前路径一致。
 */

/**
 * 锦标赛 ICM 建议 —— **确定性**：风险溢价直接加到跟注门槛上。
 *
 * `potOdds` 就是「不加 ICM 时跟注所需的权益」（`ctx.potOdds` =
 * `toCall / (totalPot + toCall)`，口径见 `potOdds.ts`）；锦标赛里跟注的**有效**赔率
 * 更差，等价于把门槛抬高一个 `riskPremium`：
 *
 * ```text
 * 面对下注： requiredEquity = potOdds + riskPremium
 * 开池 rfi： requiredEquity = OPEN_THRESHOLD[position] + riskPremium
 * ```
 *
 * 于是「锦标赛比现金局更难跟注 / 更难开池」这件事变成一条可断言的不等式，
 * 而不是一张随机档位表。`potOdds` 在 `rfi` 下不被使用（没人下注）。
 */
export function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
  action: 'rfi' | 'facing_open' | 'facing_3bet' | 'facing_shove',
  potOdds: number,
): ICMRecommendation {
  const stage = config.tournamentStage;
  const stageAdj = getStageAdjustment(stage);
  const positionAdj = getPositionAdjustment(position);

  const avgBubbleFactor = calculateBubbleFactor(
    config.heroStack,
    config.averageStack,
    config.averageStack * config.numPlayers,
    config.payoutStructure,
    config.numPlayers,
  );
  const riskPremium = calculateRiskPremium(avgBubbleFactor);
  const icmAdjustment = stageAdj * positionAdj;

  const handTier = getPreflopTier(hand);

  // 确定性决策：把风险溢价**加到门槛上**，再拿手牌档位的代表权益去比。
  //
  // 这里以前是一整套 `random()` 档位表（23 处 `random()`），既不可复现、也无法断言
  // 「溢价把门槛抬高了」。现在只剩一个不等式，跟注 / 全下门槛因此可以直接单测。
  //
  // 基础门槛分两种：面对下注时是**跟注赔率**（`potOdds`），开池时是**位置门槛**
  // （开池没人下注，没有赔率可加）。风险溢价一律加在基础门槛之上。
  const baseThreshold = action === 'rfi' ? OPEN_THRESHOLD[position] : potOdds;
  const requiredEquity = baseThreshold + riskPremium;
  const handEquity = TIER_EQUITY[handTier] ?? TIER_EQUITY[6];

  let adjustedAction: ICMRecommendation['action'] = 'fold';
  let adjustedSizing: number | undefined;

  if (action === 'rfi') {
    // 没人下注 → 没有「跟注」这个选项：够门槛就开池，不够就弃牌。
    if (handEquity >= requiredEquity) {
      adjustedAction = 'raise';
      adjustedSizing = RAISE_SIZING.rfi;
    }
  } else if (action === 'facing_shove') {
    // 面对全下只有跟 / 弃（`RAISE_MARGIN.facing_shove` 是 Infinity，加注不可能成立）。
    if (handEquity >= requiredEquity) {
      adjustedAction = 'call';
    }
  } else {
    // 面对开池 / 3bet：明显领先才加注，够门槛就跟注，否则弃牌。
    const margin = RAISE_MARGIN[action] ?? 0;
    if (handEquity >= requiredEquity + margin) {
      adjustedAction = 'raise';
      adjustedSizing = RAISE_SIZING[action];
    } else if (handEquity >= requiredEquity) {
      adjustedAction = 'call';
    }
  }

  const reasoning =
    `ICM调整: ${stage}阶段, 风险溢价 ${(riskPremium * 100).toFixed(1)}%, ` +
    `手牌等级 ${handTier}(代表权益 ${(handEquity * 100).toFixed(0)}%), ` +
    `跟注门槛 ${(requiredEquity * 100).toFixed(1)}%`;

  return {
    action: adjustedAction,
    sizing: adjustedSizing,
    riskPremium,
    bubbleFactor: avgBubbleFactor,
    icmAdjustment,
    requiredEquity,
    handEquity,
    reasoning,
  };
}

/**
 * 「泡沫期」判定 —— **单一来源**。
 *
 * 为什么不再用原先的 `isTournamentBubble`：它要求 `totalPlayers > 6`，而本应用是单张
 * 6 人桌 —— 该条件**永远为假**，等于 ICM 从不生效（死代码）。而且它看的是
 * 「本手还剩几个人没弃牌」，并不是「距离进钱圈还有几人」。
 *
 * 真正可观测、且对任意桌型都成立的信号是**基于筹码**的泡沫因子：筹码越接近均势，
 * 输光一次的 ICM 代价就越大。阈值与 `botAI` 决定「ICM 是否接管」时用的是同一个。
 */
export const BUBBLE_PREMIUM_THRESHOLD = 0.10;

/**
 * 从对局状态算「风险溢价」—— 锦标赛里跟注门槛要加的量。**现金局恒为 0**。
 *
 * 注意 `hero` 必须是**当前行动的那个玩家**：风险溢价取决于「我这把输光值多少」，
 * 以前 `getICMConfig` 固定拿 `players[0]` 当主角，于是任何非 0 号位的决策都在用
 * 别人的筹码算自己的 ICM。
 *
 * 另外，溢价是**有符号**的，调用方不能假定它 >= 0：
 *
 * - 筹码**高于**桌均 → bubble factor > 1 → 溢价为正（输光很贵 → 收紧）；
 * - 筹码**低于**桌均 → bubble factor < 1 → 溢价为负（输光损失的 $EV 小，
 *   短筹码反而该多赌 → 放宽）。
 *
 * 实测：6 人桌均势（各 1000）溢价 ≈ +0.16；主角 200 对 5×1000 时 ≈ −0.26。
 */
export function riskPremiumFor(state: GameState, hero: Player): number {
  if (!isTournamentScenario()) return 0;

  const config = getICMConfig(state, hero);
  const bubbleFactor = calculateBubbleFactor(
    config.heroStack,
    config.averageStack,
    config.averageStack * config.numPlayers,
    config.payoutStructure,
    config.numPlayers,
  );
  return calculateRiskPremium(bubbleFactor);
}

/** 是否处在 ICM 意义上的泡沫期（风险溢价显著）。现金局恒为 false。 */
export function isIcmBubble(state: GameState, hero: Player): boolean {
  return riskPremiumFor(state, hero) > BUBBLE_PREMIUM_THRESHOLD;
}

/**
 * 从对局状态组装 ICM 配置。
 *
 * `hero` 是**当前行动的那个玩家** —— 以前这里固定取 `state.players[0]`，于是
 * 2–6 号位的决策都在拿 1 号位的筹码算自己的风险溢价（`heroStack` 错、进而
 * `calculateBubbleFactor` 的输赢两侧都错）。`hero` 缺省时退回 `players[0]`，
 * 只为兼容只关心「桌子整体」的调用方。
 */
export function getICMConfig(state: GameState, hero?: Player): ICMConfig {
  const playerStacks = state.players.map(p => p.chips);
  const totalChips = playerStacks.reduce((a, b) => a + b, 0);
  const averageStack = totalChips / state.players.length;

  return {
    tournamentStage: getTournamentStage(state.players.length, Math.floor(state.players.length * 0.15)),
    payoutStructure: [0.50, 0.30, 0.20],
    playerStacks,
    heroStack: hero?.chips ?? state.players[0]?.chips ?? 0,
    blinds: state.smallBlind * 2,
    ante: 0,
    numPlayers: state.players.length,
    averageStack,
  };
}
