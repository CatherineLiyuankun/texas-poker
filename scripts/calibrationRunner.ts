/**
 * Bot 性格的**闭环校准 runner**（方案 §10.4 / §12.3 的 P9 行）。
 *
 * ## 为什么要有它
 *
 * 「性格参数是否真的把行为推到目标区间」只能在**大量真实对局**上量出来。方案 §4 的
 * 目标区间是工作目标，不是靠单测能证明的；而 2000+ player-hand × 多 seed 的规模
 * 不能塞进默认 Jest（§10.4 明确禁止新增自动收集的 30 分钟 `calibration.test.ts`）。
 * 所以它是一个**显式命令**（`npm run calibrate`），不是测试。
 *
 * ## 它驱动的是生产状态机，不是第二套引擎
 *
 * 方案 §10.4：「闭环 runner 走生产 reducer/动作接受/计数逻辑，不手写第二套扑克引擎。」
 * 具体来说，这里用的全部是生产模块：
 *
 * | 环节 | 生产模块 |
 * | --- | --- |
 * | 状态推进 | `useGameState.gameReducer`（`START_GAME` / `PLAYER_ACTION` / `REVEAL_HAND` / `NEXT_STREET` / `RESET_ROUND`） |
 * | 动作合法性 | `useGameState.isActionAccepted`（reducer 收不收，与 `GameBoard` 记不记事件**同一口径**） |
 * | 回合结束 | `useGameState.bettingComplete` |
 * | Bot 决策 | `botAI.getBotAction` |
 * | 事件形状 | `utils/actionEvent.buildActionEvent` |
 * | 结算快照 | `utils/handSettlementSnapshot.computeSettlementSnapshot` |
 * | 记录容器 | `opponentModel.startNewHand / recordAction`、`longOpponentModel.saveHand` |
 * | 聚合计数 | `longOpponentModel.getTypeLongStats` → `typeStats.computeTypeStats` → `opponentModelUtil` 计数内核 |
 *
 * ## 与 `GameBoard` 的时序对应
 *
 * `GameBoard` 靠一组 `useEffect` 驱动（开手键、机器人行动、街道推进、结算快照、存进度）。
 * React 按声明顺序跑同一次 commit 的 effect，多次 `dispatch` 也按顺序应用到同一个 reducer
 * —— 所以这里把「一次渲染周期」摊平成**顺序的 reducer 调用**，净效果逐位等价。两处刻意不复刻：
 *
 * - **`collectPot` effect 不复刻**：它的条件是 `allFolded && winner && mainPot > 0`，
 *   而 `COLLECT_POT` 分支自己有一句 `if (state.mainPot <= 0 || state.winner !== null) return state`。
 *   弃牌获胜在 reducer 里**当场**就把底池发给赢家并把 `mainPot` 置 0，所以那个 effect
 *   在生产里也从不生效（恒被自己拦掉）。
 * - **`setTimeout` 停顿不复刻**：那些延时是纯 UX 节奏（`GameBoard` 注释写明「与正确性无关」）。
 *   `resetRound` 里的 `setTimeout(0)` 只是等 React 应用完 `RESET_ROUND`，同步顺序调用等价。
 *
 * ## 会话（盘）边界
 *
 * `opponentModel` 的会话画像**按盘累积**（决策 40），而 `botAI.getBotAction` 每次决策都按
 * 会话全量重算对手统计 ⇒ 单盘手数越长，决策成本越高。所以 runner 有 `handsPerSession`
 * （**runner 参数**，不是生产常数）：每盘跑完就 `resetOpponentStats()` + `beginSession()`，
 * 与生产里「返回菜单再开新盘」同语义。跨盘累计交给长期库，与生产完全一致。
 */

import { execSync } from 'node:child_process';

