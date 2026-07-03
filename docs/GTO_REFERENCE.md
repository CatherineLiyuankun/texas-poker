# GTO Preflop Reference — 6-Max 100BB Cash Game

> **Sources**: PioSolver outputs, GTO Wizard published charts, "Modern Poker Theory" (Acevedo), "Play Optimal Poker" (Brokos)
>
> **Assumptions**: 6-max, 100BB effective, standard rake. All percentages combo-weighted.

---

## 1. RFI (Raise First In) Ranges

### UTG — ~15-17% (200-225 combos), Open 2.5-3.0 BB

| Category | Hands | ~Combos |
|----------|-------|---------|
| Pairs | 77+ (66 mixed ~50%) | 48-54 |
| Suited broadways | AKs, AQs, AJs, ATs, KQs, KJs, KTs, QJs, QTs, JTs | 40 |
| Suited Ax | A5s, A4s, A3s, A2s | 16 |
| Suited A9s | A9s (mixed ~50%) | 0-4 |
| Suited connectors | T9s, 98s (87s mixed ~40%) | 8-12 |
| Offsuit | AKo, AQo, AJo, ATo (KJo mixed ~40%), KQo | 60-72 |

**Exclude**: 55-, A8s-, K9s-, Q9s-, J9s-, T8s-, K9o-, QJo-, JTo-

### MP — ~18-22% (240-290 combos), Open 2.5-3.0 BB

| Category | Hands | ~Combos |
|----------|-------|---------|
| Pairs | 55+ (44 mixed ~40%) | 60-66 |
| Suited broadways | AKs-A9s, KQs-K9s, QJs-QTs, JTs | 52 |
| Suited Ax | A5s-A2s | 16 |
| Suited connectors | T9s-54s (65s mixed, 54s mixed ~20%) | 20-24 |
| Offsuit | AKo-ATo (A9o mixed ~30%), KQo, KJo (KTo mixed ~30%) | 72-84 |

**Exclude**: 33-, A7s-, K8s-, Q9s-, J9s-, T8s-, K9o-, Q9o-

### CO — ~27-33% (360-440 combos), Open 2.5-3.0 BB

| Category | Hands | ~Combos |
|----------|-------|---------|
| Pairs | 22+ | 78 |
| Suited Ax | A2s+ (all) | 48 |
| Suited Kx | KQs-K8s (K7s mixed ~30%) | 20-24 |
| Suited Qx | QJs-Q9s (Q8s mixed ~30%) | 12-16 |
| Suited Jx | JTs, J9s (J8s mixed ~30%) | 8-12 |
| Suited Tx | T9s, T8s (T7s fold) | 8 |
| Suited connectors | 98s-54s | 24 |
| Offsuit Ax | AKo-A9o (A8o fold) | 60 |
| Offsuit Kx | KQo-KTo (K9o fold) | 36 |
| Offsuit Qx | QJo, QTo (Q9o fold) | 24 |
| Offsuit Jx+ | JTo (J9o fold) | 12 |

**Exclude**: K7s, Q8s, J8s, T7s, A8o-, K9o-, Q9o-, J9o-, T8o-

### BTN — ~42-50% (560-660 combos), Open 2.0-2.5 BB

| Category | Hands | ~Combos |
|----------|-------|---------|
| Pairs | 22+ | 78 |
| Suited Ax | A2s+ | 48 |
| Suited Kx | K2s+ | 48 |
| Suited Qx | Q5s+ (Q4s mixed, Q3s-Q2s fold) | 24-32 |
| Suited Jx | J6s+ (J5s mixed ~30%) | 20-24 |
| Suited Tx | T7s+ (T6s mixed ~30%) | 16-20 |
| Suited 9x+ | 96s+, 86s+, 75s+, 65s, 54s | 32 |
| Offsuit Ax | A2o+ | 144 |
| Offsuit Kx | K7o+ (K6o-K5o fold) | 96 |
| Offsuit Qx | Q8o+ (Q7o fold) | 72 |
| Offsuit Jx | J8o+ (J7o fold) | 60 |
| Offsuit Tx | T8o+ (T7o fold) | 48 |
| Offsuit 9x+ | 98o, 87o | 24 |

**Exclude**: Q3s, Q2s, J5s-, T6s-, K6o, K5o, Q7o, J7o, T7o, 97o, 86o, 76o, 65o, 54o

### SB — ~36-45% (480-600 combos), Open 2.5-3.0 BB, **RAISE OR FOLD ONLY**

| Category | Hands | ~Combos |
|----------|-------|---------|
| Pairs | 22+ | 78 |
| Suited | A2s+, K2s+, Q4s+, J5s+, T8s+, 98s-54s | ~200 |
| Offsuit | A2o+, K7o+, Q9o+, J9o+, T9o, 98o | ~400 |

---

## 2. BB Defense vs Open

| vs Opener | Total % | 3-bet % | Call % | 3-bet Value | 3-bet Bluff |
|-----------|---------|---------|--------|-------------|-------------|
| UTG | 25-30% | ~8% | ~17-22% | QQ+, AKs, AKo | A5s, A4s |
| MP | 28-33% | ~9% | ~19-24% | JJ+, AQs+, AQo | A5s-A2s |
| CO | 35-40% | ~11% | ~23-28% | TT+, AQs+, AJs, AQo | A5s-A2s |
| BTN | 55-65% | ~15% | ~40-50% | TT+, AQs+, AKo | A5s-A2s, K9s-K6s |
| SB | 35-42% | ~12% | ~22-28% | 88+, ATs+, AJo+, KQs | A5s-A2s |

