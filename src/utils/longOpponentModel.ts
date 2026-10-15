import type { PlayerId } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';
import {
  type PlayerStats,
  computePlayerStatsFromEvents,
} from './opponentModelUtil';
import { saveGameProgress, loadGameProgress } from './gamePersistence';
import { computeTypeStats, type TypeStats } from './typeStats';

export type { PlayerType, VpipPfrStats, PlayerStats } from './opponentModelUtil';
export type { TypeStats, BotTypeGroup } from './typeStats';

// 导出PlayerLongStats作为PlayerStats的别名（向后兼容）
export type PlayerLongStats = PlayerStats;

interface PersistentData {
  version: number;
  hands: HandRecord[];
}

const STORAGE_KEY = 'texas-poker-long-stats';

let persistentData: PersistentData = {
  version: 2,
  hands: [],
};

let initialized = false;

function loadFromStorage(): void {
  if (initialized) return;
  initialized = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.version === 2 && Array.isArray(data.hands)) {
        persistentData = data;
        return;
      }
    }
  } catch {
    // ignore
  }

  // No data found, use default
  persistentData = { version: 2, hands: [] };
}

function saveToStorage(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentData));
}

/**
 * 按事件**增量**建手牌记录（找不到就新建）。
 *
 * 注意：这条路径**不写开手快照**（`playerTypes` / `playerRoles`，方案 §8.2）——
 * 事件本身不带快照，无法在这里补出来。生产链路的开手记录走
 * `opponentModel.startNewHand`，结算时由 `GameBoard` 用 `saveHand` 整份覆盖；
 * 本函数只服务测试与「只有事件流」的场景，不要拿它当生产入口。
 */
export function recordAction(event: ActionEvent): void {
  loadFromStorage();

  // Find or create the hand record
  let handRecord = persistentData.hands.find(h => h.handId === event.handId);
  if (!handRecord) {
    handRecord = {
      handId: event.handId,
      timestamp: event.timestamp,
      events: [],
      players: [],
    };
    persistentData.hands.push(handRecord);
  }

  // Add the event
  handRecord.events.push(event);

  // Track players in this hand
  if (!handRecord.players.includes(event.playerId)) {
    handRecord.players.push(event.playerId);
  }

  saveToStorage();
}

export function saveHand(hand: HandRecord): void {
  loadFromStorage();

  // Check if hand already exists
  const existingIndex = persistentData.hands.findIndex(h => h.handId === hand.handId);
  if (existingIndex >= 0) {
    // Update existing hand
    persistentData.hands[existingIndex] = hand;
  } else {
    // Add new hand
    persistentData.hands.push(hand);
  }

  saveToStorage();
}

export function endCurrentHand(winner: PlayerId | null, potAmount: number): void {
  loadFromStorage();

  // Find the most recent hand (last one added)
  if (persistentData.hands.length === 0) return;

  const lastHand = persistentData.hands[persistentData.hands.length - 1];
  lastHand.result = { winner, potAmount };

  saveToStorage();
}

export function getPlayerLongStats(playerId: PlayerId): PlayerStats {
  loadFromStorage();

  // 把**完整**手牌记录交给 computePlayerStatsFromEvents，由它自己按玩家过滤：
  // 3-bet / fold-to-c-bet 要看对手的动作，c-bet / WTSD / WSD 只看该玩家自己的动作。
  // 以前这里传的是完整记录、但函数假定已过滤，于是 c-bet / WTSD / WSD 被算到了
  // 「本手最后一个翻前加注者」头上；而 session 路径传的又是过滤后的记录，
  // 于是 3-bet / fold-to-c-bet 恒为 null。现在两条路径统一。
  return computePlayerStatsFromEvents(playerId, persistentData.hands);
}

/**
 * 批量取长期统计。入参是**任意**玩家 id（真人或 Bot 都行）——
 * 长期库 `persistentData.hands` 存的是**整手**记录（含所有玩家的动作），
 * 所以 Bot 和真人一样能算，不需要按真人过滤。
 */
export function getAllPlayerLongStats(playerIds: PlayerId[]): PlayerStats[] {
  return playerIds.map(id => getPlayerLongStats(id));
}

/**
 * 按**分配类型**聚合的长期统计（方案 §8.1/§9.1，P7）。
 *
 * 与 `getAllPlayerLongStats` 的分工：
 * - 那个按**座位**（playerId）聚合 —— 座位不是稳定身份，同一座位跨盘可能是
 *   不同性格、也可能是真人；
 * - 这个按 P5 冻结的**开手快照**（`HandRecord.playerTypes`）分组 ——
 *   分配 TAG 的样本永远留在 TAG 组，即使实测像 Fish（§8.1，偏差是 P9 校准信号）。
 *
 * 真人**绝不**出现在结果里（决策 38：真人始终按 playerId 聚合）。
 * 只返回**有样本**的组；关闭性格时旧/新记录都归 `Unknown` 组，不会出现六行空行。
 *
 * 数据源是整个长期库（跨会话），所以这里能看到历史所有盘 —— 这也意味着
 * **性格开关是逐手的**：同一批结果里可能混着「开启时按类型分组的手」与
 * 「关闭时归 Unknown 的手」。是否展示类型行由调用方（UI）按当前盘配置决定。
 */
export function getTypeLongStats(): TypeStats[] {
  loadFromStorage();
  return computeTypeStats(persistentData.hands);
}

export function resetLongTermStats(): void {
  persistentData = { version: 2, hands: [] };
  localStorage.removeItem(STORAGE_KEY);
  initialized = false;
}

export function exportStats(): void {
  loadFromStorage();

  const progress = loadGameProgress();

  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    hands: persistentData.hands,
    progress,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'poker-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  success: boolean;
  hasProgress: boolean;
}

export async function importStats(file: File): Promise<ImportResult> {
  const fail: ImportResult = { success: false, hasProgress: false };
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if ((data.version === 2 || data.version === 3) && Array.isArray(data.hands)) {
      loadFromStorage();

      const existingHandIds = new Set(persistentData.hands.map(h => h.handId));
      for (const hand of data.hands) {
        if (!existingHandIds.has(hand.handId)) {
          persistentData.hands.push(hand);
        }
      }

      saveToStorage();

      let hasProgress = false;
      if (data.version === 3 && data.progress && data.progress.version === 1) {
        saveGameProgress(data.progress);
        hasProgress = true;
      }

      return { success: true, hasProgress };
    }

    return fail;
  } catch {
    return fail;
  }
}