import type { Action, GameState, PlayerId } from '../src/types/poker';
import type { HandRecord, PlayerRole } from '../src/types/stats';
import {
  bettingComplete,
  createInitialState,
  gameReducer,
  isActionAccepted,
} from '../src/hooks/useGameState';
import { getBotAction } from '../src/utils/botAI';
import { buildActionEvent } from '../src/utils/actionEvent';
import { computeSettlementSnapshot } from '../src/utils/handSettlementSnapshot';
import {
  beginSession,
  getCurrentHand,
  getSessionId,
  makeHandId,
  recordAction,
  resetOpponentStats,
  setCurrentHandFlopSeenPlayers,
  setCurrentHandShowdownPlayers,
  setCurrentHandShowdownWinners,
  startNewHand,
} from '../src/utils/opponentModel';
import {
  getTypeLongStats,
  resetLongTermStats,
  saveHand,
} from '../src/utils/longOpponentModel';
import {
  allocateBotTypes,
  botIdsForRange,
  botTypeQuota,
  isValidBotPersonality,
  toBotTypeMap,
  type BotPersonality,
  type BotTypeMap,
} from '../src/utils/botPersonality';
import { mulberry32, resetRandomSource, setRandomSeed } from '../src/utils/random';
import { resetGtoConfig, setGtoConfig } from '../src/utils/gtoConfig';
import { NO_RAKE, resetRakeConfig, setRakeConfig } from '../src/utils/rake';
import { EQUITY_ITERATIONS, equityIterations } from '../src/utils/equityIterations';
import { calculateEquity } from '../src/utils/equityCalculator';
import { getCommunityByPhase } from '../src/utils/communityByPhase';
import {
  EMPTY_STAT_COUNTS,
  statsFromCounts,
  sumCounts,
  type StatCounts,
} from '../src/utils/opponentModelUtil';
import {
  evaluateTargets,
  formatReport,
  hashSeed,
  parseCalibrationArgs,
  proxyDecide,
  TYPE_ORDER,
  type CalibrationConfig,
  type CalibrationReport,
  type ProxyContext,
  type TypeMetrics,
  type TypeReport,
} from './calibrationCore';

/** 单手的步数护栏：正常一手 <60 步，超出即说明状态机没在收敛 —— 报错而不是死循环。 */
const MAX_STEPS_PER_HAND = 500;

type Group = BotPersonality | 'Unknown';

// ── 内存版 localStorage ──────────────────────────────────────────────────────

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

/**
 * 只存在于内存的 `localStorage`。
 *
 * Node 里没有 `localStorage`，而 `opponentModel` / `longOpponentModel` 都靠它做持久化。
 * 用内存实现（而不是真文件）有两个理由：
 *
 * 1. **绝不碰用户数据**（方案 §10.4 末条）：这是隔离的实验存储，不是浏览器里那份；
 * 2. `setItem` 是 **no-op**：生产实现每次都 `JSON.stringify` 整个会话/长期库，
 *    2000 手规模下是 O(n²)。跳过它不影响任何被测逻辑 —— `loadFromStorage` 拿不到东西
 *    就保留内存态，正是我们想要的。
 */
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const shim: MemoryStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: () => {},
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = shim;
}

// ── 计数与结算 ───────────────────────────────────────────────────────────────

interface RunCounters {
  hands: number;
  decisions: number;
  /**
   * 被 `isActionAccepted` 拒掉的 Bot 决策，按 `动作@街道` 计数。
   *
   * 这不是 runner 的内部细节而是**生产信号**：`GameBoard` 的机器人 effect 在动作被拒时
   * 只 `return`，而 effect 的依赖（`state`）没有变化 ⇒ 不会重跑 ⇒ 真人视角里**机器人卡住**。
   * 所以只要这个数 > 0，就是需要单独定位的生产缺陷，不能拿兜底动作悄悄糊过去。
   */
  rejectedBotDecisions: Map<string, number>;
  /** 每类在各座位出现的 player-hand 数（决策 43「全位置」）。 */
  seatHistogram: Map<Group, Record<string, number>>;
}

const isSettled = (s: GameState): boolean =>
  s.winner !== null || (s.phase === 'showdown' && s.mainPot === 0);

/**
 * 代理策略的 `ProxyContext`：全部从**生产**合法性函数派生，不自己写一套判据。
 *
 * `canRaise` 直接问 `isActionAccepted('raise', 最小追加额)` —— 于是代理「能不能加注」
 * 与 reducer「收不收这个加注」永远同一个答案。
 */
