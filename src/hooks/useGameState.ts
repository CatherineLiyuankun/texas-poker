import { useReducer, useCallback } from 'react';
import type { Card, GameState, PlayerId, Action, Suit, Rank } from '../types/poker';
import { evaluateHand, compareHands } from '../utils/handEvaluator';

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

const INITIAL_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

function createInitialState(): GameState {
  const dealer: PlayerId = Math.random() < 0.5 ? 1 : 2;
  return {
    phase: 'preflop',
    pot: 0,
    communityCards: [],
    players: [
      { id: 1, chips: INITIAL_CHIPS, bet: 0, hand: [], hasActed: false, folded: false, revealed: false },
      { id: 2, chips: INITIAL_CHIPS, bet: 0, hand: [], hasActed: false, folded: false, revealed: false }
    ],
    currentPlayer: dealer === 1 ? 2 : 1,
    dealer,
    lastBet: 0,
    winner: null,
    handRank: null,
    winningCards: [],

  };
}

type GameAction =
  | { type: 'START_GAME' }
  | { type: 'PLAYER_ACTION'; player: PlayerId; action: Action; amount?: number }
  | { type: 'REVEAL_HAND'; player: PlayerId }
  | { type: 'NEXT_STREET' }
  | { type: 'COLLECT_POT'; winner: PlayerId }
  | { type: 'SPLIT_POT' }
  | { type: 'RESET_ROUND' }

  | { type: 'FOLD'; player: PlayerId }
  | { type: 'SWITCH_PLAYER' };

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

function getNextPlayer(state: GameState): PlayerId {
  const currentIdx = state.currentPlayer - 1;
  const nextIdx = currentIdx === 0 ? 1 : 0;
  return (nextIdx + 1) as PlayerId;
}

function bettingComplete(state: GameState): boolean {
  const [p1, p2] = state.players;
  if (p1.folded || p2.folded) return true;
  if (p1.hasActed && p2.hasActed && p1.bet === p2.bet && p1.bet === state.lastBet) {
    return true;
  }
  return false;
}

