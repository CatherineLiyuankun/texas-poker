import { useReducer, useCallback } from 'react';
import type { Card, GameState, PlayerId, Action, Suit, Rank, Player } from '../types/poker';
import { evaluateHand, compareHands } from '../utils/handEvaluator';
import { INITIAL_CHIPS, SMALL_BLIND, BIG_BLIND } from '../utils/constant';

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function shuffleDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}


function createPlayer(id: PlayerId, isRealPlayer: boolean): Player {
  return {
    id,
    chips: INITIAL_CHIPS,
    bet: 0,
    totalBet: 0,
    hand: [],
    hasActed: false,
    folded: false,
    revealed: false,
    isRealPlayer,
    lastAction: undefined,
    buyInCount: 0,
    allIn: false,
  };
}

function createInitialState(realPlayerCount: number, botPlayerCount: number): GameState {
  const totalPlayers = realPlayerCount + botPlayerCount;
  const dealer: PlayerId = (Math.floor(Math.random() * totalPlayers) + 1) as PlayerId;

  const players: Player[] = [];
  for (let i = 0; i < totalPlayers; i++) {
    const playerId = (i + 1) as PlayerId;
    const isReal = i < realPlayerCount;
    players.push(createPlayer(playerId, isReal));
  }

  return {
    phase: 'preflop',
    pot: 0,
    communityCards: [],
    players,
    currentPlayer: dealer === 1 ? 2 : 1,
    dealer,
    lastBet: 0,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount,
    botPlayerCount,
  };
}

type GameAction =
  | { type: 'START_GAME'; realPlayerCount: number; botPlayerCount: number; playerChips?: number[] }
  | { type: 'PLAYER_ACTION'; player: PlayerId; action: Action; amount?: number }
  | { type: 'REVEAL_HAND'; player: PlayerId }
  | { type: 'NEXT_STREET' }
  | { type: 'COLLECT_POT'; winner: PlayerId }
  | { type: 'SPLIT_POT' }
  | { type: 'RESET_ROUND' }
  | { type: 'FOLD'; player: PlayerId };

function canCheck(lastBet: number, playerBet: number): boolean {
  return lastBet === playerBet;
}

function canCall(lastBet: number, playerBet: number, chips: number): boolean {
  const toCall = lastBet - playerBet;
  return toCall > 0 && toCall <= chips;
}

function canRaise(lastBet: number, playerBet: number, chips: number): boolean {
  const toCall = lastBet - playerBet;
  const minAdditional = toCall + BIG_BLIND;
  return minAdditional <= chips;
}

  function canFold(lastBet: number, playerBet: number): boolean {
    return lastBet > playerBet;
  }

  function canAllIn(chips: number): boolean {
    return chips > 0;
  }

function getNextActivePlayer(state: GameState, playersOverride?: Player[]): PlayerId | null {
  const players = playersOverride ?? state.players;
  const totalPlayers = players.length;
  for (let i = 1; i <= totalPlayers; i++) {
    const nextIdx = ((state.currentPlayer - 1 + i) % totalPlayers);
    const nextPlayer = players[nextIdx];
    if (!nextPlayer.folded && nextPlayer.chips > 0) {
      return nextPlayer.id;
    }
  }
  return null;
}

function getPlayerIndex(playerId: PlayerId): number {
  return playerId - 1;
}

function allPlayersActed(state: GameState): boolean {
  const activePlayers = state.players.filter(p => !p.folded && p.chips > 0);
  return activePlayers.every(p => p.hasActed);
}

function allBetsEqual(state: GameState): boolean {
  const activePlayers = state.players.filter(p => !p.folded && p.chips > 0);
  if (activePlayers.length === 0) return true;
  const firstBet = activePlayers[0].bet;
  return activePlayers.every(p => p.bet === firstBet && p.bet === state.lastBet);
}

function bettingComplete(state: GameState): boolean {
  const activePlayers = state.players.filter(p => !p.folded && p.chips > 0);
  if (activePlayers.length <= 1) return true;
  return allPlayersActed(state) && allBetsEqual(state);
}

