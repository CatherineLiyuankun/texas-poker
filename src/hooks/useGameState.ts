import { useReducer, useCallback } from 'react';
import type {
  Card,
  GameState,
  PlayerId,
  Action,
  Suit,
  Rank,
  Player,
  SidePot,
} from '../types/poker';
import { evaluateHand, compareHands } from '../utils/handEvaluator';
import { INITIAL_CHIPS, SMALL_BLIND, BIG_BLIND } from '../utils/constant';

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
];

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

function createInitialState(
  realPlayerCount: number,
  botPlayerCount: number,
): GameState {
  const totalPlayers = realPlayerCount + botPlayerCount;
  const dealer: PlayerId = (Math.floor(Math.random() * totalPlayers) +
    1) as PlayerId;

  const players: Player[] = [];
  for (let i = 0; i < totalPlayers; i++) {
    const playerId = (i + 1) as PlayerId;
    const isReal = i < realPlayerCount;
    players.push(createPlayer(playerId, isReal));
  }

  return {
    phase: 'preflop',
    mainPot: 0,
    sidePots: [],
    communityCards: [],
    players,
    currentPlayer: dealer === 1 ? 2 : 1,
    dealer,
    lastBet: 0,
    lastRaiseBet: BIG_BLIND - SMALL_BLIND,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount,
    botPlayerCount,
  };
}

type GameAction =
  | {
      type: 'START_GAME';
      realPlayerCount: number;
      botPlayerCount: number;
      playerChips?: number[];
    }
  | { type: 'PLAYER_ACTION'; player: PlayerId; action: Action; amount?: number }
  | { type: 'REVEAL_HAND'; player: PlayerId }
  | { type: 'NEXT_STREET' }
  | { type: 'COLLECT_POT'; winner: PlayerId }
  | { type: 'SPLIT_POT' }
  | { type: 'RESET_ROUND' }
  | { type: 'FOLD'; player: PlayerId };

export function canCheck(lastBet: number, playerBet: number): boolean {
  return lastBet === playerBet;
}

export function canCall(
  lastBet: number,
  playerBet: number,
  chips: number,
): boolean {
  const toCall = lastBet - playerBet;
  return toCall > 0 && toCall <= chips;
}

export function canRaise(
  lastBet: number,
  playerBet: number,
  chips: number,
  lastRaiseBet: number,
  raiseRightsOpened: boolean,
): boolean {
  if (!raiseRightsOpened) return false;

  const toCall = lastBet - playerBet;
  const minAdditional = toCall + lastRaiseBet;
  return minAdditional <= chips;
}

export function canFold(lastBet: number, playerBet: number): boolean {
  return lastBet > playerBet;
}

export function canAllIn(chips: number): boolean {
  return chips > 0;
}

