import type { Player, GameState, Action, PlayerId } from '../types/poker';
import {
  canCheck,
  canCall,
  canRaise,
  canAllIn,
  canFold,
} from '../hooks/useGameState';
import { getPreflopTier } from './preflopHandStrength';
import { calculateEquity } from './equityCalculator';
import {
  calculateOpponentProfile,
  getOpponentAdjustments,
  type OpponentAdjustments,
} from './opponentModel';
import { translations } from './translations';
import { decidePreflopGTO } from './gtoPreflop';

let useGtoStrategy = false;
export function setGtoStrategy(enabled: boolean): void { useGtoStrategy = enabled; }
export function getGtoStrategy(): boolean { return useGtoStrategy; }

interface BotDecision {
  action: Action;
  amount?: number;
}

interface ActionFlags {
  canCheckResult: boolean;
  canCallResult: boolean;
  canRaiseResult: boolean;
  canFoldResult: boolean;
  canAllInResult: boolean;
}

interface ContextInfo {
  toCall: number;
  totalPot: number;
  potOdds: number;
  position: number;
  totalPlayers: number;
  numOpponents: number;
  isHeadsUp: boolean;
  isLatePosition: boolean;
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  isMiddlePosition: boolean;
  isEarlyPosition: boolean;
  isBlind: boolean;
  hasLimpers: boolean;
}

function getPlayerPosition(
  playerId: PlayerId,
  dealer: PlayerId,
  totalPlayers: number,
): number {
  const dealerIdx = dealer - 1;
  const playerIdx = playerId - 1;
  return (playerIdx - dealerIdx + totalPlayers) % totalPlayers;
}

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  multiplier: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  const totalPot =
    state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const suggested = Math.floor(totalPot * multiplier);
  const maxAfford = player.chips;
  return Math.min(Math.max(baseRaise, suggested), maxAfford);
}

function getCommunityCardsByPhase(state: GameState): typeof state.communityCards {
  switch (state.phase) {
    case 'preflop':
      return [];
    case 'flop':
      return state.communityCards.slice(0, 3);
    case 'turn':
      return state.communityCards.slice(0, 4);
    case 'river':
      return state.communityCards.slice(0, 5);
    default:
      return state.communityCards;
  }
}

function handContainsAce(hand: { rank: string }[]): boolean {
  return hand.some(card => card.rank === 'A');
}

function decidePreflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const tier = getPreflopTier(player.hand);
  const isFacingRaise = ctx.toCall > 0;
  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 对手画像调整量：
  // - tightenCall: 面对激进对手时提高跟注门槛（正数 = 更难跟注）
  // - stealBoost: 对手弃牌率高时鼓励偷盲（+10% 加注概率）
  // - foldBoost: 对手被动时增加弃牌倾向（+10% 弃牌概率）
  const tightenCall = adj.callPenalty;
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const foldBoost = adj.foldPenalty > 0 ? 0.10 : 0;

  // 手牌含 A 时的全局调整因子：
  // - aceRaiseFactor: A 高牌更倾向加注（×1.10）
  // - aceCallFactor:  A 高牌更倾向跟注/过牌（×1.40），同时作用于分子和条件概率分母
  //   adjCall = baseCallProb * aceCallFactor
  //   条件概率 = adjCall / max(1 - baseRaiseProb - adjCall, 0.01)
  //   Math.max 防止高 raiseProb 时分母 ≤ 0
  const hasAce = handContainsAce(player.hand);
  const aceRaiseFactor = hasAce ? 1.10 : 1.0;
  const aceCallFactor = hasAce ? 1.40 : 1.0;

  // Tier 1-2（顶级牌/强牌）：AA, KK, QQ, AKs, AQs, AKo, JJ, TT 等
  // 策略：几乎 100% VPIP，永远不弃牌
  if (tier <= 2) {
    // Tier 2 偶尔设陷阱：12% 概率仅跟注（伪装牌力，不面对大加注时）
    if (tier === 2 && Math.random() < 0.12 && flags.canCallResult && !isFacingBigRaise) {
      return { action: 'call' };
    }
    // 浅筹码（≤ 2 倍底池）时直接全下
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
      return { action: 'allin' };
    }
    // 优先加注：Tier 1 加注 1.5 倍，Tier 2 加注 1.2 倍
    if (flags.canRaiseResult) {
      const mult = tier === 1 ? 1.5 : 1.2;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 无法加注时跟注
    if (flags.canCallResult) return { action: 'call' };
  }

  // Tier 3（可玩牌）：99-77, Axs, KTs, JTs, ATo, KQo 等
  // 策略：位置越好参与度越高，BTN 约 90% VPIP，EP 约 50%
  // 无人加注时：raise-first 模式（先判定加注，再判定跟注，最后弃牌）
  // 面对大加注：晚期位用 raise-first，非晚期位用 fold-first（先判定弃牌）
  if (tier === 3) {
    if (isFacingBigRaise) {
      if (ctx.isButton || ctx.isCutoff) {
        // 晚期位面对大加注：20% 反加注，65% 跟注，15% 弃牌
        if (flags.canRaiseResult && Math.random() < 0.20) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        const adjCall = 0.65 * aceCallFactor;
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - 0.20 - adjCall, 0.01)) {
          return { action: 'call' };
        }
        if (flags.canFoldResult) return { action: 'fold' };
      } else {
        // 非晚期位面对大加注：先判定弃牌（fold-first 模式）
        const foldProb = 0.40 + foldBoost;
        if (flags.canFoldResult && Math.random() < foldProb) {
          return { action: 'fold' };
        }
        const adjCall = 0.50 * aceCallFactor;
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - foldProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
        if (flags.canCallResult) return { action: 'call' };
        if (flags.canFoldResult) return { action: 'fold' };
      }
    }
    
    // 无人加注：raise-first 模式（加注优先，位置越靠前概率越低）
    // BTN/CO: 73% raise (×1.10 for Ax), 17% call, 10% fold
    if ((ctx.isButton || ctx.isCutoff) && !isFacingRaise) {
      const baseRaiseProb = 0.73;
      const baseCallProb = 0.17;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && Math.random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.05) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // HJ（劫持位）: 52% raise, 23% call, 25% fold
    if (ctx.isHijack && !isFacingRaise) {
      const baseRaiseProb = 0.52;
      const baseCallProb = 0.23;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 38% raise (×1.10 for Ax), 27% call, 35% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      const baseRaiseProb = 0.38;
      const baseCallProb = 0.27;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 30% raise (×1.10 for Ax), 20% call, 50% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.30;
      const baseCallProb = 0.20;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Blind/fallback: check or fold
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canFoldResult) return { action: 'fold' };
  }

  // Tier 4: Speculative (~65% VPIP at BTN, position-dependent)
  if (tier === 4) {
    if (isFacingBigRaise) {
      if (ctx.isButton || ctx.isCutoff) {
        // 晚期位面对大加注：更积极地防守
        if (flags.canRaiseResult && Math.random() < 0.20) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        const adjCall = 0.60 * aceCallFactor;
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - 0.20 - adjCall, 0.01)) {
          return { action: 'call' };
        }
        // 剩余概率弃牌（20% + foldBoost 增加弃牌倾向）
        if (flags.canFoldResult && Math.random() < 0.20 + foldBoost) {
          return { action: 'fold' };
        }
      } else {
        // 非晚期位面对大加注：先判定弃牌（fold-first 模式）
        const foldProb = 0.48 + foldBoost;
        if (flags.canFoldResult && Math.random() < foldProb) {
          return { action: 'fold' };
        }
        const adjCall = 0.42 * aceCallFactor;
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - foldProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canCheckResult) return { action: 'check' };
    
    // BTN: 63% raise (×1.10 for Ax), 17% call, 20% fold
    if (ctx.isButton && !isFacingRaise) {
      const baseRaiseProb = 0.63;
      const baseCallProb = 0.17;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && Math.random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // CO: 53% raise (×1.10 for Ax), 18% call, 29% fold
    if (ctx.isCutoff && !isFacingRaise) {
      const baseRaiseProb = 0.53;
      const baseCallProb = 0.18;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && Math.random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Hijack: 38% raise (×1.10 for Ax), 20% call, 42% fold
    if (ctx.isHijack && !isFacingRaise) {
      const baseRaiseProb = 0.38;
      const baseCallProb = 0.20;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && Math.random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 26% raise (×1.10 for Ax), 16% call, 58% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      const baseRaiseProb = 0.26;
      const baseCallProb = 0.16;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 16% raise (×1.10 for Ax), 12% call, 72% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.16;
      const baseCallProb = 0.12;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Late position 3-bet light against single raise
    if ((ctx.isButton || ctx.isCutoff) && isFacingRaise && !isFacingBigRaise) {
      if (flags.canRaiseResult && Math.random() < 0.18) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.15) };
      }
    }
    
    // Call with good pot odds
    if (flags.canCallResult && ctx.potOdds < (0.38 - tightenCall)) {
      return { action: 'call' };
    }
    
    // Heads up: call more liberally
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (0.48 - tightenCall)) {
      return { action: 'call' };
    }
    
    // Fallback: fold
    if (flags.canFoldResult) return { action: 'fold' };
  }

  // Tier 5: Marginal (~48% VPIP at BTN, highly position-dependent)
  if (tier === 5) {
    if (flags.canCheckResult) return { action: 'check' };

    // Button: 52% raise (×1.10 for Ax), 12% call (×1.40 for Ax), 36% fold
    if (ctx.isButton && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.30;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.18;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.52;
        const baseCallProb = 0.12;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Cutoff: 42% raise (×1.10 for Ax), 14% call (×1.40 for Ax), 44% fold
    if (ctx.isCutoff && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.28;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.15;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.42;
        const baseCallProb = 0.14;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Hijack: 33% raise (×1.10 for Ax), 17% call (×1.40 for Ax), 50% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.33;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.13;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.33;
        const baseCallProb = 0.17;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Middle position: 25% raise (×1.10 for Ax), 13% call (×1.40 for Ax), 62% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.35;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.05;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.25;
        const baseCallProb = 0.13;
        const adjCall = baseCallProb * aceCallFactor;
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Early position (UTG): 12% raise (×1.10 for Ax), 8% call (×1.40 for Ax), 80% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.12;
      const baseCallProb = 0.08;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Blind defense: call wider against late position raises
    if (isFacingRaise && !isFacingBigRaise && ctx.isBlind) {
      if (flags.canRaiseResult && Math.random() < 0.22) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.1) };
      }
      if (flags.canCallResult && ctx.potOdds < (0.40 - tightenCall)) {
        return { action: 'call' };
      }
      const adjCall = 0.48 * aceCallFactor;
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - 0.22 - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // 盲位面对大加注/all-in: 边缘牌仅以极好的赔率防守
    if (isFacingBigRaise && ctx.isBlind) {
      if (flags.canCallResult && ctx.potOdds < (0.20 - tightenCall)) {
        return { action: 'call' };
      }
    }

    // Heads up: defend wider
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (0.28 - tightenCall)) {
      return { action: 'call' };
    }

    // 面对小额加注: 位置越靠后跟注范围越宽
    if (isFacingRaise && !isFacingBigRaise && flags.canCallResult) {
      const threshold = ctx.isLatePosition ? 0.30 : ctx.isMiddlePosition ? 0.25 : 0.20;
      if (ctx.potOdds < (threshold - tightenCall)) {
        return { action: 'call' };
      }
    }

    // Very cheap calls with any position
    if (flags.canCallResult && ctx.potOdds < (0.18 - tightenCall)) {
      return { action: 'call' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // Tier 6: Trash (~15% VPIP at BTN, very tight)
  if (tier === 6) {
    if (flags.canCheckResult) return { action: 'check' };

    // Button: 15% raise (×1.10 for Ax), 5% call (×1.40 for Ax), 80% fold
    if (ctx.isButton && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.05;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.03;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.15;
        const baseCallProb = 0.05;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Cutoff: 12% raise (×1.10 for Ax), 4% call (×1.40 for Ax), 84% fold
    if (ctx.isCutoff && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.03;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.02;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.12;
        const baseCallProb = 0.04;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Hijack: 8% raise (×1.10 for Ax), 3% call (×1.40 for Ax), 89% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.015;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.08;
        const baseCallProb = 0.03;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && Math.random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Middle position: 5% raise (×1.10 for Ax), 2% call (×1.40 for Ax), 93% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.00;
        if (flags.canCallResult && Math.random() < adjCall) {
          return { action: 'call' };
        }
        if (baseRaiseProb > 0 && flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.05;
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
        }
        if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Early position (UTG): 2% raise (×1.10 for Ax), 1% call (×1.40 for Ax), 97% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.02;
      const baseCallProb = 0.01;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && Math.random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
      }
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Blind defense: very tight even from blinds
    if (isFacingRaise && !isFacingBigRaise && ctx.isBlind) {
      if (flags.canRaiseResult && Math.random() < 0.10) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.1) };
      }
      if (flags.canCallResult && ctx.potOdds < (0.25 - tightenCall)) {
        return { action: 'call' };
      }
      const adjCall = 0.15 * aceCallFactor;
      if (flags.canCallResult && Math.random() < adjCall / Math.max(1 - 0.10 - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Heads up: slightly wider but still tight
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (0.15 - tightenCall)) {
      return { action: 'call' };
    }

    // Very cheap calls only
    if (flags.canCallResult && ctx.potOdds < (0.08 - tightenCall)) {
      return { action: 'call' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // Fallback for any unhandled cases
  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

// 翻后决策：胜率 + 赔率 + 对手画像综合判断
// Monte Carlo 胜率已包含听牌概率，不再单独叠加听牌
function decidePostflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityCardsByPhase(state);

  const iterations = state.phase === 'flop' ? 200 : 300;
  const equity = calculateEquity(
    player.hand, community, ctx.numOpponents, iterations,
  );

  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 后面是否还有未行动的活跃玩家（用于判断隔离加注是否有意义）
  const hasPlayersBehind = state.players.some(
    p => p.id !== player.id && !p.folded && !p.hasActed,
  );

  // 面对大额加注/all-in 时，raiseBonus（基于对手弃牌率）不适用，
  // 因为对手已经 all-in 或大幅加注，不可能弃牌
  const effectiveRaiseBonus = (isFacingBigRaise && adj.raiseBonus > 0) ? 0 : adj.raiseBonus;

  // 强牌：胜率 >= 75% + 对手画像调整
  if (equity >= 0.75 + adj.callPenalty) {
    if (isFacingBigRaise && !hasPlayersBehind) {
      // 面对 all-in/大加注且后面无人: 全下或跟注，raise 无意义
      if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
        return { action: 'allin' };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = equity >= 0.85 ? 1.3 : 1.0;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  // 中等牌力：胜率 >= 55% + 对手画像调整
  if (equity >= 0.55 + adj.callPenalty - effectiveRaiseBonus) {
    // 面对大额加注时，中等牌力改为倾向跟注/过牌，不主动加注
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    // 主动下注：60% 概率（专业标准）
    if (flags.canRaiseResult && Math.random() < 0.60) {
      const mult = equity >= 0.65 ? 0.85 : 0.75;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 过牌：30% 概率（条件概率）
    if (flags.canCheckResult && Math.random() < 0.30 / (1 - 0.60)) {
      return { action: 'check' };
    }
    // 跟注：10% 概率
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult) return { action: 'call' };
  }

  // 边缘牌力：胜率 >= 35% + 对手画像调整
  if (equity >= 0.35 + adj.callPenalty - effectiveRaiseBonus) {
    // 面对大额加注时，禁止诈唬，改为跟注/弃牌
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
      if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCheckResult) return { action: 'check' };
      return { action: flags.canCallResult ? 'call' : 'fold' };
    }
    // 诈唬下注：30% 概率（少对手时）
    const bluffProb = ctx.numOpponents <= 2 ? 0.30 : 0;
    if (flags.canRaiseResult && Math.random() < bluffProb) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.7) };
    }
    // 过牌：50% 概率（条件概率）
    if (flags.canCheckResult && Math.random() < 0.50 / (1 - bluffProb)) {
      return { action: 'check' };
    }
    // 跟注：20% 概率
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响（平均弃牌率高 + 晚位 + 少对手）
  // 面对大额加注/all-in 时完全禁止诈唬，且必须有最低胜率底线
  if (
    !isFacingBigRaise &&
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    equity >= 0.15 &&
    adj.raiseBonus > 0 &&
    Math.random() < 0.2
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
  }

  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  if (flags.canCheckResult) return { action: 'check' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

// 河牌决策：胜率 + 赔率 + 对手画像综合判断
function decideRiver(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityCardsByPhase(state);
  const equity = calculateEquity(
    player.hand, community, ctx.numOpponents, 500,
  );

  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 后面是否还有未行动的活跃玩家（用于判断隔离加注是否有意义）
  const hasPlayersBehind = state.players.some(
    p => p.id !== player.id && !p.folded && !p.hasActed,
  );

  // 面对大额加注/all-in 时，raiseBonus 不适用
  const effectiveRaiseBonus = (isFacingBigRaise && adj.raiseBonus > 0) ? 0 : adj.raiseBonus;

  // 强牌：胜率 >= 70% + 对手画像调整
  if (equity >= 0.70 + adj.callPenalty) {
    if (isFacingBigRaise && !hasPlayersBehind) {
      // 面对 all-in/大加注且后面无人: 全下或跟注，raise 无意义
      if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
        return { action: 'allin' };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = equity >= 0.85 ? 1.2 : 0.9;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  // 中等牌力：胜率 >= 50% + 对手画像调整
  if (equity >= 0.50 + adj.callPenalty - effectiveRaiseBonus) {
    // 面对大额加注时，中等牌力改为倾向跟注/过牌
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    // 主动下注：50% 概率（河牌更谨慎）
    if (flags.canRaiseResult && Math.random() < 0.50) {
      const mult = equity >= 0.60 ? 0.85 : 0.75;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 过牌：35% 概率（条件概率）
    if (flags.canCheckResult && Math.random() < 0.35 / (1 - 0.50)) {
      return { action: 'check' };
    }
    // 跟注：15% 概率
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.isHeadsUp) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响
  // 面对大额加注/all-in 时完全禁止诈唬，且必须有最低胜率底线
  if (
    !isFacingBigRaise &&
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    equity >= 0.15 &&
    adj.raiseBonus > 0 &&
    Math.random() < 0.25
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
  }

  // 边缘跟注：胜率 >= 30% 且超过赔率 + 对手画像调整
  if (
    equity >= 0.30 + adj.callPenalty &&
    flags.canCallResult &&
    equity >= ctx.potOdds + 0.05
  ) {
    return { action: 'call' };
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  // 行动记录已移至 GameBoard.tsx 统一管理（每个行动只记录一次）
  const toCall = state.lastBet - player.bet;
  const canCheckResult = canCheck(state.lastBet, player.bet);
  const canCallResult = canCall(state.lastBet, player.bet, player.chips);
  const canRaiseResult = canRaise(
    state.lastBet,
    player.bet,
    player.chips,
    state.lastRaiseBet,
    state.raiseRightsOpened,
  );
  const canAllInResult = canAllIn(player.chips);
  const canFoldResult = canFold(state.lastBet, player.bet);

  const flags: ActionFlags = {
    canCheckResult,
    canCallResult,
    canRaiseResult,
    canFoldResult,
    canAllInResult,
  };

  const activePlayers = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  );
  const position = getPlayerPosition(
    player.id,
    state.dealer,
    state.players.length,
  );
  const totalPot =
    state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const potOdds = toCall > 0 ? toCall / (totalPot + toCall) : 0;
  const numOpponents = activePlayers.length;

  const ctx: ContextInfo = {
    toCall,
    totalPot,
    potOdds,
    position,
    totalPlayers: state.players.length,
    numOpponents,
    isHeadsUp: numOpponents === 1,
    isLatePosition: position >= Math.floor(state.players.length * 0.6),
    isButton: position === 0,
    isCutoff: position === state.players.length - 1 && position > 2,
    isHijack: position === state.players.length - 2 && position > 2,
    isMiddlePosition: position >= Math.floor(state.players.length * 0.3) && position < state.players.length - 2 && position > 2,
    isEarlyPosition: position > 0 && position < Math.floor(state.players.length * 0.3),
    isBlind: position === 1 || position === 2,
    hasLimpers: state.phase === 'preflop'
      ? state.players.some(p =>
          p.id !== player.id &&
          !p.folded &&
          p.bet === state.smallBlind * 2 &&
          getPlayerPosition(p.id, state.dealer, state.players.length) > 2,
        )
      : false,
  };

  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const adj = getOpponentAdjustments(oppProfile);

  switch (state.phase) {
    case 'preflop':
      return useGtoStrategy
        ? decidePreflopGTO(player, state, flags, ctx, adj)
        : decidePreflop(player, state, flags, ctx, adj);
    case 'flop':
    case 'turn':
      return decidePostflop(player, state, flags, ctx, adj);
    case 'river':
      return decideRiver(player, state, flags, ctx, adj);
    default:
      return {
        action: canCheckResult ? 'check' : canCallResult ? 'call' : 'fold',
      };
  }
}

export function getBotName(botIndex: number): string {
  return `${translations.playerArea.bot}${botIndex + 1}`;
}
