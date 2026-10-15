import type { Card, GameState, Player, Action } from '../types/poker';
import { RANK_ORDER } from '../types/poker';
import type { ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { analyzeBoardWithEquity } from './boardTexture';
import type { BoardTexture } from './boardTexture';
import { getCardsToCome } from './communityByPhase';
import { evaluateHand } from './handEvaluator';
import { calculateRangeAwareEquity } from './rangeEquity';
import { detectDraws } from './drawDetector';
import {
  classifyPostflopHand,
  DRAW_OUTS_BY_STREET,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
} from './handStrength';
import { drawCallEquityThreshold } from './gtoMath';
// 筹码深度的唯一来源：bb 换算从 stackDepth 取（本文件曾硬编码 `/10`）。
import { effectiveStackBB } from './stackDepth';
// SPR / 有效筹码的唯一来源：本文件不再自己写 `player.chips / totalPot`。
import { sprFromState } from './spr';
// SPR 决策表（commit / control / cautious）与尺度表的唯一来源 —— 与 `gtoPostflop` 共用。
import {
  adjustSizingByHand,
  sprBetSizing,
  sprDecisionOf,
  type SprDecision,
} from './sprStrategy';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数。
import { equityIterations } from './equityIterations';
// ICM 风险溢价（锦标赛）与「门槛 = 赔率 + 溢价」的唯一来源。现金局恒为 0。
import { riskAdjustedThreshold, riskPremiumFor } from './gtoICM';
// persona 派生量：`valueShift` 平移分档、`callShift`（来自 `callBias`）平移跟注门槛。
// `undefined` 时两者都是精确恒等（见 `getDeepStackRecommendation` 的注释）。
import { postflopParams, shiftThreshold, type PersonalityParams } from './botPersonality';

/**
 * 本模块的手牌分档规则。分档实现统一在 `handStrength.classifyPostflopHand`，
 * 这里只声明「本调用方用哪套规则」。
 *
 * - `madeHandFloors: MADE_HAND_FLOORS` —— 有条件的成牌类别下限（A3）。
 *   旧行为是 `promoteMadeHandsByRank: true`：两对及以上**无条件** `strong`，
 *   于是 4 花面上的底两对（权益可能只有 0.20）也会被拿去加注。
 * - `drawOutsThreshold: DRAW_OUTS_BY_STREET` —— 与 `gtoPostflop` 同一张分街表：
 *   翻牌 8 outs、转牌 9 outs。听牌质量是概率事实，两个引擎不该有第二套阈值。
 *
 * A3 之后本模块与 `gtoPostflop` 的规则**完全相同** —— 这是收敛而不是巧合：
 * 分档是纯概率问题，不该因为「哪个引擎在问」而不同。
 */
export const HAND_STRENGTH_RULES: HandStrengthRules = {
  madeHandFloors: MADE_HAND_FLOORS,
  drawOutsThreshold: DRAW_OUTS_BY_STREET,
};

interface DeepStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  spr: number;                   // Stack-to-Pot Ratio
  phase: 'flop' | 'turn' | 'river';
  boardTexture: BoardTexture;
  isIP: boolean;
  numOpponents: number;
  toCall: number;
  totalPot: number;
  lastRaiseBet: number;
  potOdds: number;
  /**
   * **分档专用**的权益 = `equity − valueShift`（见 `getDeepStackRecommendation`）。
   *
   * ⚠️ 与传进两个 handler 的 `equity` 参数**不是同一个数**：`equity` 必须保持原始值，
   * 因为所有跟注门槛判据都是「**真实**权益 vs 门槛」（门槛那侧已经吃了 `callShift`）。
   * 若把 `valueShift` 也从 `equity` 里扣掉，等于同一个偏移被算了两次 ——
   * 这正是 P6b-2 里「门槛与权益分开处理」的原因，此处沿用同一口径。
   */
  classifyEquity: number;
}

type HandAdjustment = 'upgrade' | 'downgrade' | 'neutral';

interface DeepStackRecommendation {
  action: Action;
  amount?: number;
  sizing?: number;               // 下注尺寸百分比
  handAdjustment: HandAdjustment;
  sprDecision: SprDecision;
  reasoning: string;
}

function isSmallPair(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 === rank2 && rank1 >= RANK_ORDER['2'] && rank1 <= RANK_ORDER['5'];
}

function isSuitedConnector(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  const diff = Math.abs(rank1 - rank2);
  return diff >= 1 && diff <= 4;
}

function isOffsuitBroadway(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit === hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 >= RANK_ORDER['10'] && rank2 >= RANK_ORDER['10'];
}

function isOverpair(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 === rank2 && rank1 >= RANK_ORDER['10'];
}

function isSuitedAce(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  return hand[0].rank === 'A' || hand[1].rank === 'A';
}

