import type { Player, GameState, Action, PlayerId } from '../types/poker';
import { evaluateHand } from './handEvaluator';
import {
  canCheck,
  canCall,
  canRaise,
  canAllIn,
  canFold,
} from '../hooks/useGameState';

interface BotDecision {
  action: Action;
  amount?: number;
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  const handStrength = evaluateHand(player.hand, state.communityCards);
  const handValue = handStrength.value;

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

  const activePlayers = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  );
  const playerPosition = getPlayerPosition(
    player.id,
    state.dealer,
    state.players.length,
  );

  const totalPot =
    state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const potOdds = toCall > 0 ? toCall / (totalPot + toCall) : 0;
  const isHeadsUp = activePlayers.length === 1;

  if (handValue >= 8) {
    if (canAllInResult && player.chips <= totalPot * 2) {
      return { action: 'allin' as Action };
    }
    if (canRaiseResult) {
      const raiseAmount = calculateRaiseAmount(player, state, 1.5);
      return { action: 'raise', amount: raiseAmount };
    }
    if (canCallResult) {
      return { action: 'call' };
    }
  }

  if (handValue >= 7) {
    if (canAllInResult && player.chips <= totalPot * 1.5) {
      return { action: 'allin' as Action };
    }
    if (canRaiseResult) {
      const raiseAmount = calculateRaiseAmount(player, state, 1.2);
      return { action: 'raise', amount: raiseAmount };
    }
    if (canCallResult) {
      return { action: 'call' };
    }
    if (canCheckResult) {
      return { action: 'check' };
    }
  }

  if (handValue >= 5) {
    if (!isHeadsUp && playerPosition >= 3 && canRaiseResult) {
      const raiseAmount = calculateRaiseAmount(player, state, 1);
      return { action: 'raise', amount: raiseAmount };
    }
    if (canCheckResult) {
      return { action: 'check' };
    }
    if (canCallResult && potOdds < 0.3) {
      return { action: 'call' };
    }
    if (canCallResult) {
      return { action: 'call' };
    }
  }

  if (handValue >= 3) {
    if (canCheckResult) {
      return { action: 'check' };
    }
    if (canCallResult && potOdds < 0.2) {
      return { action: 'call' };
    }
    if (canFoldResult && potOdds > 0.35 && !isHeadsUp) {
      return { action: 'fold' };
    }
  }

  if (canCheckResult) {
    if (Math.random() < 0.7) {
      return { action: 'check' };
    }
    if (canRaiseResult && playerPosition <= 2 && Math.random() < 0.2) {
      const raiseAmount = calculateRaiseAmount(player, state, 0.75);
      return { action: 'raise', amount: raiseAmount };
    }
  }

  if (canCallResult) {
    if (potOdds < 0.15) {
      return { action: 'call' };
    }
    if (potOdds < 0.25 && handValue >= 2) {
      return { action: 'call' };
    }
  }

  if (canFoldResult && toCall > 0) {
    if (potOdds > 0.4) {
      return { action: 'fold' };
    }
  }

  return { action: canCheckResult ? 'check' : canCallResult ? 'call' : 'fold' };
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

export function getBotName(botIndex: number): string {
  const names = [
    'Alpha',
    'Beta',
    'Gamma',
    'Delta',
    'Epsilon',
    'Zeta',
    'Eta',
    'Theta',
    'Iota',
    'Kappa',
  ];
  return names[botIndex] || `Bot ${botIndex + 1}`;
}
