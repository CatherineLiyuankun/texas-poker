export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type PlayerId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type HandRank =
  | 'high_card'
  | 'pair'
  | 'two_pair'
  | 'three_of_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_kind'
  | 'straight_flush'
  | 'royal_flush';

export type GamePhase =
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'ended';
export type Action = 'check' | 'call' | 'raise' | 'fold' | 'allin';

export interface Player {
  id: PlayerId;
  chips: number; // 玩家当前筹码数量
  bet: number; // 记录玩家在当前轮的下注金额
  totalBet: number; // 记录玩家在当前局的总下注金额
  isRealPlayer: boolean; // 是否是真人玩家（true）还是电脑玩家（false）
  hand: Card[]; // 玩家手牌
  lastAction?: Action; // 记录玩家上一次的行动（check、call、raise、fold、allin）
  buyInCount: number; // 记录玩家买入筹码次数，每次购买1000筹码
  revealed: boolean; // 记录玩家是否已经看牌
  hasActed: boolean; // 记录玩家在当前轮是否已经行动过
  folded: boolean; // 弃牌
  allIn: boolean; // all-in状态
}

export interface SidePot {
  id: number;
  amount: number;
  contributions: Partial<Record<PlayerId, number>>;
  eligiblePlayers: PlayerId[];
  level?: number;
  threshold?: number;
}

/**
 * 翻前一次**已被状态机接受**的自愿投入（按发生顺序）。
 *
 * 强制盲注不入链（盲注不是「开池」）；跟注式全下按 `call` 记（不是 raise）。
 * 场景判定（`detectPreflopScenario`）只读这条链，不再用 `lastBet > player.bet`
 * 或「不同 bet 值个数」猜历史 —— 那些金额口径在多人先后行动、同额加注、
 * 短全下重开等局面上都会判错。
 */
export interface PreflopEntry {
  playerId: PlayerId;
  /** `raise` = 主动加注（含加注式全下）；`call` = 自愿跟注/跛入。 */
  kind: 'raise' | 'call';
  /** 仅 `kind === 'raise'` 有意义：增量是否达到完整加注（重开加注权）。 */
  fullRaise?: boolean;
}

export interface PotDistribution {
  potType: string;
  amount: number;
  winnings: number[];
  contributions: number[];
}

export interface GameState {
  phase: GamePhase;
  mainPot: number;
  sidePots: SidePot[];
  communityCards: Card[];
  players: Player[];
  currentPlayer: PlayerId;
  dealer: PlayerId;
  lastBet: number;
  lastRaiseBet: number;
  raiseRightsOpened: boolean;
  /**
   * 翻前已被状态机接受的自愿投入链（按发生顺序，见 `PreflopEntry`）。
   *
   * 生产路径从 `START_GAME` 起总会填充；缺失（旧存档、手工构造的状态）时
   * 场景判定回退到旧的金额口径 —— 那是**不可信**的兼容分支。
   */
  preflopChain?: PreflopEntry[];
  winner: PlayerId | null;
  handRank: HandRank | null;
  winningCards: Card[];
  realPlayerCount: number;
  botPlayerCount: number;
  smallBlind: number;
  chipsAtRoundStart: number[];
  chipsBeforeSettlement: number[];
  potDistribution: PotDistribution[];
}

export const RANK_ORDER: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const HAND_RANK_ORDER: Record<HandRank, number> = {
  high_card: 1,
  pair: 2,
  two_pair: 3,
  three_of_kind: 4,
  straight: 5,
  flush: 6,
  full_house: 7,
  four_of_kind: 8,
  straight_flush: 9,
  royal_flush: 10,
};

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  high_card: '高牌 High Card',
  pair: '一对 Pair',
  two_pair: '两对 Two Pair',
  three_of_kind: '三条 Three of a Kind',
  straight: '顺子 Straight',
  flush: '同花 Flush',
  full_house: '葫芦 Full House',
  four_of_kind: '四条 Four of a Kind',
  straight_flush: '同花顺 Straight Flush',
  royal_flush: '皇家同花顺 Royal Flush',
};
