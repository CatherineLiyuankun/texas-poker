export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type PlayerId = 1 | 2;

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

export type GamePhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended';
export type Action = 'check' | 'call' | 'raise' | 'fold';

export interface Player {
  id: PlayerId;
  chips: number;
  bet: number;
  hand: Card[];
  hasActed: boolean;
  folded: boolean;
  revealed: boolean;
}

export interface GameState {
  phase: GamePhase;
  pot: number;
  communityCards: Card[];
  players: [Player, Player];
  currentPlayer: PlayerId;
  dealer: PlayerId;
  lastBet: number;
  winner: PlayerId | null;
  handRank: HandRank | null;
  winningCards: Card[];

}

export const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export const HAND_RANK_ORDER: Record<HandRank, number> = {
  'high_card': 1,
  'pair': 2,
  'two_pair': 3,
  'three_of_kind': 4,
  'straight': 5,
  'flush': 6,
  'full_house': 7,
  'four_of_kind': 8,
  'straight_flush': 9,
  'royal_flush': 10
};

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  'high_card': '高牌',
  'pair': '一对',
  'two_pair': '两对',
  'three_of_kind': '三条',
  'straight': '顺子',
  'flush': '同花',
  'full_house': '葫芦',
  'four_of_kind': '四条',
  'straight_flush': '同花顺',
  'royal_flush': '皇家同花顺'
};
