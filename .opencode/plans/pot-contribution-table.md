# Plan: Change "奖池分配 Pot Distribution" to "奖池贡献 Pot Contribution"

## Goal
Replace the pot distribution table (showing how winnings are split among winners) with a pot contribution table (showing how much each player contributed to each pot).

## Files to Modify

| File | Change |
|------|--------|
| `src/types/poker.ts` | Add `contributions: number[]` to `PotDistribution` interface |
| `src/utils/potCalculator.ts` | Add `computeContributions()` helper function |
| `src/hooks/useGameState.ts` | Populate `contributions` at all ~6 `potDist` construction sites |
| `src/components/GameBoard.tsx` | Render `contributions` instead of `winnings` in the table (lines 416-467) |
| `src/utils/translations.ts` | Change title to `'奖池贡献 Pot Contribution'` |

## Detailed Changes

### 1. `src/types/poker.ts` (line 69-73)
Add `contributions: number[]` to `PotDistribution`, keeping `winnings` alongside:
```typescript
export interface PotDistribution {
  potType: string;
  amount: number;
  winnings: number[];
  contributions: number[];  // NEW: per-player contribution amounts
}
```

### 2. `src/utils/potCalculator.ts` - New helper function
Add after `calculatePots`:
```typescript
export function computeContributions(
  players: Player[],
  potCalc: PotCalculation,
): { mainContributions: number[]; sideContributions: number[][] } {
  const playersWithBet = players.filter((p) => p.bet > 0);
  const activePlayers = players.filter((p) => !p.folded && p.bet > 0);
  const mainThreshold = activePlayers.length > 0
    ? Math.min(...activePlayers.map((p) => p.bet))
    : 0;

  const mainContributions = players.map((p) =>
    p.bet > 0 ? Math.min(p.bet, mainThreshold) : 0,
  );

  const sideContributions = potCalc.sidePots.map((sp) => {
    const threshold = sp.threshold ?? 0;
    const levelBet = /* computed from threshold diffs */
    return players.map((p) =>
      p.bet >= threshold && !p.folded ? levelBet : 0,
    );
  });

  return { mainContributions, sideContributions };
}
```
(Note: levelBet is `threshold - prevThreshold`, computed from sorted thresholds like in `calculatePots`.)

### 3. `src/hooks/useGameState.ts` - 6 sites to update

At each site, when building `potDist`, also compute and include `contributions` using the player's `totalBet` (set as `bet` in temp players):

**Site 1 (line ~460, PLAYER_ACTION fold):**
Uses `calculatePots(tempPlayers, 0)` - add contribution arrays from `computeContributions(tempPlayers, potCalc)`.

**Site 2 (line ~549, FOLD action):**
Same pattern as Site 1 - uses `calculatePots(tempPlayers, 0)`.

**Site 3 (line ~643, NEXT_STREET single eligible player):**
Uses `state.players` directly. Compute contributions from each player's `totalBet`:
- Create temp players with `bet: p.totalBet`
- Call `calculatePots` + `computeContributions`

**Site 4 (line ~805, NEXT_STREET multi-player showdown):**
Uses `state.mainPot` and `state.sidePots`. Compute contributions from player `totalBet` values with the same helper.

**Site 5 (line ~884, COLLECT_POT):**
Single pot entry. Compute contributions from player `totalBet`.

**Site 6 (line ~928, SPLIT_POT):**
Single pot entry. Compute contributions from player `totalBet`.

### 4. `src/utils/translations.ts` (line 111)
```typescript
// Before:
title: '奖池分配 Pot Distribution',
// After:
title: '奖池贡献 Pot Contribution',
```

### 5. `src/components/GameBoard.tsx` (lines 416-467)

Change the table rendering:
- **Title**: uses `translations.potDistribution.title` (auto-updated via translations)
- **Cell values**: Replace `pot.winnings[idx]` with `pot.contributions[idx]`
- **Cell color**: Change from `text-green-400` (for winnings > 0) to plain white text (no conditional green)
- **Total column**: Sum `pot.contributions[idx]` instead of `pot.winnings[idx]`
- **Header pot amounts**: Keep yellow `$pot.amount` (unchanged)

Specifically lines 442-462:
```tsx
{state.players.map((p, idx) => {
  const totalContrib = state.potDistribution.reduce(
    (sum, pot) => sum + (pot.contributions[idx] ?? 0), 0,
  );
  return (
    <tr key={p.id}>
      <td className="px-2 py-1">{getPlayerDisplayName(p, idx)}</td>
      {state.potDistribution.map((pot, potIdx) => {
        const contrib = pot.contributions[idx] ?? 0;
        return (
          <td key={potIdx} className={`px-2 py-1 text-right ${contrib > 0 ? 'text-white' : 'text-white/60'}`}>
            ${contrib}
          </td>
        );
      })}
      <td className={`px-2 py-1 text-right font-bold ${totalContrib > 0 ? 'text-white' : 'text-white/60'}`}>
        ${totalContrib}
      </td>
    </tr>
  );
})}
```

## Verification
After implementation, run:
1. `npm run lint` - check for ESLint errors
2. `npm run build` - check TypeScript compilation
3. `npm test` - run existing tests
4. Manual verification: start dev server, play a round, confirm the bottom-left table shows contributions (not winnings)
