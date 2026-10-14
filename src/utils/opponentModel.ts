import type { PlayerId, Player } from '../types/poker';
import type { ActionEvent, HandRecord, PlayerRole } from '../types/stats';
import type { BotTypeMap } from './botPersonality';
import type { RandomSource } from './random';
import {
  type VpipPfrStats,
  type PlayerStats,
  collectPlayerEvents,
  computeTendencyFromEvents,
  computeFoldRateFromEvents,
  computePlayerStatsFromEvents,
  detectLimpersFromEvents,
} from './opponentModelUtil';

const STORAGE_KEY = 'texas-poker-session-stats';

interface SessionData {
  version: number;
  currentHand: HandRecord | null;
  sessionHands: HandRecord[];
}

let sessionData: SessionData = {
  version: 1,
  currentHand: null,
  sessionHands: [],
};

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      sessionData = JSON.parse(raw);
    }
  } catch {
    // ignore
  }
}

function saveToStorage(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
}

// ── 稳定手牌身份：`sessionId + handOrdinal`（方案 §8.2） ───────────────────────
//
// 旧实现的手牌 id 是 `${handCounter}-${dealer}-${hero底牌}`，`handCounter` 是
// **组件 ref**：返回菜单再开新盘会重挂载、计数归零，于是「同 dealer + 同底牌」
// 的新盘手牌会生成与上一盘**完全相同**的 id。长期库 `saveHand` 按 handId 覆盖，
// 旧手牌被悄悄吃掉，长期统计随之失真。
//
// 修法不是「把计数搬到模块级」——那只是把碰撞概率推远，而且会让「旧记录」被
// 批量改写。改成一个**每盘必新的 `sessionId`**：跨盘手牌键天然不同，盘内再用
// 单调递增的 `handOrdinal` 区分每一手。**旧记录保留原 id，不批量重写。**

let sessionSeq = 0;
let sessionId = '';

/**
 * 拼一个新的盘 id。
 *
 * 唯一性靠「毫秒时间戳 + 进程内自增序号」，**默认不消耗任何随机源** —— 见
 * `beginSession` 的说明。传了 `random` 才额外掺一份噪声（测试注入用）。
 */
function nextSessionId(random?: RandomSource): string {
  sessionSeq += 1;
  const base = `${Date.now().toString(36)}-${sessionSeq.toString(36)}`;
  return random
    ? `${base}-${Math.floor(random() * 0x100000000).toString(36)}`
    : base;
}

// 模块加载即分配一份：`makeHandId` 在任何调用点都拿得到非空 id。
sessionId = nextSessionId();

/**
 * 新盘边界：换一个新的 `sessionId`（方案 §8.2）。
 *
 * 默认**不消耗随机源**，这是刻意的：`GameBoard` 在 `startGame`（洗牌）之前调用本
 * 函数，多消耗一个 `Math.random()` 就会把播种的洗牌序列整体错位 ——
 * `GameBoard.showdown.settlement` 这类用例靠 `jest.spyOn(Math, 'random')` 钉住
 * 发牌结果，会被无声地翻掉。需要确定性的测试可显式注入 `random`。
 */
export function beginSession(random?: RandomSource): string {
  sessionId = nextSessionId(random);
  return sessionId;
}

/** 当前盘的 `sessionId`。手牌键的组成部分，不是用户可见数据。 */
export function getSessionId(): string {
  return sessionId;
}

/**
 * 用「当前盘 sessionId + 盘内手序」拼出稳定手牌身份（方案 §8.2）。
 *
 * 公式只此一处：调用方（`GameBoard`）只负责推进手序，容器记录与 `ActionEvent`
 * 共用同一个返回值 —— 旧实现两处各拼一遍字符串，改一处就会让「事件的 handId」
 * 与「容器的 handId」分叉。
 */
export function makeHandId(handOrdinal: number): string {
  return `${sessionId}-${handOrdinal}`;
}

/**
 * 开新一手。
 *
 * `playerTypes` / `playerRoles` 是**开手快照**（方案 §8.2）：在开手那一刻复制，
 * 之后不得再改 —— 它们与 `PlayerStats.playerType`（实测分类）是两种不可混淆的
 * 身份（方案 §8.1）：分配 TAG 但实测 Fish 的样本仍留在 TAG 组。
 */
