export interface SavedProgress {
  version: 1;
  chips: number[];
  realPlayers: number[];
  botPlayers: number[];
  smallBlind: number;
  dealer: number;
  savedAt: number;
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
