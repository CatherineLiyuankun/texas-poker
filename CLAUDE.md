# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

React 19 + TypeScript + Vite + Tailwind Texas Hold'em game (2–10 players, humans + AI bots). No router: `App.tsx` switches between `StartPage` and `GameBoard`. Bilingual UI comes from a single static `translations.ts` object (no i18n framework).

`AGENTS.md` is the project's ground truth for style and conventions (2-space indent, semicolons, single quotes, trailing commas, ~100-char lines, no `any`, types from `src/types/poker.ts`). Read it before non-trivial changes and update it when conventions change.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run lint         # ESLint (flat config, eslint.config.js)
npm test             # All Jest tests
npm test potCalculator.test.ts            # Single test file (substring match works)
npm test -- --coverage                    # With coverage
npm run e2eTests     # Integration suite only (src/e2eTests/)
```

Jest uses ts-jest with jsdom (`jest.config.mjs`, `tsconfig.test.json`). Test discovery is `**/__tests__/**/*.(test|spec).*` plus `**/e2eTests/**` — new tests must live in a `__tests__/` directory or `src/e2eTests/`, named `*.test.{ts,tsx}`.

## Architecture

### Game state machine

`src/hooks/useGameState.ts` is the core: a single `useReducer` over `GameState` (defined in `src/types/poker.ts`) with actions `START_GAME`, `PLAYER_ACTION`, `FOLD`, `REVEAL_HAND`, `NEXT_STREET`, `COLLECT_POT`, `SPLIT_POT`, `RESET_ROUND`. It also exports the pure action-legality helpers (`canCheck`/`canCall`/`canRaise`/`canFold`/`canAllIn`) that are shared by both the UI and the bot AI — keep them in sync with reducer logic.

`src/components/GameBoard.tsx` is the orchestrator, not just a view: it drives bot turns (`setTimeout` + `getBotAction`), street advancement, showdown/settlement, game-progress persistence, and — importantly — is the **single place where opponent `ActionEvent`s are recorded** (`opponentModel.recordAction`). Do not add recording inside `botAI.ts` (it was deliberately removed there to avoid double-recording).

### Chip conservation (critical invariant)

Total chips must always equal initial chips; tests enforce this. Rules that protect it:

- `state.mainPot` is a UI-display value only; actual chips are tracked in `player.bet` (current street) and `player.totalBet` (whole hand).
- After all-ins, call `calculatePots(players, 0)` (pass `currentPot = 0`) to avoid double-counting the display pot.
- Clear `state.sidePots` before recalculating — they must not accumulate.
- Blinds are forced bets and always count toward pots even when `hasActed === false`.

`src/utils/potCalculator.ts` builds the main pot + multi-level side pots from per-player bets: each level's amount is `(threshold − previousThreshold) × contributors`, eligibility is `!folded && bet >= threshold`. `validateTotalPots` exists for the conservation check.

### Bot AI pipeline

`src/utils/botAI.ts` → `getBotAction(player, state)` is the only bot entry point. It computes action flags, pot odds, position context, and opponent-profile adjustments, then dispatches by phase (`preflop` / `flop`+`turn` / `river`). A module-level flag `useGtoStrategy` (set via `setGtoStrategy()` from GameBoard's saved setting) switches each phase between heuristic strategies (`decidePreflop`/`decidePostflop`/`decideRiver`) and GTO strategies (`decidePreflopGTO` / `decidePostflopGTO` / `decideRiverGTO`).

The GTO modules in `src/utils/` are consulted by both the bots and the player-facing analysis panel:

- `gtoPreflop.ts` — position-based RFI / defend / 3-bet range tables and frequencies; also `getPreflopRangeClasses` used by range-aware equity.
- `gtoPostflop.ts`, `gtoRiver.ts` — street decisions using board texture + GTO math.
- `gtoDeepStack.ts`, `gtoShortStack.ts` (push/call ranges), `gtoICM.ts` (bubble factors, risk premium).
- `gtoNodelock.ts` — exploitative adjustments from detected opponent leaks (needs sufficient sample size via `isSampleSufficient`).
- `gtoMath.ts` — MDF, value/bluff ratios, call/raise EV, required equity.
- `docs/GTO_REFERENCE.md` — the 6-max 100BB charts these tables approximate.

### Equity calculation — two layers

- `equityCalculator.calculateEquity(hand, board, numOpponents, iterations, options?)`: Monte Carlo with reused deck; ties split as `1/(1+tied)`. **Heads-up river is exact enumeration** (all C(45,2) villain hands) — do not replace it with Monte Carlo. `options.opponentCombos` samples the primary opponent from a range.
- `rangeEquity.calculateRangeAwareEquity(...)`: the **decision entry point**. Infers the primary opponent's continuing range from preflop role reconstruction (`reconstructPreflopRoleFromEvents`), `gtoPreflop.ts` position tables, card removal, and optional VPIP width tuning; falls back to random hands when no range is inferable.

Decision code must call `calculateRangeAwareEquity`, not raw `calculateEquity` — the deliberate exception is board-texture calibration, which uses random opponents on purpose. `expandRange` must always apply card removal against hero + board.

### Board texture (`boardTexture.ts`)

- `analyzeBoard(cards)` — fast, pure, deterministic heuristic; street-aware (flop/turn score draw potential, river scores made-hand structure). Must stay free of Monte Carlo work.
- `analyzeBoardWithEquity(cards)` — 70/30 blend of the heuristic with an equity calibration (top-set vs random hand via `calculateEquity`); cached per board, flop/turn only (river falls back to heuristic). Use this for AI decision entry points. Extend `BoardTexture` by adding fields; consumers depend on `wetness` and `classification`.

### Opponent modeling — three layers

- `opponentModelUtil.ts` — pure computations from `ActionEvent`s: VPIP, PFR, AF, C-bet, WTSD, W$D, check-raise, 3-bet, fold-to-c-bet, player-type classification (Nit/TAG/LAG/Calling Station/Maniac).
- `opponentModel.ts` — session-scoped event/hand store (localStorage key `texas-poker-session-stats`); feeds bot adjustments (`calculateOpponentProfile`, `getOpponentAdjustments`) and the stats panel. Reset per session via `resetOpponentStats`.
- `longOpponentModel.ts` — persistent cross-session stats (localStorage key `texas-poker-long-stats`) with JSON export/import.

`ActionEvent` / `HandRecord` types live in `src/types/stats.ts`.

### Hand evaluation & pot-adjacent utils

- `handEvaluator.ts` — `evaluateHand(hand, community)` / `compareHands`; ranks High Card → Royal Flush.
- `preflopHandStrength.ts` — 169-hand-class scoring/tiers used by preflop decisions.
- `drawDetector.ts` — flush draw / OESD / gutshot with outs-based probabilities.
- `preflopOpenRanges.ts`, `tablePositions.ts` — open-ability by position and seat label helpers.

### Persistence (localStorage)

- `gamePersistence.ts` — chips, buy-in counts, GTO flag, table config (resume-game flow in `App.tsx`/`StartPage`).
- The two stats stores above. Tests that touch these should clean up localStorage.

## Testing notes

- `src/utils/__tests__/` — algorithm correctness (pots, equity, draws, board texture, each GTO module, preflop strength, range equity).
- `src/hooks/__tests__/` — reducer/side-pot behavior; `src/e2eTests/useGameState.integration.test.ts` — full-hand flows asserting chip conservation and pot splitting.
- `src/components/__tests__/` — GameBoard blind logic and showdown settlement.
- Any change to betting/pot logic must keep the chip-conservation tests green; add scenarios with mixed all-in amounts when touching that area.
