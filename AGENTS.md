# AGENTS.md — Guidelines for Autonomous/Agentic Coding in `texas-poker`

---

## Table of Contents
1. **Project Overview**
2. **Build, Lint, and Test Commands**
3. **Core Game Logic**
4. **Code Style and Formatting Rules**
5. **TypeScript, Error Handling, and Naming**
6. **Imports and File Organization**
7. **Development, Review, and Best Practices**

---

## 1. Project Overview

This project is a React + TypeScript web application for Texas Hold'em Poker. All agentic (AI/autonomous) contributions must respect project conventions, code style, and automation/CI requirements.

---

## 2. Build, Lint, and Test Commands

**Build:**
```
npm run build
```
*Alias for:* `tsc -b && vite build`

**Development Server:**
```
npm run dev
```
*Runs the Vite development server with hot reload.*

**Lint:**
```
npm run lint
```
*Runs ESLint with project configuration for TypeScript, React, and Hooks.*

### Testing

Tests are now fully implemented with Jest and React Testing Library.

**Run all tests:**
```
npm test
```

**Run specific test files:**
```
npm test potCalculator.test.ts          # Unit tests for pot calculation
npm test useGameState.integration.test.ts  # Integration tests for game flow
```

**Test Structure:**
- **Unit Tests**: `src/utils/__tests__/potCalculator.test.ts` - Algorithm correctness (11 tests)
- **Integration Tests**: `src/e2eTests/useGameState.integration.test.ts` - Full game flow (9 tests)
- **Hook Tests**: `src/hooks/__tests__/` - Hook behavior tests
- Place all new test files in `src/**/*.test.{ts,tsx}`

**Test Coverage:**
- Pot calculation: 6 standard Texas Hold'em scenarios + edge cases
- Game flow: Chip conservation, all-in mechanics, pot splitting
- Must ensure chip conservation (total chips = initial chips) at all times

---

## 3. Core Game Logic

### Pot Calculation (`src/utils/potCalculator.ts`)

The pot calculation logic follows standard Texas Hold'em rules:

**Key Function:**
```typescript
calculatePots(players: Player[], currentPot: number): PotCalculation
```

**Algorithm:**
1. **Main Pot**: Sum of `min(player.bet, mainThreshold)` for all players with bet > 0
2. **Side Pots**: Created for each betting threshold level above mainThreshold
3. **Eligible Players**: Only players with `!folded && bet >= threshold` can contest each pot

**Critical Rules:**
- Blinds are forced bets and always count toward pot (even if `hasActed=false`)
- All-in creates side pots when bet amounts differ
- Chip conservation must be maintained: `sum(all bets) = mainPot + sidePots total`
- Never double-count chips (mainPot display value vs. player.bet)

**Example Scenario:**
```
Players: A($20), B($50), C($80), D($80)
Main Pot: $80 (20×4, all players eligible)
Side Pot 1: $90 ((50-20)×3, players B,C,D eligible)  
Side Pot 2: $60 ((80-50)×2, players C,D eligible)
Total: $230 = sum of all bets ✓
```

### Game State Management (`src/hooks/useGameState.ts`)

**State Flow:**
- `START_GAME`: Initialize blinds, set mainPot for UI display
- `PLAYER_ACTION`: Handle check/call/raise/fold/allin
- `NEXT_STREET`: Reset bets for new round, handle showdown
- **All-in Logic**: Call `calculatePots(players, 0)` to avoid double-counting

**Critical Implementation Details:**
- `state.mainPot` is for UI display only, actual chips tracked in `player.bet`
- When calculating pots after all-in, pass `currentPot=0` to avoid duplication
- Clear existing side pots before recalculating (fix cumulative bug)

### Board Texture Analysis (`src/utils/boardTexture.ts`)

Wet/dry texture drives postflop strategy (c-bet frequency, sizing). Two layers:

- `analyzeBoard(cards)`: fast deterministic heuristic, street-aware. Flop/turn score
  draw potential (flush/straight/connectivity); river scores made-hand structure
  (four-flush, straight on board, one-card straight completions) since no draws exist.
  Ace counts low only for genuine wheel structures (A-2-3), and the low-card bonus
  requires connectivity.
