# Chen Formula 替换方案

## Summary
Replace the current preflop strength formula with the Chen Formula (by Bill Chen), a well-established poker hand evaluation method. Update color thresholds and recommendation thresholds in HandAnalysis.tsx accordingly.

## Chen Formula Algorithm
```
Bill Chen's Preflop Hand Strength Formula:

1. Chen Value (different from face value for broadway cards):
   A=10, K=8, Q=7, J=6, T=5, 9-2=face value

2. Pocket Pairs:
   score = max(5, chenValue × 2)
   Examples: AA=20, KK=16, QQ=14, 55=10, 22=5(min)

3. Non-pair hands:
   Start with the Chen value of the higher card
   + Suited bonus: +2
   + Gap penalty (gap = rank_high - rank_low - 1):
     gap 0 (connector):  0
     gap 1 (one-gapper): -1
     gap 2 (two-gapper): -2
     gap 3:              -4
     gap 4+:             -5
   + Straight potential bonus: +1 if gap ≤ 1 AND lower card Chen value ≤ 7
     (i.e., lower card is Q or below, since AKQ can make top straight)

4. Normalization: score / 20 → range [0, 1]

Score range: ~3.5 (32o) to 20 (AA)
```

## Files to Change

### 1. `src/utils/preflopHandStrength.ts` — Replace getPreflopStrength

Add the algorithm description as JSDoc comments above the function, then implement:

```typescript
/**
 * Preflop hand strength using the Chen Formula (by Bill Chen).
 *
 * Algorithm:
 * 1. Chen Value: A=10, K=8, Q=7, J=6, T=5, others=face value
 * 2. Pocket pair: score = max(5, chenValue × 2)
 * 3. Non-pair: start with higher card's Chen value, then:
 *    - Suited: +2
 *    - Gap penalty: 0→0, 1→-1, 2→-2, 3→-4, ≥4→-5
 *    - Straight potential: +1 if gap≤1 and low card Chen≤7
 * 4. Normalize: score / 20 → [0, 1]
 *
 * Examples: AA=1.00, AKs=0.65, KQs=0.55, 98s=0.40, K3o=0.15, 72o=0.10
 * Reference: "The Poker Formula" by Bill Chen
 */
export function getPreflopStrength(hand: Card[]): number {
  // ... Chen Formula implementation
}
```

Keep `RANK_VAL` (needed for gap calculation) and add `CHEN_VAL` mapping.

### 2. `src/components/HandAnalysis.tsx` — Update thresholds

**Strength bar colors** (line ~191-202):
```
Old thresholds: 0.80 / 0.60 / 0.45 / 0.30 / 0.20
New thresholds: 0.65 / 0.45 / 0.35 / 0.25 / 0.15
```

Mapping to tier colors:
| Chen score | Color | Tier | Example hands |
|---|---|---|---|
| ≥ 0.65 (13+) | bg-red-400 | 1 | AA, KK, AKs |
| ≥ 0.45 (9+) | bg-orange-400 | 2 | QQ, JJ, TT, AKo |
| ≥ 0.35 (7+) | bg-amber-500 | 3 | AJs, KQs, 99 |
| ≥ 0.25 (5+) | bg-green-400 | 4 | 98s, K8s, 66 |
| ≥ 0.15 (3+) | bg-blue-400 | 5 | 33, 22 |
| < 0.15 | bg-purple-400 | 6 | 72o, 32o |

**Recommendation thresholds** (line ~24-29):
```
Old: 0.70 / 0.50 / 0.38
New: 0.60 / 0.40 / 0.25
```

| Chen score | Recommendation |
|---|---|
| ≥ 0.60 | Raise 加注 |
| ≥ 0.40 | Call/Raise |
| ≥ 0.25 + potOdds < 0.25 | Call 跟注 |
| potOdds === 0 | Check 过牌 |
| else | Fold 弃牌 |

### 3. `src/utils/__tests__/preflopHandStrength.test.ts` — Update tests

All relative comparison tests (高对比低对强, 同花比非同花强, 连张比间隔大的牌强) should still pass since Chen Formula preserves the same ordering.

Specific value tests to update:
| Test | Old | New Chen | Action |
|---|---|---|---|
| AA `toBe(1)` | 1.0 | 20/20=1.0 | No change needed |
| 72o `toBeLessThan(0.2)` | 0.17 | (7-5)/20=0.10 | No change needed |
| AKs `> garbage*3` | 0.80 > 0.51 | 0.65 > 0.30 | No change needed |

Add new specific-value tests for Chen Formula verification:
- K3o should be ~0.15 (the bug fix that motivated this change)
- AKs should be 0.65
- 98s should be 0.40

## Verification
- `npm run lint` — 0 errors
- `npx tsc --noEmit` — 0 errors
- `npm test` — all pass