function getNextActivePlayer(
  state: GameState,
  playersOverride?: Player[],
): PlayerId | null {
  const players = playersOverride ?? state.players;
  const totalPlayers = players.length;
  for (let i = 1; i <= totalPlayers; i++) {
    const nextIdx = (state.currentPlayer - 1 + i) % totalPlayers;
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
  const canActPlayers = state.players.filter(
    (p) => !p.folded && !p.allIn && p.chips > 0,
  );
  if (canActPlayers.length === 0) return true;
  return canActPlayers.every((p) => p.hasActed);
}

function allBetsEqual(state: GameState): boolean {
  const activeBettors = state.players.filter(
    (p) => !p.folded && !p.allIn && p.chips > 0,
  );

  if (activeBettors.length === 0) return true;

  const maxBet = Math.max(...activeBettors.map((p) => p.bet), 0);
  return activeBettors.every((p) => p.bet === maxBet);
}

function hasPlayerActedAfterAllIn(state: GameState): boolean {
  const allInPlayers = state.players.filter((p) => !p.folded && p.allIn);
  if (allInPlayers.length === 0) return true;

  const maxAllInBet = Math.max(...allInPlayers.map((p) => p.bet), 0);
  const notAllInPlayers = state.players.filter(
    (p) => !p.folded && !p.allIn && p.chips > 0,
  );

  if (notAllInPlayers.length === 0) return true;

  return notAllInPlayers.every((p) => p.bet >= maxAllInBet || p.hasActed);
}

function bettingComplete(state: GameState): boolean {
  const activePlayers = state.players.filter(
    (p) => !p.folded && (p.allIn || p.chips > 0),
  );
  if (activePlayers.length <= 1) return true;

  if (!hasPlayerActedAfterAllIn(state)) return false;

  return allPlayersActed(state) && allBetsEqual(state);
}

function getBlindIndices(
  dealer: PlayerId,
  totalPlayers: number,
): { smallBlind: number; bigBlind: number } {
  const dealerIdx = getPlayerIndex(dealer);
  const smallBlindIdx = (dealerIdx + 1) % totalPlayers;
  const bigBlindIdx = (dealerIdx + 2) % totalPlayers;
  return { smallBlind: smallBlindIdx, bigBlind: bigBlindIdx };
}

export function useGameState() {
  const [state, dispatch] = useReducer(
    (state: GameState, action: GameAction): GameState => {
      switch (action.type) {
        case 'START_GAME': {
          console.log(
            'START_GAME:',
            JSON.stringify({
              actionReal: action.realPlayerCount,
              actionBot: action.botPlayerCount,
              stateReal: state.realPlayerCount,
              stateBot: state.botPlayerCount,
            }),
          );
          const deck = shuffleDeck();
          const totalPlayers = action.realPlayerCount + action.botPlayerCount;

          const newPlayers: Player[] = [];
          for (let i = 0; i < totalPlayers; i++) {
            const playerId = (i + 1) as PlayerId;
            const isReal = i < action.realPlayerCount;
            newPlayers.push({
              ...createPlayer(playerId, isReal),
              hand: [deck[i * 2], deck[i * 2 + 1]],
              chips:
                action.playerChips?.[i] ??
                state.players[i]?.chips ??
                INITIAL_CHIPS,
              buyInCount: state.players[i]?.buyInCount ?? 0,
            });
          }

          const communityCards = deck.slice(
            totalPlayers * 2,
            totalPlayers * 2 + 5,
          );
          const dealer =
            state.dealer ||
            ((Math.floor(Math.random() * totalPlayers) + 1) as PlayerId);

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

          let lastRaiseBet: number;
          let raiseRightsOpened: boolean;

          if (bbAmount >= BIG_BLIND) {
            lastRaiseBet = bbAmount - sbAmount;
            raiseRightsOpened = true;
          } else {
            lastRaiseBet = BIG_BLIND - SMALL_BLIND;
            raiseRightsOpened = false;
          }

          return {
            phase: 'preflop',
            mainPot: sbAmount + bbAmount,
            sidePots: [],
            communityCards,
            players: newPlayers,
            currentPlayer: newPlayers[nextPlayerIdx].id,
            dealer: dealer,
            lastBet: bbAmount,
            lastRaiseBet,
            raiseRightsOpened,
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

          const newPlayers = state.players.map((p) => ({ ...p }));
          let newPot = state.mainPot;
          let newLastBet = state.lastBet;
          let newLastRaiseBet = state.lastRaiseBet;
          let newRaiseRightsOpened = state.raiseRightsOpened;
          const newSidePots = [...state.sidePots];

          const actingPlayer = { ...newPlayers[playerIdx] };

          switch (action.action) {
            case 'check':
              actingPlayer.hasActed = true;
              if (actingPlayer.chips === 0) {
                actingPlayer.allIn = true;
              }
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
              const additional = action.amount ?? 0;
              const toCall = state.lastBet - player.bet;
              const newBet = player.bet + additional;

              actingPlayer.bet += additional;
              actingPlayer.totalBet += additional;
              actingPlayer.chips -= additional;
              if (actingPlayer.chips === 0) {
                actingPlayer.allIn = true;
              }
              actingPlayer.hasActed = true;

              if (state.lastRaiseBet === 0 && state.lastBet === 0) {
                newLastRaiseBet = newBet;
              } else {
                newLastRaiseBet = additional - toCall;
              }

              newLastBet = Math.max(newLastBet, newBet);
              newRaiseRightsOpened = true;
              newPot += additional;
              break;
            }
            case 'allin': {
              const allInAmount = actingPlayer.chips;
              const toCall = state.lastBet - player.bet;
              const extraAmount = allInAmount - toCall;

              actingPlayer.bet += allInAmount;
              actingPlayer.totalBet += allInAmount;
              actingPlayer.chips = 0;
              actingPlayer.hasActed = true;
              actingPlayer.allIn = true;
              newPot = 0;

              newLastBet = Math.max(newLastBet, actingPlayer.bet);

              if (state.lastRaiseBet === 0 && state.lastBet === 0) {
                newLastRaiseBet = allInAmount;
                newRaiseRightsOpened = true;
              } else if (extraAmount >= state.lastRaiseBet) {
                newLastRaiseBet = extraAmount;
                newRaiseRightsOpened = true;
              } else {
                newLastRaiseBet = state.lastRaiseBet;
                newRaiseRightsOpened = false;
              }

              newPlayers[playerIdx] = {
                ...actingPlayer,
                lastAction: action.action,
              };

              const allPlayers = newPlayers.filter(
                (p) => !p.folded && p.bet > 0,
              );
              const statePlayers = state.players.filter(
                (p) => !p.folded && p.bet > 0,
              );
              const activePlayers = newPlayers.filter((p) => !p.folded);
              if (allPlayers.length === 0) {
                break;
              }
              const commonBet = Math.min(...allPlayers.map((p) => p.bet));
              const mainPotSize = commonBet * activePlayers.length;
              const totalContributed =
                state.mainPot + allPlayers.reduce((sum, p) => sum + p.bet, 0);
              const excessTotal = totalContributed - mainPotSize;
              newPot = mainPotSize;

              if (excessTotal > 0) {
                const playersWhoCanBetFurther = allPlayers.filter(
                  (p) => p.bet > commonBet,
                );
                if (playersWhoCanBetFurther.length > 0) {
                  const contributions: Partial<Record<PlayerId, number>> = {};
                  let sidePotAmount = 0;
                  playersWhoCanBetFurther.forEach((p) => {
                    const excess = p.bet - commonBet;
                    contributions[p.id] = excess;
                    sidePotAmount += excess;
                  });
                  const newSidePot: SidePot = {
                    id: newSidePots.length + 1,
                    amount: sidePotAmount,
                    contributions,
                    eligiblePlayers: statePlayers.map((p) => p.id), // 参与当前轮下注的玩家都可以竞争边池
                  };
                  newSidePots.push(newSidePot);
                }
              }

              newLastBet = actingPlayer.bet;
              break;
            }
            case 'fold':
              actingPlayer.folded = true;
              actingPlayer.hasActed = true;
              break;
          }

          newPlayers[playerIdx] = {
            ...actingPlayer,
            lastAction: action.action,
          };

          if (action.action === 'fold') {
            const activePlayers = newPlayers.filter((p) => !p.folded);
            if (activePlayers.length === 1) {
              const winner = activePlayers[0].id;
              const totalPot =
                newPot + newSidePots.reduce((sum, sp) => sum + sp.amount, 0);
              if (totalPot > 0) {
                const winnerIdx = getPlayerIndex(winner);
                newPlayers[winnerIdx] = {
                  ...newPlayers[winnerIdx],
                  chips: newPlayers[winnerIdx].chips + totalPot,
                };
              }
              return {
                ...state,
                players: newPlayers,
                mainPot: 0,
                sidePots: [],
                lastRaiseBet: newLastRaiseBet,
                raiseRightsOpened: newRaiseRightsOpened,
                winner,
              };
            }
          }

          const nextPlayer = getNextActivePlayer(state, newPlayers);
          if (!nextPlayer) {
            const activePlayers = newPlayers.filter((p) => !p.folded);
            if (activePlayers.length >= 2) {
              return {
                ...state,
                players: newPlayers,
                mainPot: newPot,
                sidePots: newSidePots,
                lastBet: newLastBet,
                lastRaiseBet: newLastRaiseBet,
                raiseRightsOpened: newRaiseRightsOpened,
                currentPlayer: activePlayers[0].id,
              };
            }
            return state;
          }

          return {
            ...state,
            players: newPlayers,
            mainPot: newPot,
            sidePots: newSidePots,
            lastBet: newLastBet,
            lastRaiseBet: newLastRaiseBet,
            raiseRightsOpened: newRaiseRightsOpened,
            currentPlayer: nextPlayer,
          };
        }

        case 'FOLD': {
          const playerIdx = getPlayerIndex(action.player);
          if (playerIdx < 0 || playerIdx >= state.players.length) return state;

          const newPlayers = state.players.map((p, i) =>
            i === playerIdx ? { ...p, folded: true, hasActed: true } : p,
          );

          const activePlayers = newPlayers.filter((p) => !p.folded);
          if (activePlayers.length <= 1) {
            const winner = activePlayers[0]?.id ?? null;
            const totalPot =
              state.mainPot +
              state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
            if (totalPot > 0) {
              const winnerIdx = getPlayerIndex(winner);
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + totalPot,
              };
            }
            return {
              ...state,
              players: newPlayers,
              mainPot: 0,
              sidePots: [],
              winner,
            };
          }

          return { ...state, players: newPlayers };
        }

        case 'REVEAL_HAND': {
          const playerIdx = getPlayerIndex(action.player);
          if (playerIdx < 0 || playerIdx >= state.players.length) return state;

          const newPlayers = state.players.map((p, i) =>
            i === playerIdx ? { ...p, revealed: true } : p,
          );
          return { ...state, players: newPlayers };
        }

        case 'NEXT_STREET': {
          // 翻牌、转牌、河牌结束后，进入下一轮
          const newPlayers = state.players.map((p) => ({
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

          if (newPhase === 'showdown') {
            const allInPlayers = state.players.filter(
              (p) => !p.folded && p.allIn,
            );
            const minAllInBet =
              allInPlayers.length > 0
                ? Math.min(...allInPlayers.map((p) => p.totalBet))
                : 0;

            const eligiblePlayers = state.players.filter((p) => {
              if (p.folded) return false;
              if (allInPlayers.length > 0) {
                return p.totalBet >= minAllInBet; // 只有在某轮下注过且总下注金额达到最小all-in的玩家才有资格参与摊牌
              }
              return p.totalBet > 0;
            }); // 参与摊牌的玩家列表（至少在某轮下注过，且未弃牌的玩家）

            const totalPot =
              state.mainPot +
              state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);

            if (eligiblePlayers.length === 1) {
              const winner = eligiblePlayers[0].id;
              const winnerIdx = getPlayerIndex(winner);
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + totalPot,
              };
              return {
                ...state,
                phase: newPhase,
                players: newPlayers,
                currentPlayer: state.dealer,
                lastBet: 0,
                lastRaiseBet: 0,
                raiseRightsOpened: true,
                mainPot: 0,
                sidePots: [],
                winner,
              };
            }

            if (eligiblePlayers.length === 0 || totalPot === 0) {
              return {
                ...state,
                phase: newPhase,
                players: newPlayers,
                currentPlayer: state.dealer,
                lastBet: 0,
                lastRaiseBet: 0,
                raiseRightsOpened: true,
                mainPot: 0,
                sidePots: [],
                winner: null,
              };
            }

            const evaluated = eligiblePlayers.map((p) => ({
              player: p,
              eval: evaluateHand(p.hand, state.communityCards),
            }));

            let bestIdx = 0;
            for (let i = 1; i < evaluated.length; i++) {
              if (
                compareHands(evaluated[i].eval, evaluated[bestIdx].eval) > 0
              ) {
                bestIdx = i;
              }
            }

            const winners = evaluated.filter(
              (e) => compareHands(e.eval, evaluated[bestIdx].eval) === 0,
            );

            const winnerIds = winners.map((w) => w.player.id);

            let mainPotWinners = winners;
            if (winners.length > 1 && state.mainPot > 0) {
              const mainPotEligible = eligiblePlayers;
              mainPotWinners = winners.filter((w) =>
                mainPotEligible.some((e) => e.id === w.player.id),
              );
            }

            if (mainPotWinners.length === 0 && winners.length > 0) {
              mainPotWinners = winners;
            }

            if (mainPotWinners.length === 1) {
              const winnerIdx = getPlayerIndex(mainPotWinners[0].player.id);
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + state.mainPot,
              };
            } else if (mainPotWinners.length > 1) {
              const each = Math.floor(state.mainPot / mainPotWinners.length);
              mainPotWinners.forEach((w) => {
                const idx = getPlayerIndex(w.player.id);
                newPlayers[idx] = {
                  ...newPlayers[idx],
                  chips: newPlayers[idx].chips + each,
                };
              });
              const remainder = state.mainPot - each * mainPotWinners.length;
              if (remainder > 0) {
                newPlayers[getPlayerIndex(mainPotWinners[0].player.id)].chips +=
                  remainder;
              }
            }

            state.sidePots.forEach((sp) => {
              const sidePotEligible = sp.eligiblePlayers
                .map((id) => eligiblePlayers.find((p) => p.id === id))
                .filter((p) => p !== undefined);

              if (sidePotEligible.length === 0) return;

              const sideEvaluated = sidePotEligible.map((p) => ({
                player: p,
                eval: evaluateHand(p.hand, state.communityCards),
              }));

              let sideBestIdx = 0;
              for (let i = 1; i < sideEvaluated.length; i++) {
                if (
                  compareHands(
                    sideEvaluated[i].eval,
                    sideEvaluated[sideBestIdx].eval,
                  ) > 0
                ) {
                  sideBestIdx = i;
                }
              }

              const sideWinners = sideEvaluated.filter(
                (e) =>
                  compareHands(e.eval, sideEvaluated[sideBestIdx].eval) === 0,
              );

              if (sideWinners.length === 1) {
                const winnerIdx = getPlayerIndex(sideWinners[0].player.id);
                newPlayers[winnerIdx] = {
                  ...newPlayers[winnerIdx],
                  chips: newPlayers[winnerIdx].chips + sp.amount,
                };
              } else if (sideWinners.length > 1) {
                const each = Math.floor(sp.amount / sideWinners.length);
                sideWinners.forEach((w) => {
                  const idx = getPlayerIndex(w.player.id);
                  newPlayers[idx] = {
                    ...newPlayers[idx],
                    chips: newPlayers[idx].chips + each,
                  };
                });
                const remainder = sp.amount - each * sideWinners.length;
                if (remainder > 0) {
                  newPlayers[getPlayerIndex(sideWinners[0].player.id)].chips +=
                    remainder;
                }
              }
            });

            return {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              lastRaiseBet: 0,
              raiseRightsOpened: true,
              mainPot: 0,
              sidePots: [],
              winner: winnerIds.length === 1 ? winnerIds[0] : null,
              handRank: winners[0].eval.rank,
            };
          }

          let nextPlayerIdx = (state.dealer - 1 + 1) % state.players.length;
          let searchedCount = 0;
          while (
            (newPlayers[nextPlayerIdx].folded ||
              newPlayers[nextPlayerIdx].allIn ||
              newPlayers[nextPlayerIdx].chips === 0) &&
            searchedCount < state.players.length
          ) {
            nextPlayerIdx = (nextPlayerIdx + 1) % state.players.length;
            searchedCount++;
          }

          const canActPlayers = newPlayers.filter(
            (p) => !p.folded && !p.allIn && p.chips > 0,
          );
          if (canActPlayers.length === 0) {
            return {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.currentPlayer,
              lastBet: 0,
              lastRaiseBet: 0,
              raiseRightsOpened: true,
            };
          }

          return {
            ...state,
            phase: newPhase,
            players: newPlayers,
            currentPlayer: newPlayers[nextPlayerIdx].id,
            lastBet: 0,
            lastRaiseBet: 0,
            raiseRightsOpened: true,
          };
        }

        case 'COLLECT_POT': {
          if (state.mainPot <= 0 || state.winner !== null) return state;
          const winnerIdx = getPlayerIndex(action.winner);
          if (winnerIdx < 0 || winnerIdx >= state.players.length) return state;

          const totalWinnings =
            state.mainPot +
            state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
          const newPlayers = state.players.map((p, i) =>
            i === winnerIdx ? { ...p, chips: p.chips + totalWinnings } : p,
          );
          return {
            ...state,
            players: newPlayers,
            mainPot: 0,
            sidePots: [],
            lastRaiseBet: 0,
            raiseRightsOpened: true,
            winner: action.winner,
          };
        }

        case 'SPLIT_POT': {
          if (state.mainPot <= 0 || state.winner !== null) return state;
          const activePlayers = state.players.filter(
            (p) => !p.folded && p.totalBet > 0,
          );
          const totalPot =
            state.mainPot +
            state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
          const each = Math.floor(totalPot / activePlayers.length);
          const newPlayers = state.players.map((p) => {
            if (p.folded || p.totalBet === 0) return p;
            return { ...p, chips: p.chips + each };
          });
          const remainder = totalPot - each * activePlayers.length;
          if (remainder > 0 && newPlayers[0]) {
            newPlayers[0].chips += remainder;
          }
          return {
            ...state,
            players: newPlayers,
            mainPot: 0,
            sidePots: [],
            lastRaiseBet: 0,
            raiseRightsOpened: true,
            winner: null,
          };
        }

        case 'RESET_ROUND': {
          const newDealer = ((state.dealer % state.players.length) +
            1) as PlayerId;
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
            mainPot: 0,
            sidePots: [],
            communityCards: [],
            players: newPlayers,
            currentPlayer: newDealer === 1 ? 2 : 1,
            dealer: newDealer,
            lastBet: 0,
            lastRaiseBet: 0,
            raiseRightsOpened: true,
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
    },
    createInitialState(2, 0),
  );

  const startGame = useCallback(
    (
      realPlayerCount: number,
      botPlayerCount: number,
      playerChips?: number[],
    ) => {
      dispatch({
        type: 'START_GAME',
        realPlayerCount,
        botPlayerCount,
        playerChips,
      });
    },
    [],
  );

  const playerAction = useCallback(
    (player: PlayerId, action: Action, amount?: number) => {
      dispatch({ type: 'PLAYER_ACTION', player, action, amount });
    },
    [],
  );

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

  const canPlayerAct = useCallback(
    (playerId: PlayerId, action: Action): boolean => {
      const player = state.players[getPlayerIndex(playerId)];
      if (!player || player.folded || player.allIn) return false;

      switch (action) {
        case 'check':
          return canCheck(state.lastBet, player.bet);
        case 'call':
          return canCall(state.lastBet, player.bet, player.chips);
        case 'raise':
          return canRaise(
            state.lastBet,
            player.bet,
            player.chips,
            state.lastRaiseBet,
            state.raiseRightsOpened,
          );
        case 'fold':
          return canFold(state.lastBet, player.bet);
        case 'allin':
          return canAllIn(player.chips);
        default:
          return false;
      }
    },
    [state.lastBet, state.lastRaiseBet, state.raiseRightsOpened, state.players],
  );

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