- `analyzeBoardWithEquity(cards)`: heuristic blended 70/30 with an equity calibration
  (`calibrateWetnessWithEquity`) that measures top-set equity vs a random hand via
  `calculateEquity`. Vulnerable top set = wet. Results are cached per board; river
  boards fall back to the heuristic. Use this for AI analysis/decision entry points.

**Rules:**
- Keep `analyzeBoard` pure and fast; do not add Monte Carlo work to it.
- Equity calibration is flop/turn only and must stay cached (one `calculateEquity`
  call per distinct board).
- Extend `BoardTexture` fields rather than changing existing ones; consumers rely on
  `wetness` and `classification`.

### Equity Calculation (`src/utils/equityCalculator.ts`, `src/utils/rangeEquity.ts`, `src/utils/postflopRange.ts`)

Decision quality hinges on equity estimates. Two layers:

- `calculateEquity(hand, board, numOpponents, iterations, options?)`: Monte Carlo
  with partial shuffles and a reused deck. Ties split correctly as `1/(1+tied)`.
  Heads-up river is computed by exact enumeration (hero evaluated once, all
  C(45,2) opponent hands) — zero variance at Monte Carlo cost.
  `options.opponentCombos` samples the primary opponent from an estimated range;
  extra opponents stay random. `options.weightedCombos` (takes precedence over
  `opponentCombos`) samples from weighted combos, and `exactHeadsUpRiverEquity`
  honours the same weights so the exact and Monte Carlo paths agree.
- `calculateRangeAwareEquity(hero, state, community, numOpponents, iterations)`:
  the decision entry point. Estimates the primary opponent's continuing range
  (`estimateOpponentCombos`) from preflop role (most-invested player = opener,
  otherwise defender vs the aggressor), position tables in `gtoPreflop.ts`,
  card removal, and optional VPIP width tuning from `opponentModel`, **then
  narrows it by the observed postflop action line**. Falls back to random-hand
  equity when no range can be inferred.
- `postflopRange.narrowRangeByPostflopAction(combos, line, options?)`: per street,
  buckets each combo into `strong / medium / draw / weak / air` against that
  street's board and multiplies its weight by the category's propensity to take
  the observed action. Frequencies come from `postflopFrequencies.ts` (shared with
  `gtoPostflop.ts`), bluff weight from the `gtoMath.ts` value:bluff closed form,
  and facing-bet responses are anchored on MDF.

**Rules:**
- Decision code should call `calculateRangeAwareEquity`, not raw `calculateEquity`,
  except where ranges are meaningless (e.g., board-texture calibration uses random
  opponents on purpose).
- Range expansion (`expandRange`) must always apply card removal against hero +
  board before use.
- Keep exact enumeration for heads-up river; do not replace it with Monte Carlo.
- Postflop narrowing must use **soft / weighted** filtering: weights multiply
  across streets and are floored per street (`MIN_WEIGHT`), never zeroed. Hard
  filtering drops below the `combos.length >= 3` floor and silently falls back to
  random equity, which looks like a bug but is not. An empty action line must leave
  every weight at 1 so the result is identical to the preflop-only range.
- `gtoPostflop.ts` and `postflopRange.ts` must share frequencies through
  `postflopFrequencies.ts`, never by importing each other (import cycle).
- Never feed `getPreflopStrength` / `getPreflopTier` output into EV math — those
  return a 2–20 Chen score, not a probability. Preflop equity is Monte Carlo, the
  same engine as postflop; the panel only keeps the score for display.
- The `HandAnalysis` panel must show random equity and range equity as two separate
  values. Range equity falls back to random equity when `estimateOpponentCombos`
  returns `null`, and both must stay 0–1 probabilities so `gtoMath.ts` consumes them
  directly. When narrowing or AF-based exploitation changes the result, surface the
  `rangeNarrowed` / `rangeExploitative` labels so the user knows the figure is
  exploitative, not a pure GTO range.

### GTO Math (`src/utils/gtoMath.ts`)

The panel's GTO Math block (MDF / value:bluff / call & raise EV) is closed-form,
single-street and heads-up — an approximation for display, not a full GTO solution.