export function startNewHand(
  handId: string,
  players: PlayerId[],
  playerTypes: BotTypeMap = {},
  playerRoles: Partial<Record<PlayerId, PlayerRole>> = {},
): void {
  loadFromStorage();

  // 同一手重复开局（组件重挂载 / StrictMode 双调用 / 新盘与恢复交错）时**必须**
  // 幂等：否则上一份 `currentHand` 会被推进 `sessionHands`，同一手在
  // `sessionHandRecords()` 里出现两次，统计被重复计数（决策 40「当前手不重复」）。
  if (sessionData.currentHand?.handId === handId) return;

  if (sessionData.currentHand) {
    sessionData.sessionHands.push(sessionData.currentHand);
  }

  sessionData.currentHand = {
    handId,
    timestamp: Date.now(),
    events: [],
    players: [...players],
    // 开手快照（方案 §8.2）：必须在这里**复制**，不能直接引用 `state.botTypes`
    // 之类的可变对象 —— 那样后续开新盘改写分配 map 会**追溯篡改**历史记录的归属。
    // 关闭性格时传空 map（而不是省略字段），聚合侧据此区分「新记录且关闭」与
    // 「旧记录无字段」（方案 §8.3）。
    playerTypes: { ...playerTypes },
    playerRoles: { ...playerRoles },
  };

  saveToStorage();
}

export function getCurrentHand(): HandRecord | null {
  loadFromStorage();
  return sessionData.currentHand;
}

export function recordAction(event: ActionEvent): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.events.push(event);
    saveToStorage();
  }
}

export function endCurrentHand(winner: PlayerId | null, potAmount: number): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.result = { winner, potAmount };
    sessionData.sessionHands.push(sessionData.currentHand);
    sessionData.currentHand = null;
    saveToStorage();
  }
}

export function setCurrentHandShowdownPlayers(players: PlayerId[]): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.showdownPlayers = players;
    saveToStorage();
  }
}

/** 翻牌发出时冻结的未弃牌名单（含翻前 all-in），见 `HandRecord.flopSeenPlayers`。 */
export function setCurrentHandFlopSeenPlayers(players: PlayerId[]): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.flopSeenPlayers = players;
    saveToStorage();
  }
}

/** 摊牌中从任意奖池获得 > 0 份额的玩家（含平分/边池），见 `HandRecord.showdownWinners`。 */
export function setCurrentHandShowdownWinners(players: PlayerId[]): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.showdownWinners = players;
    saveToStorage();
  }
}

export function resetOpponentStats(): void {
  sessionData = {
    version: 1,
    currentHand: null,
    sessionHands: [],
  };
  localStorage.removeItem(STORAGE_KEY);
}

export function detectLimpers(bigBlind: number): PlayerId[] {
  loadFromStorage();

  if (!sessionData.currentHand) return [];

  return detectLimpersFromEvents(sessionData.currentHand.events, bigBlind);
}

/**
 * 当前会话的**完整**手牌记录（含所有玩家的动作）。
 *
 * 必须整份交给 `computePlayerStatsFromEvents`，由它自己按玩家过滤：
 * 3-bet / fold-to-c-bet 要看对手的动作，c-bet / WTSD 只看自己的动作，
 * 两种口径都要，所以调用方不能提前过滤。
 *
 * 导出给 `scripts/` 下的 headless 校准 runner：它按同样的口径喂
 * `computeTypeStats` / `computePlayerStatsFromEvents`，不另建一份记录容器。
 */
export function sessionHandRecords(): HandRecord[] {
  return sessionData.currentHand
    ? [...sessionData.sessionHands, sessionData.currentHand]
    : sessionData.sessionHands;
}

/**
 * 会话内某玩家统计的**单点入口**。
 *
 * 原先每个访问器各写一遍「收集事件 + 收集手牌 + 计算」，12 处几乎完全相同；
 * 收敛到这里之后不会再出现「某一路忘了传完整记录」的漏改。
 */
function computeSessionStats(playerId: PlayerId): PlayerStats {
  return computePlayerStatsFromEvents(playerId, sessionHandRecords());
}

