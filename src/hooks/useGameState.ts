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
import type { BotPersonality, BotTypeMap } from '../utils/botPersonality';

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
  botType?: BotPersonality,
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
    botType,
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
    // 未开局：关闭性格、空 map（真正的新盘分配由 START_GAME 写入）
    botPersonalityEnabled: false,
    botTypes: {},
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
      /** 本盘是否启用 Bot 性格（新盘配置 / 恢复时确定）。 */
      botPersonalityEnabled?: boolean;
      /** 有效分配 map；关闭或缺省时视为空。 */
      botTypes?: BotTypeMap;
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

/** 加注候选（**本次追加筹码**，不是 raise-to）的合法化输入。 */
export interface RaiseLegalizationInput {
  /** 原始候选追加额，可能来自缩放/外部输入，允许非整数或非法值。 */
  rawAdditional: number;
  /** 玩家本轮已投入的筹码。 */
  playerBet: number;
  /** 玩家剩余筹码。 */
  playerChips: number;
  /** 本轮当前最高投入。 */
  lastBet: number;
  /** 上一次完整加注的增量，用于判定最小全额加注。 */
  lastRaiseBet: number;
  /** 本轮加注权是否开放（未重开时不得再加注）。 */
  raiseRightsOpened: boolean;
  /** 是否还有能继续下注的对手（无人可应时不得加注）。 */
  hasLiveOpponent: boolean;
}

export type RaiseLegalization =
  | { kind: 'reject' }
  | {
      kind: 'raise';
      /** 合法化后的整数追加筹码（已按筹码上限截断）。 */
      additional: number;
      /** 是否把全部剩余筹码打光。 */
      allIn: boolean;
      /** 是否构成一次完整加注（增量 ≥ 上一次加注增量）。 */
      fullRaise: boolean;
    };

/**
 * 加注金额的**最终合法化层**：把「本次追加筹码」候选收敛成合法动作或拒绝。
 *
 * 规则（对应方案 §7.4）：
 * - 候选必须有限且为正 —— `NaN` / `Infinity` / `0` / 负数一律拒绝；
 * - 加注权未开放、或无人可应（对手全弃/全下/无筹码）时不得加注；
 * - 取整数筹码单位（向下取整）；超过剩余筹码则按**合法全下**截断；
 * - 加注必须超过跟注额；增量不足最小全额加注时，只有「打光筹码」才合法（短全下）。
 *
 * 返回 `{ kind: 'reject' }` 时调用方必须拒绝该动作，且**不得记录统计事件**。
 */
export function legalizeRaise(
  input: RaiseLegalizationInput,
): RaiseLegalization {
  const {
    rawAdditional,
    playerBet,
    playerChips,
    lastBet,
    lastRaiseBet,
    raiseRightsOpened,
    hasLiveOpponent: liveOpponent,
  } = input;

  if (!Number.isFinite(rawAdditional) || rawAdditional <= 0) {
    return { kind: 'reject' };
  }
  if (!raiseRightsOpened || !liveOpponent) {
    return { kind: 'reject' };
  }

  const toCall = Math.max(0, lastBet - playerBet);
  let additional = Math.floor(rawAdditional);
  let allIn = false;

  // 超筹码候选按合法全下处理（截断到剩余筹码）。
  if (additional >= playerChips) {
    additional = Math.max(0, playerChips);
    allIn = true;
  }

  // 连跟注都补不上 → 不是加注（调用方应改走 call / allin）。
  if (additional <= toCall) {
    return { kind: 'reject' };
  }

  const raiseIncrement = additional - toCall;
  const fullRaise = raiseIncrement >= lastRaiseBet;
  // 增量不足最小全额加注，且不是全下 → 非法欠注加注。
  if (!fullRaise && !allIn) {
    return { kind: 'reject' };
  }

  return { kind: 'raise', additional, allIn, fullRaise };
}

/**
 * 是否还有「能继续下注」的对手 —— 已弃牌 / 已全下 / 没筹码的对手都下不了注，
 * 对他们加注**无人可应**（多下的筹码只会原样退回）。
 * `canPlayerAct` / `legalizeRaise` / `isActionAccepted` 共用同一口径。
 */