function proxyContextOf(state: GameState, playerId: PlayerId): ProxyContext {
  const p = state.players.find((x) => x.id === playerId)!;
  const toCall = Math.max(0, state.lastBet - p.bet);
  const pot = state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const minRaiseAdditional = toCall + state.lastRaiseBet;
  return {
    toCall,
    pot,
    canCheck: toCall === 0,
    canCall: toCall > 0 && toCall <= p.chips,
    canRaise: isActionAccepted(state, playerId, 'raise', minRaiseAdditional),
    minRaiseAdditional,
    shortOfCall: toCall > p.chips,
  };
}

/** 代理策略看到的权益：与引擎同源（`equityIterations` + 当前街的公共牌）。 */
function proxyEquityOf(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((p) => p.id === playerId)!;
  const numOpponents = state.players.filter((p) => !p.folded && p.id !== playerId).length;
  if (numOpponents === 0) return 1;
  return calculateEquity(
    player.hand,
    getCommunityByPhase(state.communityCards, state.phase),
    numOpponents,
    equityIterations(state.phase),
  );
}

/**
 * 归类一次 `raise` 被 `legalizeRaise` 拒绝的**原因**（纯诊断，不参与决策）。
 *
 * 逐条照抄 `legalizeRaise` 的判据顺序；它只返回 `{kind:'reject'}` 不带原因，而
 * 「被拒」本身是生产缺陷信号，必须能一眼看出卡在哪一条上。
 */
function classifyRejectReason(
  state: GameState,
  actor: { id: PlayerId; bet: number; chips: number },
  amount: number | undefined,
): string {
  if (amount === undefined) return 'amount=undefined';
  const raw = amount;
  if (!Number.isFinite(raw) || raw <= 0) return `amount=${raw}（非正/非有限）`;
  if (!state.raiseRightsOpened) return 'raiseRightsOpened=false';
  const live = state.players.some(
    (p) => p.id !== actor.id && !p.folded && !p.allIn && p.chips > 0,
  );
  if (!live) return 'hasLiveOpponent=false';
  const toCall = Math.max(0, state.lastBet - actor.bet);
  let additional = Math.floor(raw);
  let allIn = false;
  if (additional >= actor.chips) {
    additional = Math.max(0, actor.chips);
    allIn = true;
  }
  if (additional <= toCall) return `floor(amount)≤toCall（${additional}≤${toCall}）`;
  const increment = additional - toCall;
  if (increment < state.lastRaiseBet && !allIn) {
    return `增量<lastRaiseBet且非全下（${increment}<${state.lastRaiseBet}）`;
  }
  return '其它';
}

/** 兜底动作：Bot 决策被拒时按「过牌 → 跟注 → 弃牌」找一个**一定合法**的动作。 */
function fallbackAction(state: GameState, playerId: PlayerId): Action {
  const p = state.players.find((x) => x.id === playerId)!;
  const toCall = Math.max(0, state.lastBet - p.bet);
  if (toCall === 0) return 'check';
  if (toCall <= p.chips) return 'call';
  return 'fold';
}

/**
 * 打完一手：从**已开局**（`START_GAME` 之后、盲注已下）的状态推进到结算，返回结算后状态。
 */
