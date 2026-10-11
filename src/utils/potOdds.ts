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
 * 教材口径：隐含赔率 =（彩池 + 对手未来投入）/（跟注 + 我未来跟注），
 * 归一化成 `x : 1`，盈亏平衡百分比 = `1 / (ratio + 1)`。
 *
 * **两项分属不同分支**，这是最容易算错的地方：
 * - 成牌那一支净得「底池 + 对手未来投入」—— 我自己后续投进去的筹码会随底池一起
 *   回到手上，相互抵消，所以成牌分支的净得与「我未来跟注」无关；
 * - 未成牌那一支损失「跟注 + 我未来跟注」。
 *
 * 令 EV = 0 解出
 *   `breakeven = (跟注 + 我未来跟注) / (底池 + 对手未来投入 + 跟注 + 我未来跟注)`。
 * 所以 `futureCalls` 指的是**没成牌那条路上还会投多少**，不是「以后总共投多少」；
 * 成牌之后再加注打进去的钱属于 `futureWinnings`，不属于 `futureCalls`。
 *
 * 校验（书中的例子）：彩池 7500、跟 2500、双方各剩 2500、`futureCalls` = 0 →
 * ratio = (7500 + 2500) / 2500 = 4（4:1）、盈亏平衡 = 1/5 = 20%，与书上一致。
 *
 * ⚠️ 这是**估算**不是闭式解：两项都是对未来的估计（对手会不会支付、我会不会再跟）。
 * GTO 求解器根本不显式算这两个量 —— 它把整棵博弈树解出来，未来街的 EV 自然浮现。
 * 这套是给人在牌桌上心算用的启发式。河牌没有后续街可发，调用方应直接隐藏该行
 * （那时隐含赔率恒等于直接赔率）。
 */
export interface ImpliedOddsResult {
  /** 隐含赔率比率（表示 `ratio : 1`） */
  ratio: number;
  /** 隐含赔率对应的跟注盈亏平衡百分比 = `1 / (ratio + 1)` */
  breakeven: number;
}

/**
 * `futureCalls` 缺省 0 = 计划「错过就弃牌」，也就是教材那个例子的假设。
 * 只要你会再跟一注，这一项就是正的，赔率随之变差 —— 见 `impliedOddsFor`。
 */
export function impliedOddsFrom(
  totalPot: number,
  toCall: number,
  futureWinnings: number,
  futureCalls = 0,
): ImpliedOddsResult | null {
  if (toCall <= 0) return null;
  // 分母是「我总共要投进去的钱」，只包含没成牌那条路上的追加跟注
  const risk = toCall + Math.max(0, futureCalls);
  const ratio = Math.max(0, totalPot + futureWinnings) / risk;
  return { ratio, breakeven: 1 / (ratio + 1) };
}

/**
 * 下一条街的**预计注码**：假设对手延续他当前这一注相对底池的尺度。
 *
 * 用「对手实际下出的比例」外推，而不是拍一个固定的 2/3 池 —— 这个数是从牌局本身
 * 读出来的，不需要另立一个假设。
 *
 * 例：下注前底池 5000、对手下 2500（半个池）→ 我跟注后底池 10000
 * → 下一条街预计 5000。
 */
export function nextStreetBetFrom(totalPot: number, toCall: number): number {
  const potBeforeBet = Math.max(0, totalPot - toCall);
  if (toCall <= 0 || potBeforeBet <= 0) return 0;
  return (toCall / potBeforeBet) * (totalPot + toCall);
}

/**
 * 隐含赔率里「成牌后还能再赢到的筹码」（对手未来投入）。
 *
 * 取**有效剩余筹码**：我方跟注之后还剩多少，与各未弃牌对手还剩多少，取较小者 ——
 * 对手不可能输给你超过你还能投入的量。全部对手都已弃牌时是 0（无人可支付）。
 *
 * `cap` 是「还能赢到多少」的上限。专业上不会把对手的整个剩余筹码都算成隐含赔率
 * （他不一定支付），通行假设是「还能再赢一条街的下注」。缺省不设上限
 * （= 取满额有效剩余筹码），那是乐观上界，见 `impliedOddsFor`。
 */
export function futureWinningsFrom(
  state: GameState,
  player: Player,
  toCall: number,
  cap = Number.POSITIVE_INFINITY,
): number {
  const heroRemaining = Math.max(0, player.chips - toCall);
  const opponents = state.players.filter(
    (p) => p.id !== player.id && !p.folded,
  );
  if (opponents.length === 0) return 0;
  return Math.max(
    0,
    Math.min(heroRemaining, cap, ...opponents.map((p) => p.chips)),
  );
}

/**
 * 隐含赔率里「我未来跟注」—— **只在没成牌那条路上**还会投进去的筹码。
 *
 * 成牌之后投进去的钱会随底池回到手上、相互抵消，不计在这里（见 `impliedOddsFrom`）。
 * 受「跟注后我手里还剩多少」夹住：掏不出的钱不算成本。
 */
