# Plan: Improve Test Coverage

## Current Coverage Summary

| File | Stmts | Branch | Funcs | Priority |
|------|-------|--------|-------|----------|
| `utils/botAI.ts` | 50.6% | 36.1% | 57.1% | **HIGH** |
| `components/ActionButtons.tsx` | 55.6% | 70.6% | 40.0% | **HIGH** |
| `utils/translations.ts` | 60.0% | 100% | 50.0% | LOW |
| `hooks/useGameState.ts` | 62.5% | 50.8% | 49.0% | **HIGH** |
| `components/PotDisplay.tsx` | 66.7% | 28.6% | 33.3% | MEDIUM |
| `components/Card.tsx` | 80.0% | 63.0% | 66.7% | MEDIUM |
| `components/GameBoard.tsx` | 83.5% | 82.1% | 83.9% | LOW |
| `components/PlayerArea.tsx` | 88.2% | 80.0% | 75.0% | LOW |
| Others | 97-100% | — | — | DONE |

## Prioritized Improvements

### 1. `hooks/useGameState.ts` (62.5% → target 80%+)

**Uncovered areas** (from branch analysis):
- `SPLIT_POT` action (never tested)
- `COLLECT_POT` after `winner` already set (idempotency)
- `FOLD` action (the separate action, distinct from fold inside `PLAYER_ACTION`)
- `REVEAL_HAND` boundary: invalid player index
- `canRaise` when `raiseRightsOpened = false`
- `getNextActivePlayer` when no active players exist
- `bettingComplete` / `allPlayersActed` / `allBetsEqual` edge cases
- `isBettingComplete` callback

**New tests** (add to `useGameState.test.ts`):
```typescript
describe('SPLIT_POT action', () => {
  it('平分底池给所有活跃玩家');
  it('余数分配给第一个玩家');
  it('mainPot <= 0 时不执行');
  it('已有winner时不执行');
});

describe('FOLD action (独立)', () => {
  it('正常fold标记folded=true');
  it('最后一人fold时另一玩家获胜');
  it('所有玩家fold时winner为null');
  it('非法playerIdx返回原state');
});

describe('边界场景', () => {
  it('getNextActivePlayer: 无活跃玩家返回null');
  it('bettingComplete: 全员allIn时返回true');
  it('REVEAL_HAND: 非法playerIdx返回原state');
  it('canRaise: raiseRightsOpened=false时返回false');
  it('isBettingComplete callback');
});
```

### 2. `utils/botAI.ts` (50.6% → target 80%+)

**Current test file**: `src/utils/__tests__/botAI.test.ts`

**Uncovered areas**:
- `getBotAction` with various hand strengths
- `calculateRaiseAmount` function
- Pre-flop vs post-flop decision logic
- `potOdds` calculation paths
- `canAllIn` decision (short stack bot)
- Random factor influence

**New tests** (add to `botAI.test.ts`):
```typescript
describe('getBotAction 详细场景', () => {
  it('强牌(对A)倾向加注或跟注');
  it('弱牌(2-7不同花)倾向弃牌或看牌');
  it('短码(筹码<100)倾向all-in');
  it('无需跟注时可check');
  it('需要跟注但筹码不足时fold');
});

describe('calculateRaiseAmount', () => {
  it('返回合理加注金额');
  it('不超过玩家筹码');
  it('满足最低加注要求');
});
```

### 3. `components/ActionButtons.tsx` (55.6% → target 80%+)

**No existing test file.** Create: `src/components/__tests__/ActionButtons.test.tsx`

**Test scenarios**:
```typescript
describe('ActionButtons', () => {
  it('canCheck=true时显示看牌按钮');
  it('canCall=true时显示跟注按钮及正确金额');
  it('canRaise=true时显示加注按钮和输入框');
  it('canFold=true时显示弃牌按钮');
  it('canAllIn=true时显示全押按钮');
  it('disabled=true时所有按钮禁用');
  it('isBot=true时显示电脑思考中提示');
  it('点击加注后显示确认/取消按钮');
  it('raiseAmount < minRaiseTotal时确认按钮禁用');
});
```

### 4. `components/PotDisplay.tsx` (66.7% → target 90%+)

**No existing test file.** Create: `src/components/__tests__/PotDisplay.test.tsx`

**Test scenarios**:
```typescript
describe('PotDisplay', () => {
  it('显示总奖池金额');
  it('有边池时显示主池和边池');
  it('显示当前阶段');
  it('mainPot=0时正确显示');
  it('多个边池时正确列出');
});
```

### 5. Cleanup: Remove debug console.log

**File**: `src/hooks/useGameState.ts`

Remove the `[FOLD DEBUG]` console.log statements at lines ~461, ~474 that were added during debugging.

## Execution Order

1. **Cleanup**: Remove debug console.log from `useGameState.ts`
2. **useGameState.test.ts**: Add SPLIT_POT, FOLD, edge case tests
3. **botAI.test.ts**: Add detailed getBotAction tests
4. **ActionButtons.test.tsx**: Create new test file
5. **PotDisplay.test.tsx**: Create new test file
6. Run `npm test --coverage` to verify coverage improvements
7. Run `npm run build` + `npm run lint`

## Expected Coverage After

| File | Stmts (before → after) |
|------|----------------------|
| `useGameState.ts` | 62.5% → ~80% |
| `botAI.ts` | 50.6% → ~75% |
| `ActionButtons.tsx` | 55.6% → ~85% |
| `PotDisplay.tsx` | 66.7% → ~95% |
| **TOTAL** | **74.1% → ~80%** |