export function getOpponentVpipPfr(playerId: PlayerId): VpipPfrStats {
  loadFromStorage();

  const stats = computeSessionStats(playerId);
  return {
    playerId: stats.playerId,
    handsDealt: stats.handsDealt,
    vpip: stats.vpip,
    pfr: stats.pfr,
    gap: stats.gap,
    playerType: stats.playerType,
  };
}

export function getOpponentAF(playerId: PlayerId): number | null {
  loadFromStorage();

  return computeSessionStats(playerId).af;
}

// 这里**故意**不再为 `cbet` / `wtsd` / `wsd` / `checkRaise` / `threeBet` /
// `foldToCbet` / `afq` / `turnCbet` 各开一个 `getOpponentXxx` 单字段访问器。
// 它们曾经存在，但没有任何生产代码或测试读过 —— 读这些字段的只有两处整表消费：
//   - `calculateOpponentProfile(...).botStats`（面板 NodeLock 区块）
//   - `getRealPlayerSessionStats(ids)`（面板对手统计表）
// 两者拿到的都是完整的 `PlayerStats`，单字段包装没有存在价值。
// 需要新字段时**直接从 `PlayerStats` 读**，不要再开包装函数：每多一个包装就多一条
// 「忘了把完整手牌记录传进去」的漏改路径。

// 导出统一的PlayerStats接口作为BotStatsWithAF的别名（向后兼容）
export type BotStatsWithAF = PlayerStats;

export function getRealPlayerSessionStats(
  playerIds: PlayerId[],
): PlayerStats[] {
  return playerIds.map(id => computeSessionStats(id));
}

export interface OpponentInfo {
  id: PlayerId;
  tendency: 'aggressive' | 'passive' | 'unknown';
  foldRate: number;
}

export interface OpponentProfile {
  opponents: OpponentInfo[];
  botStats: BotStatsWithAF[];
  avgFoldRate: number;
  hasAggressive: boolean;
  hasPassive: boolean;
  opponentCount: number;
}

export interface OpponentAdjustments {
  raiseBonus: number;
  callPenalty: number;
  foldPenalty: number;
}

export function getOpponentTendency(playerId: PlayerId): 'aggressive' | 'passive' | 'unknown' {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  return computeTendencyFromEvents(allEvents);
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  return computeFoldRateFromEvents(allEvents);
}

export function calculateOpponentProfile(
  players: Player[],
  currentPlayerId: PlayerId,
): OpponentProfile {
  const opponents = players.filter(
    (p) => !p.folded && p.id !== currentPlayerId,
  );

  const opponentInfos: OpponentInfo[] = opponents.map((p) => ({
    id: p.id,
    tendency: getOpponentTendency(p.id),
    foldRate: getOpponentFoldRate(p.id),
  }));

  const avgFoldRate =
    opponentInfos.length > 0
      ? opponentInfos.reduce((sum, o) => sum + o.foldRate, 0) /
        opponentInfos.length
      : 0.3;

  const hasAggressive = opponentInfos.some((o) => o.tendency === 'aggressive');
  const hasPassive = opponentInfos.some((o) => o.tendency === 'passive');

  return {
    opponents: opponentInfos,
    botStats: opponents.map((p) => computeSessionStats(p.id)),
    avgFoldRate,
    hasAggressive,
    hasPassive,
    opponentCount: opponentInfos.length,
  };
}

export function getOpponentAdjustments(
  profile: OpponentProfile,
): OpponentAdjustments {
  if (profile.opponentCount === 0) {
    return { raiseBonus: 0, callPenalty: 0, foldPenalty: 0 };
  }

  const aggressiveCount = profile.opponents.filter(
    (o) => o.tendency === 'aggressive',
  ).length;
  const passiveCount = profile.opponents.filter(
    (o) => o.tendency === 'passive',
  ).length;

  const callPenalty = Math.min(aggressiveCount * 0.05, 0.10);
  const raiseBonus = profile.avgFoldRate > 0.35 ? 0.10 : 0;
  const foldPenalty = Math.min(passiveCount * 0.04, 0.08);

  return { raiseBonus, callPenalty, foldPenalty };
}
