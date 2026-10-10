import type { GameState, Player } from '../types/poker';
import { mdfFrom } from './gtoMath';

/**
 * potOdds 口径的唯一来源 —— **只放「赔率」相关的量**。
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
 *
 * 分层：本模块只负责「业务口径」（知道什么是含注底池）；
 * MDF 属于 GTO 数学，公式与适配器都在 `gtoMath`（`calculateMDF` / `mdfFrom`），
 * 这里只是转发一下，方便面板继续从同一个入口取 `mdf`。
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
   * 最小防守频率 = 下注前底池 / 含注底池，由 `gtoMath.mdfFrom` 算出
   * （公式本体在 `gtoMath.calculateMDF`）。
   *
   * 注意：`calculateMDF(bet, pot)` 要求 `pot` 是**下注前**底池，而面板 / 河牌
   * 手里只有含注底池，早先直接把它喂进去导致显示值偏高（半池 0.667→0.75）。
   * 只持有 (totalPot, toCall) 的调用方请用 `gtoMath.mdfFrom`。
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

/**
 * 跟注赔率的**比率形式**（`totalPot : toCall`，归一化成 `x : 1`）。
 *
 * 与 `callPotOddsFrom` 是同一件事的两种写法：
 *   `callPotOdds = toCall / (totalPot + toCall) = 1 / (ratio + 1)`
 * 所以 1/3（33.3%）⇔ 2:1、1/4（25%）⇔ 3:1、1/6（16.7%）⇔ 5:1 —— 与
 * 德州教材里那张「1/4 彩池 → 5.0:1 → 17%」的表逐行对得上。
 *
 * 注意分母是 `toCall`、分子是**含注底池** `totalPot`（含对手本轮那一注，
 * 不含我方尚未投入的跟注额），这正是教材说的「总彩池 : 跟注需要的数量」。
 */
export function formatOddsRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '—';
  const fixed = ratio.toFixed(1);
  // 2.0 → 「2」、3.0 → 「3」，但 2.3 / 1.5 保留一位（教材也是这么印的）
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/**
 * 隐含赔率（implied odds）。
 *
 * 教材口径：隐含赔率 =（彩池 + 对手未来可能投入的筹码）/（我现在要跟注的筹码 +
 * 我未来可能投入的筹码），同样归一化成 `x : 1`，盈亏平衡百分比 = `1 / (ratio + 1)`。
 *
 * 本仓库采用那页书里的**乐观**假设：
 * - 「对手未来可能投入的筹码」= 跟注后双方还能继续投入的**有效剩余筹码**
 *   （`futureWinningsFrom`：取「我方跟注后剩余」与「各未弃牌对手剩余」的较小值）；
 * - 「我未来可能投入的筹码」= 0 —— 书里明说：错过就不再往彩池里投钱。
 *
 * 校验（书中的例子）：彩池 7500、跟 2500、双方各剩 2500 →
 * ratio = (7500 + 2500) / 2500 = 4（4:1）、盈亏平衡 = 1/5 = 20%，与书上一致。
 *
 * ⚠️ 这是**上界**：它假设成牌后能把对手的剩余筹码全部赢过来，真实牌局里对手
 * 未必支付；而且它完全不看成牌概率（面板另有权益行）。河牌没有后续街可发，
 * 调用方应直接隐藏该行（那时隐含赔率恒等于直接赔率）。
 */
export interface ImpliedOddsResult {
  /** 隐含赔率比率（表示 `ratio : 1`） */
  ratio: number;
  /** 隐含赔率对应的跟注盈亏平衡百分比 = `1 / (ratio + 1)` */
  breakeven: number;
}

export function impliedOddsFrom(
  totalPot: number,
  toCall: number,
  futureWinnings: number,
): ImpliedOddsResult | null {
  if (toCall <= 0) return null;
  const ratio = Math.max(0, totalPot + futureWinnings) / toCall;
  return { ratio, breakeven: 1 / (ratio + 1) };
}

/**
 * 隐含赔率里「成牌后还能再赢到的筹码」。
 *
 * 取**有效剩余筹码**：我方跟注之后还剩多少，与各未弃牌对手还剩多少，取较小者 ——
 * 对手不可能输给你超过你还能投入的量。全部对手都已弃牌时是 0（无人可支付）。
 */
export function futureWinningsFrom(
  state: GameState,
  player: Player,
  toCall: number,
): number {
  const heroRemaining = Math.max(0, player.chips - toCall);
  const opponents = state.players.filter(
    (p) => p.id !== player.id && !p.folded,
  );
  if (opponents.length === 0) return 0;
  return Math.max(0, Math.min(heroRemaining, ...opponents.map((p) => p.chips)));
}