function hasLiveOpponent(state: GameState, playerId: PlayerId): boolean {
  return state.players.some(
    (p) => p.id !== playerId && !p.folded && !p.allIn && p.chips > 0,
  );
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

/**
 * 一次玩家动作在当前状态是否会被 reducer 接受 —— **唯一**的接受口径。
 *
 * reducer 用它决定收不收，`GameBoard` 用它决定记不记统计事件，保证
 * 「被接受的动作」与「记录的事件」一一对应（方案 §7.4：reducer 拒绝动作时
 * 不能仍记一条统计事件）。任何一处放宽/收紧都必须同时改这里，避免口径漂移。
 */
export function isActionAccepted(
  state: GameState,
  player: PlayerId,
  action: Action,
  amount?: number,
): boolean {
  const idx = getPlayerIndex(player);
  if (idx < 0 || idx >= state.players.length) return false;
  const p = state.players[idx];
  if (p.folded || p.allIn) return false;

  const toCall = Math.max(0, state.lastBet - p.bet);

  switch (action) {
    case 'check':
      // 面对下注不能过牌。
      return toCall === 0;
    case 'call':
      // 跟注都不够时只能弃牌或全押（`toCall === 0` 等价于过牌，沿用旧语义放行）。
      return toCall <= p.chips;
    case 'fold':
      return true;
    case 'allin':
      return p.chips > 0;
    case 'raise':
      if (bettingComplete(state)) return false;
      return (
        legalizeRaise({
          rawAdditional: amount ?? 0,
          playerBet: p.bet,
          playerChips: p.chips,
          lastBet: state.lastBet,
          lastRaiseBet: state.lastRaiseBet,
          raiseRightsOpened: state.raiseRightsOpened,
          hasLiveOpponent: hasLiveOpponent(state, player),
        }).kind === 'raise'
      );
    default:
      return false;
  }
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
            // `Player.botType` 是有效 map 的派生视图：真人绝不赋；关闭性格时为 undefined。
            const botType =
              isReal || action.botPersonalityEnabled !== true
                ? undefined
                : action.botTypes?.[playerId];
            newPlayers.push({
              ...createPlayer(playerId, isReal, initialChips, botType),
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
            // 有效开关 / map 显式写入 state（盘内只读，见决策 35）；**关闭时 map 必为空**，
            // 不保留任何残留类型（方案 §6.1「关闭时有效 map 为空」/ §6.2「不能偷偷传 persona」）。
            botPersonalityEnabled: action.botPersonalityEnabled === true,
            botTypes: action.botPersonalityEnabled === true ? (action.botTypes ?? {}) : {},
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
          // 已弃牌 / 已全下的玩家不能再行动（全下玩家的行动机会本就被
          // `getNextActivePlayer` 排除，这里兜底防止外部误派发污染状态）。
          if (player.folded || player.allIn) return state;

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
            case 'check': {
              // 面对下注不能过牌（非法动作直接拒绝，且不记事件）。
              const checkToCall = Math.max(0, state.lastBet - player.bet);
              if (checkToCall > 0) return state;
              actingPlayer.hasActed = true;
              if (actingPlayer.chips === 0) {
                actingPlayer.allIn = true;
              }
              break;
            }
            case 'call': {
              const toCall = Math.max(0, state.lastBet - player.bet);
              // 跟注都不够时不能跟（只能弃牌或全押），否则筹码会被扣成负数。
              if (toCall > player.chips) return state;
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
              // 金额的最终合法化：finite / 整数 / 非负 / 筹码上限 / 最小全额加注 /
              // 加注权 / 无人可应，全部在这里一次性校验（方案 §7.4）。
              const legal = legalizeRaise({
                rawAdditional: action.amount ?? 0,
                playerBet: player.bet,
                playerChips: player.chips,
                lastBet: state.lastBet,
                lastRaiseBet: state.lastRaiseBet,
                raiseRightsOpened: state.raiseRightsOpened,
                hasLiveOpponent: hasLiveOpponent(state, action.player),
              });
              if (legal.kind === 'reject') return state;

              const { additional, allIn, fullRaise } = legal;
              const toCall = Math.max(0, state.lastBet - player.bet);
              const newBet = player.bet + additional;

              // 增量是否达到完整加注（≥ 上一加注增量）决定是否重开加注权
              pushPreflopEntry({
                playerId: action.player,
                kind: 'raise',
                fullRaise,
              });

              actingPlayer.bet += additional;
              actingPlayer.totalBet += additional;
              actingPlayer.chips -= additional;
              if (allIn || actingPlayer.chips === 0) {
                actingPlayer.allIn = true;
              }
              actingPlayer.hasActed = true;

              if (fullRaise) {
                if (state.lastRaiseBet === 0 && state.lastBet === 0) {
                  newLastRaiseBet = newBet;
                } else {
                  newLastRaiseBet = additional - toCall;
                }
                newRaiseRightsOpened = true;
              } else {
                // 短全下（打光筹码但增量不足）：不构成完整加注，不重开加注权。
                newLastRaiseBet = state.lastRaiseBet;
                newRaiseRightsOpened = false;
              }

              newLastBet = Math.max(newLastBet, newBet);
              newPot += additional;
              break;
            }
            case 'allin': {
              const allInAmount = actingPlayer.chips;
              // 没有筹码不能全押（正常不会被派发到，兜底防污染）。
              if (allInAmount <= 0) return state;
              const toCall = Math.max(0, state.lastBet - player.bet);
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
            // 下一手**完整继承**本盘分配（决策 35：盘内只读），重新派生视图
            botType: state.botPersonalityEnabled ? state.botTypes?.[p.id] : undefined,
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
            // 下一手继承有效开关 / map（不得先丢 map 再指望 START 从旧 state 取回）
            botPersonalityEnabled: state.botPersonalityEnabled,
            botTypes: state.botTypes,
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
      botPersonalityEnabled?: boolean,
      botTypes?: BotTypeMap,
    ) => {
      dispatch({
        type: 'START_GAME',
        realPlayerCount,
        botPlayerCount,
        smallBlind,
        playerChips,
        playerBuyInCounts,
        botPersonalityEnabled,
        botTypes,
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
    // 会话画像按**盘**累积（决策 40）：开下一手时**不再**清空统计，
    // 由 GameBoard 的 `startNewHand` 把上一手归档进 `sessionHands` 再开新的一手。
    // 清空只发生在「开新盘」（GameBoard 初始挂载 / 牌桌内开新局按钮）。
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
        // 下一手继承本盘的有效开关 / map（重新派生 Player.botType，不重抽）
        botPersonalityEnabled: latest.botPersonalityEnabled,
        botTypes: latest.botTypes,
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
      const liveOpponent = hasLiveOpponent(state, playerId);
      const toCall = state.lastBet - player.bet;

      switch (action) {
        case 'check':
          return canCheck(state.lastBet, player.bet);
        case 'call':
          return canCall(state.lastBet, player.bet, player.chips);
        case 'raise':
          return liveOpponent && canRaise(
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
          return canAllIn(player.chips) && (liveOpponent || toCall > player.chips);
        default:
          return false;
      }
    },
    [state],
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