function isSuitedGapper(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  const diff = Math.abs(rank1 - rank2);
  return diff >= 2 && diff <= 3;
}

/**
 * 深筹码才做手牌调整：小对子 / 同花连张等听牌型手牌升值，非同花大牌降值。
 *
 * 阈值是 **150bb**，与「什么时候启用深筹码引擎」同源（`stackDepth.stackBand`
 * 的 `veryDeep` 档）。以前这里写的是 100bb，而引擎只在 >150bb 被调用，
 * 100–150bb 那段判断永远走不到 —— 两个数字自相矛盾，现已对齐。
 */
function getHandAdjustment(hand: Card[], effectiveStack: number): HandAdjustment {
  if (effectiveStack <= 150) return 'neutral';

  if (isSmallPair(hand)) return 'upgrade';
  if (isSuitedConnector(hand)) return 'upgrade';
  if (isSuitedAce(hand)) return 'upgrade';
  if (isSuitedGapper(hand)) return 'upgrade';
  if (isOffsuitBroadway(hand)) return 'downgrade';
  if (isOverpair(hand)) return 'downgrade';

  return 'neutral';
}

/**
 * 价值下注尺度：牌面纹理 × SPR 承诺档，再按手牌调整方向微调。
 *
 * 实现全在 `sprStrategy`（与 `gtoPostflop` 共用），本文件不再自带尺度表 ——
 * 以前这里有一份 `DEEP_STACK_SIZING` 与一套 4/8/15 的 SPR 分档，与
 * `postflopFrequencies` 的 1.5/3 长期并存，现统一到 `spr.sprBand`。
 */
function getDeepStackSizing(
  texture: BoardTexture,
  sprDecision: SprDecision,
  handAdjustment: HandAdjustment,
): number {
  return adjustSizingByHand(
    sprBetSizing(texture.classification, sprDecision),
    handAdjustment,
  );
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

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  targetAmount: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  return Math.min(Math.max(baseRaise, targetAmount), player.chips);
}



function handleDeepStackFacingBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: DeepStackConfig,
  hand: Card[],
  equity: number,
  handAdjustment: HandAdjustment,
  sprDecision: SprDecision,
): DeepStackRecommendation {
  const { boardTexture, potOdds } = config;
  const sizing = getDeepStackSizing(boardTexture, sprDecision, handAdjustment);

  const community = getCommunityByPhase(state);
  const draws = detectDraws(hand, community, getCardsToCome(state.phase));
  const evaluated = evaluateHand(hand, community);
  // persona：分档用**平移后**的权益（`valueShift`），门槛判据仍用原始 `equity`。
  // 推导与口径见 `DeepStackConfig.classifyEquity` 的注释。
  const strength = classifyPostflopHand(
    config.classifyEquity, evaluated.rank, draws, HAND_STRENGTH_RULES,
  );

  if (sprDecision === 'commit') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: strong hand with low SPR',
        };
      }
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with strong hand',
        };
      }
    }

    if (strength === 'medium' && equity >= potOdds + 0.05) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with medium hand',
        };
      }
    }

    // 听牌出口。必须显式写出来：本分支原本只有 strong / medium 两个出口，
    // 分档顺序调整后「权益已过 medium 线的组合听牌」从 medium 挪到了 draw，
    // 若不补这一支就会直接掉到下面的默认弃牌 —— 低 SPR 下弃掉 15+ outs 的组合听牌。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with draw',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: folding weak hand',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: fallback call',
      };
    }
  }

  if (sprDecision === 'control') {
    if (strength === 'strong') {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with strong hand',
        };
      }
    }

    if (strength === 'medium') {
      if (equity >= potOdds && flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with medium hand',
        };
      }
    }

    // 跟注门槛与 gtoPostflop / 面板共用（含隐含赔率额度），
    // 否则同一条街的同一个听牌在两个引擎里会得出相反的结论。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with draw',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: folding weak hand',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: fallback call',
      };
    }
  }

  if (sprDecision === 'cautious') {
    if (strength === 'strong') {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with strong hand',
        };
      }
    }

    if (strength === 'medium' && equity >= potOdds + 0.1) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with medium hand (high equity)',
        };
      }
    }

    // 听牌出口，理由同 commit 分支：分档顺序调整后组合听牌从 medium 挪到 draw，
    // 本分支若不显式接住就会掉到默认弃牌。判据与 control 档同口径（含隐含赔率额度）。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with draw',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: folding to preserve stack',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: fallback call',
      };
    }
  }

  return {
    action: flags.canFoldResult ? 'fold' : 'call',
    sizing,
    handAdjustment,
    sprDecision,
    reasoning: 'Deep stack: default action',
  };
}

function handleDeepStackNoBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: DeepStackConfig,
  hand: Card[],
  handAdjustment: HandAdjustment,
  sprDecision: SprDecision,
): DeepStackRecommendation {
  const { spr, boardTexture } = config;
  const sizing = getDeepStackSizing(boardTexture, sprDecision, handAdjustment);

  const community = getCommunityByPhase(state);
  const draws = detectDraws(hand, community, getCardsToCome(state.phase));
  const evaluated = evaluateHand(hand, community);
  // persona：本函数**只做分档**，没有任何「真实权益 vs 门槛」的判据，所以直接用
  // `config.classifyEquity`；`equity` 形参因此已无用而被移除（保留会触发
  // `no-unused-vars`）。与 `handleDeepStackFacingBet` 的区别见那边的注释 ——
  // 那一支两者都要，必须分开。
  const strength = classifyPostflopHand(
    config.classifyEquity, evaluated.rank, draws, HAND_STRENGTH_RULES,
  );

  if (sprDecision === 'commit') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: betting strong hand',
        };
      }
    }

    if (strength === 'medium' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.8);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.8,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: betting medium hand',
      };
    }

    // 听牌出口：commit 档下组合听牌按半诈唬下注。分档顺序调整前它们走的是
    // 上面 medium 的 0.8 倍下注，调整后必须补上，否则会退化成过牌（丢掉下注频率）。
    if (strength === 'draw' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.8);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.8,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: semi-bluff with draw',
      };
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: checking weak hand',
      };
    }
  }

  if (sprDecision === 'control') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: betting strong hand',
        };
      }
    }

    if (strength === 'medium' && flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: checking medium hand for pot control',
      };
    }

    if (strength === 'draw' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.7);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.7,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: semi-bluff with draw',
      };
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: checking weak hand',
      };
    }
  }

  if (sprDecision === 'cautious') {
    if (strength === 'strong' && spr <= 10) {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing * 0.6);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing: sizing * 0.6,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: small bet with strong hand',
        };
      }
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: checking to control pot',
      };
    }
  }

  return {
    action: flags.canCheckResult ? 'check' : 'fold',
    sizing,
    handAdjustment,
    sprDecision,
    reasoning: 'Deep stack: default action',
  };
}

