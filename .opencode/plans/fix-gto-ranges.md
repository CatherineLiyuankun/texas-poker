# GTO Ranges Fix Plan

## Goal
Fix GTO implementation errors to match professional solver standards

## Verification Sources
- GTO Wizard
- PokerCoaching.com
- ThinkGTO
- PreflopWizard
- DeepFold.co
- SolvePoker.ai

## Issues Found

### 1. SB Defense Range Too Wide
- **Current**: ~53%
- **Correct**: 13-15%
- **Impact**: SB overly aggressive, violates GTO

### 2. BB Defense Range Too Narrow
- **Current**: BB vs BTN ~53%
- **Correct**: 55-65%
- **Impact**: BB over-folds, loses EV

### 3. 3-bet Sizing Too Small
- **Current**: IP 3.0x
- **Correct**: IP 3.5x
- **Impact**: Non-standard sizing

### 4. 4-bet Range Mapping Error
- **Current**: SB/BB use wrong tables
- **Correct**: Need independent SB and BB 4-bet tables

## Fix Steps

### Phase 1: Documentation
1. Move GTO_REFERENCE.md to docs/
2. Fix SB defense data
3. Fix BB defense data
4. Fix 3-bet sizing
5. Fix 4-bet ranges

### Phase 2: Code
1. Fix SB_VS_BTN range
2. Fix BB_VS_BTN range
3. Fix BB_VS_UTG/MP/CO ranges
4. Fix 3-bet sizing function
5. Fix 4-bet range mapping

### Phase 3: Verification
1. Run test suite
2. Verify range percentages
3. Check borderline hands

## Verification Standards
- SB 3-bet: 13-15%
- BB vs BTN: 55-65%
- 3-bet IP: 3.5x
- 4-bet SB/BB: Independent ranges

## Reference Data
- DeepFold.co: BB vs BTN 58% call + 15% 3-bet
- PreflopWizard: BB defense ~56%
- SolvePoker.ai: SB 3-bet ~13%
- PokerTrainer: SB 3-bet 15.1%

## Detailed Ranges

### BB vs BTN (Target: 55-65%)

#### 3-bet Range (~15%):
**Value**: TT+, AKs, AKo
**Bluff**: A5s-A2s, K9s-K6s

#### Call Range (~40-50%):
**Pairs**: 22-99
**Suited Ax**: A2s-AJs
**Suited Kx**: K2s-K5s, KJs, KTs
**Suited Qx**: Q2s-Q9s, QJs
**Suited Jx**: J2s-J9s, JTs
**Suited Tx**: T2s-T9s
**Suited 9x**: 92s-98s
**Suited 8x**: 82s-87s
**Suited 7x**: 72s-76s
**Suited 6x**: 62s-65s
**Suited 5x**: 52s-54s
**Suited 4x**: 42s, 43s
**Suited 3x**: 32s
**Offsuit Ax**: A2o-AJo
**Offsuit Kx**: K2o-KJo
**Offsuit Qx**: Q2o-QJo
**Offsuit Jx**: J2o-JTo
**Offsuit Tx**: T2o-T9o
**Offsuit 9x**: 92o-98o
**Offsuit 8x**: 82o-87o
**Offsuit 7x**: 72o-76o
**Offsuit 6x**: 62o-65o
**Offsuit 5x**: 52o-54o
**Offsuit 4x**: 42o, 43o

## Priority

| Priority | File | Issue | Impact |
|----------|------|-------|--------|
| P0 | GTO_REFERENCE.md | SB defense data wrong | Documentation inaccurate |
| P0 | gtoPreflop.ts | SB_VS_BTN too wide | Code deviates from GTO |
| P0 | gtoPreflop.ts | BB_VS_BTN too narrow | Code deviates from GTO |
| P1 | gtoPreflop.ts | 3-bet sizing too small | Non-standard sizing |
| P1 | gtoPreflop.ts | 4-bet range mapping wrong | Scenario handling error |
| P2 | gtoPreflop.ts | BB_VS_UTG/MP/CO ranges | Frequency imbalance |
