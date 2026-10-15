import type { Action, GamePhase, GameState, PlayerId } from '../types/poker';
import type { ActionEvent } from '../types/stats';

/**
 * 由「当前对局状态 + 一次已被接受的动作」构造 `ActionEvent`（统计事件的**唯一**构造点）。
 *
 * 为什么单独抽成模块：这个形状原先只写在 `GameBoard` 的一个闭包里，而
 * `scripts/` 下的 headless 校准 runner 必须产出**同一形状**的事件 —— 否则统计
 * 口径会分叉：runner 报出来的 VPIP/AF 与面板显示的对不上，而两边都「看起来对」。
 * 与 `handSettlementSnapshot.ts` 是同一类处理（方案 §9.3「统计数字与面板显示必须同源」）。
 *
 * ⚠️ 调用方必须自己确认动作**会被 reducer 接受**（`isActionAccepted`）——
 * 本函数只做形状转换，不校验合法性。被拒绝的动作不该留下事件（方案 §7.4）。
 *
 * @param state 动作发生**之前**的状态（`toCall` / `currentBet` / `potSize` / `position`
 *   都取动作前的快照，与 reducer 的接受口径一致）。
 * @param handId 本手身份（`opponentModel.makeHandId`）；生产侧由开手 effect 算好放进 ref。
 * @param playerId 行动者。
 * @param action 动作。
 * @param amount 金额（`raise` / `allin` 用；其余为 `undefined`）。
 * @param phaseOverride 显式街道覆盖；缺省取 `state.phase`。
 */
export function buildActionEvent(
  state: GameState,
  handId: string,
  playerId: PlayerId,
  action: Action,
  amount?: number,
  phaseOverride?: GamePhase,
): ActionEvent {
  const player = state.players.find((p) => p.id === playerId);
  const toCall = state.lastBet - (player?.bet || 0);
  const position =
    (playerId - state.dealer + state.players.length) % state.players.length;
  const phase = phaseOverride ?? state.phase;

  return {
    handId,
    playerId,
    phase,
    action,
    amount,
    toCall,
    currentBet: state.lastBet,
    potSize:
      state.mainPot + (state.sidePots?.reduce((sum, pot) => sum + pot.amount, 0) || 0),
    position,
    // 「面对下注/加注」的语义就是「有需要跟注的金额」，全街道通用。
    // 原来写成 `state.lastBet > 0 && phase === 'preflop'`，翻后恒为 false，
    // 且翻前连大盲免费过牌也被判成 facing（lastBet 初始就是大盲）。
    isFacingRaise: toCall > 0,
    timestamp: Date.now(),
  };
}
