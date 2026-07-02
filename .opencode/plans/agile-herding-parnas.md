# Plan: Admin "Show All Hands" Debug Button

## Goal
Add a "显示所有玩家手牌" button at round end that reveals all players' hole cards (including folded players) for bot strategy debugging. Must not affect normal game display logic. Auto-reset on next round.

## Changes

### 1. `src/components/GameBoard.tsx`

**Add state** (near line ~113, after `roundSettled`):
```ts
const [adminRevealAll, setAdminRevealAll] = useState(false);
```

**Reset on new round**: Add a `useEffect` that resets `adminRevealAll` to `false` when `roundSettled` becomes `false`:
```ts
useEffect(() => {
  if (!roundSettled) setAdminRevealAll(false);
}, [roundSettled]);
```

**Add button** (inside the `roundSettled` block, after the "Next Round" button ~line 806):
```tsx
<button
  onClick={() => setAdminRevealAll(v => !v)}
  className={`mb-4 px-4 py-2 rounded-lg font-bold ${
    adminRevealAll
      ? 'bg-orange-500 hover:bg-orange-600 text-white'
      : 'bg-gray-600 hover:bg-gray-700 text-white'
  }`}
>
  {adminRevealAll ? '隐藏未摊牌手牌 (Admin Off)' : '显示所有手牌 (Admin On)'}
</button>
```

**Pass prop** to `<PlayerArea>` (around line ~553):
```tsx
adminRevealAll={adminRevealAll}
```

### 2. `src/components/PlayerArea.tsx`

**Add prop** to `PlayerAreaProps` interface (~line 35):
```ts
adminRevealAll?: boolean;
```

**Destructure** in component (~line 58):
```ts
adminRevealAll = false,
```

**Modify `canShowHand`** (line 70) — 在最前面加 `adminRevealAll`：
```ts
// Before:
const canShowHand = (isShowdown && !player.folded) || (player.isRealPlayer && isCurrentPlayer && isViewing);
// After:
const canShowHand = adminRevealAll || (isShowdown && !player.folded) || (player.isRealPlayer && isCurrentPlayer && isViewing);
```

**Modify `getHandRankStatus()`** (line 80) — 条件从 `!player.folded` 改为 `!player.folded || adminRevealAll`：
```ts
// Before:
if (isShowdown && !player.folded) {
// After:
if (isShowdown && (!player.folded || adminRevealAll)) {
```
Admin 开启时弃牌玩家也显示牌型名称，关闭时恢复原行为。
```

**Pass `handRank` when admin reveal is active** in `GameBoard.tsx` (~line 525-528):
Change from:
```ts
state.phase === 'showdown' && !player.folded
```
to:
```ts
state.phase === 'showdown' && (!player.folded || adminRevealAll)
```

### 3. `src/utils/translations.ts`

在 `gameBoard` 对象（~line 62 之后）新增两条翻译：
```ts
adminOn: '显示所有手牌 (Admin On)',
adminOff: '隐藏未摊牌手牌 (Admin Off)',
```

`GameBoard.tsx` 按钮中引用 `translations.gameBoard.adminOn` / `translations.gameBoard.adminOff`。

## Files Modified
- `src/components/GameBoard.tsx` — state + button + prop passing
- `src/components/PlayerArea.tsx` — accept prop + update visibility logic
- `src/utils/translations.ts` — 新增 adminOn / adminOff 翻译条目

## Verification
- `npm run build` — no type errors
- `npm run lint` — no lint errors
- `npm test` — all tests pass
- Manual: start game with bots → round ends → click "显示所有手牌 (Admin)" → folded players' cards appear → click "Next Round" → cards hidden again
