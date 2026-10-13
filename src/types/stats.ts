import type { PlayerId, Action, GamePhase } from './poker';
import type { BotTypeMap } from '../utils/botPersonality';

/** 开手时的座位身份（方案 §8.2 `playerRoles`）。 */
export type PlayerRole = 'human' | 'bot';

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
   * 开手时的**分配快照**（座位 → 性格），决定长期聚合分组（方案 §8.1/§8.2）。
   *
   * 必须在**开手那一刻**从有效分配 map 复制一份（不引用随后可变对象）；
   * 关闭性格时为空对象。开手后不得再改 —— 与 `PlayerStats.playerType`
   * （实测分类）是两种不可混淆的身份：分配 TAG 但实测 Fish 的样本仍留在 TAG 组。
   *
   * 缺失表示**旧记录**（本次改动之前写入），聚合侧按 §8.3 归入 Bot Unknown。
   */
  playerTypes?: BotTypeMap;
  /**
   * 开手时的座位身份（`human` / `bot`），用于历史身份（方案 §8.2）。
   *
   * 不能从「当前 roles」反推 —— 中途换人/换盘会把历史身份改错。
   * 缺失表示旧记录。
   */
  playerRoles?: Partial<Record<PlayerId, PlayerRole>>;
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