**Two pot conventions — the root of most past bugs:**

- Ratio functions (`calculateMDF`, `calculateValueBluffRatio`, `calculateBluffFrequency`,
  `calculateRequiredFoldEquity`) take the **pot before the bet** `P` plus the **increment** `B`.
- `calculateCallEV` takes the **pot with the bet** (`P + B`) plus the call amount `B`.

`state.mainPot` / `currentPot` are pot-with-bet. Callers holding only the pot-with-bet must
go through the adapter (`mdfFrom`), never hand-write `totalPot - toCall` — doing that once
turned a half-pot MDF of 0.667 into 0.75 and a 3:1 value:bluff into 4:1.

**Rules:**

- MDF has a single implementation (`calculateMDF`); business code goes through `mdfFrom`.
- The value:bluff formula has a single implementation (`bluffShare`), shared by
  `calculateValueBluffRatio` (string ratio, e.g. `3:1`) and `calculateBluffFrequency`
  (numeric ratio). Do not re-derive `B / (P + 2B)`.
- `calculateRaiseEV` **must be passed `toCall`** (the chips the opponent already put in):
  on a call they only add `raiseSize − toCall`, so the final pot is
  `potSize + raiseSize + (raiseSize − toCall)`, **not** `potSize + 2·raiseSize`. Omitting it
  (default 0) is only correct for a bet into an unbet pot, and otherwise overstates raise EV
  by `equity · toCall · (1 − foldPct)`.
- The panel path for raise EV is `raiseEVFromContext({ equity, totalPot, heroBet, raiseTo,
  toCall })` — it owns the pot-with-bet → pot-before-bet conversion and returns
  `heroPotBefore` / `heroIncrement` for reuse by the value:bluff row. Do not re-inline the
  conversion in the component.
- `raiseEVFromContext` returns `raiseEV: null` unless the raise-to **strictly exceeds** the
  current bet (`heroIncrement > toCall`, i.e. `raiseTo > lastBet`). A raise-to that merely
  matches the call **is** a call, and anything below it is an illegal amount the
  `ActionButtons` confirm key already rejects — neither has fold equity, so pricing them
  with `calculateRaiseEV`'s `foldPct × pot` term invents EV and makes the panel recommend a
  raise that does not exist. The panel hides the row (and the ✅) on `null`.
- `classifyRange` is a **heuristic**, not a GTO solution; it only labels the panel. Never
  feed it into EV or decision logic.

### Strategy configuration (`src/utils/gtoConfig.ts`, `src/utils/rake.ts`)

`engine` (`gto` | `heuristic`) and `scenario` (`cash` | `tournament`) are **two orthogonal
fields of one config object**, not two module-level `let`s. Read via `getGtoConfig()` /
`isGtoEngine()` / `isTournamentScenario()`; write via `setGtoConfig(patch)`, which merges
because the two UI toggles write independently.

`scenario` gates three things, and they must stay mutually consistent:

| Gate | Cash | Tournament |
| --- | --- | --- |
| ICM risk premium (`gtoICM.riskPremiumFor`) | 0 | derived from the stack-relative bubble factor |
| Rake (`rake.effectiveRakeConfigFor`) | user config | always `NO_RAKE` |
| Preflop ranges (`gtoPreflop`) | base tables | derived, tighter tables |

**Rules:**

- **Render layer takes the scenario as a parameter; decision layer reads the global.**
  `GameBoard` mirrors its `scenario` state into `gtoConfig` inside a `useEffect`, so on the
  frame the toggle flips the prop has changed and the global has not. Anything that paints
  (`rake.effectiveRakeConfigFor(scenario)`, `gtoPreflop.getGtoPreflopRecommendation({
  ..., gameScenario })`) must take it as an argument; anything that decides
  (`decidePreflopGTO`, `getPreflopRangeClasses`) may read the global.
- Rake and ICM are **alternatives, not additive**: tournaments do not rake per hand, they
  punish marginal decisions through ICM. Never let both apply.
- `botAI.getBotAction` computes `ctx.potOdds` once via `rake.callThresholdWithRake(...)`
  and every downstream engine reads that field. It is the **call price**, not the raw pot
  odds — recomputing raw odds downstream silently drops the rake.