function playHand(
  initial: GameState,
  handId: string,
  proxyRng: () => number,
  counters: RunCounters,
): GameState {
  let state = initial;

  for (let step = 0; step < MAX_STEPS_PER_HAND; step++) {
    if (isSettled(state)) return state;

    // `GameBoard` 的街道推进 effect 在 `roundSettled` 与 `phase === 'showdown'` 时直接返回。
    if (state.phase === 'showdown' || state.phase === 'ended') {
      // 到这里说明 phase 已进摊牌但 `isSettled` 仍为假 —— 生产侧同样会停住
      // （street effect 早返回、bot effect 被 bettingComplete 拦住）。报出来，
      // 不要自己造一个结算把它掩盖过去。
      throw new Error(
        `hand ${handId}: phase=${state.phase} 但未结算（winner=${String(state.winner)}, mainPot=${state.mainPot}）`,
      );
    }

    if (bettingComplete(state)) {
      // `handleNextPhase`：先把每个座位亮牌，再推进街道。
      for (const p of state.players) {
        state = gameReducer(state, { type: 'REVEAL_HAND', player: p.id });
      }
      state = gameReducer(state, { type: 'NEXT_STREET' });
      continue;
    }

    const actor = state.players[state.currentPlayer - 1];
    if (!actor || actor.folded || actor.allIn) {
      throw new Error(
        `hand ${handId}: currentPlayer=${state.currentPlayer} 不可行动` +
          `（folded=${actor?.folded}, allIn=${actor?.allIn}）`,
      );
    }

    // 决策：真人座位走固定代理策略，Bot 座位走生产引擎。
    let action: Action;
    let amount: number | undefined;
    let reasonText = '';
    if (actor.isRealPlayer) {
      const decision = proxyDecide(
        proxyContextOf(state, actor.id),
        proxyEquityOf(state, actor.id),
        proxyRng,
      );
      action = decision.action;
      amount = decision.amount;
    } else {
      const decision = getBotAction(actor, state);
      action = decision.action;
      amount = decision.amount;
      // 决策理由只用于诊断（被拒时定位到具体分支）；不进报告正文。
      reasonText = (decision.reasoning ?? '').slice(0, 60);
    }

    // 与 `GameBoard` 同一条防线：reducer 不收的动作既不派发也不记事件（方案 §7.4）。
    if (!isActionAccepted(state, actor.id, action, amount)) {
      if (actor.isRealPlayer) {
        // 代理策略不该产出非法动作 —— 这是 runner 自身的不变量，直接报错。
        throw new Error(
          `hand ${handId}: 代理策略给出被拒的动作 ${action}(${amount ?? '-'})，座位 ${actor.id}`,
        );
      }
      // Bot 给出被拒的动作是**生产缺陷信号**（UI 侧会让机器人卡住，见 `RunCounters` 注释）。
      // 计一次数（按动作+街道归类，便于定位），再换成一定合法的兜底动作让这一手走完
      // —— 一次运行不该被单个异常动作打断，但信号必须留在报告里。
      // 带上座位性格与拒绝原因：能立刻分辨「persona 接线引入」还是「与性格无关的既有缺陷」。
      const reason =
        action === 'raise' ? classifyRejectReason(state, actor, amount) : '-';
      const kind =
        `${action}@${state.phase}/${actor.botType ?? 'no-persona'} :: ${reason}` +
        `${reasonText ? ` :: ${reasonText}` : ''}`;
      counters.rejectedBotDecisions.set(
        kind,
        (counters.rejectedBotDecisions.get(kind) ?? 0) + 1,
      );
      action = fallbackAction(state, actor.id);
      amount = undefined;
      if (!isActionAccepted(state, actor.id, action, amount)) {
        throw new Error(`hand ${handId}: 兜底动作 ${action} 也被拒，座位 ${actor.id}`);
      }
    }

    // 事件取**动作前**快照（生产侧 `createActionEvent` 读的是渲染闭包里的旧 state）。
    const event = buildActionEvent(state, handId, actor.id, action, amount);
    state = gameReducer(state, { type: 'PLAYER_ACTION', player: actor.id, action, amount });
    recordAction(event);
    counters.decisions++;
  }

  throw new Error(`hand ${handId}: 超过 ${MAX_STEPS_PER_HAND} 步仍未结算`);
}

/** 结算快照 + 落长期库 —— 与 `GameBoard` 的结算 effect 逐句对应。 */
function settleHand(state: GameState): void {
  const currentHand = getCurrentHand();
  if (!currentHand) throw new Error('结算时没有 currentHand —— 开手记录缺失');
  const snapshot = computeSettlementSnapshot(state, currentHand.events);
  if (snapshot.showdownPlayers) setCurrentHandShowdownPlayers(snapshot.showdownPlayers);
  if (snapshot.flopSeenPlayers) setCurrentHandFlopSeenPlayers(snapshot.flopSeenPlayers);
  if (snapshot.showdownWinners) setCurrentHandShowdownWinners(snapshot.showdownWinners);
  const handWithResult: HandRecord = {
    ...currentHand,
    flopSeenPlayers: snapshot.flopSeenPlayers,
    showdownPlayers: snapshot.showdownPlayers,
    showdownWinners: snapshot.showdownWinners,
    result: { winner: state.winner, potAmount: snapshot.potAmount },
  };
  saveHand(handWithResult);
}

