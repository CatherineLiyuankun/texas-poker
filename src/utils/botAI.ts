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
  detectLimpers,
  type OpponentAdjustments,
} from './opponentModel';
import { translations } from './translations';

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
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const tightenCall = adj.callPenalty;
  const foldBoost = adj.foldPenalty > 0 ? 0.10 : 0;

  // Tier 1-2: Premium/Strong (~100% VPIP)
  if (tier <= 2) {
    // Occasionally just call with Tier 2 for deception (trap play)
    if (tier === 2 && Math.random() < 0.12 && flags.canCallResult && !isFacingBigRaise) {
      return { action: 'call' };
    }
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = tier === 1 ? 1.5 : 1.2;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
  }

  // Tier 3: Playable (~80% VPIP at BTN)
  if (tier === 3) {
    if (isFacingBigRaise) {
      if (ctx.isButton || ctx.isCutoff) {
        if (flags.canRaiseResult && Math.random() < 0.20) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        if (flags.canCallResult && Math.random() < 0.60) {
          return { action: 'call' };
        }
        if (flags.canFoldResult) return { action: 'fold' };
      } else {
        if (flags.canFoldResult && Math.random() < (0.50 + foldBoost)) {
          return { action: 'fold' };
        }
        if (flags.canCallResult && Math.random() < 0.40) {
          return { action: 'call' };
        }
        if (flags.canFoldResult) return { action: 'fold' };
      }
    }
    
    // BTN/CO: 60% raise, 20% call, 20% fold
    if ((ctx.isButton || ctx.isCutoff) && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < (0.60 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.05) };
      }
      if (flags.canCallResult && Math.random() < 0.20) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Hijack: 40% raise, 30% call, 30% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < 0.40) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < 0.30) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 35% raise, 35% call, 30% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < 0.35) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < 0.35) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 25% raise, 25% call, 50% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < 0.25) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && Math.random() < 0.25) {
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
        // Late position: defend more aggressively
        if (flags.canRaiseResult && Math.random() < 0.20) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        if (flags.canCallResult && Math.random() < 0.55) {
          return { action: 'call' };
        }
        if (flags.canFoldResult && Math.random() < (0.45 + foldBoost)) {
          return { action: 'fold' };
        }
      } else {
        // Early/middle position: tighter against big raises
        if (flags.canFoldResult && Math.random() < (0.55 + foldBoost)) {
          return { action: 'fold' };
        }
        if (flags.canCallResult && Math.random() < 0.35) {
          return { action: 'call' };
        }
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canCheckResult) return { action: 'check' };
    
    // BTN: 50% raise, 15% call, 35% fold
    if (ctx.isButton && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < (0.50 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < 0.15) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // CO: 40% raise, 15% call, 45% fold
    if (ctx.isCutoff && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < (0.40 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < 0.15) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Hijack: 30% raise, 15% call, 55% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < (0.30 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < 0.15) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 20% raise, 15% call, 65% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < 0.20) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < 0.15) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 10% raise, 10% call, 80% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      if (flags.canRaiseResult && Math.random() < 0.10) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && Math.random() < 0.10) {
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
    if (flags.canCallResult && ctx.potOdds < (0.35 - tightenCall)) {
      return { action: 'call' };
    }
    
    // Heads up: call more liberally
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (0.45 - tightenCall)) {
      return { action: 'call' };
    }
    
    // Fallback: fold
    if (flags.canFoldResult) return { action: 'fold' };
  }

  // Tier 5-6: Marginal/Trash (~20-30% VPIP, highly position-dependent)
  if (flags.canCheckResult) return { action: 'check' };

  // Button: most aggressive position
  if (ctx.isButton && !isFacingRaise) {
    if (ctx.hasLimpers) {
      // Limpers ahead: can limp behind with marginal hands
      if (flags.canCallResult && Math.random() < 0.25) {
        return { action: 'call' };
      }
      if (flags.canRaiseResult && Math.random() < 0.15) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
      }
    } else {
      // No limpers: steal attempt
      if (flags.canRaiseResult && Math.random() < (0.48 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
      }
      if (flags.canCallResult && Math.random() < 0.08) {
        return { action: 'call' };
      }
    }
  }

  // Cutoff: second most aggressive
  if (ctx.isCutoff && !isFacingRaise) {
    if (ctx.hasLimpers) {
      if (flags.canCallResult && Math.random() < 0.22) {
        return { action: 'call' };
      }
      if (flags.canRaiseResult && Math.random() < 0.12) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
      }
    } else {
      if (flags.canRaiseResult && Math.random() < (0.38 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
      }
      if (flags.canCallResult && Math.random() < 0.12) {
        return { action: 'call' };
      }
    }
  }

  // Hijack: moderate aggression
  if (ctx.isHijack && !isFacingRaise) {
    if (ctx.hasLimpers) {
      if (flags.canCallResult && Math.random() < 0.28) {
        return { action: 'call' };
      }
      if (flags.canRaiseResult && Math.random() < 0.10) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
      }
    } else {
      if (flags.canRaiseResult && Math.random() < (0.28 + stealBoost)) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
      }
      if (flags.canCallResult && Math.random() < 0.18) {
        return { action: 'call' };
      }
    }
  }

  // Middle position: occasional play with marginal hands
  if (ctx.isMiddlePosition && !isFacingRaise) {
    if (ctx.hasLimpers) {
      if (flags.canCallResult && Math.random() < 0.30) {
        return { action: 'call' };
      }
    } else {
      if (flags.canRaiseResult && Math.random() < 0.20) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
      }
      if (flags.canCallResult && Math.random() < 0.22) {
        return { action: 'call' };
      }
    }
  }

  // Early position (UTG): very tight
  if (ctx.isEarlyPosition && !isFacingRaise) {
    if (flags.canRaiseResult && Math.random() < 0.08) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
    }
    if (flags.canCallResult && Math.random() < 0.05) {
      return { action: 'call' };
    }
  }

  // Blind defense: call wider against late position raises
  if (isFacingRaise && !isFacingBigRaise && ctx.isBlind) {
    // Defend blinds more aggressively
    if (flags.canRaiseResult && Math.random() < 0.22) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.1) };
    }
    if (flags.canCallResult && ctx.potOdds < (0.35 - tightenCall)) {
      return { action: 'call' };
    }
    if (flags.canCallResult && Math.random() < 0.40) {
      return { action: 'call' };
    }
  }

  // Heads up: defend wider
  if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (0.20 - tightenCall)) {
    return { action: 'call' };
  }

  // Very cheap calls with any position
  if (flags.canCallResult && ctx.potOdds < (0.10 - tightenCall)) {
    return { action: 'call' };
  }

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
): BotDecision {
  const community = getCommunityCardsByPhase(state);

  const iterations = state.phase === 'flop' ? 200 : 300;
  const equity = calculateEquity(
    player.hand, community, ctx.numOpponents, iterations,
  );

  // 获取对手画像和阈值调整量
  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const adj = getOpponentAdjustments(oppProfile);

  // 强牌：胜率 >= 75% + 对手画像调整
  if (equity >= 0.75 + adj.callPenalty) {
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
  if (equity >= 0.55 + adj.callPenalty - adj.raiseBonus) {
    if (ctx.isLatePosition && flags.canRaiseResult && Math.random() < 0.4) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult) return { action: 'call' };
  }

  // 边缘牌力：胜率 >= 35% + 对手画像调整
  if (equity >= 0.35 + adj.callPenalty - adj.raiseBonus) {
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响（平均弃牌率高 + 晚位 + 少对手）
  if (
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
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
): BotDecision {
  const community = getCommunityCardsByPhase(state);
  const equity = calculateEquity(
    player.hand, community, ctx.numOpponents, 500,
  );

  // 获取对手画像和阈值调整量
  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const adj = getOpponentAdjustments(oppProfile);

  // 强牌：胜率 >= 70% + 对手画像调整
  if (equity >= 0.70 + adj.callPenalty) {
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
  if (equity >= 0.50 + adj.callPenalty - adj.raiseBonus) {
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.isHeadsUp) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响
  if (
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
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
    isCutoff: position === state.players.length - 1,
    isHijack: position === state.players.length - 2,
    isMiddlePosition: position >= Math.floor(state.players.length * 0.3) && position < state.players.length - 2,
    isEarlyPosition: position > 0 && position < Math.floor(state.players.length * 0.3),
    isBlind: position === 1 || position === 2,
    hasLimpers: state.phase === 'preflop' ? detectLimpers().length > 0 : false,
  };

  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const adj = getOpponentAdjustments(oppProfile);

  switch (state.phase) {
    case 'preflop':
      return decidePreflop(player, state, flags, ctx, adj);
    case 'flop':
    case 'turn':
      return decidePostflop(player, state, flags, ctx);
    case 'river':
      return decideRiver(player, state, flags, ctx);
    default:
      return {
        action: canCheckResult ? 'check' : canCallResult ? 'call' : 'fold',
      };
  }
}

export function getBotName(botIndex: number): string {
  return `${translations.playerArea.bot}${botIndex + 1}`;
}
