import type { GameScenario } from './gtoConfig';
import type { RakeConfig } from './rake';

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