/**
 * 记录本手每个座位归属哪个分配组。
 *
 * 规则与 `typeStats.groupOf` 一致：真人（`playerRoles === 'human'`）不进任何类型组；
 * 合法分配进该组；其余归 `Unknown`。`buildTypeReports` 会**断言**本直方图的合计等于
 * 聚合内核数出来的 player-hand 数，两边一旦漂移就报错。
 */
function tallySeats(state: GameState, playerTypes: BotTypeMap, counters: RunCounters): void {
  for (const p of state.players) {
    if (p.isRealPlayer) continue; // 决策 38：真人始终按 playerId 聚合
    const assigned = playerTypes[p.id];
    const group: Group = isValidBotPersonality(assigned) ? assigned : 'Unknown';
    const hist = counters.seatHistogram.get(group) ?? {};
    hist[String(p.id)] = (hist[String(p.id)] ?? 0) + 1;
    counters.seatHistogram.set(group, hist);
  }
}

// ── 单 seed 运行 ─────────────────────────────────────────────────────────────

/**
 * 跑一个 seed：从冷启动开始，按 `handsPerSession` 分盘，跑满 `handsPerSeed` 手。
 *
 * 每个 seed 前清空长期库（`resetLongTermStats`）—— 这样 `getTypeLongStats()` 给的是
 * **本 seed 独立**的聚合，分 seed 稳定性才有意义；跨 seed 的池化由调用方用 `sumCounts`
 * 做（与 `computeTypeStats` 内部池化是同一套加法，口径不可能分叉）。
 */