function getBlindIndices(dealer: PlayerId, totalPlayers: number): { smallBlind: number; bigBlind: number } {
  const dealerIdx = getPlayerIndex(dealer);
  const smallBlindIdx = (dealerIdx + 1) % totalPlayers;
  const bigBlindIdx = (dealerIdx + 2) % totalPlayers;
  return { smallBlind: smallBlindIdx, bigBlind: bigBlindIdx };
}

export function useGameState() {
  const [state, dispatch] = useReducer((state: GameState, action: GameAction): GameState => {
    switch (action.type) {
      case 'START_GAME': {
        console.log('START_GAME:', JSON.stringify({ actionReal: action.realPlayerCount, actionBot: action.botPlayerCount, stateReal: state.realPlayerCount, stateBot: state.botPlayerCount }));
        const deck = shuffleDeck();
        const totalPlayers = action.realPlayerCount + action.botPlayerCount;

        const newPlayers: Player[] = [];
        for (let i = 0; i < totalPlayers; i++) {
          const playerId = (i + 1) as PlayerId;
          const isReal = i < action.realPlayerCount;
          newPlayers.push({
            ...createPlayer(playerId, isReal),
            hand: [deck[i * 2], deck[i * 2 + 1]],
            chips: action.playerChips?.[i] ?? state.players[i]?.chips ?? INITIAL_CHIPS,
            buyInCount: state.players[i]?.buyInCount ?? 0,
          });
        }

        const communityCards = deck.slice(totalPlayers * 2, totalPlayers * 2 + 5);
        const dealer = state.dealer || ((Math.floor(Math.random() * totalPlayers) + 1) as PlayerId);

        const { smallBlind: sbIdx, bigBlind: bbIdx } = getBlindIndices(
          dealer,
          totalPlayers,
        );

        const sbAmount = Math.min(SMALL_BLIND, newPlayers[sbIdx].chips);
        newPlayers[sbIdx].bet = sbAmount;
        newPlayers[sbIdx].totalBet = sbAmount;
        newPlayers[sbIdx].chips -= sbAmount;

        const bbAmount = Math.min(BIG_BLIND, newPlayers[bbIdx].chips);
        newPlayers[bbIdx].bet = bbAmount;
        newPlayers[bbIdx].totalBet = bbAmount;
        newPlayers[bbIdx].chips -= bbAmount;

        let nextPlayerIdx = (bbIdx + 1) % totalPlayers;
        while (newPlayers[nextPlayerIdx].folded) {
          nextPlayerIdx = (nextPlayerIdx + 1) % totalPlayers;
        }

         return {
           phase: 'preflop',
           pot: sbAmount + bbAmount,
           communityCards,
           players: newPlayers,
           currentPlayer: newPlayers[nextPlayerIdx].id,
           dealer: dealer,
           lastBet: bbAmount,
           winner: null,
           handRank: null,
           winningCards: [],
           realPlayerCount: action.realPlayerCount,
           botPlayerCount: action.botPlayerCount,
         };
      }

      case 'PLAYER_ACTION': {
        const playerIdx = getPlayerIndex(action.player);
        if (playerIdx < 0 || playerIdx >= state.players.length) return state;

        const player = state.players[playerIdx];
        if (player.folded) return state;

        const newPlayers = state.players.map(p => ({ ...p }));
        let newPot = state.pot;
        let newLastBet = state.lastBet;

        const actingPlayer = { ...newPlayers[playerIdx] };

        switch (action.action) {
          case 'check':
            actingPlayer.hasActed = true;
            break;
          case 'call': {
            const toCall = state.lastBet - player.bet;
            actingPlayer.bet += toCall;
            actingPlayer.totalBet += toCall;
            actingPlayer.chips -= toCall;
            actingPlayer.hasActed = true;
            newPot += toCall;
            if (actingPlayer.chips === 0) {
              actingPlayer.allIn = true;
            }
            break;
          }
          case 'raise': {
            const toCall = state.lastBet - player.bet;
            const minAdditional = toCall + BIG_BLIND;
            const requested = action.amount ?? minAdditional;
            const additional = Math.max(minAdditional, requested);
            actingPlayer.bet += additional;
            actingPlayer.totalBet += additional;
            actingPlayer.chips -= additional;
            if (actingPlayer.chips === 0) {
              actingPlayer.allIn = true;
            }
            actingPlayer.hasActed = true;
            newLastBet = Math.max(newLastBet, actingPlayer.bet);
            newPot += additional;
            break;
          }
          case 'allin': {
            const allInAmount = actingPlayer.chips;
            actingPlayer.bet += allInAmount;
            actingPlayer.totalBet += allInAmount;
            actingPlayer.chips = 0;
            actingPlayer.hasActed = true;
            actingPlayer.allIn = true;
            newPot += allInAmount; // 更新底池
            if (actingPlayer.bet > newLastBet) {
              newLastBet = actingPlayer.bet; // 更新当前最高注金
            }
            break;
          }
          case 'fold':
            actingPlayer.folded = true;
            actingPlayer.hasActed = true;
            break;
        }

        newPlayers[playerIdx] = { ...actingPlayer, lastAction: action.action };

        if (action.action === 'fold') {
          const activePlayers = newPlayers.filter(p => !p.folded);
          if (activePlayers.length === 1) {
            const winner = activePlayers[0].id;
            if (newPot > 0) {
              const winnerIdx = getPlayerIndex(winner);
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + newPot,
              };
            }
            return {
              ...state,
              players: newPlayers,
              pot: 0,
              winner,
            };
          }
        }

        const nextPlayer = getNextActivePlayer(state, newPlayers);
        if (!nextPlayer) {
          const activePlayers = newPlayers.filter(p => !p.folded);
          if (activePlayers.length >= 2) {
            return {
              ...state,
              players: newPlayers,
              pot: newPot,
              lastBet: newLastBet,
              currentPlayer: activePlayers[0].id,
            };
          }
          return state;
        }

        return {
          ...state,
          players: newPlayers,
          pot: newPot,
          lastBet: newLastBet,
          currentPlayer: nextPlayer,
        };
      }

      case 'FOLD': {
        const playerIdx = getPlayerIndex(action.player);
        if (playerIdx < 0 || playerIdx >= state.players.length) return state;

        const newPlayers = state.players.map((p, i) =>
          i === playerIdx ? { ...p, folded: true, hasActed: true } : p
        );

        const activePlayers = newPlayers.filter(p => !p.folded);
        if (activePlayers.length <= 1) {
          const winner = activePlayers[0]?.id ?? null;
          if (winner && state.pot > 0) {
            const winnerIdx = getPlayerIndex(winner);
            newPlayers[winnerIdx] = {
              ...newPlayers[winnerIdx],
              chips: newPlayers[winnerIdx].chips + state.pot,
            };
          }
          return {
            ...state,
            players: newPlayers,
            pot: 0,
            winner,
          };
        }

        return { ...state, players: newPlayers };
      }

      case 'REVEAL_HAND': {
        const playerIdx = getPlayerIndex(action.player);
        if (playerIdx < 0 || playerIdx >= state.players.length) return state;

        const newPlayers = state.players.map((p, i) =>
          i === playerIdx ? { ...p, revealed: true } : p
        );
        return { ...state, players: newPlayers };
      }

      case 'NEXT_STREET': {
        const newPlayers = state.players.map(p => ({
          ...p,
          hasActed: false,
          bet: 0,
        }));

        let newPhase = state.phase;
        if (state.phase === 'preflop') {
          newPhase = 'flop';
        } else if (state.phase === 'flop') {
          newPhase = 'turn';
        } else if (state.phase === 'turn') {
          newPhase = 'river';
        } else if (state.phase === 'river') {
          newPhase = 'showdown';
        }

        if (newPhase === 'showdown' && state.pot > 0 && state.winner === null) {
          const activePlayers = state.players.filter(p => !p.folded);
          if (activePlayers.length === 1) {
            const winner = activePlayers[0].id;
            const winnerIdx = getPlayerIndex(winner);
            newPlayers[winnerIdx] = {
              ...newPlayers[winnerIdx],
              chips: newPlayers[winnerIdx].chips + state.pot,
            };
            return {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              pot: 0,
              winner,
            };
          }

          const evaluated = activePlayers.map(p => ({
            player: p,
            eval: evaluateHand(p.hand, state.communityCards),
          }));

          let bestIdx = 0;
          for (let i = 1; i < evaluated.length; i++) {
            if (compareHands(evaluated[i].eval, evaluated[bestIdx].eval) > 0) {
              bestIdx = i;
            }
          }

          const winners = evaluated.filter(e =>
            compareHands(e.eval, evaluated[bestIdx].eval) === 0
          );

          if (winners.length === 1) {
            const winner = winners[0].player.id;
            const winnerIdx = getPlayerIndex(winner);
            newPlayers[winnerIdx] = {
              ...newPlayers[winnerIdx],
              chips: newPlayers[winnerIdx].chips + state.pot,
            };
            return {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              pot: 0,
              winner,
              handRank: winners[0].eval.rank,
            };
          }

          const each = Math.floor(state.pot / winners.length);
          winners.forEach(w => {
            const idx = getPlayerIndex(w.player.id);
            newPlayers[idx] = {
              ...newPlayers[idx],
              chips: newPlayers[idx].chips + each,
            };
          });
          const remainder = state.pot - each * winners.length;
          if (remainder > 0) {
            newPlayers[getPlayerIndex(winners[0].player.id)].chips += remainder;
          }

          return {
            ...state,
            phase: newPhase,
            players: newPlayers,
            currentPlayer: state.dealer,
            lastBet: 0,
            pot: 0,
            winner: null,
          };
        }

        let nextPlayerIdx = (state.dealer - 1 + 1) % state.players.length;
        let searchedCount = 0;
        while ((newPlayers[nextPlayerIdx].folded || newPlayers[nextPlayerIdx].allIn || newPlayers[nextPlayerIdx].chips === 0) && searchedCount < state.players.length) {
          nextPlayerIdx = (nextPlayerIdx + 1) % state.players.length;
          searchedCount++;
        }
        
        const canActPlayers = newPlayers.filter(p => !p.folded && !p.allIn && p.chips > 0);
        if (canActPlayers.length === 0) {
          return {
            ...state,
            phase: newPhase,
            players: newPlayers,
            currentPlayer: state.currentPlayer,
            lastBet: 0,
          };
        }
        
        return {
          ...state,
          phase: newPhase,
          players: newPlayers,
          currentPlayer: newPlayers[nextPlayerIdx].id,
          lastBet: 0,
        };
      }

      case 'COLLECT_POT': {
        if (state.pot <= 0 || state.winner !== null) return state;
        const winnerIdx = getPlayerIndex(action.winner);
        if (winnerIdx < 0 || winnerIdx >= state.players.length) return state;

        const newPlayers = state.players.map((p, i) =>
          i === winnerIdx ? { ...p, chips: p.chips + state.pot } : p
        );
        return {
          ...state,
          players: newPlayers,
          pot: 0,
          winner: action.winner,
        };
      }

      case 'SPLIT_POT': {
        if (state.pot <= 0 || state.winner !== null) return state;
        const activePlayers = state.players.filter(p => !p.folded);
        const each = Math.floor(state.pot / activePlayers.length);
        const newPlayers = state.players.map(p => {
          if (p.folded) return p;
          return { ...p, chips: p.chips + each };
        });
        const remainder = state.pot - each * activePlayers.length;
        if (remainder > 0 && newPlayers[0]) {
          newPlayers[0].chips += remainder;
        }
        return {
          ...state,
          players: newPlayers,
          pot: 0,
          winner: null,
        };
      }

      case 'RESET_ROUND': {
        const newDealer = ((state.dealer % state.players.length) + 1) as PlayerId;
        const newPlayers = state.players.map((p, index) => ({
          ...p,
          chips: p.chips > 0 ? p.chips : p.chips + INITIAL_CHIPS,
          buyInCount: p.chips > 0 ? p.buyInCount : p.buyInCount + 1,
          bet: 0,
          totalBet: 0,
          hand: [],
          hasActed: false,
          folded: false,
          revealed: false,
          isRealPlayer: index < state.realPlayerCount,
        }));
        return {
          phase: 'preflop',
          pot: 0,
          communityCards: [],
          players: newPlayers,
          currentPlayer: newDealer === 1 ? 2 : 1,
          dealer: newDealer,
          lastBet: 0,
          winner: null,
          handRank: null,
          winningCards: [],
          realPlayerCount: state.realPlayerCount,
          botPlayerCount: state.botPlayerCount,
        };
      }

      default:
        return state;
    }
  }, createInitialState(2, 0));

  const startGame = useCallback((realPlayerCount: number, botPlayerCount: number, playerChips?: number[]) => {
    dispatch({ type: 'START_GAME', realPlayerCount, botPlayerCount, playerChips });
  }, []);

  const playerAction = useCallback((player: PlayerId, action: Action, amount?: number) => {
    dispatch({ type: 'PLAYER_ACTION', player, action, amount });
  }, []);

  const revealHand = useCallback((player: PlayerId) => {
    dispatch({ type: 'REVEAL_HAND', player });
  }, []);

  const nextStreet = useCallback(() => {
    dispatch({ type: 'NEXT_STREET' });
  }, []);

  const collectPot = useCallback((winner: PlayerId) => {
    dispatch({ type: 'COLLECT_POT', winner });
  }, []);

  const splitPot = useCallback(() => {
    dispatch({ type: 'SPLIT_POT' });
  }, []);

  const resetRound = useCallback(() => {
    dispatch({ type: 'RESET_ROUND' });
    setTimeout(() => {
      dispatch({
        type: 'START_GAME',
        realPlayerCount: state.realPlayerCount,
        botPlayerCount: state.botPlayerCount,
      });
    }, 0);
  }, [state.realPlayerCount, state.botPlayerCount]);

  const fold = useCallback((player: PlayerId) => {
    dispatch({ type: 'FOLD', player });
  }, []);

  const canPlayerAct = useCallback((playerId: PlayerId, action: Action): boolean => {
    const player = state.players[getPlayerIndex(playerId)];
    if (!player || player.folded || player.allIn) return false;

    switch (action) {
      case 'check':
        return canCheck(state.lastBet, player.bet);
      case 'call':
        return canCall(state.lastBet, player.bet, player.chips);
      case 'raise':
        return canRaise(state.lastBet, player.bet, player.chips);
      case 'fold':
        return canFold(state.lastBet, player.bet);
      case 'allin':
        return canAllIn(player.chips);
      default:
        return false;
    }
  }, [state.lastBet, state.players]);

  const isBettingComplete = useCallback((): boolean => {
    return bettingComplete(state);
  }, [state]);

  const getCurrentPhaseCards = useCallback((): Card[] => {
    switch (state.phase) {
      case 'preflop':
        return [];
      case 'flop':
        return state.communityCards.slice(0, 3);
      case 'turn':
        return state.communityCards.slice(0, 4);
      case 'river':
        return state.communityCards;
      default:
        return state.communityCards;
    }
  }, [state.phase, state.communityCards]);

  return {
    state,
    startGame,
    playerAction,
    revealHand,
    nextStreet,
    collectPot,
    splitPot,
    resetRound,
    fold,
    canPlayerAct,
    isBettingComplete,
    getCurrentPhaseCards,
  };
}

export { SMALL_BLIND, BIG_BLIND, INITIAL_CHIPS };