import { useReducer, useCallback, useRef, useEffect } from 'react';
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
  PreflopEntry,
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
    preflopChain: [],
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

/**
 * 本轮下注是否已经结束 —— **全仓唯一**的判定，reducer 与 `GameBoard` 共用。
 *
 * 以前这个语义有两份各写各的实现：reducer 侧一份（用来拦加注）、`GameBoard` 侧
 * 一份（用来放行机器人 / 亮真人按钮 / 推进街道）。两份口径不同，遇到「盲注打光
 * 筹码的被动 all-in」时一份判 `true`、一份判 `false` —— 加注被静默吞掉、按钮却
 * 还亮着、街道也不推进，真人就卡死在那里（见 `docs/PASSIVE_ALLIN_PLAN.md`）。
 * 收敛到一处之后不会再漂移。
 */
export function bettingComplete(state: GameState): boolean {
  const activePlayers = state.players.filter((p) => !p.folded);
  const canActPlayers = activePlayers.filter((p) => !p.allIn && p.chips > 0);

  // 没人还能下注（只剩一个未弃牌者 / 全下 / 没筹码）→ 本轮无从下注。
  if (activePlayers.length <= 1 || canActPlayers.length === 0) return true;

  // 只剩一个人能下注、且他不欠跟注 → **无人可应**（对手都全下了）。
  // 此时让他下注没有意义（没人跟得起，多下的筹码只会原样退回），本轮直接结束，
  // 跑完公共牌去摊牌。他若还欠跟注（`bet < lastBet`）则不在此列：仍须跟注或弃牌。
  if (canActPlayers.length === 1 && canActPlayers[0].bet >= state.lastBet) {
    return true;
  }

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
            const carriedChips = action.playerChips?.[i] ?? initialChips;
            const carriedBuyInCount =
              action.playerBuyInCounts?.[i] ?? state.players[i]?.buyInCount ?? 0;
            // 0 筹码玩家不能被发牌：现金局须先补码（比赛则等于淘汰）。
            // 本局统一在开局前自动补码，避免带 0 筹码入局，
            // 同时兜住 resetRound 中 setTimeout 读到旧 state 的竞态。
            const needsRebuy = carriedChips <= 0;
            newPlayers.push({
              ...createPlayer(playerId, isReal, initialChips),
              hand: [deck[i * 2], deck[i * 2 + 1]],
              chips: needsRebuy ? initialChips : carriedChips,
              buyInCount: needsRebuy
                ? carriedBuyInCount + 1
                : carriedBuyInCount,
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
          // 盲注把筹码打光 = **被动 all-in**：和 call/raise 分支同口径，把 allIn 一并置位。
          // 漏了这一步会留下 `chips === 0 && allIn === false` 的畸形态 —— 座位标签会
          // 显示「Waiting」，且 `bettingComplete` 的 `(allIn || chips > 0)` 两头都不满足，
          // 把该玩家排除出「本轮还有人下注」的判定（见 docs/PASSIVE_ALLIN_PLAN.md）。
          // `hasActed` 保持 false：下盲注不算行动；置位 allIn 后该玩家本就被排除在
          // `canActPlayers` 之外，`hasActed` 不再被读。
          if (newPlayers[sbIdx].chips === 0) newPlayers[sbIdx].allIn = true;

          const bbAmount = Math.min(bigBlind, newPlayers[bbIdx].chips);
          newPlayers[bbIdx].bet = bbAmount;
          newPlayers[bbIdx].totalBet = bbAmount;
          newPlayers[bbIdx].chips -= bbAmount;
          if (newPlayers[bbIdx].chips === 0) newPlayers[bbIdx].allIn = true;

          let nextPlayerIdx = (bbIdx + 1) % totalPlayers;
          while (newPlayers[nextPlayerIdx].folded) {
            nextPlayerIdx = (nextPlayerIdx + 1) % totalPlayers;
          }

          let lastRaiseBet: number;

          // 大盲筹码不足时，bring-in（最低下注额）不降低：其他人仍须按完整大盲跟注，
          // 加注权保持开放，加注者至少加注到 2×大盲（Robert's Rules Sec.4 / Sec.14）。
          const raiseRightsOpened = true;

          if (bbAmount >= bigBlind) {
            lastRaiseBet = bbAmount - sbAmount;
          } else {
            lastRaiseBet = bigBlind - smallBlind;
          }

          const newState = {
            phase: 'preflop',
            mainPot: sbAmount + bbAmount,
            sidePots: [],
            communityCards,
            players: newPlayers,
            currentPlayer: newPlayers[nextPlayerIdx].id,
            dealer: dealer,
            lastBet: bigBlind,
            lastRaiseBet,
            raiseRightsOpened,
            // 盲注不入链：链里只有「已被接受的自愿加注/跟注」。
            preflopChain: [],
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
          // 本轮下注一旦结束，就不能再有人加注。
          // 否则在街道推进的动画间隙里，最后一个行动者（翻前通常是机器人大盲）
          // 会再次加注，把其他人的 hasActed 重新清空、逼他们再跟一圈，
          // 来回拉锯形成死循环。这里是最后一道权威防线 —— UI 侧还会在回合
          // 结束时同时关掉机器人行动与真人按钮（见 GameBoard.bettingRoundComplete）。
          if (bettingComplete(state) && action.action === 'raise') {
            return state;
          }

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

          // 翻前自愿投入链：只记**已被接受**的自愿加注/跟注（盲注不入链、
          // 跟注式全下按跟注记）。场景判定只读这条链，见 `PreflopEntry`。
          let newPreflopChain = state.preflopChain;
          const pushPreflopEntry = (entry: PreflopEntry) => {
            if (state.phase !== 'preflop') return;
            newPreflopChain = [...(newPreflopChain ?? []), entry];
          };

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
              // 自愿跟注/跛入（toCall === 0 是过牌，不算入池）
              if (toCall > 0) {
                pushPreflopEntry({ playerId: action.player, kind: 'call' });
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

              // 增量是否达到完整加注（≥ 上一加注增量）决定是否重开加注权
              pushPreflopEntry({
                playerId: action.player,
                kind: 'raise',
                fullRaise: additional - toCall >= state.lastRaiseBet,
              });

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

              // 加注式全下（增量 > 0）是 raise（短全下 `fullRaise=false`，不重开）；
              // 跟注式全下按 call 记 —— 与 `isPreflopRaise` / AF 的 all-in 口径一致。
              pushPreflopEntry(
                extraAmount > 0
                  ? {
                      playerId: action.player,
                      kind: 'raise',
                      fullRaise: extraAmount >= state.lastRaiseBet,
                    }
                  : { playerId: action.player, kind: 'call' },
              );

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
                preflopChain: newPreflopChain,
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
            preflopChain: newPreflopChain,
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
            preflopChain: [],
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

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

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
    dispatch({ type: 'RESET_ROUND' });
    setTimeout(() => {
      const latest = stateRef.current;
      dispatch({
        type: 'START_GAME',
        realPlayerCount: latest.realPlayerCount,
        botPlayerCount: latest.botPlayerCount,
        smallBlind: latest.smallBlind || SMALL_BLIND,
        playerChips: latest.players.map(p => p.chips),
        playerBuyInCounts: latest.players.map(p => p.buyInCount),
      });
    }, 0);
  }, []);

  const fold = useCallback((player: PlayerId) => {
    dispatch({ type: 'FOLD', player });
  }, []);

  const canPlayerAct = useCallback(
    (playerId: PlayerId, action: Action): boolean => {
      const player = state.players[getPlayerIndex(playerId)];
      if (!player || player.folded || player.allIn) return false;

      // 还有没有「能继续下注」的对手。已弃牌 / 已全下 / 没筹码的对手都下不了注，
      // 对他们加注**无人可应**（多下的筹码只会原样退回），所以不该亮加注/全押按钮。
      const hasLiveOpponent = state.players.some(
        (p) => p.id !== playerId && !p.folded && !p.allIn && p.chips > 0,
      );
      const toCall = state.lastBet - player.bet;

      switch (action) {
        case 'check':
          return canCheck(state.lastBet, player.bet);
        case 'call':
          return canCall(state.lastBet, player.bet, player.chips);
        case 'raise':
          return hasLiveOpponent && canRaise(
            state.lastBet,
            player.bet,
            player.chips,
            state.lastRaiseBet,
            state.raiseRightsOpened,
          );
        case 'fold':
          return canFold(state.lastBet, player.bet);
        case 'allin':
          // 无人可应时，全押只在「跟注都不够」时才有意义（短筹码跟注）；
          // 否则它等同于一次没人跟得起的加注。注意 `canCall` 要求
          // `toCall <= chips`，所以这条例外不能删 —— 删了筹码不够跟注的玩家
          // 将既不能跟注也不能全押，只能弃牌。
          return canAllIn(player.chips) && (hasLiveOpponent || toCall > player.chips);
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