function runSeed(cfg: CalibrationConfig, seed: number, counters: RunCounters): void {
  const sessionRng = mulberry32(seed ^ 0x5bf03635);
  const proxyRng = mulberry32(seed ^ 0x1b56c4e9);

  // 发牌 + 蒙特卡洛走 `Math.random`（与生产一致：那是「发牌/模拟」随机）。
  // 策略混合频率走 `random.ts`（生产里唯一受 `setRandomSeed` 控制的那条）。
  //
  // ── O1：发牌流**每手重播种**（方案 §9 阶段 1；`docs/CALIBRATION_RNG_PLAN.md`）──
  //
  // 此前 `Math.random` 是一条从 `mulberry32(seed)` 一路用到底的流，而蒙特卡洛权益
  // 也吃这条流 ⇒ 任何参数改动都会改变权益调用次数，从而让**后续每一次洗牌**整体错位、
  // 整个样本重抽（实测：只动 Nit 的 `openWiden`，参数未动的 TAG 的 PFR 18.4→20.2、
  // LAG 的 VPIP 33.8→31.7）。
  //
  // 现在每次发牌前把流重播种到 `mulberry32(hashSeed(seed, dealIndex))`，于是
  // 「第 k 手拿到的牌」= 该流的**前 51 次**抽样（`shuffleDeck` 的 Fisher-Yates），
  // 只由 `(seed, k)` 决定，与「本手之前消耗了多少随机数」无关。
  //
  // ⚠️ 本阶段只解耦了**发牌**：权益流仍与发牌流共用这条 `Math.random`（阶段 2 才拆），
  // 策略流也仍是「每 seed 播种一次、全桌共用」（阶段 3 才按决策重播种）。所以本阶段
  // 拿到的是**发牌级**的配置无关性，**指标级**的还没拿到。
  const originalMathRandom = Math.random;
  /**
   * 在**每次发牌前**把 `Math.random` 重播种到该手的独立流。
   *
   * `dealIndex` 用「已完成的累计手数」，因此在一个 seed 内唯一、且跨盘连续
   * （每盘 `handsPerSession` 手，但索引不重置）—— 不同 seed 之间由 `seed` 区分。
   * 也要覆盖 `createInitialState` 的 dealer 抽取：那一抽决定整盘（`RESET_ROUND`
   * 之后 dealer 是按 `(dealer % n) + 1` **确定性**轮转的），所以它同样必须与
   * 「此前消耗了多少随机数」无关。
   */
  const reseedDeal = (dealIndex: number): void => {
    Math.random = mulberry32(hashSeed(seed, dealIndex));
  };
  setRandomSeed(seed ^ 0x9e3779b9);

  try {
    resetLongTermStats();
    let handsDone = 0;

    while (handsDone < cfg.handsPerSeed) {
      // ── 开新盘（对应 `GameBoard` 的挂载 effect）──────────────────────────
      resetOpponentStats();
      beginSession();
      let handCounter = 0;
      let handKey = '';
      let handId = '';

      const botTypes = toBotTypeMap(
        botIdsForRange(cfg.realPlayers, cfg.botPlayers),
        allocateBotTypes(cfg.botPlayers, sessionRng),
      );

      // 冷启动状态 = `useGameState` 的 `createInitialState(2, 0)`，**含它消耗的那一个
      // `Math.random`**：`START_GAME` 的 dealer 取 `state.dealer || random`，而这里
      // `state.dealer` 恒为 1 或 2 ⇒ **每盘第一手的 dealer 只在 {1,2} 里**。这是生产
      // 现状，runner 原样复刻并在报告里注明（不偷偷"修"成按全桌人数抽）。
      reseedDeal(handsDone);
      let state = createInitialState(2, 0);
      // 发牌（`START_GAME` 的 `shuffleDeck`，51 次）从**本手独立流**的起点开始。
      reseedDeal(handsDone);
      state = gameReducer(state, {
        type: 'START_GAME',
        realPlayerCount: cfg.realPlayers,
        botPlayerCount: cfg.botPlayers,
        smallBlind: cfg.smallBlind,
        botPersonalityEnabled: true,
        botTypes,
      });

      for (let h = 0; h < cfg.handsPerSession; h++) {
        if (handsDone >= cfg.handsPerSeed) break;

        // 开手键（`GameBoard` 的手牌检测 effect）：键变了才算新的一手。
        const hero = state.players[0];
        const key = `${getSessionId()}-${state.dealer}-${hero.hand[0]?.rank}-${hero.hand[1]?.rank}`;
        if (key !== handKey) {
          handKey = key;
          handCounter++;
          handId = makeHandId(handCounter);
          const playerTypes: BotTypeMap = { ...botTypes };
          const playerRoles: Partial<Record<PlayerId, PlayerRole>> = {};
          for (const p of state.players) {
            playerRoles[p.id] = p.isRealPlayer ? 'human' : 'bot';
          }
          startNewHand(
            handId,
            state.players.map((p) => p.id),
            playerTypes,
            playerRoles,
          );
          tallySeats(state, playerTypes, counters);
        }

        state = playHand(state, handId, proxyRng, counters);
        settleHand(state);
        counters.hands++;
        handsDone++;

        // 下一手（`GameBoard.handleResetRound` → `useGameState.resetRound`）。
        // `RESET_ROUND` 只按 `(dealer % n) + 1` **确定性**轮转 dealer，不消耗随机数；
        // 真正的发牌在随后的 `START_GAME`，所以在它之前重播种。
        state = gameReducer(state, { type: 'RESET_ROUND' });
        reseedDeal(handsDone);
        state = gameReducer(state, {
          type: 'START_GAME',
          realPlayerCount: state.realPlayerCount,
          botPlayerCount: state.botPlayerCount,
          smallBlind: state.smallBlind,
          playerChips: state.players.map((p) => p.chips),
          playerBuyInCounts: state.players.map((p) => p.buyInCount),
          botPersonalityEnabled: state.botPersonalityEnabled,
          botTypes: state.botTypes,
        });
      }
    }
  } finally {
    Math.random = originalMathRandom;
  }
}

// ── 停止规则（机会数，而不是只看总手数） ──────────────────────────────────────

/**
 * 池化后的机会数是否达到方案 §10.4 的示意资源下限。
 *
 * 判定三条**硬**下限：每类 player-hand、看翻牌机会（WTSD 分母）、AF 跟注动作数。
 * §10.4 里「其他稀少机会 ≥100」原文是「**用于参考**」，所以只报告不拦停 ——
 * 把它当硬门会让 turn-c-bet 这类机会把整次运行拖到几万手。
 */