export function useGameState() {
  const [state, dispatch] = useReducer((state: GameState, action: GameAction): GameState => {
    switch (action.type) {
      case 'START_GAME': {
        const deck = shuffleDeck();
        const p1Hand = [deck[0], deck[2]];
        const p2Hand = [deck[1], deck[3]];
        const currentDealer = state.dealer;
        
        const newState: GameState = {
          ...createInitialState(),
          players: [
            { id: 1, chips: state.players[0].chips, bet: 0, hand: p1Hand, hasActed: false, folded: false, revealed: false },
            { id: 2, chips: state.players[1].chips, bet: 0, hand: p2Hand, hasActed: false, folded: false, revealed: false }
          ],
          communityCards: deck.slice(4, 9),
          pot: 0,
          dealer: currentDealer,
        };
        
        const smallBlind = newState.dealer;
        const bigBlind = smallBlind === 1 ? 2 : 1;
        
        const p1Idx = smallBlind === 1 ? 0 : 1;
        const p2Idx = bigBlind === 1 ? 0 : 1;
        
        newState.players[p1Idx].bet = SMALL_BLIND;
        newState.players[p1Idx].chips -= SMALL_BLIND;
        newState.players[p2Idx].bet = BIG_BLIND;
        newState.players[p2Idx].chips -= BIG_BLIND;
        newState.pot = SMALL_BLIND + BIG_BLIND;
        newState.lastBet = BIG_BLIND;
        newState.currentPlayer = smallBlind;
        
        return newState;
      }
      
      case 'PLAYER_ACTION': {
        const playerIdx = action.player - 1;
        const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
        let newPot = state.pot;
        let newLastBet = state.lastBet;
        
        const player = { ...newPlayers[playerIdx] };
        
        switch (action.action) {
          case 'check':
            player.hasActed = true;
            break;
          case 'call': {
            const toCall = state.lastBet - player.bet;
            player.bet += toCall;
            player.chips -= toCall;
            player.hasActed = true;
            newPot += toCall;
            break;
          }
          case 'raise': {
            const toCall = state.lastBet - player.bet;
            const minAdditional = toCall + BIG_BLIND;
            const requested = action.amount ?? minAdditional;
            const additional = Math.max(minAdditional, requested);
            player.bet += additional;
            player.chips -= additional;
            player.hasActed = true;
            newLastBet = Math.max(newLastBet, player.bet);
            newPot += additional;
            break;
          }
          case 'fold':
            player.folded = true;
            player.hasActed = true;
            break;
        }
        
        newPlayers[playerIdx] = player;

        if (action.action === 'fold') {
          const winner: PlayerId = player.id === 1 ? 2 : 1;
          const winnerIdx = winner - 1;
          if (newPot > 0) {
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
        
        const nextPlayer = getNextPlayer(state);
        const nextPlayerIdx = nextPlayer - 1;
        
        if (newPlayers[nextPlayerIdx].folded) {
          newPlayers[nextPlayerIdx].hasActed = true;
        } else if (newPlayers[nextPlayerIdx].hasActed && player.hasActed) {
          if (player.bet === newPlayers[nextPlayerIdx].bet && player.bet === newLastBet) {
            return { ...state, players: newPlayers, pot: newPot, lastBet: newLastBet };
          }
        }
        
        return {
          ...state,
          players: newPlayers,
          pot: newPot,
          lastBet: newLastBet,
          currentPlayer: nextPlayer
        };
      }
      
      case 'FOLD': {
        const playerIdx = action.player - 1;
        const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
        newPlayers[playerIdx] = { ...newPlayers[playerIdx], folded: true };
        return { ...state, players: newPlayers };
      }

      case 'SWITCH_PLAYER': {
        const nextPlayer = state.currentPlayer === 1 ? 2 : 1;
        return { ...state, currentPlayer: nextPlayer };
      }
      
      case 'REVEAL_HAND': {
        const playerIdx = action.player - 1;
        const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
        newPlayers[playerIdx] = { ...newPlayers[playerIdx], revealed: true };
        return { ...state, players: newPlayers };
      }
      
      case 'NEXT_STREET': {
        const newPlayers = state.players.map(p => ({
          ...p,
          hasActed: false,
          bet: 0
        })) as [typeof state.players[0], typeof state.players[1]];
        
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
          const p1Eval = evaluateHand(state.players[0].hand, state.communityCards);
          const p2Eval = evaluateHand(state.players[1].hand, state.communityCards);
          const result = compareHands(p1Eval, p2Eval);
          const settledPlayers = [...newPlayers] as [typeof state.players[0], typeof state.players[1]];

          if (result > 0) {
            settledPlayers[0].chips += state.pot;
            return {
              ...state,
              phase: newPhase,
              players: settledPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              pot: 0,
              winner: 1,
            };
          }

          if (result < 0) {
            settledPlayers[1].chips += state.pot;
            return {
              ...state,
              phase: newPhase,
              players: settledPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              pot: 0,
              winner: 2,
            };
          }

          const each = Math.floor(state.pot / 2);
          settledPlayers[0].chips += each;
          settledPlayers[1].chips += state.pot - each;
          return {
            ...state,
            phase: newPhase,
            players: settledPlayers,
            currentPlayer: state.dealer,
            lastBet: 0,
            pot: 0,
            winner: null,
          };
        }
        
        return {
          ...state,
          phase: newPhase,
          players: newPlayers,
          currentPlayer: state.dealer === 1 ? 2 : 1,
          lastBet: 0
        };
      }
      

       case 'COLLECT_POT': {
         if (state.pot <= 0 || state.winner !== null) {
           return state;
         }
         const winnerIdx = action.winner - 1;
         const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
         newPlayers[winnerIdx].chips += state.pot;
         
         return {
           ...state,
           players: newPlayers,
           pot: 0,
           winner: action.winner
         };
       }

       case 'SPLIT_POT': {
         if (state.pot <= 0 || state.winner !== null) {
           return state;
         }
         const pot = state.pot;
         const each = Math.floor(pot / 2);
         const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
         newPlayers[0].chips += each;
         newPlayers[1].chips += pot - each;
         return {
           ...state,
           players: newPlayers,
           pot: 0,
           winner: null
         };
       }
      
      case 'RESET_ROUND': {
        const newDealer = state.dealer === 1 ? 2 : 1;
        return {
          ...createInitialState(),
          players: state.players.map(p => ({
            ...p,
            chips: p.chips > 0 ? p.chips : INITIAL_CHIPS
          })) as [typeof state.players[0], typeof state.players[1]],
          dealer: newDealer
        };
      }
      
      default:
        return state;
    }
  }, createInitialState());

  const startGame = useCallback(() => {
    dispatch({ type: 'START_GAME' });
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
  setTimeout(() => { dispatch({ type: 'START_GAME' }); }, 0);
}, []);


  const fold = useCallback((player: PlayerId) => {
    dispatch({ type: 'FOLD', player });
  }, []);

  const canPlayerAct = useCallback((player: PlayerId, action: Action): boolean => {
    const p = state.players[player - 1];
    if (p.folded) return false;
    
    switch (action) {
      case 'check':
        return canCheck(state.lastBet, p.bet);
      case 'call':
        return canCall(state.lastBet, p.bet, p.chips);
      case 'raise':
        return canRaise(state.lastBet, p.bet, p.chips);
      case 'fold':
        return canFold(state.lastBet, p.bet);
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
    getCurrentPhaseCards
  };
}

export { SMALL_BLIND, BIG_BLIND, INITIAL_CHIPS };