### BB vs BTN Call Range Detail (should be ~26-34%):
Pairs: 88-22, Suited: ATs-A2s, KJs-K4s, QJs-Q6s, JTs-J6s, T9s-T7s, 98s-95s, 87s-74s, 65s-54s
Offsuit: AJo-A2o, KJo-K7o, QJo-Q7o, JTo-J8o, T9o-T8o, 98o-87o

---

## 3. SB Defense (3-bet or Fold ONLY)

| vs Opener | Total 3-bet % | Value 3-bet | Bluff 3-bet |
|-----------|---------------|-------------|-------------|
| UTG | 8-12% | QQ+, AKs, AKo | A5s, A4s |
| MP | 10-15% | JJ+, AQs+, AQo, AKo | A5s-A2s, AJs (mixed) |
| CO | 15-22% | TT+, AQs+, AJs, AQo, AKo | A5s-A2s, KQs, KJs (mixed) |
| BTN | 13-15% | 99+, AQs+, AJs, ATs, AQo, AKo | A5s-A2s, K9s-K6s, Q9s, J9s, T9s, 87s, 76s |

---

## 4. IP Defense vs Open

| vs Opener | Total % | 3-bet % | Call % |
|-----------|---------|---------|--------|
| UTG | 15-20% | ~7% | ~9-12% |
| MP | 18-23% | ~8% | ~11-14% |
| CO | 22-28% | ~10% | ~14-17% |
| BTN | 25-30% | ~12% | ~15-17% |

---

## 5. 4-bet Response (vs 3-bet)

| Opener Pos | 4-bet Value | 4-bet Bluff | Call |
|-----------|-------------|-------------|------|
| UTG | QQ+, AKs | A5s, A4s | JJ, TT, AQs, AKo, AQo |
| MP | QQ+, AKs | A5s, A4s | JJ, TT, AQs, AJs, AKo, AQo, KQs |
| CO | JJ+, AQs+ | A5s-A3s | TT, 99, AJs, AKo, AQo, KQs |
| BTN | TT+, AQs+ | A5s-A2s | 99, 88, AJs, ATs, AKo, AQo, KQs, KJs |

---

## 6. Sizing

| Action | Size |
|--------|------|
| Open UTG/MP/CO | 2.5 BB |
| Open BTN | 2.0-2.5 BB |
| Open SB | 2.5-3.0 BB |
| 3-bet IP | 3.5× open |
| 3-bet OOP | 4.0× open |
| 4-bet IP | 2.2× 3-bet |
| 4-bet OOP | 2.5× 3-bet |

---

## 7. Key Principles

1. **SB never limps** — raise or fold only (position disadvantage + capped range)
2. **BB defends widest** — sunk cost + closing action + best pot odds
3. **A5s/A4s/A3s are premier bluffs** — block AA/AK + flush/wheel equity when called
4. **IP defends with more flat calls** — position advantage allows wider calling
5. **Mixed strategies** — borderline hands are raise/fold mixes (we use pure actions + frequency display)

---

## 8. Borderline Hands Quick Reference

| Hand | UTG RFI | CO RFI | BTN RFI | BB vs UTG | BB vs BTN | SB vs BTN (3bet/fold) |
|------|---------|--------|---------|-----------|-----------|----------------------|
| 66 | Mixed | Raise | Raise | Call | Call | Fold |
| A9s | Mixed | Raise | Raise | Call | Call | Fold |
| KJo | Mixed | Raise | Raise | Fold | Call | 3-bet |
| 44 | Fold | Raise | Raise | Call | Call | Fold |
| K7s | Fold | Mixed | Raise | Fold | Call | 3-bet |
| Q8s | Fold | Mixed | Raise | Fold | Call | 3-bet |
| A8o | Fold | Fold | Raise | Fold | Call | Fold |
| Q9o | Fold | Fold | Raise | Fold | Call | 3-bet |
| K5o | Fold | Fold | Fold | Fold | Call | Fold |
| 87o | Fold | Fold | Fold | Fold | Call | Fold |
| Q3s | Fold | Fold | Mixed | Fold | Call | Fold |
| 72o | Fold | Fold | Fold | Fold | Fold | Fold |
| K7o | Fold | Fold | Fold | Fold | Call | Mixed 3bet/fold |

---

## 9. Implementation Checklist

- [ ] `lookup()` correctly distinguishes suited (upper triangle) from offsuit (lower triangle)
- [ ] RFI ranges within ±3% of targets for all positions
- [ ] BB defense vs BTN ≥ 55%
- [ ] BB defense vs UTG ≥ 25%
- [ ] SB vs BTN 3-bet ≥ 13% and ≤ 15%
- [ ] SB vs UTG 3-bet ≥ 8%
- [ ] IP vs BTN defense ≥ 25%
- [ ] SB RFI never results in a limp (only raise or fold)
- [ ] BB option always checks (never folds weak hands)
- [ ] `isFacing3bet` only triggers for the original raiser
- [ ] 4-bet sizing dynamic based on actual 3-bet size
- [ ] OOP determination consistent between bot and display functions
- [ ] Mixed frequency data returned for borderline hands
- [ ] Position mapping correct for 2-6 player tables