function opportunitiesMet(
  pooled: ReadonlyMap<Group, StatCounts>,
  expected: readonly BotPersonality[],
  cfg: CalibrationConfig,
): boolean {
  for (const g of expected) {
    const c = pooled.get(g);
    if (!c) return false;
    if (c.handsDealt < cfg.minPlayerHandsPerType) return false;
    if (c.wtsd.den < cfg.minFlopOpportunities) return false;
    if (c.afCalls < cfg.minAfCalls) return false;
  }
  return true;
}

// ── 报告组装 ─────────────────────────────────────────────────────────────────

function buildTypeReports(
  pooled: ReadonlyMap<Group, StatCounts>,
  vpipBySeed: ReadonlyMap<Group, Record<string, number>>,
  seatHistogram: ReadonlyMap<Group, Record<string, number>>,
): TypeReport[] {
  const out: TypeReport[] = [];
  for (const group of TYPE_ORDER) {
    const counts = pooled.get(group);
    if (!counts || counts.handsDealt === 0) continue;

    const seats = seatHistogram.get(group) ?? {};
    const seatTotal = Object.values(seats).reduce((a, b) => a + b, 0);
    // 自校验：座位直方图的合计必须等于聚合内核数出来的 player-hand 数。两边对不上
    // 说明 runner 的归属规则与 `typeStats.groupOf` 漂移了 —— 宁可报错。
    if (seatTotal !== counts.handsDealt) {
      throw new Error(
        `${group}: 座位直方图合计 ${seatTotal} ≠ 聚合 player-hand ${counts.handsDealt}（归属规则漂移）`,
      );
    }

    // `PlayerStats` 把 `afState` / `afAggressive` / `afCalls` 声明成可选（为手工构造的
    // 测试桩留口子）；`statsFromCounts` 总会填。这里显式归一化，报告层的类型就不用
    // 到处带 `undefined`。
    const computed = statsFromCounts(counts);
    const metrics: TypeMetrics = {
      ...computed,
      afState: computed.afState ?? 'no-actions',
      afAggressive: computed.afAggressive ?? 0,
      afCalls: computed.afCalls ?? 0,
      counts,
    };
    out.push({
      groupType: group,
      observedPlayerType: metrics.playerType,
      metrics,
      checks:
        group === 'Unknown'
          ? []
          : evaluateTargets(group, {
              vpip: metrics.vpip,
              pfr: metrics.pfr,
              af: metrics.af,
              afState: metrics.afState,
              wtsd: metrics.wtsd,
            }),
      seatHistogram: seats,
      vpipBySeed: vpipBySeed.get(group) ?? {},
    });
  }
  return out;
}