export function getDeepStackRecommendation(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
  /**
   * 性格参数（可选尾参）。`undefined` 时 `valueShift`/`callShift` 均为 0，
   * `classifyEquity === equity`、`config.potOdds` 逐位不变 —— 深筹码路径**无 persona
   * 逐位不变**（方案 §7.2 第 8 行「深筹码路径独立核实」）。
   *
   * ⚠️ 深筹码引擎**完全确定性**（本文件零处 `random()`），所以 `aggressionMult`
   * 在这里**没有作用点**：混合频率不存在，可改的只有「门槛」。这正是 §7.2 第 8 行
   * 把深筹码的参数列为「门槛、权重、尺寸」而非频率的原因 —— 本步只接门槛
   * （`valueShift` 改分档、`callShift` 改跟注门槛），**尺寸（`sizingMult`）留到 P6c**
   * 与「共用安全尺寸合法化」一起做（§12.3 的 P6c 行），避免在两处各自裸乘。
   *
   * 河牌也走本函数（`decideRiver` 的 veryDeep 早返回），但 `decideRiver` **不传**
   * persona（P6c 才接），所以河牌路径当前仍是恒等。
   */
  persona?: PersonalityParams,
): DeepStackRecommendation {
  const pf = postflopParams(persona);
  const community = getCommunityByPhase(state);
  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents,
    equityIterations(state.phase));

  const effectiveStack = effectiveStackBB(player.chips, state.smallBlind);
  // SPR 由 spr.ts 统一取「有效筹码 / 底池」—— 以前这里用的是**自己**筹码，
  // 与面板口径不一致（见 spr.ts 文件头）。
  const spr = sprFromState(player, state.players, ctx.totalPot);

  const handAdjustment = getHandAdjustment(player.hand, effectiveStack);
  const sprDecision = sprDecisionOf(spr);

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.05 : 0;
  const callTighten = adj.callPenalty > 0 ? 0.03 : 0;

  const config: DeepStackConfig = {
    effectiveStack,
    spr,
    phase: state.phase as 'flop' | 'turn' | 'river',
    boardTexture: texture,
    isIP: ctx.isButton || ctx.isCutoff || ctx.isHijack,
    numOpponents: ctx.numOpponents,
    toCall: ctx.toCall,
    totalPot: ctx.totalPot,
    lastRaiseBet: state.lastRaiseBet,
    // ICM 风险溢价（现金局恒为 0）叠加到跟注门槛上 —— 本引擎下面所有跟注判据
    // （strong/medium/draw 三档 × commit/control/cautious 三档）都读 `config.potOdds`，
    // 所以在这一处注入即可全覆盖，不必逐个分支改。
    // persona：`callShift`（来自 `callBias`）也叠在这同一处 —— 一处平移，六条跟注
    // 门槛全部同步（§7.3 第 5 条）。`callShift === 0` 时 `shiftThreshold` 原样返回，
    // 逐位不变。⚠️ 顺序是「先叠 ICM 溢价、再叠 callShift」，两者都是门槛偏移、可交换，
    // 但写成固定顺序便于复核。
    potOdds: shiftThreshold(
      riskAdjustedThreshold(ctx.potOdds, riskPremiumFor(state, player)),
      pf.callShift,
    ),
    // persona：分档专用权益 = `equity − valueShift`（与门槛判据用的原始 `equity` 分开，
    // 见 `DeepStackConfig.classifyEquity`）。`valueShift === 0` 时逐位等于 `equity`。
    classifyEquity: equity - pf.valueShift,
  };

  if (ctx.toCall > 0) {
    const result = handleDeepStackFacingBet(
      player, state, flags, ctx, config,
      player.hand, equity, handAdjustment, sprDecision,
    );

    // 对手跟注率高时，减少诈唬下注。
    // ⚠️ 这里用**原始** `equity`（不是 `classifyEquity`）：`0.5` / `0.4` 这两条是
    // 「对手画像」的门，不是价值门槛。§7.2 第 4 行明确要求 persona「保留对手调整」，
    // 所以 valueShift 不该渗进这两条 —— 否则同一个 valueShift 会在分档与对手门里
    // 各生效一次，两个语义完全不同的判据被同一个旋钮耦合。
    if (callTighten > 0 && result.action === 'raise' && equity < 0.5) {
      return {
        ...result,
        // ⚠️ **面对下注不能压成 `check`**：过牌要求 `toCall === 0`（`isActionAccepted` 的
        // `case 'check'`），而本分支只在 `ctx.toCall > 0` 时进入 —— 压成 `check` 必被
        // `legalizeRaise`/动作接受层拒绝，`GameBoard` 的机器人 effect 只 `return`
        // （依赖未变 ⇒ 不重跑）⇒ **机器人卡住**。不诈唬加注的合法替代是**跟注**。
        action: 'call',
        // 跟注不带金额（reducer 用 `toCall` 自算）；清掉 `...result` 带来的加注金额，
        // 免得陈旧 `amount` 被 `createActionEvent` 记进统计事件。
        amount: undefined,
        reasoning: `${result.reasoning} (opponent calls too much, calling instead)`,
      };
    }

    return result;
  }

  const result = handleDeepStackNoBet(
    player, state, flags, ctx, config,
    player.hand, handAdjustment, sprDecision,
  );

  // 对手弃牌率高时，增加偷盲/持续下注频率
  // 必须复核 `flags.canRaiseResult`：无人可应（对手都全下/弃牌）时它会被关掉，
  // 此时把 check 翻成 raise 就是一次没人跟得起的无效加注。
  if (stealBoost > 0 && flags.canRaiseResult && result.action === 'check' && equity < 0.4) {
    return {
      ...result,
      action: 'raise',
      // ⚠️ **必须给 `amount`**：深筹码的调用点（`botAI` 的 `veryDeep` 分支）映射的是
      // `deepStackRec.amount` —— 不像短筹码 / ICM 那样映射 `.sizing`。漏了它，`getBotAction`
      // 末尾的「唯一缩放点」会因 `raw.amount === undefined` 直接原样返回，于是
      // `isActionAccepted('raise', undefined)` 被 `legalizeRaise` 拒绝；而 `GameBoard`
      // 的机器人 effect 在动作被拒时只 `return`（依赖 `state` 未变 ⇒ 不重跑）⇒
      // **真人视角里机器人卡住、牌局停住**。金额口径与同文件其它 6 处 `raise` 分支一致：
      // `target = floor(totalPot × sizing)`，再交给 `calculateRaiseAmount` 夹到合法区间。
      amount: calculateRaiseAmount(player, state, Math.floor(ctx.totalPot * 0.33)),
      sizing: 0.33,
      reasoning: `${result.reasoning} (opponent folds often, stealing)`,
    };
  }

  return result;
}

export function getDeepStackAdjustments(
  hand: Card[],
  effectiveStack: number,
): { handAdjustment: HandAdjustment; sprDecision: SprDecision; spr: number } {
  const handAdjustment = getHandAdjustment(hand, effectiveStack);
  const spr = effectiveStack > 0 ? effectiveStack / 10 : 999; // Simplified SPR calculation
  const sprDecision = sprDecisionOf(spr);

  return { handAdjustment, sprDecision, spr };
}
