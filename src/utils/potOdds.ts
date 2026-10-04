import type { GameState, Player } from '../types/poker';

/**
 * potOdds 口径的唯一来源。
 *
 * 背景：面板显示、面板建议、GTO 建议、机器人决策原本各自内联了一遍
 * `toCall / (totalPot + toCall)`，而显示侧还额外混入过一个语义不同的量。
 * 这里把「底池 / 跟注额 / 跟注赔率」的定义收敛到一处，避免多处漂移。
 *
 * 约定（务必保持）：
 * - `totalPot` 含本轮已下注 —— `state.mainPot` 在 call/raise 时会累加本轮下注，
 *   `NEXT_STREET` 只把 `player.bet` 归零，所以 mainPot 是「含注底池」。
 * - `potBeforeBet = totalPot - toCall` 即「对手下最后一注之前」的底池。
 *   真实对局里 mainPot 含对手本轮的注，必然 >= lastBet >= toCall，
 *   所以 `potBeforeBet + toCall === totalPot` 恒成立；不可达的畸形输入下
 *   potBeforeBet 会被夹到 0（不产生负数）。
 * - `callPotOdds` 与 `gtoMath.calculateCallEV` 的盈亏平衡点一致：
 *   `calculateCallEV(callPotOdds, totalPot, toCall) === 0`。
 * - `mdf` 用的是**下注前**底池（`gtoMath.calculateMDF` 的约定），
 *   与 `callPotOdds` 用的含注底池不同口径 —— 同一个 memo 里两个量必须分开传参。
 */
export interface PotOddsInput {
  /** `state.mainPot`（含本轮已下注） */
  mainPot: number;
  /** `state.sidePots` 的金额合计 */
  sidePotTotal: number;
  /** `state.lastBet` —— 本轮最高下注额 */
  lastBet: number;
  /** 当前玩家本轮已投入的筹码（`player.bet`） */
  playerBet: number;
}

export interface PotOddsResult {
  /** 跟注所需的追加筹码，下限 0 */
  toCall: number;
  /** 当前底池（含本轮已下注）= mainPot + sidePotTotal */
  totalPot: number;
  /** 下注前底池 = totalPot - toCall */
  potBeforeBet: number;
  /** 跟注所需权益 = toCall / (totalPot + toCall) */
  callPotOdds: number;
  /**
   * 最小防守频率 = potBeforeBet / totalPot，等价于
   * `gtoMath.calculateMDF(toCall, potBeforeBet)`。
   *
   * 注意：`calculateMDF(bet, pot)` 要求 `pot` 是**下注前**底池，而面板 / 河牌
   * 手里只有含注底池，早先直接把它喂进去导致显示值偏高（半池 0.667→0.75）。
   * 只持有 (totalPot, toCall) 的调用方请用 `mdfFrom`。
   */
  mdf: number;
}

/**
 * 跟注赔率 = toCall / (totalPot + toCall)。
 * 已持有 toCall / totalPot 的调用方（如 ctx）直接用这个，保证公式只有一处。
 */
export function callPotOddsFrom(toCall: number, totalPot: number): number {
  return toCall > 0 ? toCall / (totalPot + toCall) : 0;
}

/**
 * 最小防守频率 = 下注前底池 / 含注底池。
 *
 * 只持有「含注底池 + 跟注额」的调用方用这个，避免自己写 `totalPot - toCall`
 * 再手滑把含注底池喂给 `calculateMDF`。无需跟注（toCall = 0）时返回 1。
 */
export function mdfFrom(totalPot: number, toCall: number): number {
  const pot = Math.max(0, totalPot);
  if (pot <= 0) return 0;
  const potBeforeBet = Math.max(0, pot - Math.max(0, toCall));
  return potBeforeBet / pot;
}

export function computePotOdds(input: PotOddsInput): PotOddsResult {
  const totalPot = Math.max(0, input.mainPot + input.sidePotTotal);
  const toCall = Math.max(0, input.lastBet - input.playerBet);
  const potBeforeBet = Math.max(0, totalPot - toCall);
  const callPotOdds = callPotOddsFrom(toCall, totalPot);
  const mdf = mdfFrom(totalPot, toCall);

  return { toCall, totalPot, potBeforeBet, callPotOdds, mdf };
}

/** 从完整对局状态与某个玩家计算口径，省去调用方手工取 sidePots 合计。 */
export function computePotOddsFor(state: GameState, player: Player): PotOddsResult {
  return computePotOdds({
    mainPot: state.mainPot,
    sidePotTotal: state.sidePots.reduce((sum, sp) => sum + sp.amount, 0),
    lastBet: state.lastBet,
    playerBet: player.bet,
  });
}