/** 分配 → 实测 的混淆矩阵（分类回归）。 */
function buildConfusion(
  types: readonly TypeReport[],
): Record<string, Record<string, number>> {
  const confusion: Record<string, Record<string, number>> = {};
  for (const t of types) {
    const row = confusion[t.groupType] ?? {};
    row[t.observedPlayerType] = (row[t.observedPlayerType] ?? 0) + t.metrics.handsDealt;
    confusion[t.groupType] = row;
  }
  return confusion;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

export function runCalibration(cfg: CalibrationConfig): CalibrationReport {
  installMemoryStorage();

  // reducer 每次状态转移都 `console.log` 一份完整 state（`logStateChange`，开发期诊断用）。
  // 万手规模下那是几十万行输出 —— 静音掉。报告走 `process.stdout.write`，不受影响。
  const mutableConsole = console as unknown as { log: (...args: unknown[]) => void };
  const originalLog = mutableConsole.log;
  mutableConsole.log = () => {};

  // 全局配置：现金局 + 无抽水（方案 §10.2「cash/no-rake 主场景」）。
  setGtoConfig({ engine: cfg.gto ? 'gto' : 'heuristic', scenario: cfg.scenario });
  setRakeConfig({ ...NO_RAKE });

  // 权益迭代：低迭代初筛时**临时**改写 `EQUITY_ITERATIONS` 的值。生产侧没有注入点
  // （它是模块级常量，所有调用方在**调用时**读它），直接改值是唯一不改生产源码的做法；
  // 跑完必须还原（`finally`）。
  const originalIterations = { ...EQUITY_ITERATIONS };
  if (cfg.equityIterations !== null) {
    for (const phase of Object.keys(EQUITY_ITERATIONS) as (keyof typeof EQUITY_ITERATIONS)[]) {
      EQUITY_ITERATIONS[phase] = cfg.equityIterations;
    }
  }

  const counters: RunCounters = {
    hands: 0,
    decisions: 0,
    rejectedBotDecisions: new Map(),
    seatHistogram: new Map(),
  };
  const pooled = new Map<Group, StatCounts>();
  const vpipBySeed = new Map<Group, Record<string, number>>();

  const started = Date.now();
  try {
    for (const seed of cfg.seeds) {
      runSeed(cfg, seed, counters);
      for (const row of getTypeLongStats()) {
        pooled.set(
          row.groupType,
          sumCounts(pooled.get(row.groupType) ?? EMPTY_STAT_COUNTS, row.counts),
        );
        const bySeed = vpipBySeed.get(row.groupType) ?? {};
        bySeed[String(seed)] = row.vpip * 100;
        vpipBySeed.set(row.groupType, bySeed);
      }
    }
  } finally {
    for (const phase of Object.keys(originalIterations) as (keyof typeof EQUITY_ITERATIONS)[]) {
      EQUITY_ITERATIONS[phase] = originalIterations[phase];
    }
    resetGtoConfig();
    resetRakeConfig();
    resetRandomSource();
    resetLongTermStats();
    resetOpponentStats();
    mutableConsole.log = originalLog;
  }
  const elapsedMs = Date.now() - started;

  const types = buildTypeReports(pooled, vpipBySeed, counters.seatHistogram);
  const expected = botTypeQuota(cfg.botPlayers);
  const met = opportunitiesMet(pooled, expected, cfg);

  const notes = [
    '真人座位由**固定代理策略**驱动（`calibrationCore.proxyDecide`，纯函数、规则公开）：' +
      '权益 ≥0.70 且可加注 → 价值加注；无跟注压力时按 6% 固定频率诈唬；' +
      '跟注需高于底池赔率 0.02。它是测试对手，不是产品分配的一部分，也不读任何 persona 参数。',
    `会话画像按**盘**累积（决策 40）：每 ${cfg.handsPerSession} 手重置一次会话并换 sessionId，` +
      '跨盘累计走长期库 —— 与生产「返回菜单再开新盘」同语义。该参数是 runner 参数，不是生产常数。' +
      `⚠️ 它必须**远大于 6**：每盘只跑 ${cfg.handsPerSession} 手时，一条盘只轮到 ` +
      `${Math.min(6, cfg.handsPerSession)} 个 dealer 位置，下面的「第一手 dealer 偏置」会被放大。`,
    '⚠️ 生产现状：每盘**第一手**的 dealer 取自 `createInitialState(2, 0)`（恒为 1 或 2），' +
      '不是按全桌人数抽的。runner 原样复刻，位置分布因此有轻微偏置。',
    `停止规则：每 seed 跑满 ${cfg.handsPerSeed} 手后按**机会数**判定（每类 player-hand ≥` +
      `${cfg.minPlayerHandsPerType}、看翻牌 ≥${cfg.minFlopOpportunities}、AF 跟注 ≥${cfg.minAfCalls}）。` +
      '未达标即为「样本不充分」→ 追加样本或调参重跑，**不改阈值**（决策 43）。' +
      '「其他稀少机会 ≥100」按 §10.4 原文只报告不拦停。',
  ];

  return {
    label: cfg.label,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    config: cfg,
    notes,
    hands: counters.hands,
    decisions: counters.decisions,
    rejectedBotDecisions: [...counters.rejectedBotDecisions.values()].reduce(
      (a, b) => a + b,
      0,
    ),
    rejectedBotByKind: Object.fromEntries(
      [...counters.rejectedBotDecisions.entries()].sort((a, b) => b[1] - a[1]),
    ),
    elapsedMs,
    equityIterations: cfg.equityIterations,
    stoppedBy: met ? 'opportunities' : 'hand-limit',
    types,
    confusion: buildConfusion(types),
  };
}

// CLI 入口：`node scripts/calibrate.mjs …`（见 `scripts/calibrate.mjs`）。
if (process.env.CALIBRATION_RUNNER_MAIN === '1') {
  const report = runCalibration(parseCalibrationArgs(process.argv.slice(2)));
  process.stdout.write(formatReport(report) + '\n');
}
