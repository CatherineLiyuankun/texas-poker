import { useReducer, useCallback } from 'react';
import type {
  Card,
  GameState,
  GamePhase,
  PlayerId,
  Action,
  Suit,
  Rank,
  Player,
  PotDistribution,
  HandRank,
} from '../types/poker';
import { evaluateHand, compareHands } from '../utils/handEvaluator';
import { INITIAL_CHIPS, SMALL_BLIND, BIG_BLIND } from '../utils/constant';
import { calculatePots, computeContributions } from '../utils/potCalculator';
import { resetOpponentStats } from '../utils/opponentModel';

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

function logStateChange(actionType: string, newState: GameState): void {
  console.log(`[${actionType}] State update:`, {
    phase: newState.phase,
    mainPot: newState.mainPot,
    sidePots: newState.sidePots.length,
    currentPlayer: newState.currentPlayer,
    lastBet: newState.lastBet,
    lastRaiseBet: newState.lastRaiseBet,
    raiseRightsOpened: newState.raiseRightsOpened,
    winner: newState.winner,
    dealer: newState.dealer,
    players: newState.players.map((p) => ({
      id: p.id,
      chips: p.chips,
      bet: p.bet,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
      hasActed: p.hasActed,
      isRealPlayer: p.isRealPlayer,
    })),
  });
}

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

