# Preflop Tier Display Plan

## Summary
Add preflop hand tier classification (Tier 1-6) to the HandAnalysis panel, displayed alongside the existing preflop strength percentage.

## Tier Color Scheme
| Tier | Name | Color | Tailwind |
|---|---|---|---|
| 1 | Premium 顶级 | 红色 | text-red-400 |
| 2 | Strong 强牌 | 橙色 | text-orange-400 |
| 3 | Playable 可玩 | 土黄色 | text-amber-500 |
| 4 | Speculative 投机 | 绿色 | text-green-400 |
| 5 | Marginal 边缘 | 蓝色 | text-blue-400 |
| 6 | Fold 弃牌 | 紫色 | text-purple-400 |

## Implementation

### 1. `src/utils/preflopHandStrength.ts` — Add getPreflopTier()

Use a compact 13x13 string grid lookup table. Index mapping:
- 0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
- Diagonal = pocket pairs
- Above diagonal = suited hands
- Below diagonal = offsuit hands

```
       2  3  4  5  6  7  8  9  T  J  Q  K  A
  2  [ 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6 ]
  3  [ 6, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6 ]
  4  [ 6, 6, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6 ]
  5  [ 6, 6, 5, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6 ]
  6  [ 6, 6, 6, 5, 4, 6, 6, 6, 6, 6, 6, 6, 6 ]
  7  [ 6, 6, 6, 5, 5, 3, 6, 6, 6, 6, 6, 6, 6 ]
  8  [ 6, 6, 6, 6, 5, 5, 3, 6, 6, 6, 6, 6, 6 ]
  9  [ 6, 6, 6, 6, 5, 5, 5, 3, 4, 6, 6, 6, 6 ]
  T  [ 6, 6, 6, 6, 6, 5, 5, 4, 3, 4, 6, 6, 6 ]
  J  [ 6, 6, 6, 6, 6, 5, 5, 4, 4, 2, 5, 6, 6 ]
  Q  [ 6, 6, 6, 6, 6, 6, 5, 5, 4, 4, 2, 4, 5 ]
  K  [ 6, 6, 6, 6, 6, 6, 5, 5, 4, 3, 3, 2, 4 ]
  A  [ 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 1, 1, 1 ]
```

Function signature: `export function getPreflopTier(hand: Card[]): number` (returns 1-6)

### 2. `src/utils/translations.ts` — Add tier labels

Add to `handAnalysis` section:
```typescript
tier: 'Tier',
tierNames: {
  1: 'Premium 顶级',
  2: 'Strong 强牌',
  3: 'Playable 可玩',
  4: 'Speculative 投机',
  5: 'Marginal 边缘',
  6: 'Fold 弃牌',
},
```

### 3. `src/components/HandAnalysis.tsx` — Display tier

- Import `getPreflopTier`
- Compute tier in the existing preflop section (or via useMemo)
- Add a new Row below the preflop strength:
```
Tier 2 — Strong 强牌
```
- Color the tier text using the color scheme above

### 4. `src/utils/__tests__/preflopHandStrength.test.ts` — Add tier tests

- AA → Tier 1
- JJ → Tier 2
- 99 → Tier 3
- 98s → Tier 4
- 33 → Tier 5
- 72o → Tier 6

## Verification
- `npm run lint` — 0 errors
- `npx tsc --noEmit` — 0 errors
- `npm test` — all pass
