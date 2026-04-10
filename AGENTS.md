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

---