function createPlayer(
  id: PlayerId,
  isRealPlayer: boolean,
  initialChips: number = INITIAL_CHIPS,
): Player {
  return {
    id,
    chips: initialChips,
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
  smallBlind: number = SMALL_BLIND,
): GameState {
  const totalPlayers = realPlayerCount + botPlayerCount;
  const dealer: PlayerId = (Math.floor(Math.random() * totalPlayers) +
    1) as PlayerId;
  const initialChips = smallBlind * 200;
  const bigBlind = smallBlind * 2;

  const players: Player[] = [];
  for (let i = 0; i < totalPlayers; i++) {
    const playerId = (i + 1) as PlayerId;
    const isReal = i < realPlayerCount;
    players.push(createPlayer(playerId, isReal, initialChips));
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
    lastRaiseBet: bigBlind - smallBlind,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount,
    botPlayerCount,
    smallBlind,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

type GameAction =
  | {
      type: 'START_GAME';
      realPlayerCount: number;
      botPlayerCount: number;
      smallBlind: number;
      playerChips?: number[];
      playerBuyInCounts?: number[];
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
          const deck = shuffleDeck();
          const totalPlayers = action.realPlayerCount + action.botPlayerCount;
          const smallBlind = action.smallBlind;
          const bigBlind = smallBlind * 2;
          const initialChips = smallBlind * 200;

          const newPlayers: Player[] = [];
          for (let i = 0; i < totalPlayers; i++) {
            const playerId = (i + 1) as PlayerId;
            const isReal = i < action.realPlayerCount;
            newPlayers.push({
              ...createPlayer(playerId, isReal, initialChips),
              hand: [deck[i * 2], deck[i * 2 + 1]],
              chips:
                action.playerChips?.[i] ??
                initialChips,
              buyInCount: action.playerBuyInCounts?.[i] ?? state.players[i]?.buyInCount ?? 0,
            });
          }

          const communityCards = deck.slice(
            totalPlayers * 2,
            totalPlayers * 2 + 5,
          );
          const dealer =
            state.dealer ||
            ((Math.floor(Math.random() * totalPlayers) + 1) as PlayerId);

          const chipsAtRoundStartSnapshot = newPlayers.map(p => p.chips);

          const { smallBlind: sbIdx, bigBlind: bbIdx } = getBlindIndices(
            dealer,
            totalPlayers,
          );

          const sbAmount = Math.min(smallBlind, newPlayers[sbIdx].chips);
          newPlayers[sbIdx].bet = sbAmount;
          newPlayers[sbIdx].totalBet = sbAmount;
          newPlayers[sbIdx].chips -= sbAmount;

          const bbAmount = Math.min(bigBlind, newPlayers[bbIdx].chips);
          newPlayers[bbIdx].bet = bbAmount;
          newPlayers[bbIdx].totalBet = bbAmount;
          newPlayers[bbIdx].chips -= bbAmount;

          let nextPlayerIdx = (bbIdx + 1) % totalPlayers;
          while (newPlayers[nextPlayerIdx].folded) {
            nextPlayerIdx = (nextPlayerIdx + 1) % totalPlayers;
          }

          let lastRaiseBet: number;
          let raiseRightsOpened: boolean;

          if (bbAmount >= bigBlind) {
            lastRaiseBet = bbAmount - sbAmount;
            raiseRightsOpened = true;
          } else {
            lastRaiseBet = bigBlind - smallBlind;
            raiseRightsOpened = false;
          }

          const newState = {
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
            smallBlind,
            chipsAtRoundStart: chipsAtRoundStartSnapshot,
            chipsBeforeSettlement: [],
            potDistribution: [],
          } as GameState;
          logStateChange('START_GAME', newState);
          return newState;
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

              if (additional <= toCall || newBet <= state.lastBet) {
                return state;
              }

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

              const potCalculation = calculatePots(newPlayers, 0);
              newPot = potCalculation.mainPot;
              newSidePots.length = 0;  // 清空现有边池
              potCalculation.sidePots.forEach((sp) => {
                newSidePots.push({
                  id: newSidePots.length + 1,
                  amount: sp.amount,
                  contributions: sp.contributions,
                  eligiblePlayers: sp.eligiblePlayers,
                  level: sp.level,
                  threshold: sp.threshold,
                });
              });

              break;
            }
            case 'fold':
              actingPlayer.folded = true;
              actingPlayer.hasActed = true;
              break;
          }

          if (action.action === 'raise' || action.action === 'allin') {
            for (let i = 0; i < newPlayers.length; i++) {
              if (
                i !== playerIdx &&
                !newPlayers[i].folded &&
                !newPlayers[i].allIn &&
                newPlayers[i].chips > 0 &&
                newPlayers[i].bet < newLastBet
              ) {
                newPlayers[i].hasActed = false;
              }
            }
          }

          newPlayers[playerIdx] = {
            ...actingPlayer,
            lastAction: action.action,
          };

          if (action.action === 'fold') {
            const activePlayers = newPlayers.filter((p) => !p.folded);
            if (activePlayers.length === 1) {
              const winner = activePlayers[0].id;
              const totalPot = newPlayers.reduce((sum, p) => sum + p.totalBet, 0);
              const preChips = state.players.map(p => p.chips);
              const tempPlayers = newPlayers.map(p => ({ ...p, folded: false, bet: p.totalBet }));
              const potCalc = calculatePots(tempPlayers, 0);
              const contribs = computeContributions(tempPlayers, potCalc);
              const potDist: PotDistribution[] = [
                {
                  potType: '主池',
                  amount: potCalc.mainPot,
                  winnings: newPlayers.map(p => p.id === winner ? potCalc.mainPot : 0),
                  contributions: contribs.mainContributions,
                },
                ...potCalc.sidePots.map((sp, i) => ({
                  potType: `边池${i + 1}`,
                  amount: sp.amount,
                  winnings: newPlayers.map(p => p.id === winner ? sp.amount : 0),
                  contributions: contribs.sideContributions[i],
                })),
              ];
              if (totalPot > 0) {
                const winnerIdx = getPlayerIndex(winner);
                newPlayers[winnerIdx] = {
                  ...newPlayers[winnerIdx],
                  chips: newPlayers[winnerIdx].chips + totalPot,
                };
              }
              const newState = {
                ...state,
                players: newPlayers,
                mainPot: 0,
                sidePots: [],
                lastRaiseBet: newLastRaiseBet,
                raiseRightsOpened: newRaiseRightsOpened,
                winner,
                chipsBeforeSettlement: preChips,
                potDistribution: potDist,
              };
              logStateChange('PLAYER_ACTION', newState);
              return newState;
            }
          }

          const nextPlayer = getNextActivePlayer(state, newPlayers);
          if (!nextPlayer) {
            const activePlayers = newPlayers.filter((p) => !p.folded);
            if (activePlayers.length >= 2) {
              const newState = {
                ...state,
                players: newPlayers,
                mainPot: newPot,
                sidePots: newSidePots,
                lastBet: newLastBet,
                lastRaiseBet: newLastRaiseBet,
                raiseRightsOpened: newRaiseRightsOpened,
                currentPlayer: activePlayers[0].id,
              };
              logStateChange('PLAYER_ACTION', newState);
              return newState;
            }
            return state;
          }

          const newState = {
            ...state,
            players: newPlayers,
            mainPot: newPot,
            sidePots: newSidePots,
            lastBet: newLastBet,
            lastRaiseBet: newLastRaiseBet,
            raiseRightsOpened: newRaiseRightsOpened,
            currentPlayer: nextPlayer,
          };
          logStateChange('PLAYER_ACTION', newState);
          return newState;
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
            const totalPot = newPlayers.reduce((sum, p) => sum + p.totalBet, 0);
            const preChips = state.players.map(p => p.chips);
            let potDist: PotDistribution[] = [];
            if (winner !== null) {
              const tempPlayers = newPlayers.map(p => ({ ...p, folded: false, bet: p.totalBet }));
              const potCalc = calculatePots(tempPlayers, 0);
              const contribs = computeContributions(tempPlayers, potCalc);
              potDist = [
                {
                  potType: '主池',
                  amount: potCalc.mainPot,
                  winnings: newPlayers.map(p => p.id === winner ? potCalc.mainPot : 0),
                  contributions: contribs.mainContributions,
                },
                ...potCalc.sidePots.map((sp, i) => ({
                  potType: `边池${i + 1}`,
                  amount: sp.amount,
                  winnings: newPlayers.map(p => p.id === winner ? sp.amount : 0),
                  contributions: contribs.sideContributions[i],
                })),
              ];
            }
            if (totalPot > 0) {
              const winnerIdx = getPlayerIndex(winner);
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + totalPot,
              };
            }
            const newState = {
              ...state,
              players: newPlayers,
              mainPot: 0,
              sidePots: [],
              winner,
              chipsBeforeSettlement: preChips,
              potDistribution: potDist,
            };
            logStateChange('FOLD', newState);
            return newState;
          }

          const newState = { ...state, players: newPlayers };
          logStateChange('FOLD', newState);
          return newState;
        }

        case 'REVEAL_HAND': {
          const playerIdx = getPlayerIndex(action.player);
          if (playerIdx < 0 || playerIdx >= state.players.length) return state;

          const newPlayers = state.players.map((p, i) =>
            i === playerIdx ? { ...p, revealed: true } : p,
          );
          const newState = { ...state, players: newPlayers };
          logStateChange('REVEAL_HAND', newState);
          return newState;
        }

        case 'NEXT_STREET': {
          // 翻牌、转牌、河牌结束后，进入下一轮
          const newPlayers = state.players.map((p) => ({
            ...p,
            hasActed: false,
            bet: 0,
          }));

          let newPhase: GamePhase = state.phase;
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
            const preChips = state.players.map(p => p.chips);

            if (eligiblePlayers.length === 1) {
              const winner = eligiblePlayers[0].id;
              const winnerIdx = getPlayerIndex(winner);
              const tempPlayersForContrib = state.players.map(p => ({
                ...p, folded: false, bet: p.totalBet,
              }));
              const contribCalc = calculatePots(tempPlayersForContrib, 0);
              const contribsForSingle = computeContributions(tempPlayersForContrib, contribCalc);
              const potDist: PotDistribution[] = [{
                potType: '主池',
                amount: totalPot,
                winnings: state.players.map(p => p.id === winner ? totalPot : 0),
                contributions: contribsForSingle.mainContributions,
              }, ...contribCalc.sidePots.map((sp, i) => ({
                potType: `边池${i + 1}`,
                amount: sp.amount,
                winnings: state.players.map(() => 0),
                contributions: contribsForSingle.sideContributions[i],
              }))];
              newPlayers[winnerIdx] = {
                ...newPlayers[winnerIdx],
                chips: newPlayers[winnerIdx].chips + totalPot,
              };
              const newState = {
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
                chipsBeforeSettlement: preChips,
                potDistribution: potDist,
              };
              logStateChange('NEXT_STREET', newState);
              return newState;
            }

            if (eligiblePlayers.length === 0 || totalPot === 0) {
              const newState = {
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
                chipsBeforeSettlement: preChips,
                potDistribution: [],
              };
              logStateChange('NEXT_STREET', newState);
              return newState;
            }

            const tempPlayersForPot = state.players.map(p => ({
              ...p, folded: false, bet: p.totalBet,
            }));
            const correctPotCalc = calculatePots(tempPlayersForPot, 0);
            const contribs = computeContributions(tempPlayersForPot, correctPotCalc);

            const allPotLevels = [
              { amount: correctPotCalc.mainPot, threshold: 0, isMain: true },
              ...correctPotCalc.sidePots.map((sp, i) => ({
                amount: sp.amount,
                threshold: sp.threshold ?? 0,
                isMain: false,
                index: i,
              })),
            ];

            const allWinnings: number[][] = allPotLevels.map(() =>
              new Array(state.players.length).fill(0),
            );
            let bestRank: HandRank | null = null;
            const finalWinnerIds: PlayerId[] = [];

            allPotLevels.forEach((potLevel, potLevelIdx) => {
              let potEligible: Player[];
              if (potLevel.isMain) {
                potEligible = eligiblePlayers;
              } else {
                const spIndex = (potLevel as typeof potLevel & { index: number }).index;
                const threshold = correctPotCalc.sidePots[spIndex]?.threshold ?? 0;
                potEligible = eligiblePlayers.filter(p => p.totalBet >= threshold);
              }

              if (potEligible.length === 0) return;

              const potEvaluated = potEligible.map((p) => ({
                player: p,
                eval: evaluateHand(p.hand, state.communityCards),
              }));

              let potBestIdx = 0;
              for (let i = 1; i < potEvaluated.length; i++) {
                if (
                  compareHands(
                    potEvaluated[i].eval,
                    potEvaluated[potBestIdx].eval,
                  ) > 0
                ) {
                  potBestIdx = i;
                }
              }

              const potWinners = potEvaluated.filter(
                (e) =>
                  compareHands(e.eval, potEvaluated[potBestIdx].eval) === 0,
              );

              if (potLevel.isMain && bestRank === null) {
                bestRank = potEvaluated[potBestIdx].eval.rank;
                finalWinnerIds.push(...potWinners.map(w => w.player.id));
              }

              const potAmount = potLevel.amount;
              if (potWinners.length === 1) {
                const winnerIdx = getPlayerIndex(potWinners[0].player.id);
                allWinnings[potLevelIdx][winnerIdx] += potAmount;
                newPlayers[winnerIdx] = {
                  ...newPlayers[winnerIdx],
                  chips: newPlayers[winnerIdx].chips + potAmount,
                };
              } else if (potWinners.length > 1) {
                const each = Math.floor(potAmount / potWinners.length);
                potWinners.forEach((w) => {
                  const idx = getPlayerIndex(w.player.id);
                  allWinnings[potLevelIdx][idx] += each;
                  newPlayers[idx] = {
                    ...newPlayers[idx],
                    chips: newPlayers[idx].chips + each,
                  };
                });
                const remainder = potAmount - each * potWinners.length;
                if (remainder > 0) {
                  const firstIdx = getPlayerIndex(potWinners[0].player.id);
                  allWinnings[potLevelIdx][firstIdx] += remainder;
                  newPlayers[firstIdx].chips += remainder;
                }
              }
            });

            const potDist: PotDistribution[] = [
              {
                potType: '主池',
                amount: correctPotCalc.mainPot,
                winnings: allWinnings[0],
                contributions: contribs.mainContributions,
              },
              ...correctPotCalc.sidePots.map((sp, i) => ({
                potType: `边池${i + 1}`,
                amount: sp.amount,
                winnings: allWinnings[i + 1],
                contributions: contribs.sideContributions[i],
              })),
            ];

            const uniqueWinnerIds = [...new Set(finalWinnerIds)];
            const newState = {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.dealer,
              lastBet: 0,
              lastRaiseBet: 0,
              raiseRightsOpened: true,
              mainPot: 0,
              sidePots: [],
              winner: uniqueWinnerIds.length === 1 ? uniqueWinnerIds[0] : null,
              handRank: bestRank,
              chipsBeforeSettlement: preChips,
              potDistribution: potDist,
            };
            logStateChange('NEXT_STREET', newState);
            return newState;
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
            const newState = {
              ...state,
              phase: newPhase,
              players: newPlayers,
              currentPlayer: state.currentPlayer,
              lastBet: 0,
              lastRaiseBet: 0,
              raiseRightsOpened: true,
            };
            logStateChange('NEXT_STREET', newState);
            return newState;
          }

          const newState = {
            ...state,
            phase: newPhase,
            players: newPlayers,
            currentPlayer: newPlayers[nextPlayerIdx].id,
            lastBet: 0,
            lastRaiseBet: 0,
            raiseRightsOpened: true,
          };
          logStateChange('NEXT_STREET', newState);
          return newState;
        }

        case 'COLLECT_POT': {
          if (state.mainPot <= 0 || state.winner !== null) return state;
          const winnerIdx = getPlayerIndex(action.winner);
          if (winnerIdx < 0 || winnerIdx >= state.players.length) return state;

          const totalWinnings =
            state.mainPot +
            state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
          const preChips = state.players.map(p => p.chips);
          const tempPlayersForContrib = state.players.map(p => ({
            ...p, folded: false, bet: p.totalBet,
          }));
          const contribCalc = calculatePots(tempPlayersForContrib, 0);
          const contribs = computeContributions(tempPlayersForContrib, contribCalc);
          const potDist: PotDistribution[] = [{
            potType: '主池',
            amount: totalWinnings,
            winnings: state.players.map(p => p.id === action.winner ? totalWinnings : 0),
            contributions: contribs.mainContributions,
          }, ...contribCalc.sidePots.map((sp, i) => ({
            potType: `边池${i + 1}`,
            amount: sp.amount,
            winnings: state.players.map(() => 0),
            contributions: contribs.sideContributions[i],
          }))];
          const newPlayers = state.players.map((p, i) =>
            i === winnerIdx ? { ...p, chips: p.chips + totalWinnings } : p,
          );
          const newState = {
            ...state,
            players: newPlayers,
            mainPot: 0,
            sidePots: [],
            lastRaiseBet: 0,
            raiseRightsOpened: true,
            winner: action.winner,
            chipsBeforeSettlement: preChips,
            potDistribution: potDist,
          };
          logStateChange('COLLECT_POT', newState);
          return newState;
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
          const preChips = state.players.map(p => p.chips);
          const splitWinnings = new Array(state.players.length).fill(0);
          const newPlayers = state.players.map((p, i) => {
            if (p.folded || p.totalBet === 0) return p;
            splitWinnings[i] = each;
            return { ...p, chips: p.chips + each };
          });
          const remainder = totalPot - each * activePlayers.length;
          if (remainder > 0 && newPlayers[0]) {
            newPlayers[0].chips += remainder;
            splitWinnings[0] += remainder;
          }
          const tempPlayersForContrib = state.players.map(p => ({
            ...p, folded: false, bet: p.totalBet,
          }));
          const contribCalc = calculatePots(tempPlayersForContrib, 0);
          const contribs = computeContributions(tempPlayersForContrib, contribCalc);
          const potDist: PotDistribution[] = [{
            potType: '主池',
            amount: totalPot,
            winnings: splitWinnings,
            contributions: contribs.mainContributions,
          }, ...contribCalc.sidePots.map((sp, i) => ({
            potType: `边池${i + 1}`,
            amount: sp.amount,
            winnings: state.players.map(() => 0),
            contributions: contribs.sideContributions[i],
          }))];
          const newState = {
            ...state,
            players: newPlayers,
            mainPot: 0,
            sidePots: [],
            lastRaiseBet: 0,
            raiseRightsOpened: true,
            winner: null,
            chipsBeforeSettlement: preChips,
            potDistribution: potDist,
          };
          logStateChange('SPLIT_POT', newState);
          return newState;
        }

        case 'RESET_ROUND': {
          const newDealer = ((state.dealer % state.players.length) +
            1) as PlayerId;
          const resetInitialChips = (state.smallBlind || SMALL_BLIND) * 200;
          const newPlayers = state.players.map((p, index) => ({
            ...p,
            chips: p.chips > 0 ? p.chips : p.chips + resetInitialChips,
            buyInCount: p.chips > 0 ? p.buyInCount : p.buyInCount + 1,
            bet: 0,
            totalBet: 0,
            hand: [],
            hasActed: false,
            folded: false,
            revealed: false,
            lastAction: undefined,
            isRealPlayer: index < state.realPlayerCount,
          }));
          const newState = {
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
            smallBlind: state.smallBlind || SMALL_BLIND,
            chipsAtRoundStart: [],
            chipsBeforeSettlement: [],
            potDistribution: [],
          } as GameState;
          logStateChange('RESET_ROUND', newState);
          return newState;
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
      smallBlind: number,
      playerChips?: number[],
      playerBuyInCounts?: number[],
    ) => {
      dispatch({
        type: 'START_GAME',
        realPlayerCount,
        botPlayerCount,
        smallBlind,
        playerChips,
        playerBuyInCounts,
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
    resetOpponentStats();
    const resetInitialChips = (state.smallBlind || SMALL_BLIND) * 200;
    const resetChips = state.players.map(
      (p) => (p.chips > 0 ? p.chips : p.chips + resetInitialChips),
    );
    dispatch({ type: 'RESET_ROUND' });
    setTimeout(() => {
      dispatch({
        type: 'START_GAME',
        realPlayerCount: state.realPlayerCount,
        botPlayerCount: state.botPlayerCount,
        smallBlind: state.smallBlind || SMALL_BLIND,
        playerChips: resetChips,
      });
    }, 0);
  }, [state.realPlayerCount, state.botPlayerCount, state.smallBlind, state.players]);

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
