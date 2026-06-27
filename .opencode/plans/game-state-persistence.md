# Game State Persistence - Between-Round Save & Resume

## Context

The Texas Hold'em poker game loses all progress (chip counts, game config) on refresh/navigation. User wants to pause mid-session and resume later with the same chip counts.

**Approach**: Auto-save chips + config after each round settles. On StartPage, offer "Continue Last Game" (resume with saved chips) and "Start Game" (fresh chips, clears old save).

---

## Data Structure

```ts
// src/utils/gamePersistence.ts
interface SavedProgress {
  version: 1;
  chips: number[];          // chips[playerIndex] = chip count
  realPlayers: number[];    // e.g. [1, 2]
  botPlayers: number[];     // e.g. [3, 4]
  smallBlind: number;
  dealer: number;           // PlayerId
  savedAt: number;          // Date.now()
}
```

localStorage key: `'texas-poker-progress'`

---

## Step 1: Create `src/utils/gamePersistence.ts`

```ts
const STORAGE_KEY = 'texas-poker-progress';

export function saveGameProgress(progress: SavedProgress): void
  // JSON.stringify → localStorage.setItem

export function loadGameProgress(): SavedProgress | null
  // localStorage.getItem → JSON.parse, null on error/missing
  // Validate version === 1

export function clearGameProgress(): void
  // localStorage.removeItem

export function hasGameProgress(): boolean
  // return loadGameProgress() !== null
```

## Step 2: Edit `src/utils/translations.ts`

Add `persistence` section:

```ts
persistence: {
  continueGame: 'Continue Last Game',
  clearProgress: 'Clear Save',
  savedProgress: 'Saved Progress',
  savedAt: (time: string) => `Saved: ${time}`,
  playerChips: (name: string, chips: number) => `${name}: $${chips}`,
  confirmClear: 'Clear saved game progress?',
},
```

## Step 3: Edit `src/components/StartPage.tsx`

**New prop**: `onResumeGame: (progress: SavedProgress) => void`

**Logic**:
- On mount, call `loadGameProgress()` into local state
- If saved progress exists, show below existing "Start Game" button:
  - Saved info section (timestamp + each player's chips preview)
  - "Continue Last Game" button → calls `onResumeGame(savedProgress)`
  - "Clear Save" button → confirm → `clearGameProgress()` → remove section
- If no saved progress, original UI only

## Step 4: Edit `src/App.tsx`

**New state**: `savedChips: number[] | undefined`

| Action | Behavior |
|---|---|
| `handleStartGame` | `clearGameProgress()`, `savedChips = undefined`, start with fresh chips |
| `handleResumeGame(progress)` | Set config from progress, `savedChips = progress.chips`, start with saved chips |
| `handleBackToMenu` | `gameStarted = false`, `savedChips = undefined` |

**GameBoard props**: add `savedChips?: number[]`

## Step 5: Edit `src/components/GameBoard.tsx`

**Props**: add `savedChips?: number[]`

**Auto-save effect** — when `roundSettled` becomes true:
```ts
saveGameProgress({
  version: 1,
  chips: state.players.map(p => p.chips),
  realPlayers: state.players.filter(p => p.isRealPlayer).map(p => p.id),
  botPlayers: state.players.filter(p => !p.isRealPlayer).map(p => p.id),
  smallBlind: state.smallBlind,
  dealer: state.dealer,
  savedAt: Date.now(),
});
```

**Save on back** — wrap `onBackToMenu` to also save before navigating away

**Init with saved chips** — pass `savedChips` to `startGame()`:
```ts
startGame(playerConfig.realPlayers, playerConfig.botPlayers, playerConfig.smallBlind, savedChips);
```

---

## Files Changed

| File | Action |
|---|---|
| `src/utils/gamePersistence.ts` | NEW |
| `src/utils/translations.ts` | EDIT |
| `src/components/StartPage.tsx` | EDIT |
| `src/App.tsx` | EDIT |
| `src/components/GameBoard.tsx` | EDIT |

**NOT changed**: `useGameState.ts` (already supports `playerChips` in `START_GAME`)

---

## Verification

1. `npm run lint` — no errors
2. `npm test` — all tests pass
3. Manual test:
   - Play a round to settlement → verify `texas-poker-progress` in localStorage
   - Click "Back" → StartPage shows "Continue Last Game" with chip info
   - Click "Continue Last Game" → new round with saved chips
   - Go back → click "Start Game" → fresh chips, save cleared
   - Refresh mid-game → go back → "Continue Last Game" still works
