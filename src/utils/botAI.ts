import type { Player, GameState, Action, PlayerId } from '../types/poker';
import {
  canCheck,
  canCall,
  canRaise,
  canAllIn,
  canFold,
} from '../hooks/useGameState';
import { getPreflopTier } from './preflopHandStrength';
import { detectDraws } from './drawDetector';
import { calculateEquity } from './equityCalculator';
import {
  recordOpponentAction,
  getOpponentTendency,
  getOpponentFoldRate,
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

function getCardsToCome(state: GameState): number {
  switch (state.phase) {
    case 'preflop': return 5;
    case 'flop': return 2;
    case 'turn': return 1;
    case 'river': return 0;
    default: return 0;
  }
}

function decidePreflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
): BotDecision {
  const tier = getPreflopTier(player.hand);
  const isFacingRaise = ctx.toCall > 0;
  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  if (tier <= 2) {
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = tier === 1 ? 1.5 : 1.2;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
  }

  if (tier === 3) {
    if (isFacingBigRaise && !ctx.isLatePosition) {
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (ctx.isLatePosition && flags.canRaiseResult && !isFacingBigRaise) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  if (tier === 4) {
    if (isFacingBigRaise) {
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && ctx.potOdds < 0.25) return { action: 'call' };
    if (flags.canCallResult && ctx.isLatePosition && !isFacingRaise) {
      return { action: 'call' };
    }
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canCallResult && ctx.potOdds < 0.08) return { action: 'call' };
  if (flags.canFoldResult) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

function getOpponentInfo(
  player: Player,
  state: GameState,
): { avgFoldRate: number; hasAggressive: boolean; hasPassive: boolean } {
  const activeOpponents = state.players.filter(
    (p) => !p.folded && p.id !== player.id && !p.allIn,
  );
  const tendencies = activeOpponents.map((p) => getOpponentTendency(p.id));

  const avgFoldRate =
    activeOpponents.length > 0
      ? activeOpponents.reduce(
          (sum, p) => sum + getOpponentFoldRate(p.id),
          0,
        ) / activeOpponents.length
      : 0.3;

  return {
    avgFoldRate,
    hasAggressive: tendencies.some((t) => t === 'aggressive'),
    hasPassive: tendencies.some((t) => t === 'passive'),
  };
}

function decidePostflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
): BotDecision {
  const community = getCommunityCardsByPhase(state);
  const cardsToCome = getCardsToCome(state);

  const iterations = state.phase === 'flop' ? 200 : 300;
  const equity = calculateEquity(
    player.hand, community, ctx.numOpponents, iterations,
  );

  const drawInfo = detectDraws(player.hand, community, cardsToCome);
  const effectiveEquity = equity + drawInfo.estimatedEquity * 0.5;

  const oppInfo = getOpponentInfo(player, state);

  if (effectiveEquity >= 0.75) {
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = effectiveEquity >= 0.85 ? 1.3 : 1.0;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  if (effectiveEquity >= 0.55) {
    if (ctx.isLatePosition && flags.canRaiseResult && Math.random() < 0.4) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult) return { action: 'call' };
  }

  if (drawInfo.totalOuts >= 8 && flags.canRaiseResult && ctx.isLatePosition) {
    if (Math.random() < 0.35) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.75) };
    }
  }

  if (drawInfo.totalOuts > 0) {
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && effectiveEquity > ctx.potOdds + 0.05) {
      return { action: 'call' };
    }
    if (flags.canCallResult && ctx.potOdds < 0.15) return { action: 'call' };
  }

  if (effectiveEquity >= 0.35) {
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
  }

  if (
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    oppInfo.avgFoldRate > 0.3 &&
    Math.random() < 0.2
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
  }

  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  if (flags.canCheckResult) return { action: 'check' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

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

  const oppInfo = getOpponentInfo(player, state);

  if (equity >= 0.70) {
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

  if (equity >= 0.50) {
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult && equity >= ctx.potOdds) return { action: 'call' };
    if (flags.canCallResult && ctx.isHeadsUp) return { action: 'call' };
  }

  if (
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    oppInfo.avgFoldRate > 0.35 &&
    Math.random() < 0.25
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
  }

  if (equity >= 0.30 && flags.canCallResult && equity >= ctx.potOdds + 0.05) {
    return { action: 'call' };
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  state.players.forEach((p) => {
    if (p.id !== player.id && p.lastAction) {
      recordOpponentAction(p.id, p.lastAction);
    }
  });

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
  };

  switch (state.phase) {
    case 'preflop':
      return decidePreflop(player, state, flags, ctx);
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
