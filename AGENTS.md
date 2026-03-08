# AGENTS.md — Guidelines for Autonomous/Agentic Coding in `texas-poker`

---

## Table of Contents
1. **Project Overview**
2. **Build, Lint, and Test Commands**
3. **Code Style and Formatting Rules**
4. **TypeScript, Error Handling, and Naming**
5. **Imports and File Organization**
6. **Development, Review, and Best Practices**

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
> **Note:** No test runner/scripts present by default. To add tests:
> - Install Jest and React Testing Library:
>   ```
>   npm install --save-dev jest @testing-library/react @types/jest
>   ```
> - Add `test` script to `package.json`:
>   ```json
>   "test": "jest"
>   ```
> - Run tests:
>   ```
>   npm test
>   # or for a single test file:
>   npx jest src/components/MyComponent.test.tsx
>   ```
> 
> Place all new test files in `src/**/*.test.{ts,tsx}`

---

## 3. Code Style and Formatting Rules

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

## 4. TypeScript, Error Handling, and Naming

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

## 5. Imports and File Organization

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

## 6. Development, Review, and Best Practices

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
