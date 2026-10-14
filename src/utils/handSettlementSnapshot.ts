import type { ActionEvent } from '../types/stats';
import type { GameState, PlayerId } from '../types/poker';

/**
 * 一手结算时要冻结进 `HandRecord` 的**三份事实快照** + 底池金额（方案 §8.2 / §9.2）。
 *
 * 为什么单独抽成模块：这三份快照原先只写在 `GameBoard` 的结算 effect 里，而
 * `scripts/` 下的 headless 校准 runner 需要**同一份**事实来喂 `computeTypeStats`
 * / `computePlayerStatsFromEvents`。复制一份逻辑过去就等于埋下「两处口径漂移」的
 * 种子 —— 统计数字与面板显示会悄悄对不上（正是方案 §9.3 要防的）。
 */
export interface SettlementSnapshot {
  /**
   * 翻牌**实际发出时**仍未弃牌的参与者（含翻前 all-in 后无动作的 runout）。
   *
   * 不能用「本人是否有翻后动作」推断 —— 翻前 all-in 的玩家不会再行动，却真实
   * 看到了翻牌。WTSD 的分母靠它。
   */
  flopSeenPlayers?: PlayerId[];
  /** 真正进入摊牌的参与者（非提前 reveal）。 */
  showdownPlayers?: PlayerId[];
  /**
   * 摊牌中从任意奖池获得 **> 0** 份额的玩家（含平分与边池）。
   *
   * 单个 `state.winner` 表达不了多赢家 / 边池；WSD 的分子靠它。
   */
  showdownWinners?: PlayerId[];
  /** 本手底池总额（所有座位 `totalBet` 之和，含边池）。 */
  potAmount: number;
}

/**
 * 从**已结算**的对局状态算出这一手的快照。
 *
 * ⚠️ 调用方必须自己确认「本手已结算」（`GameBoard` 用 `roundSettled`）——
 * 本函数只看 `phase` 与 `potDistribution`，在结算前调用会得到一份无意义的快照。
 *
 * @param state 当前对局状态
 * @param events 本手已记录的动作事件（`HandRecord.events`）；翻前弃牌名单从它读，
 *   因为 `state.players` 上的 `folded` 是**跨街累计**的，无法区分「翻前就弃了」
 *   与「翻后弃了」。
 */
export function computeSettlementSnapshot(
  state: GameState,
  events: readonly ActionEvent[],
): SettlementSnapshot {
  const isShowdown = state.phase === 'showdown';

  // 翻牌名单 = 翻前未弃牌者。**不能**用「本人是否有 flop 动作」推断（见上）。
  const preflopFoldedIds = new Set(
    events
      .filter((e) => e.phase === 'preflop' && e.action === 'fold')
      .map((e) => e.playerId),
  );
  const flopSeenPlayers =
    state.phase !== 'preflop'
      ? state.players.filter((p) => !preflopFoldedIds.has(p.id)).map((p) => p.id)
      : undefined;

  const showdownPlayers = isShowdown
    ? state.players.filter((p) => !p.folded).map((p) => p.id)
    : undefined;

  // `potDistribution[].winnings` 按**座位数组下标**对齐（不是 playerId），
  // 所以这里用 `idx` 查而不是 `p.id`。
  const showdownWinners = isShowdown
    ? state.players
        .filter((_, idx) =>
          state.potDistribution.some((pd) => (pd.winnings[idx] ?? 0) > 0),
        )
        .map((p) => p.id)
    : undefined;

  return {
    flopSeenPlayers,
    showdownPlayers,
    showdownWinners,
    potAmount: state.players.reduce((sum, p) => sum + p.totalBet, 0),
  };
}
