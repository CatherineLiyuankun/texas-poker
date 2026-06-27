import type { PlayerId, Action, GamePhase } from './poker';

export interface ActionEvent {
  handId: string;
  playerId: PlayerId;
  phase: GamePhase;
  action: Action;
  amount?: number;
  toCall: number;
  currentBet: number;
  potSize: number;
  position: number;
  isFacingRaise: boolean;
  timestamp: number;
}

export interface HandRecord {
  handId: string;
  timestamp: number;
  events: ActionEvent[];
  players: PlayerId[];
  result?: {
    winner: PlayerId | null;
    potAmount: number;
  };
}