- Tournament preflop ranges are **derived** from the cash tables at module load (trim each
  table's raise / call cells to the top `TOURNAMENT_RAISE_KEEP` / `TOURNAMENT_CALL_KEEP`
  fraction, ordered `tier → Chen`). Never hand-author a second set of tables — that creates
  a second source of truth for the same concept.

**Single-source leaf modules.** Rake, stack-depth bands, strategy randomness, equity
iteration counts, preflop hand strength and hand-strength classification each live in one
leaf module with no business imports, so React components, bot code and tests can all
depend on them without cycles. When a value is computed in more than one place, extract the
leaf rather than synchronising the copies.

---

## 4. Code Style and Formatting Rules

- **Linting:** Uses ESLint flat config (`eslint.config.js`) with these configs:
  - `@eslint/js` recommended
  - `typescript-eslint` recommended
  - `eslint-plugin-react-hooks` recommended
  - `eslint-plugin-react-refresh` (Vite-specific)
- **Ignored Directories:** `/dist` and `/node_modules` are never linted or committed.

- **Formatting:**
  - No Prettier config; formatting should follow ESLint auto-fixes and examples already present.
  - Always use 2 spaces for indentation.
  - Semicolons required.
  - Prefer single quotes except in JSX (double quotes for HTML attributes).
  - Always use trailing commas in multiline arrays/objects/types.
  - Limit lines to 100 characters when possible for readability.

---

## 5. TypeScript, Error Handling, and Naming

- **Type Annotations:**
  - All React props, return types, function parameters, and exported objects must have explicit types.
  - Use types from `src/types/poker.ts` for core models.
- **Strict Types:**
  - Favor `interface` for objects, `type` for unions/enums.
  - Never use `any` unless absolutely unavoidable—prefer `unknown` and type narrowing.

- **Naming Conventions:**
  - `PascalCase` for React components, classes, and exported types/interfaces.
  - `camelCase` for functions, variables, file names, and non-type symbols.
  - `UPPER_SNAKE_CASE` only for top-level, immutable constants (rare in this base).

- **Error Handling:**
  - UI logic should fail gracefully. Defensive checks before UI renders are preferred over try/catch.
  - Don’t throw errors in UI—signal via props/state. Handle edge cases sensibly with clear fallback UX.

---

## 6. Imports and File Organization

- Use ESModule imports everywhere. No CommonJS (`require`).
  ```ts
  import React from 'react'
  import { Something } from '../types/poker'
  ```
- Group imports: 
  1. Node/React/npm packages
  2. Absolute paths within `src/`
  3. Relative local imports
- Avoid default-except-React imports; use named exports when possible.
- Place all new code in `src/` or `src/components`, `src/hooks`, `src/types`, or `src/utils` as appropriate.

---

## 7. Development, Review, and Best Practices

- **File Placement:**
  - UI components: `src/components/`
  - Custom hooks: `src/hooks/`
  - Core types: `src/types/poker.ts`
  - Utilities/helpers: `src/utils/`
- **.gitignore:**
  - Never commit `/node_modules`, `/dist`, IDE/workspace files, or OS-generated files (see `.gitignore`).
- **Committing:**
  - Keep PRs and commits atomic, organized by feature/fix.
  - Write clear, actionable commit messages focused on the "why".
  - Never commit secrets, credentials, or local config overrides.
- **Testing (when enabled):**
  - Use React Testing Library over Enzyme/Jest DOM queries.
  - Test user-observable behavior, not implementation details.
  - Tests go in `src/**/*.test.{ts,tsx}`.
  - Document any manual QA steps required if tests are not automated.

---

## For Agentic Coders
- Always check/obey ESLint and TypeScript errors before opening PRs.
- When tests are present, ensure all tests pass locally before submitting code.
- If extending or modifying conventions, update this AGENTS.md with rationale.
- Use this file as ground truth for new agentic contributions, automation, or migration.
- Known issues, tech debt, and open decisions live in [`TODO.md`](TODO.md) at the repo
  root — read it before starting, and when you deliberately leave something unfixed,
  add an entry there instead of a silent `TODO` comment in the code.

---
