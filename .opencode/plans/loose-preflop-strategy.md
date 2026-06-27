# Plan: Loosen Bot Preflop Strategy (Target VPIP ~28%)

## Goal
Make the bot play more hands preflop, targeting ~28% VPIP (between TAG and LAG), while adding unpredictability via mixed strategies.

## Problem Analysis
Current `decidePreflop` in `src/utils/botAI.ts:80-127`:
1. **Too tight**: Tier 5-6 (~73% of all hands) almost always fold. Estimated VPIP ~18%.
2. **Deterministic**: Same hand + same situation = same action. Perfectly predictable.

## VPIP Budget (target ~28%)

| Tier | Combos | % of Total | Play Rate | VPIP Contribution |
|---|---|---|---|---|
| 1-2 (Premium+Strong) | 114/1326 | 8.6% | ~100% | **8.6%** |
| 3 (Playable) | 129/1326 | 9.7% | ~85% | **8.2%** |
| 4 (Speculative) | 114/1326 | 8.6% | ~50% | **4.3%** |
| 5-6 (Marginal+Trash) | 969/1326 | 73.1% | ~9.5% | **6.9%** |
| **Total** | | | | **~28%** |

## Changes

### File 1: `src/utils/botAI.ts`

#### 1a. Import `OpponentAdjustments` type (line 11-14)
Change:
```typescript
import {
  calculateOpponentProfile,
  getOpponentAdjustments,
} from './opponentModel';
```
To:
```typescript
import {
  calculateOpponentProfile,
  getOpponentAdjustments,
  type OpponentAdjustments,
} from './opponentModel';
```

#### 1b. Rewrite `decidePreflop` function signature (line 80)
Add `adj: OpponentAdjustments` parameter:
```typescript
function decidePreflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
```

#### 1c. Rewrite `decidePreflop` body (lines 86-127)

New logic with exact probability thresholds:

**Tier 1-2 (Premium/Strong)** — ~100% VPIP:
- Tier 1: unchanged, always all-in/raise/call
- Tier 2: 90% raise, 10% flat call (disguise strength)

**Tier 3 (Playable)** — ~85% VPIP:
- Facing big raise + early position: 60% fold / 40% call (was: 100% fold)
- Facing big raise + late position: 15% 3-bet / 50% call / 35% fold
- Late position, no big raise: 35% raise (steal) / 65% call
- Otherwise: call or check

**Tier 4 (Speculative)** — ~50% VPIP:
- Facing big raise: 65% fold / 35% call (was: 100% fold)
- Late position, no raise: 40% raise (steal) / 60% call
- Late position, facing raise (not big): 12% light 3-bet
- potOdds threshold: < 30% (was: < 25%)
- Heads-up: loosen potOdds threshold to < 40%

**Tier 5-6 (Marginal/Trash)** — ~9.5% VPIP:
- Late position, no raise: 25% raise (steal) / 45% call / 30% fold
- Middle position, no raise: call if potOdds < 15%, else fold
- Early position: only call if potOdds < 6%
- Facing any raise: fold (except heads-up with potOdds < 10%)

**Opponent adjustments** (applied to steal/call thresholds):
- `adj.raiseBonus > 0`: steal probability +10% (opponents fold a lot)
- `adj.callPenalty > 0`: calling thresholds tighter by +0.05 per 0.05 penalty
- `adj.foldPenalty > 0`: fold to raises probability +10% (passive opponents' raises are credible)

**Full pseudo-code:**
```
function decidePreflop(player, state, flags, ctx, adj):
  tier = getPreflopTier(player.hand)
  isFacingRaise = ctx.toCall > 0
  isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2
  stealBoost = adj.raiseBonus > 0 ? 0.10 : 0
  tightenCall = adj.callPenalty
  foldBoost = adj.foldPenalty > 0 ? 0.10 : 0

  // Tier 1-2: Premium/Strong (~100% play)
  if tier <= 2:
    if tier == 2 && Math.random() < 0.10 && canCall:
      return call  // disguise strength
    // ... existing allin/raise/call logic unchanged

  // Tier 3: Playable (~85% play)
  if tier == 3:
    if isFacingBigRaise:
      if ctx.isLatePosition:
        if canRaise && Math.random() < 0.15: return raise  // light 3-bet
        if canCall && Math.random() < 0.50: return call
        if canFold: return fold
      else:
        if canFold && Math.random() < (0.60 + foldBoost): return fold
        if canCall: return call
    if ctx.isLatePosition && !isFacingBigRaise:
      if canRaise && Math.random() < (0.35 + stealBoost): return raise  // steal
    if canCall: return call
    if canCheck: return check

  // Tier 4: Speculative (~50% play)
  if tier == 4:
    if isFacingBigRaise:
      if canFold && Math.random() < (0.65 + foldBoost): return fold
      if canCall: return call
    if canCheck: return check
    if ctx.isLatePosition && !isFacingRaise:
      if canRaise && Math.random() < (0.40 + stealBoost): return raise
    if ctx.isLatePosition && isFacingRaise && !isFacingBigRaise:
      if canRaise && Math.random() < 0.12: return raise  // light 3-bet
    if canCall && ctx.potOdds < (0.30 - tightenCall): return call
    if ctx.isHeadsUp && canCall && ctx.potOdds < (0.40 - tightenCall): return call
    if canCall && ctx.isLatePosition && !isFacingRaise: return call

  // Tier 5-6: Marginal/Trash (~9.5% play)
  if canCheck: return check
  if ctx.isLatePosition && !isFacingRaise:
    if canRaise && Math.random() < (0.25 + stealBoost): return raise
    if canCall && Math.random() < 0.45: return call
  if ctx.isHeadsUp && canCall && ctx.potOdds < (0.10 - tightenCall): return call
  if canCall && ctx.potOdds < (0.06 - tightenCall): return call
  if canFold: return fold
  return canCall ? call : fold
```

#### 1d. Update `getBotAction` (lines 255-314)

Add opponent profile calculation before the switch and pass to `decidePreflop`:

Before the `switch` statement (around line 300), add:
```typescript
const oppProfile = calculateOpponentProfile(state.players, player.id);
const adj = getOpponentAdjustments(oppProfile);
```

In the switch, change:
```typescript
case 'preflop':
  return decidePreflop(player, state, flags, ctx);
```
To:
```typescript
case 'preflop':
  return decidePreflop(player, state, flags, ctx, adj);
```

### File 2: `src/utils/__tests__/botAI.test.ts`

Tests affected by randomization:

| Test | Line | Current Assertion | Fix |
|---|---|---|---|
| "可能返回fold" | 379-383 | `expect('fold')` | Change to `expect(['fold','call','raise']).toContain(...)` |
| "赔率差时倾向于弃牌" | 246-262 | `expect('fold')` | Change to `expect(['fold','call','raise']).toContain(...)` |

All other tests already use `toContain` with multiple actions and should remain stable.

## Verification

1. `npm test` — all tests pass
2. `npm run lint` — no lint errors
3. `npm run build` — no build errors

## Expected Impact

| Metric | Before | After |
|---|---|---|
| VPIP | ~18% | **~28%** (TAG-LAG boundary) |
| Predictability | 100% deterministic | Mixed strategy |
| Late position steal | Tier 1-2 only | Tier 1-5 (25-40% frequency) |
| 3-bet range | Tier 1-2 only | Tier 1-4 (12-15% frequency) |
| Opponent adaptation | None preflop | Full integration |
| Tier 5-6 play rate | ~3% | ~9.5% |
