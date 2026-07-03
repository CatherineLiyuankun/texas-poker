# Add 4 New Poker Stats: 3-Bet%, Fold to C-Bet%, AFq%, Turn C-Bet%

## Overview

Add 4 new tracking statistics to the player stats table in HandAnalysis. These stats require new computation functions, updated interfaces, and table layout changes.

**New table layout (13 columns):**
```
Pre-Flop (4):  VPIP, PFR, 3-Bet%, Type
Post-Flop (6): AF, AFq, CBet, Fold to C-Bet, Turn CBet, C/R
Showdown (2):  WTSD, W$SD
```

## File Changes

### 1. `src/utils/opponentModelUtil.ts` — 4 new compute functions

**a. `compute3BetFromEvents(events: ActionEvent[]): number | null`**
- Analyzes preflop event sequence per hand
- For each hand: sort preflop events by timestamp, track if a raise occurred before the target player's first action
- If player's first preflop action is `raise`/`allin` AND a prior raise exists → 3-bet
- Formula: `3bets / opportunities * 100`
- Note: Cannot rely on `isFacingRaise` field (incorrectly true for all preflop actions since `lastBet >= BB`)

**b. `computeFoldToCbetFromEvents(playerId: PlayerId, hands: HandRecord[]): number | null`**
- Requires FULL hand events (not filtered to single player)
- For each hand: identify PFR (last preflop raiser from ALL events), check if PFR bets on flop, check if target player faced the bet and folded
- Formula: `folds / opportunities * 100`

**c. `computeAFqFromEvents(events: ActionEvent[]): number | null`**
- Postflop events: count aggressive actions (raise + allin) and total actions (raise + allin + call + check + fold)
- Formula: `aggressive / total * 100`
- Similar to existing `computeAFFromEvents` but uses total as denominator

**d. `computeTurnCbetFromEvents(playerId: PlayerId, hands: HandRecord[]): number | null`**
- Requires FULL hand events
- For each hand: identify PFR, check if PFR bets on flop (c-bet), then check if PFR also bets on turn
- Formula: `turn_cbets / flop_cbets * 100`

### 2. `src/utils/opponentModel.ts` — 4 new getters + interface update

- `getOpponent3Bet(playerId)` — uses filtered player events
- `getOpponentFoldToCbet(playerId)` — uses FULL hand events (not filtered)
- `getOpponentAFq(playerId)` — uses filtered player events
- `getOpponentTurnCbet(playerId)` — uses FULL hand events (not filtered)
- `BotStatsWithAF`: add `threeBet: number | null`, `foldToCbet: number | null`, `afq: number | null`, `turnCbet: number | null`
- Wire into `getRealPlayerSessionStats` and `calculateOpponentProfile`

### 3. `src/utils/longOpponentModel.ts` — interface + computation

- `PlayerLongStats`: add same 4 fields
- `getPlayerLongStats`: compute 4 new stats
- For fold-to-cbet and turn cbet: pass full `playerHands` (already has full events from `persistentData.hands`)

### 4. `src/utils/translations.ts` — new keys

```
threeBet: '3-Bet'
foldToCbet: 'F/CB'
afq: 'AFq'
turnCbet: 'Turn CB'
```

### 5. `src/components/HandAnalysis.tsx` — display

- 4 new color functions:
  - `get3BetColor`: <5% blue (tight), 7-10% green (standard), >12% red (aggressive)
  - `getFoldToCbetColor`: <40% red (station), 50-60% green (standard), >70% blue (exploitable)
  - `getAFqColor`: <35% blue (passive), 40-55% green (balanced), >60% red (aggressive)
  - `getTurnCbetColor`: <40% blue (one-and-done), 50-65% green (standard), >70% red (barreler)
- Update grouped headers: Pre-Flop colSpan=4, Post-Flop colSpan=6, Showdown colSpan=2
- Add 4 new `<td>` cells in both bot and real player rows

## Data Flow Note

**Critical for Fold to C-Bet and Turn C-Bet:** These stats need cross-player event data. The `getOpponent*` functions must pass **full hand events** (all players' actions), not just the target player's filtered events. The computation functions receive `playerId` + full `HandRecord[]` to find PFR and other players' actions internally.