export function futureCallsFrom(
  player: Player,
  toCall: number,
  cap: number,
): number {
  const heroRemaining = Math.max(0, player.chips - toCall);
  return Math.max(0, Math.min(heroRemaining, cap));
}

/** `impliedOddsFor` 的成对结果：教材上界与「按计划追牌」的期望口径。 */
export interface ImpliedOddsPair {
  /** 乐观上界：对手未来投入取满额有效剩余筹码，我未来跟注记 0（计划「错过即弃」） */
  upperBound: ImpliedOddsResult;
  /**
   * 主值：按**追牌计划**展开的期望口径 —— 成牌之后就不再是跟注而是收钱，
   * 最后一条街（河牌）没成牌就直接弃牌、不会再有跟注。「我未来跟注」按
   * `impliedCallWeight` 加权（有 `outs` 时按成牌概率），「对手未来投入」仍取
   * 乐观侧（成牌后收满剩余街数）。
   */
  planned: ImpliedOddsResult;
}

/**
 * 「我未来跟注」的**加权系数**（单位：单街注码 `b̂`）。
 *
 * 原先写成 `b̂ × 剩余街数`，这是把「每条街都跟」当成了计划，同时错在两处：
 *
 * - **最后一条街（河牌）不会再有跟注。** 河牌发出来时要么成牌（收钱）、要么没成
 *   （弃牌），两条路都不产生跟注。所以最多只覆盖 `n − 1` 条街。
 * - **第 `k` 条街只有在「前 `k` 张都没成牌」时才会跟。** 成牌之后这条路就结束了。
 *
 * 给了 `outs`（听牌检测的补牌数）时按成牌概率加权，否则按「一直没成牌」的确定性
 * 计划即 `n − 1`。两者在 `outs → 0` 处**连续** —— 这是刻意保留的性质。
 *
 * 「对手未来投入」**不做这个加权**：它是乐观侧（假定成牌后能收满剩余街数），
 * 与 `upperBound` 同一取向。两项都加权会让 `outs = 0` 与 `outs = 1` 之间跳一大截
 * （`outs = 0` 时退化分支假定「第 1 张就成牌」，而 1 张补牌的成牌率只有 2%），
 * 面板上会出现一个说不清的不连续点。
 */
function impliedCallWeight(streetsLeft: number, outs?: number): number {
  const n = Math.max(0, Math.floor(streetsLeft));
  if (n <= 1) return 0;
  if (outs === undefined || outs <= 0) return n - 1;

  // 第 k 张牌的成牌概率：翻牌圈 47 张未见、转牌圈 46 张（与 `drawDetector` 同口径）
  let calls = 0;
  let missThrough = 1;
  for (let k = 1; k <= n - 1; k++) {
    missThrough *= 1 - Math.min(1, outs / (47 - (k - 1)));
    calls += missThrough;
  }
  return calls;
}

/**
 * 一次算出隐含赔率的两个口径，供面板并排对照。
 *
 * `streetsLeft` = 还要发的公共牌数（翻牌 2、转牌 1、河牌 0），也等于**剩余的下注街数**。
 *
 * - `upperBound`：`futureWinnings` 取满额有效剩余筹码、`futureCalls` = 0。教材那个例子
 *   就是这一口径（4:1 / 20%），但它同时假设了「成牌后能把对手剩余筹码全赢过来」和
 *   「错过就弃牌」，是最乐观的读法。
 * - `planned`：`futureCalls` 按 `impliedCallWeight` 加权（有 `outs` 时按成牌概率），
 *   `futureWinnings` 仍是「成牌后收满剩余街数」的乐观侧；两项各自受剩余筹码夹住。
 *
 * `planned` 的盈亏平衡**不低于** `upperBound`，有时甚至高于直接赔率 —— 这正是
 * 「打算再付一注时，有效赔率可能比眼前的价格更差」。
 *
 * 无跟注额 / 河牌（`streetsLeft <= 0`）时返回 null，调用方应隐藏该行。
 */
export function impliedOddsFor(
  state: GameState,
  player: Player,
  totalPot: number,
  toCall: number,
  streetsLeft: number,
  outs?: number,
): ImpliedOddsPair | null {
  if (toCall <= 0 || streetsLeft <= 0) return null;

  const perStreet = nextStreetBetFrom(totalPot, toCall);
  const callWeight = impliedCallWeight(streetsLeft, outs);

  const upperBound = impliedOddsFrom(
    totalPot,
    toCall,
    futureWinningsFrom(state, player, toCall),
  );
  const planned = impliedOddsFrom(
    totalPot,
    toCall,
    futureWinningsFrom(state, player, toCall, perStreet * streetsLeft),
    futureCallsFrom(player, toCall, perStreet * callWeight),
  );
  if (!upperBound || !planned) return null;
  return { upperBound, planned };
}
