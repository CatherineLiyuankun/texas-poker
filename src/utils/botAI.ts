import type { Player, GameState, Action, PlayerId } from '../types/poker';
import { evaluateHand } from './handEvaluator';
import { BIG_BLIND } from '../hooks/useGameState';

interface BotDecision {
  action: Action;
  amount?: number;
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  const handStrength = evaluateHand(player.hand, state.communityCards);
  const handValue = handStrength.value;

  const toCall = state.lastBet - player.bet;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && toCall <= player.chips;
  const canRaise = toCall + BIG_BLIND <= player.chips;
  const canFold = toCall > 0;

  const activePlayers = state.players.filter(p => !p.folded && p.id !== player.id);
  const playerPosition = getPlayerPosition(player.id, state.dealer, state.players.length);

  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const isHeadsUp = activePlayers.length === 1;

  if (handValue >= 7) {
    if (canRaise) {
      const raiseAmount = calculateRaiseAmount(player, state, 1.5);
      return { action: 'raise', amount: raiseAmount };
    }
    if (canCall) {
      return { action: 'call' };
    }
  }

  if (handValue >= 5) {
    if (!isHeadsUp && playerPosition >= 3 && canRaise) {
      const raiseAmount = calculateRaiseAmount(player, state, 1);
      return { action: 'raise', amount: raiseAmount };
    }
    if (canCheck) {
      return { action: 'check' };
    }
    if (canCall && potOdds < 0.25) {
      return { action: 'call' };
    }
  }

  if (handValue >= 3) {
    if (canCheck) {
      return { action: 'check' };
    }
    if (canCall && potOdds < 0.15) {
      return { action: 'call' };
    }
    if (canFold && potOdds > 0.3 && !isHeadsUp) {
      return { action: 'fold' };
    }
  }

  if (canCheck) {
    if (Math.random() < 0.7) {
      return { action: 'check' };
    }
    if (canRaise && playerPosition <= 2 && Math.random() < 0.2) {
      const raiseAmount = calculateRaiseAmount(player, state, 0.75);
      return { action: 'raise', amount: raiseAmount };
    }
  }

  if (canCall) {
    if (potOdds < 0.1) {
      return { action: 'call' };
    }
    if (potOdds < 0.2 && handValue >= 2) {
      return { action: 'call' };
    }
  }

  if (canFold && toCall > 0) {
    if (potOdds > 0.4) {
      return { action: 'fold' };
    }
  }

  return { action: canCheck ? 'check' : (canCall ? 'call' : 'fold') };
}

function getPlayerPosition(playerId: PlayerId, dealer: PlayerId, totalPlayers: number): number {
  const dealerIdx = dealer - 1;
  const playerIdx = playerId - 1;
  return (playerIdx - dealerIdx + totalPlayers) % totalPlayers;
}

function calculateRaiseAmount(player: Player, state: GameState, multiplier: number): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + BIG_BLIND;
  const potSize = state.pot;
  const suggested = Math.floor(potSize * multiplier);
  const maxAfford = player.chips;
  return Math.min(Math.max(baseRaise, suggested), maxAfford);
}

export function getBotName(botIndex: number): string {
  const names = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
    'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'
  ];
  return names[botIndex] || `Bot ${botIndex + 1}`;
}