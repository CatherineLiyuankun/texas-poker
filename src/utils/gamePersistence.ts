import type { GameScenario } from './gtoConfig';
import type { RakeConfig } from './rake';
import type { BotTypeMap } from './botPersonality';

export interface SavedProgress {
  version: 1;
  chips: number[];
  buyInCounts: number[];
  realPlayers: number[];
  botPlayers: number[];
  smallBlind: number;
  dealer: number;
  savedAt: number;
  gtoEnabled?: boolean;
  /** 赛制。老存档没有这个字段，读取方按 `'cash'` 兜底（与配置化前行为一致）。 */
  scenario?: GameScenario;
  /** 抽水。老存档没有这个字段，读取方按「不抽水」兜底（与可配置前行为一致）。 */
  rake?: RakeConfig;
  /**
   * 本盘是否启用 Bot 性格。老存档没有这个字段 → 规范化后按「关闭」处理（决策 31），
   * **不继承**新局默认开。
   */
  botPersonalityEnabled?: boolean;
  /**
   * 本盘的有效分配 map（座位 → 性格）。与 `botPersonalityEnabled` 成对：
   * 开关缺失 / `false` / map 损坏时读取方一律退回「关闭 + 空 map」（决策 36）。
   */
  botTypes?: BotTypeMap;
}

/**
 * 当前 reducer 支持的玩家总数范围。与 `StartPage` 的新局校验共用同一份常量，
 * 避免「UI 允许开 X 人桌、恢复层却不认」的口径漂移。
 */
export const MIN_TOTAL_PLAYERS = 2;
export const MAX_TOTAL_PLAYERS = 10;

/**
 * 存档名单是否符合当前 reducer 的**前缀布局**约定（方案 §6.2）。
 *
 * reducer 只按「人数」重建角色（真人为 `1..R`、Bot 为 `R+1..R+B`），并不接收
 * 真实名单。所以只有当存档名单本身就是这个前缀布局时，按人数恢复才等价于
 * 按名单恢复；否则（例如 `human=[2], bot=[1,3]`）恢复会把角色与筹码**静默错位**。
 * 这种非前缀名单必须显式拒绝并提示，不得丢弃或重映射类型 / 筹码（方案 §6.2）。
 *
 * 同时校验：`chips` 与总人数等长、总人数在 `2..10`、每个座位 id 唯一且落在
 * `1..total`（前缀布局天然保证落在范围内）。
 */
export function isPrefixRoster(
  progress: Pick<SavedProgress, 'chips' | 'realPlayers' | 'botPlayers'>,
): boolean {
  const { chips, realPlayers, botPlayers } = progress;
  if (!Array.isArray(chips) || !Array.isArray(realPlayers) || !Array.isArray(botPlayers)) {
    return false;
  }
  const total = realPlayers.length + botPlayers.length;
  if (total < MIN_TOTAL_PLAYERS || total > MAX_TOTAL_PLAYERS) return false;
  if (chips.length !== total) return false;

  const all = [...realPlayers, ...botPlayers];
  if (new Set(all).size !== total) return false;

  for (let i = 0; i < realPlayers.length; i++) {
    if (realPlayers[i] !== i + 1) return false;
  }
  for (let i = 0; i < botPlayers.length; i++) {
    if (botPlayers[i] !== realPlayers.length + i + 1) return false;
  }
  return true;
}

const STORAGE_KEY = 'texas-poker-progress';

export function saveGameProgress(progress: SavedProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn('Failed to save game progress:', e);
  }
}

export function loadGameProgress(): SavedProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    return parsed as SavedProgress;
  } catch {
    return null;
  }
}

export function clearGameProgress(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasGameProgress(): boolean {
  return loadGameProgress() !== null;
}
