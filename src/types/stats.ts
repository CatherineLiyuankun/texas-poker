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
  /**
   * 翻牌**实际发出时**仍未弃牌的参与者（含翻前 all-in 后无动作的 runout）。
   *
   * 必须在翻牌发出那一刻冻结，不能从「个人是否有 flop 动作」推断 ——
   * 翻前 all-in 的玩家不会再行动，却真实看到了翻牌。缺失时由统计侧回退到
   * 旧口径（本人有翻后动作才算看翻牌），仅影响历史记录。
   */
  flopSeenPlayers?: PlayerId[];
  /** 真正进入摊牌的参与者（非提前 reveal）。 */
  showdownPlayers?: PlayerId[];
  /**
   * 摊牌中从任意奖池获得 **> 0** 份额的玩家（含平分与边池）。
   *
   * 单个 `result.winner` 无法表达多赢家/边池；缺失时统计侧回退到 `result.winner`。
   */
  showdownWinners?: PlayerId[];
  result?: {
    winner: PlayerId | null;
    potAmount: number;
  };
}
