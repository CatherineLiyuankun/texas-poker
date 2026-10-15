# Texas Hold'em Poker / 德州扑克

[English](#english) | [中文](#中文)

---

## English

A React-based Texas Hold'em Poker game with intelligent bots, accurate pot calculation, and full game flow.

### Features

- **Multiplayer Support**: 2-10 players (real players + AI bots)
- **Smart Bot AI**: Professional-grade AI with mixed strategies, position-aware play, and opponent modeling
  - **Preflop Strategy**: TAG-LAG hybrid style (VPIP ~28%, PFR ~20%) with 169-hand tier system
  - **Mixed Strategy**: Randomized decisions to prevent exploitation
  - **Position Play**: Wider range from late position, blind stealing, light 3-bets
  - **Postflop AI**: Monte Carlo equity simulation (200-500 iterations) + pot odds comparison
  - **Draw Detection**: Flush draw, open-ended straight, gutshot with outs-based probability
  - **Opponent Modeling**: Profiles opponents as aggressive/passive and adjusts thresholds dynamically
- **Bot Personality (persona)**: each bot can be assigned one of six personalities that reshape its preflop/postflop thresholds and bet sizing; set on the start screen (**default on**, chosen when starting a new game, read-only mid-game)
  - **Six types & the A′ quota**: for B bots the assignment is the multiset `TAG` (B=1), `TAG+Fish` (B=2), `TAG+LAG+Fish` (B=3), `TAG+LAG+Fish+Nit` (B=4), `TAG+LAG+Fish+Nit+CS` (B=5), `TAG+LAG+Fish+Nit+CS+Maniac` (B=6); normal new games cap at B≤6
  - **Assigned ≠ measured**: the *assigned* type drives decisions through seven knobs (`openWiden` / `defendVsOpen` / `threeBetFreq` / `valueShift` / `aggressionMult` / `callBias` / `sizingMult`), while the *measured* type in the stats table is classified from the bot's real VPIP/PFR — the two may legitimately differ
  - **Seat label**: once a hand is settled each bot seat shows its assigned personality (with a hover explanation); nothing is shown during betting, and disabled/unassigned seats never get a fabricated label
  - **Stats by assigned type**: the stats popover groups bots by assigned personality, alongside the per-seat measured stats
  - **Calibration**: parameters were fitted by a closed-loop runner (`npm run calibrate`, reusing the production reducer, 3000 hands at production equity iterations) — see [Known Limits](#known-limits); the ratio and TAG/LAG PFR targets became reachable once the preflop raise branch was un-gated, and **16/19** joint checks now pass (the remaining 2 are semantic gaps)
- **Hand Analysis Panel**: Real-time display of **random-hand equity** and **range-aware equity**, pot odds, implied odds, draw info, **Bot Action**, and action recommendations
  - **Random equity**: hero vs. N uniformly random hands (Monte Carlo; heads-up river uses exact enumeration) — its "vs random hands" caveat sits in that row's **hover tooltip**, not inline (an inline note would crowd the percentage out of the row)
  - **Range equity**: hero vs. an inferred opponent continuing range (preflop role + position tables + card removal + VPIP, then narrowed by the observed postflop action line)
  - Available from preflop onward; the recommendation and EV figures are driven by range equity, falling back to random equity when no range can be inferred
  - **Bot Action** (above `GTO Math`): **two fixed rows** — `Bot 紧凶Action` / `Bot 松凶Action` — showing what the seat would do **if it were a TAG / a LAG**, independent of the table's actual assignment (both rows stay even when the table has no such bot or personality is off). Same decision path as the live bots (`getShadowBotActions` → `getBotAction`), with the strategy randomness swapped for a state-seeded PRNG so a panel render never advances the real bots' mixed-frequency stream; the two rows share one equity computation. It is a *hypothetical*, so it may legitimately differ from the bot's actual action (channel ④ below); when the seat has no actionable decision the value degrades to `—` while both rows stay
  - **Pot odds**: the percentage plus the same thing as a ratio (`pot : call`), e.g. `33.3% 2 : 1` — 1/4 pot `5 : 1`, 1/2 pot `3 : 1`, 3/4 pot `2.3 : 1`, full pot `2 : 1`, 2 pots `1.5 : 1`, matching the standard table
  - **Implied odds**: `(pot + future winnings) : (call + my future calls)` — the main figure is a **drawing plan** (what the opponent keeps paying once I improve), with the optimistic textbook read (`上界`) printed next to it. Shown only for a hand that can still improve — a draw, a backdoor flush draw, three of a kind or a preflop pocket pair — and hidden on the river. Full caliber, worked example and edge cases: [Implied Odds](#implied-odds)
- **Player Stats Tracking (VPIP/PFR)**: Long-term tracking of preflop behavior across multiple hands — the stats table covers bots and real players on the same footing
  - **VPIP** (Voluntarily Put Money In Pot): Percentage of hands where a player voluntarily enters the pot preflop
  - **PFR** (Pre-Flop Raise): Percentage of hands where a player raises preflop
  - **Player Type Classification**: Automatically classifies players based on VPIP/PFR ranges:
    - **Nit** (Tight-Passive): VPIP <= 20%, PFR < 12%, Gap > 8%
    - **TAG** (Tight-Aggressive): VPIP 20%-28%, PFR 16%-32%, Gap <= 8%
    - **LAG** (Loose-Aggressive): VPIP <= 38%, PFR 20%-32%, Gap <= 8%
    - **Calling Station** (Loose-Passive): VPIP > 35%, PFR < 15%, Gap > 20%
    - **Maniac**: VPIP >= 45%, PFR >= 35%
    - **Others**: Does not fit any of the above categories
  - **Persistent Storage**: Data saved in localStorage, survives browser restarts
  - **Export/Import**: Backup stats to JSON file and restore later
  - **Stats Table**: a collapsible popover at the top-right of the game screen (under the `Real n | Bot n` counters), **collapsed by default** — showing VPIP, PFR, and player type per player, **real players first, bots below**; bot rows are computed from the same cross-session long-term store as real players (not just the current session)
- **Strategy Configuration**: two orthogonal axes, toggled on the table screen
  - **Engine**: `GTO` (per-street GTO modules) or `heuristic` (the TAG/LAG hybrid above)
  - **Scenario**: `cash` or `tournament`. Tournaments disable rake, add an ICM risk premium derived from the stack-relative bubble factor, and use preflop ranges tightened relative to the cash tables
  - **Rake** (cash only, set on the start screen): off / percentage of the pot / fixed BBs, each with an optional BB cap
- **Complete Game Flow**: Pre-flop → Flop → Turn → River → Showdown
- **Hand Evaluation**: Recognizes all hand ranks from High Card to Royal Flush
- **Accurate Pot Calculation**: Main pot and side pots with proper multi-level splitting
- **Chip System**: Starting 1000 chips, with betting and pot tracking
- **Blind Structure**: Configurable small blind (default $5, big blind = 2×SB)
- **All-in Support**: Full all-in mechanics with proper side pot creation
- **Bilingual**: English and Chinese (auto-detected)
- **Responsive UI**: Built with Tailwind CSS

### Game Actions

- **Check**: Skip betting when no bet to call
- **Call**: Match the current bet
- **Raise**: Increase the bet
- **Fold**: Surrender the hand
- **All-in**: Bet all remaining chips (creates side pots if needed)

### Pot Calculation Logic

The game implements accurate Texas Hold'em pot rules:

- **Main Pot**: The smallest bet among active players × number of contributing players
- **Side Pots**: Created when players all-in with different amounts
- **Multi-level Splitting**: Each side pot has its own eligible players
- **Chip Conservation**: Total chips always equal initial chips (verified by tests)

Example: 4 players with bets $20, $50, $80, $80

- Main Pot: $80 (20×4)
- Side Pot 1: $90 ((50-20)×3)
- Side Pot 2: $60 ((80-50)×2)

### Equity Calculation

Equity is the expected **share of the pot** (0–1), not a win probability — split pots count as `1 / (1 + tied)`.  
The analysis panel shows two estimates side by side:

|                   | Opponent model                                                  | Engine                                                                                               | Role                                         |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Random equity** | N uniformly random hands                                        | Monte Carlo (300–400 iterations); heads-up river uses exact enumeration of all C(45,2) villain hands | Baseline / sanity check                      |
| **Range equity**  | One inferred continuing range (remaining opponents stay random) | Same Monte Carlo engine, with the primary opponent sampled from the weighted combos                  | Drives the recommendation and the EV figures |

**Range inference** (`estimateOpponentCombos` in `src/utils/rangeEquity.ts`):

1. Reconstruct the preflop role from the action log (most-invested player = opener, otherwise defender vs. the aggressor) and look the position up in the `gtoPreflop.ts` tables.
2. Apply card removal against hero + board, and optionally tune the width from the opponent's tracked VPIP.
3. **Narrow by the postflop action line** (`src/utils/postflopRange.ts`). Each street the opponent acted on contributes one factor: their combos are bucketed into `strong / medium / draw / weak / air` against that street's board, then weighted by that category's propensity to take the observed action. Bet and raise frequencies come from the shared tables in `postflopFrequencies.ts` (the same numbers the bot itself uses), bluff weight comes from the GTO value:bluff closed form in `gtoMath.ts`, and facing-bet responses are anchored on MDF.

Weights multiply across streets and are floored per street, so a combo is never removed — the range degrades smoothly instead of collapsing. With no postflop history every weight is 1 and the result is identical to the preflop-only range. When the opponent's tracked aggression (AF / tendency) is available, bluff weights are scaled by it, which makes the figure an **exploitative** range rather than a purely GTO one — the panel labels this explicitly.

Iteration counts live in one shared table (`src/utils/equityIterations.ts`): preflop 400, flop 350, turn/river 300 — the **same numbers for the bot and the panel**, so a figure shown to the user is the figure the bot decided on. They no longer scale down with the opponent count.

**Known limits**: only the primary opponent is range-modelled (multiway range equity reads high); the postflop line is reconstructed from recorded actions rather than solved, so it is a heuristic; river frequencies are derived from the turn row because the bot's river branch never used the c-bet table; side pots, unequal stacks and ICM are not modelled *inside the equity figure itself* (ICM changes the bot's preflop thresholds only under the heuristic engine — see Strategy Configuration & Advice Channels); the Monte Carlo estimate still carries a few points of variance.


### Implied Odds

`(pot + future winnings) : (call + my future calls)` — *"if I call now, how much more can I win once I improve?"*  
The row prints two calibers side by side: the main figure is the **drawing plan**, the small `上界` reference is the optimistic textbook read. The same formula lives in the row's hover tooltip.

**1. When the row appears** (`potOdds.shouldShowImpliedOdds`) — only for a hand that can still improve. It is a pure **display gate**: it never feeds the arithmetic. Any one member is enough.

| Member              | Test                                                     | Why it counts                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draw                | `drawDetector` reports a flush draw / OESD / gutshot     | Requires **exactly** 4 of a suit — a made flush and a 3-card backdoor draw are both excluded                                                                                                                                     |
| Backdoor flush draw | Exactly 3 of a suit, **at least one of them in my hand** | `drawDetector` does not report these. Needs 2 more cards, so it is off from the turn on. A three-suited *board* does not count: two more of that suit make a flush for everyone, so nobody pays                                  |
| Three of a kind     | `evaluateHand(...).rank === 'three_of_kind'`             | Set / trips / board trips. Already a made hand (so `drawDetector` ignores it), but it can still become a full house or quads. A full house or quads does **not** qualify — 1 out is the same order as drawing to a pair with air |
| Preflop pocket pair | `phase === 'preflop'`                                    | Set mining — the classic implied-odds spot (≈12% to flop a set). Postflop, a pocket pair that missed has 2 outs and does not qualify                                                                                             |

Top pair, two pair, a made straight or flush, and a pocket pair that missed the flop show **nothing**: the figure would only contradict the plain pot odds on the same screen.

**2. The main figure — drawing plan** (`potOdds.impliedOddsFor`)

| Term                           | Caliber                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opponent's future contribution | Next-street bet × **betting streets left**, then capped by his remaining stack                    | The next-street bet is extrapolated from his *actual* bet-to-pot fraction (`nextStreetBetFrom`) — no invented "2/3 pot" assumption. Streets left: preflop 3 / flop 2 / turn 1. **Deliberately not the cards still to come**: the two agree only from the flop on (preflop is 5 vs 3), and passing 5 inflates the preflop figure by ~1.7× while still looking plausible |
| My future calls                | That bet × `impliedCallWeight(streetsLeft, outs)`                                                 | Weighted by the chance I have **not** hit yet, so `outs → 0` stays continuous. The river street never produces a call ⇒ `n − 1`                                                                                                                                                                                                                                        |
| Reverse implied-odds discount  | ×0.4 paired board, ×0.5 three-suited board + straight draw, ×0.6 non-nut flush draw; floor `0.15` | Applies to the **winnings** side only — hitting can still lose                                                                                                                                                                                                                                                                                                         |
| Opponent paying willingness    | ×0.7 when `WTSD < 20`, ×0.85 when `AF < 1`; gate 20 hands; never scales up                        | Applied only once the sample is real; missing stats are skipped, not read as 0                                                                                                                                                                                                                                                                                         |
| Rake                           | Subtracted from the **numerator** (winnings), never the denominator (risk)                        | Cash games only — a tournament is `NO_RAKE` (`effectiveRakeConfigFor`)                                                                                                                                                                                                                                                                                                 |

**3. The `上界` reference** — the optimistic read: the opponent keeps betting the same fraction for every remaining street (× streets left), my future calls = 0, no discounts, no rake. It deliberately does **not** assume "he stacks off": in deep stacks that caliber degenerates into absurd ratios (two 50 000 stacks, 5 000 pot → a **4.3%** breakeven, i.e. "call with 4% equity"). Capping it at one bet per remaining street keeps the textbook example intact and the deep-stack figure sane (the paired-board case in the tests: 2.3% → **12.5%**).

**4. Worked example** — the book's short stack: pot `7 500`, call `2 500`, both players `2 500` behind.

| Caliber             | Reward : risk                                   | Breakeven |
| ------------------- | ----------------------------------------------- | --------- |
| Drawing plan (main) | `(7 500 + 2 500) : (2 500 + 2 500)` = **2 : 1** | **33.3%** |
| `上界` (optimistic)   | `(7 500 + 2 500) : 2 500` = **4 : 1**           | **20.0%** |

**5. Properties worth knowing**

| Property                                          | Detail                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The plan can be **worse** than the plain pot odds | Committing to pay another street is what does it — the upper bound relaxes the bar, the plan raises it |
| Already all-in opponents are excluded             | Their `chips = 0` would otherwise drag the whole `Math.min` to 0 in a multi-way pot                    |
| Hidden on the river                               | No street left ⇒ the figure is identical to the plain pot odds                                         |
| Deep stacks                                       | "Full effective stack" is never assumed, so the ratio does not collapse (see §3)                       |


### Strategy Configuration & Advice Channels

Two **orthogonal** switches on the table screen — but their blast radius differs, which is easy to misread:

| Axis                    | Values                | Sole consumer in the repo                                                     | Affects the bot | Affects the panel                             |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------- | --------------- | --------------------------------------------- |
| **Engine** (GTO toggle) | `gto` / `heuristic`   | `botAI.ts` (three dispatch sites: preflop / postflop / river)                 | ✅               | ❌ **zero**                                    |
| **Scenario**            | `cash` / `tournament` | `gtoICM` (risk premium), `gtoShortStack`, `rake`, `gtoPreflop` (range tables) | ✅               | ✅ 3 sites (range tables / rake / caveat text) |

The analysis panel shows **four** things that all look like "the recommended action". They take different inputs, so they may legitimately disagree — that is a difference of convention, not a bug:

| Dimension                               | ① `GTO preflop` (preflop only)                                                                                                                                                                  | ② Recommendation                                                                                                | ③ `Action` (postflop only)                                                                                                                                     | ④ Bot's actual action (seat bubble)                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Street**                              | preflop only                                                                                                                                                                                    | preflop + postflop                                                                                              | postflop only (flop/turn/river)                                                                                                                                | all                                                               |
| **Data source**                         | the 13×13 hand-authored range tables in `gtoPreflop` (7 RFI / 21 defend / 6 four-bet / 3 cold three-bet); derived tightened tables for tournaments                                              | `rangeEquity` (Monte Carlo over an inferred opponent range, falling back to random equity) + `callThresholdFor` | `gtoPostflop` / `gtoRiver` + `postflopFrequencies`                                                                                                             | `botAI.getBotAction`, dispatched by `isGtoEngine()`               |
| **Decision rule**                       | pick the table by (position, preflop scenario) → look up the hand-class cell → `R`/`C`/`F`; mixed frequencies from `MIX`; sizing from position + stack band                                     | `edge = equity − callThreshold`, graded by street-specific thresholds                                           | board texture + hand class + equity + pot odds + SPR + position + draws                                                                                        | the engine's own rules **+ action-availability filtering**        |
| **Uses equity?**                        | ❌ never                                                                                                                                                                                         | ✅ **the only input**                                                                                            | ✅                                                                                                                                                              | ✅                                                                 |
| **Uses position?**                      | ✅ **primary key**                                                                                                                                                                               | ❌                                                                                                               | ✅                                                                                                                                                              | ✅                                                                 |
| **Uses board / draws?**                 | ❌ (no board preflop)                                                                                                                                                                            | ⚠️ indirectly (equity already includes them; the rule does not read texture)                                    | ✅ **primary input**                                                                                                                                            | ✅ (postflop)                                                      |
| **Uses pot odds?**                      | ❌ never                                                                                                                                                                                         | ✅ **core**                                                                                                      | ✅ (`callThreshold`)                                                                                                                                            | ✅ (`ctx.potOdds`)                                                 |
| **Uses an opponent profile?**           | ❌ no `adj` parameter                                                                                                                                                                            | ⚠️ indirectly (the range is narrowed / exploitative)                                                            | ❌ no `adj` parameter                                                                                                                                           | ✅ **the only one**                                                |
| **Uses stack depth / ICM?**             | stack ✅ / ICM ❌                                                                                                                                                                                 | ❌ / ❌                                                                                                           | stack ✅ (SPR) / ICM ❌                                                                                                                                          | ✅ / ✅ (ICM on every street; the premium is 0 in cash)            |
| **Output granularity**                  | `action` + `sizingBB` + `freq{r,c,f}` + `isAllIn`                                                                                                                                               | a single action word (no size, no frequency)                                                                    | `action` + size + board texture + `reasoning` + `freq`                                                                                                         | `{action, amount?, reasoning?}`; the bubble shows only the action |
| **Randomness**                          | ❌ deterministic                                                                                                                                                                                 | ⚠️ rule is deterministic; equity is Monte Carlo (seeded)                                                        | ✅ yes (seeded)                                                                                                                                                 | ✅ yes (seeded via `setRandomSeed`)                                |
| **Constrained by action availability?** | ❌                                                                                                                                                                                               | ❌                                                                                                               | ❌                                                                                                                                                              | ✅ **the only one** (`canXxxResult`)                               |
| **Affected by the GTO toggle?**         | ❌                                                                                                                                                                                               | ❌                                                                                                               | ❌                                                                                                                                                              | ✅ **the only one**                                                |
| **Affected by the scenario?**           | ✅ (tightened tables)                                                                                                                                                                            | ✅ indirectly (rake; preflop equity via tightened opponent ranges)                                               | ⚠️ only via pot odds (rake)                                                                                                                                    | ✅ everything                                                      |
| **Relation to the bot**                 | shares the tables **and** `detectPreflopScenario` with `decidePreflopGTO` when GTO is on; the bot additionally applies the ICM premium / opponent adjustments / all-in feasibility / randomness | shares only the call-price convention                                                                           | shares the same functions as `decidePostflopGTO` / `decideRiverGTO` (river shares `getRiverStrategy`); the bot additionally applies ICM / opponent adjustments | it *is* the bot                                                   |
| **Question it answers**                 | "what does the GTO preflop chart say for this hand in this seat?"                                                                                                                               | "is this hand's equity enough for this price?"                                                                  | "on this board at this SPR, how much do we bet / check / call / fold?"                                                                                         | "what did the bot actually do?"                                   |

Per-combination breakdown:

| Chain                                       | OFF · cash                           | OFF · tournament                                   | ON · cash                                                               | ON · tournament            |
| ------------------------------------------- | ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Bot preflop engine                          | heuristic `decidePreflop`            | same, **ICM may take over**                        | `decidePreflopGTO` (table lookup)                                       | same, **tightened tables** |
| Bot preflop ICM risk premium                | ❌ always 0                           | ✅ **yes** (~+16% measured)                         | ❌ none                                                                  | ❌ **none**                 |
| Bot postflop / river ICM risk premium       | ❌ always 0                           | ✅ **yes** (folded into the call threshold)          | ✅ **yes** (same)                                                        | ✅ **yes** (same)           |
| Bot postflop / river SPR commitment         | ✅ `sprStrategy` (commit / control / cautious) | ✅ same                                    | ✅ same                                                                  | ✅ same                     |
| Bot short-stack push/fold (`gtoShortStack`) | ✅ used                               | ✅ used + `isBubble` tightening                     | ❌ **not used** (goes through `jamInsteadOfSizing` / `shouldAllInBySPR`) | ❌ not used                 |
| Bot call-threshold rake                     | per StartPage rake config            | ❌ never                                            | per config                                                              | ❌ never                    |
| Bot postflop / river engine                 | heuristic                            | same                                               | `decidePostflopGTO` / `decideRiverGTO`                                  | same                       |
| Panel ① `GTO preflop`                       | ✅ GTO table (**toggle-independent**) | ✅ **tightened table**                              | same                                                                    | same                       |
| Panel ② Recommendation                      | equity vs rake-adjusted price        | same + preflop equity shifts from tightened ranges | same                                                                    | same                       |
| Panel ③ `Action`                            | GTO postflop module                  | same (no rake, ❌ no ICM)                           | same                                                                    | same                       |
| Panel caveat line                           | `… · 未计 ICM · 未计抽水`                  | `… · 未计 ICM（机器人溢价 +X%） · 未计抽水 · 锦标赛范围收紧`          | same                                                                    | same                       |

**Two asymmetries worth knowing** (each also recorded in the source comments):

1. **Preflop, ICM reaches the bot only when GTO is OFF.** On the heuristic path `botAI.decidePreflop` applies the risk premium (`gtoICM.riskPremiumFor`) and `gtoShortStack`. When GTO is ON, preflop tournament tightening is expressed solely through the derived range tables in `gtoPreflop` (`TOURNAMENT_*_KEEP`), which do **not** stack a risk premium. **Postflop and river are different**: there the premium is applied under *both* engines, because `gtoPostflop` / `gtoRiver` / `gtoDeepStack` (shared with the panel's `Action` row) and the heuristic `botAI.decidePostflop` / `decideRiver` all fold it into the call threshold via `gtoICM.riskAdjustedThreshold`.
2. **The panel never applies ICM — but it does *display* the bot-side premium.** `HandAnalysis` imports only `gtoICM.riskPremiumForScenario` and uses it for the caveat text; none of its numbers (the recommendation row, MDF / Call EV / Raise EV / V:B) is ICM-adjusted. The caveat line therefore starts with *未计 ICM* in both scenarios and, under tournaments, annotates the bot's premium as *（机器人溢价 +X%）* — a signed value (negative for a short stack, i.e. a *loosened* threshold). What *does* change the panel's numbers under tournaments is the opponent's modelled range (tightened preflop) — and that has its own label, *锦标赛范围收紧*. The quoted strings are the literal UI labels, which are Chinese.

**The panel's `Bot Action` rows are not a fifth channel of the table above.** They answer a *hypothetical* — "if this seat were a TAG / a LAG, what would it do?" — by running the bot's decision path on that seat (`getShadowBotActions`). They share the *code* with ④ (all end in `getBotAction`) but not the *sample*: ④ is the bot's real action, each `Bot Action` row is one deterministic draw from the same mixed strategy. They may legitimately differ, and neither is a bug. The two rows are **always shown**; when the seat has no actionable decision (hero folded, all-in, settled, …) the value degrades to a `— / 无可行动作` placeholder rather than disappearing.

### Known Limits

- **Personality calibration is partial (updated after the structural fix).** The §4 VPIP/PFR/AF/WTSD ranges are *working targets*, not hard guarantees. The preflop raise branch used to be gated so that non-blind seats almost always entered by *calling*, which made the VPIP/PFR **ratio** and the TAG/LAG **PFR** targets unreachable by tuning the knobs alone. That gate is now fixed (RFI **raise** ← `openWiden`, **limp/call** ← `defendVsOpen`) and the parameters were re-scaled, so on the 6-player table at production equity iterations **16 of 19** joint checks pass (up from 13) and the assigned→measured classification is correct **5/5**. Two targets remain unmet and are known *semantic* gaps rather than knob-range problems: the Fish `WTSD ≤ 30` target contradicts its loose-passive semantics, and the Fish/CS `AF < 1.5` target has no knob left to move. Maniac is still not sampled by the calibration runner. Full data, root cause and follow-up plan: `docs/BOT_PERSONALITY_PLAN.md` §17.1 and §17.3.
- **7/8-player tables.** The first full acceptance round is the 6-player table `1 real + 5 bots`. For 7/8 players only configuration correctness, save/restore and all-seat legality are gated; the full six-type calibration at 7 players (R1/B6, with a Maniac real-play special) and at 8 players is a later phase. Full position unification for 7/8 seats is **not** part of this change.
- **Save / refresh mid-hand.** Recovery is guaranteed from a **settled-hand snapshot**. Resuming an in-progress hand after a refresh is a separate, known issue and is not claimed as supported.

### Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Jest + React Testing Library (unit + integration tests)

### Getting Started

```bash
npm install
npm run dev
```

### Run Tests

```bash
# Unit tests (pot calculator, hand evaluation)
npm test

# Integration tests (full game flow)
npm test useGameState.integration.test.ts

# All tests with coverage
npm test -- --coverage
```

### Lint & Build

```bash
npm run lint
npm run build
```

### Testing Structure

- **Unit Tests**: `src/utils/__tests__/` - Algorithm correctness (pot calculation, equity, draw detection, preflop hand strength)
- **Integration Tests**: `src/e2eTests/` - Full game flow (end-to-end)
- **Hook Tests**: `src/hooks/__tests__/` - Hook behavior tests
- **Component Tests**: `src/components/__tests__/` - UI, settlement, equity panel, and the player-stats popover
- **Test Coverage**: 1700 tests across 91 test suites (1698 passed, 2 skipped) — run `npm test` for the current figure

---

## 中文

一个基于 React 的德州扑克游戏，包含智能机器人、精确的底池计算和完整的游戏流程。

### 功能特性

- **多人支持**: 2-10 名玩家（真人 + AI 机器人）
- **智能机器人 AI**: 专业级 AI，具备混合策略、位置感知和对手画像
  - **翻前策略**: TAG-LAG 混合风格（VPIP ~28%, PFR ~20%），基于 169 种起手牌分级系统
  - **混合策略**: 随机化决策，防止被对手反推牌型
  - **位置打法**: 后位范围更宽、偷盲、轻 3-bet
  - **翻后 AI**: Monte Carlo 胜率模拟（300-400 次迭代）+ 底池赔率比较
  - **听牌检测**: 同花听牌、两头顺子、卡顺，基于 Outs 概率计算
  - **对手画像**: 自动识别激进/被动型对手，动态调整决策阈值
- **Bot 性格（persona）**: 每个 Bot 可被分配六类性格之一，重塑其翻前/翻后门槛与下注尺寸；在开始页设置（**默认开**、开新盘时选定、盘内只读）
  - **六类与 A′ 配额**: B 个 Bot 的分配是多重集 `TAG`（B=1）、`TAG+Fish`（B=2）、`TAG+LAG+Fish`（B=3）、`TAG+LAG+Fish+Nit`（B=4）、`TAG+LAG+Fish+Nit+CS`（B=5）、`TAG+LAG+Fish+Nit+CS+Maniac`（B=6）；普通新局上限 B≤6
  - **分配 ≠ 实测**: **分配**的类型通过七个旋钮（`openWiden` / `defendVsOpen` / `threeBetFreq` / `valueShift` / `aggressionMult` / `callBias` / `sizingMult`）驱动机器人决策；统计表里的**实测**类型则由机器人真实 VPIP/PFR 分类得出 —— 两者可以合法地不同
  - **座位标签**: 一手结算后每个 Bot 座位显示其**分配**的性格（悬停有说明）；下注阶段不显示，关闭/未分配的座位不虚构标签
  - **按分配类型聚合**: 统计浮层按**分配**的性格把 Bot 分组展示，与按座位的实测统计并列
  - **校准**: 参数由闭环 runner（`npm run calibrate`，复用生产 reducer，3000 手、生产迭代）拟合得出 —— 见 [已知限制](#已知限制)；翻前加注分支解除门控后 ratio 与 TAG/LAG PFR 目标已可达，19 项联合检查**通过 16 项**（余 2 项为语义缺口）
- **手牌分析面板**: 实时显示**随机权益**与**范围权益**、底池赔率、隐含赔率、听牌信息、**Bot Action** 和行动建议
  - **随机权益**: 我方手牌 vs N 手均匀随机牌（Monte Carlo；单挑河牌走精确枚举）—— 「vs 随机牌」的口径说明挂在该行的**悬停提示**里，不占版面（写在行内会把百分比挤出去）
  - **范围权益**: 我方手牌 vs 推断出的对手续玩范围（翻前角色 + 位置表 + 去牌 + VPIP 宽度修正，再按观测到的翻后行动线收窄）
  - 翻前起即可用；行动建议与 EV 数字由范围权益驱动，无法推断范围时回退为随机权益
  - **Bot Action**（位于 `GTO Math` 之前）: **固定两行** —— `Bot 紧凶Action` / `Bot 松凶Action` —— 显示这个座位**如果是 TAG / LAG** 会怎么打，与当盘实际分配无关（当盘没有这两类 Bot、甚至整盘关闭性格，两行都在）。与场上机器人同一条决策路径（`getShadowBotActions` → `getBotAction`），只是把策略随机换成由局面签名派生的 PRNG，因此面板渲染**不会**推进真机器人的混合频率序列；两行共享一次权益计算。它是**假设性**结果，与机器人的真实动作（下表通道 ④）可以合法地不同；该座位没有可行动作时值退化成 `— / 无可行动作`，但两行不消失
  - **底池赔率**: 百分比 + 同一件事的**比率形式**（底池 : 跟注），如 `33.3% 2 : 1` —— 1/4 池 `5 : 1`、1/2 池 `3 : 1`、3/4 池 `2.3 : 1`、一个池 `2 : 1`、两个池 `1.5 : 1`，与标准表逐行一致
  - **隐含赔率**: `（底池 + 对手未来投入）:（跟注 + 我未来跟注）` —— 主值是**追牌计划**口径（成牌之后对手还会付多少），旁边的小号「上界」是教材式乐观对照。只在手牌还有变强路径时显示（听牌 / 后门同花听 / 三条 / 翻前口袋对），河牌隐藏。完整口径、算例与边界见 [隐含赔率](#隐含赔率)
- **玩家数据统计 (VPIP/PFR)**: 跨多局长期追踪翻牌前行为 —— 统计表里 Bot 与真人同一口径
  - **VPIP** (主动入池率): 玩家翻牌前自愿入池的手牌百分比
  - **PFR** (翻牌前加注率): 玩家翻牌前加注的手牌百分比
  - **玩家类型分类**: 基于 VPIP/PFR 区间自动分类：
    - **Nit** (紧弱): VPIP <= 20%, PFR < 12%, Gap > 8%
    - **TAG** (紧凶): VPIP 20%-28%, PFR 16%-32%, Gap <= 8%
    - **LAG** (松凶): VPIP <= 38%, PFR 20%-32%, Gap <= 8%
    - **Calling Station** (跟注站): VPIP > 35%, PFR < 15%, Gap > 20%
    - **Maniac** (疯子): VPIP >= 45%, PFR >= 35%
    - **Others** (其他): 不属于以上类型
  - **持久化存储**: 数据保存在 localStorage，浏览器重启后数据保留
  - **导出/导入**: 支持将统计数据备份为 JSON 文件并恢复
  - **统计表格**: 收在游戏页面右上角（`真人 n | Bot n` 下方）的**可折叠浮层**里，默认收起、点击按钮才展开；显示每位玩家的 VPIP、PFR 和玩家类型，**真人行在上、Bot 行在下**。表头一律不折行（`3-Bet` / `Turn CB` 保持一行），「类型」列也不折行（`Nit 紧弱` 保持一行），放不下时浮层整体变宽、必要时横向滚动。Bot 与真人一样读跨会话的长期统计（而非只算当前会话）
- **策略配置**: 牌桌上两个**正交**开关
  - **引擎**: `GTO`（各街走 GTO 模块）或 `启发式`（上面那套 TAG/LAG 混合风格）
  - **赛制**: `现金局` 或 `锦标赛`。锦标赛不抽水、叠加由「筹码相对泡沫因子」算出的 ICM 风险溢价，并使用相对现金局收紧的翻前范围
  - **抽水**（仅现金局，在开始页设置）: 不抽水 / 按底池百分比 / 固定 nBB，三种都可选填「封顶几个 BB」
- **完整游戏流程**: 翻牌前 → 翻牌 → 转牌 → 河牌 → 摊牌
- **手牌评估**: 识别所有牌型，从高牌到皇家同花顺
- **精确底池计算**: 主池和边池的多层级正确拆分
- **筹码系统**: 初始 1000 筹码，支持下注和底池追踪
- **盲注结构**: 小盲可调（默认 $5，大盲 = 2×小盲）
- **全押支持**: 完整的全押机制，正确创建边池
- **双语支持**: 中文和英文（自动检测）
- **响应式 UI**: 使用 Tailwind CSS 构建

### 游戏操作

- **过牌 (Check)**: 无需跟注时跳过下注
- **跟注 (Call)**: 匹配当前下注
- **加注 (Raise)**: 增加下注金额
- **弃牌 (Fold)**: 放弃本局
- **全押 (All-in)**: 押上所有剩余筹码（必要时创建边池）

### 底池计算逻辑

游戏实现了精确的德州扑克底池规则：

- **主池**: 活跃玩家中最小下注额 × 有贡献的玩家数量
- **边池**: 当玩家以不同金额全押时创建
- **多层级拆分**: 每个边池有各自的合格玩家
- **筹码守恒**: 总筹码始终等于初始筹码（已通过测试验证）

示例：4名玩家下注 $20、$50、$80、$80

- 主池: $80 (20×4)
- 边池1: $90 ((50-20)×3)
- 边池2: $60 ((80-50)×2)

### 权益计算

权益是**底池期望分成比例**（0–1），不是胜率 —— 平分底池按 `1 / (1 + 平分人数)` 计入。  
分析面板并排显示两个估算值：

|          | 对手模型                   | 计算引擎                                                | 作用            |
| -------- | ---------------------- | --------------------------------------------------- | ------------- |
| **随机权益** | N 手均匀随机牌               | Monte Carlo（300–400 次迭代）；单挑河牌走精确枚举（全部 C(45,2) 对手组合） | 基准值 / 交叉验证    |
| **范围权益** | 一个推断出的续玩范围（其余对手仍视为随机牌） | 同一 Monte Carlo 引擎，主要对手从估算组合中采样                      | 驱动行动建议与 EV 数字 |

**范围推断**（`src/utils/rangeEquity.ts` 的 `estimateOpponentCombos`）：

1. 从行动历史重建翻前角色（下注最多者为开池方，否则为面对加注方的防守方），在 `gtoPreflop.ts` 位置表中查表。
2. 对 hero + 公共牌做去牌，并可依据对手的历史 VPIP 调整范围宽度。
3. **按翻后行动线收窄**（`src/utils/postflopRange.ts`）。对手行动过的每条街贡献一个因子：先按其面对该街牌面的强度分桶为 `strong / medium / draw / weak / air`，再乘以该类别采取观测行动的概率作为权重。下注/加注频率取自 `postflopFrequencies.ts` 中的共享表（与 bot 自身使用同一套数字），诈唬权重来自 `gtoMath.ts` 的 GTO 价值:诈唬闭式解，面对下注的应对以 MDF 为锚。

权重跨街道连乘，且每条街单独设下限，因此组合永不会被彻底剔除 —— 范围是平滑退化而非坍缩。没有翻后历史时所有权重均为 1，结果与纯翻前范围完全一致。当对手的历史激进度（AF / 倾向）可用时，诈唬权重会按其缩放，使该数字成为**剥削性**范围而非纯 GTO 范围 —— 面板对此有明确标注。

迭代次数集中在 `src/utils/equityIterations.ts` 一张表里（翻前 400、翻牌 350、转牌/河牌 300），**机器人与面板共用同一套数字** —— 面板显示给用户的胜率就是机器人据以决策的胜率。已不再按对手数降档。

**已知局限**：只对主要对手建模范围（多人底池的范围权益偏高）；翻后行动线由记录的行动重建而非求解，属启发式；河牌频率由转牌行推导而来（bot 的河牌分支未使用 c-bet 表）；**权益数字本身**不含边池、不等筹码与 ICM（ICM 只在启发式引擎下改变机器人的翻前门槛，见「策略配置与建议口径」）；Monte Carlo 本身仍有几个百分点的方差。

### 隐含赔率

`（底池 + 对手未来投入）:（跟注 + 我未来跟注）` —— *「我现在跟这一注，成牌之后还能再赢多少？」*  
这一行并排给出两个口径：主值是**追牌计划**，小号「上界」是教材式的乐观读法。同一套公式也挂在该行的悬停提示里。

**1. 什么时候显示这一行**（`potOdds.shouldShowImpliedOdds`）—— 只有「手牌还能变强」时才显示。它是一道**纯显示门**，不参与任何赔率计算；下列任一成员成立即显示。

| 成员    | 判据                                           | 为什么算                                                                                                  |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 听牌    | `drawDetector` 认出同花听 / 两头顺 / 卡顺              | 要求**恰好** 4 张同花 —— 已成同花与 3 张的后门听都不算                                                                    |
| 后门同花听 | 恰好 3 张同花，且**我手里至少有一张**                       | `drawDetector` 不认它。需要再发 2 张，所以转牌之后不成立。**牌面自己三张同花不算**：再发两张谁都成花，成了也赢不到钱                                 |
| 三条    | `evaluateHand(...).rank === 'three_of_kind'` | 暗三条 / 明三条 / 牌面三条都算。它已经是成牌（所以 `drawDetector` 不认它是听牌），但还能变葫芦、变四条。葫芦 / 四条**不算** —— 只剩 1 张补牌，跟「空气追对子」一个量级 |
| 翻前口袋对 | `phase === 'preflop'`                        | set mining，最经典的隐含赔率场景（约 12% 中三条）。翻后已错过牌面的口袋对只剩 2 张补牌，不算                                               |

顶对、两对、已成顺子 / 同花、翻后错过牌面的口袋对都**不显示** —— 那个数字只会在同一屏上跟直接赔率打架。

**2. 主值 —— 追牌计划口径**（`potOdds.impliedOddsFor`）

| 分项      | 口径                                              | 说明                                                                                                                                                     |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 对手未来投入  | 下一条街的预计注码 × **剩余下注街数**，再受他剩余筹码夹住                | 预计注码由他当前的下注尺度外推（`nextStreetBetFrom`），不假设「2/3 池」这类固定比例。剩余下注街数：翻前 3 / 翻牌 2 / 转牌 1。**刻意不用「还要发的牌数」**：两者只在翻牌往后恰好相等（翻前是 5 vs 3），传牌数会把翻前结果放大 ~1.7 倍，而且看起来仍然合理 |
| 我未来跟注   | 该注码 × `impliedCallWeight(streetsLeft, outs)`    | 按**还没成牌**的概率加权，所以 `outs → 0` 时仍然连续；河牌那条街不会再产生跟注 ⇒ `n − 1`                                                                                              |
| 反隐含赔率折扣 | 牌面对子 ×0.4、三张同花 + 顺子听 ×0.5、非坚果同花听 ×0.6，下限 `0.15` | 只作用在**赢到的筹码**一侧 —— 成牌仍可能输                                                                                                                              |
| 对手支付意愿  | `WTSD < 20` ×0.7、`AF < 1` ×0.85；样本门槛 20 手；永不上调  | 样本够时才打折；字段缺失按「不参与」处理，不当成 0                                                                                                                             |
| 抽水      | 从**分子**（赢到的筹码）里扣，绝不动分母（风险）                      | 只在现金局；锦标赛由 `effectiveRakeConfigFor` 恒为 `NO_RAKE`                                                                                                       |

**3. 小号「上界」** —— 乐观读法：对手按同一比例继续下注、把剩余街数收满，我未来跟注记 0，不打折也不折抽水。它**刻意不取「对手全下」那个口径**：深筹码下那个口径会退化成荒谬的比价（双方各 5 万、底池 5000 → 盈亏平衡 **4.3%**，等于宣称「4% 胜率就可以跟」）。改成「每条剩余街只收一注」之后，教材那个例子的数字仍然成立，深筹码下的数也不再离谱（测试里的牌面对子用例：2.3% → **12.5%**）。

**4. 算例** —— 教材那个浅筹码例子：底池 `7 500`、跟 `2 500`、双方身后各 `2 500`。

| 口径       | 收益 : 风险                                         | 盈亏平衡      |
| -------- | ----------------------------------------------- | --------- |
| 追牌计划（主值） | `(7 500 + 2 500) : (2 500 + 2 500)` = **2 : 1** | **33.3%** |
| 「上界」（乐观） | `(7 500 + 2 500) : 2 500` = **4 : 1**           | **20.0%** |

**5. 几个容易踩的点**

| 性质                | 说明                                         |
| ----------------- | ------------------------------------------ |
| 计划口径可能**比直接赔率还差** | 「打算再付一注」就会这样 —— 上界放宽门槛，计划口径抬高门槛            |
| 已全下的对手不计入         | 他们的 `chips = 0`，否则多人池里会把 `Math.min` 整体拖到 0 |
| 河牌隐藏              | 没有后续街，这一行与直接赔率恒等                           |
| 深筹码不会崩            | 从不假设「把对手剩余筹码全赢过来」，所以比价不会退化成荒谬值（见第 3 节）     |


### 策略配置与建议口径

牌桌上有两个**正交**的开关，但它们的影响面并不相同 —— 这一点最容易误读：

| 轴              | 取值                  | 全仓唯一消费者                                                 | 影响机器人 | 影响面板                   |
| -------------- | ------------------- | ------------------------------------------------------- | ----- | ---------------------- |
| **引擎**（GTO 开关） | `gto` / `heuristic` | `botAI.ts`（翻前 / 翻后 / 河牌三处派发）                            | ✅     | ❌ **0 处**              |
| **赛制**         | `现金局` / `锦标赛`       | `gtoICM`（风险溢价）、`gtoShortStack`、`rake`、`gtoPreflop`（范围表） | ✅     | ✅ 3 处（范围表 / 抽水 / 标注文案） |

分析面板上有**四条**看起来都像「建议动作」的通道。它们的输入不同，所以**可以合法地互相矛盾** —— 那不是 bug，是口径不同：

| 维度               | ① `GTO preflop`（仅翻前）                                                                                      | ② 「胜率 vs 赔率 → 建议」                                                  | ③ `Action`（仅翻后）                                                                                        | ④ 机器人真实动作（座位气泡）                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **生效街**          | 仅翻前                                                                                                       | 翻前 + 翻后                                                            | 仅翻后（翻牌/转牌/河牌）                                                                                          | 全部                                        |
| **数据来源**         | `gtoPreflop` 的 13×13 手编范围表（RFI 7 张 / 防守 21 张 / 4bet 6 张 / 冷 3bet 3 张）；锦标赛用派生收紧表                           | `rangeEquity`（对推断出的对手范围做 Monte Carlo，退化时用随机权益）+ `callThresholdFor` | `gtoPostflop` / `gtoRiver` + `postflopFrequencies`                                                     | `botAI.getBotAction`，按 `isGtoEngine()` 派发 |
| **判定方式**         | 按（位置, 翻前场景）选表 → 查手牌类格子 → `R`/`C`/`F`；混合频率来自 `MIX`；尺寸按位置 + 筹码档                                             | `edge = equity − callThreshold`，按街用各自的相对阈值分级                       | 牌面纹理 + 手牌档 + 权益 + 赔率 + SPR + 位置 + 听牌                                                                   | 引擎自身的判据 **+ 行动权限过滤**                      |
| **用胜率？**         | ❌ 完全不用                                                                                                    | ✅ **唯一主输入**                                                        | ✅                                                                                                      | ✅                                         |
| **用位置？**         | ✅ **主键**                                                                                                  | ❌                                                                  | ✅                                                                                                      | ✅                                         |
| **用牌面 / 听牌？**    | ❌（翻前无牌面）                                                                                                  | ⚠️ 间接（权益已含，判定不看纹理）                                                 | ✅ **主输入之一**                                                                                            | ✅（翻后）                                     |
| **用底池赔率？**       | ❌ 完全不用                                                                                                    | ✅ **核心**                                                           | ✅（`callThreshold`）                                                                                     | ✅（`ctx.potOdds`）                          |
| **用对手画像？**       | ❌ 签名里没有 `adj`                                                                                             | ⚠️ 间接（范围含收窄 / 剥削性调整）                                               | ❌ 签名里没有 `adj`                                                                                          | ✅ **唯一用画像的通道**                            |
| **用筹码深度 / ICM？** | 筹码 ✅ / ICM ❌                                                                                              | ❌ / ❌                                                              | 筹码 ✅（SPR）/ ICM ❌                                                                                       | ✅ / ✅（ICM 每条街都算；现金局溢价恒为 0）               |
| **输出粒度**         | `action` + `sizingBB` + `freq{r,c,f}` + `isAllIn`                                                         | 一个动作词（无尺寸、无频率）                                                     | `action` + 尺寸 + 牌面纹理 + `reasoning` + `freq`                                                            | `{action, amount?, reasoning?}`；气泡只显示动作词  |
| **随机性**          | ❌ 纯确定性                                                                                                    | ⚠️ 判据确定；权益是 Monte Carlo（受 seed 控制）                                 | ✅ 有（受 seed 控制）                                                                                         | ✅ 有（受 `setRandomSeed` 控制）                 |
| **受行动权限约束？**     | ❌                                                                                                         | ❌                                                                  | ❌                                                                                                      | ✅ **唯一受约束**（`canXxxResult`）               |
| **受 GTO 开关影响？**  | ❌                                                                                                         | ❌                                                                  | ❌                                                                                                      | ✅ **唯一受影响**                               |
| **受赛制影响？**       | ✅ 查收紧表                                                                                                    | ✅ 间接（抽水；翻前权益因对手范围收紧而变）                                             | ⚠️ 只通过赔率（抽水）                                                                                           | ✅ 全部                                      |
| **与机器人的关系**      | GTO ON 时与 `decidePreflopGTO` **共用同一套表 + 同一个 `detectPreflopScenario`**；机器人另外还叠 ICM 溢价 / 对手调整 / 全下可行性 / 随机性 | 只共享「跟注价格」这一处口径                                                     | 与 GTO ON 的 `decidePostflopGTO` / `decideRiverGTO` **同源函数**（河牌共用 `getRiverStrategy`）；机器人另外还叠 ICM / 对手调整 | 就是它本身                                     |
| **回答的问题**        | 「按 GTO 翻前图，这手牌在这个位置该怎么打？」                                                                                 | 「这手牌的胜率够不够这个价格？」                                                   | 「这个牌面 + 这个 SPR，该下注 / 过牌 / 跟注 / 弃牌多少？」                                                                  | 「机器人这手到底怎么打？」                             |

四种组合逐条对照：

| 链路                           | OFF · 现金局              | OFF · 锦标赛                            | ON · 现金局                                               | ON · 锦标赛    |
| ---------------------------- | ---------------------- | ------------------------------------ | ------------------------------------------------------ | ----------- |
| 机器人翻前引擎                      | 启发式 `decidePreflop`    | 同左，**ICM 可接管**                       | `decidePreflopGTO` 查表                                  | 同左，查**收紧表** |
| 机器人翻前 ICM 风险溢价               | ❌ 恒为 0                 | ✅ **有**（实测 ≈ +16%）                   | ❌ 无                                                    | ❌ **无**     |
| 机器人翻后 / 河牌 ICM 风险溢价           | ❌ 恒为 0                 | ✅ **有**（折进跟注门槛）                     | ✅ **有**（同左）                                             | ✅ **有**（同左） |
| 机器人翻后 / 河牌 SPR 承诺档            | ✅ `sprStrategy`（commit / control / cautious） | ✅ 同左                           | ✅ 同左                                                   | ✅ 同左        |
| 机器人短筹码推 / 弃（`gtoShortStack`） | ✅ 走                    | ✅ 走 + `isBubble` 收紧                  | ❌ **不走**（改走 `jamInsteadOfSizing` / `shouldAllInBySPR`） | ❌ 不走        |
| 机器人跟注门槛抽水                    | 按 StartPage 的抽水配置      | ❌ 恒不抽水                               | 按配置                                                    | ❌ 恒不抽水      |
| 机器人翻后 / 河牌引擎                 | 启发式                    | 同左                                   | `decidePostflopGTO` / `decideRiverGTO`                 | 同左          |
| 面板 ① `GTO preflop`           | ✅ 显示 GTO 表（**不受开关影响**） | ✅ 显示**收紧表**                          | 同左                                                     | 同左          |
| 面板 ②「建议」                     | 权益 vs 抽水后赔率            | 同左 + 翻前权益因范围收紧而变                     | 同左                                                     | 同左          |
| 面板 ③ `Action`                | GTO 翻后模块               | 同左（不抽水、❌ 无 ICM）                      | 同左                                                     | 同左          |
| 面板口径标注                       | `… · 未计 ICM · 未计抽水`    | `… · 未计 ICM（机器人溢价 +X%） · 未计抽水 · 锦标赛范围收紧` | 同左                                                     | 同左          |

**两处必须知道的不对称**（源码注释里也各记了一份）：

1. **翻前，ICM 只在 GTO OFF 时影响机器人。** 启发式路径的 `botAI.decidePreflop` 会叠风险溢价（`gtoICM.riskPremiumFor`）与 `gtoShortStack`。GTO ON 时翻前锦标赛的收紧全部由 `gtoPreflop` 的派生范围表（`TOURNAMENT_*_KEEP`）表达，**不叠**风险溢价。**翻后与河牌不一样**：两条引擎都会把溢价折进跟注门槛 —— `gtoPostflop` / `gtoRiver` / `gtoDeepStack`（与面板 `Action` 行同源）与启发式的 `botAI.decidePostflop` / `decideRiver` 都走 `gtoICM.riskAdjustedThreshold`。
2. **面板从不计 ICM —— 但会*显示*机器人侧的溢价。** `HandAnalysis` 只 import `gtoICM.riskPremiumForScenario`，且仅用于口径文案；它的任何数字（建议行、MDF / Call EV / Raise EV / V:B）都不做 ICM 调整。所以口径标注在两种赛制下都以「未计 ICM」开头，锦标赛那句把机器人侧的溢价标成「机器人溢价 ±X%」（**有符号**：短筹码为负 = 门槛被放宽）。锦标赛下面板数字**确实**会变，但变的原因是**对手范围被收紧**，那件事有自己的标注「锦标赛范围收紧」。

**面板的 `Bot Action` 两行不是上表的第五条通道。** 它们回答的是一个**假设性问题** ——「这个座位如果是 TAG / LAG 会怎么打」—— 做法是对该座位跑一次机器人决策路径（`getShadowBotActions`）。它与 ④ **共用代码**（最终都走 `getBotAction`），但不共用**样本**：④ 是机器人的真实动作，每个 `Bot Action` 行是从同一套混合策略里抽出的一个确定性样本。两者可以合法地不同，谁都不是 bug。两行**恒在**；该座位没有可行动作（真人已弃牌、已全下、已结算…）时值退化成 `— / 无可行动作` 占位符，而不是整行消失。

### 已知限制

- **性格校准是部分的（结构修复后已更新）。** §4 的 VPIP/PFR/AF/WTSD 区间是**工作目标**，不是硬保证。此前翻前加注分支被门控，非盲位几乎总走**跟注**入池，导致 VPIP/PFR 的 **ratio** 与 TAG/LAG 的 **PFR** 目标仅靠调性格旋钮**无法达到**；该门控已修（RFI 的**加注** ← `openWiden`、**跛入/跟注** ← `defendVsOpen`）并重标了参数，六人桌在生产迭代下 19 项联合检查**通过 16 项**（原 13 项），分配→实测分类 **5/5 全对**。仍有两项未达标，且都是**语义**缺口而非量程问题：Fish 的 `WTSD ≤ 30` 与「松被动」语义相悖；Fish/CS 的 `AF < 1.5` 已无旋钮可用。Maniac 仍未被校准 runner 采样。完整数据、根因与后续计划见 `docs/BOT_PERSONALITY_PLAN.md` §17.1 与 §17.3。
- **7/8 人桌。** 首轮完整验收是六人桌 `1 真人 + 5 Bot`。7/8 人只做配置正确性、存档恢复与全座位合法性门；七人（R1/B6，含 Maniac 真实对局专项）与八人的六类完整校准为后续阶段。7/8 的完整位置统一**不在**本次改动内。
- **中途存档 / 刷新。** 只保证从**结算快照**恢复。刷新后续打一手进行中的牌是另一个已知问题，不在支持范围内。

### 技术栈

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Jest + React Testing Library (单元测试 + 集成测试)

### 快速开始

```bash
npm install
npm run dev
```

### 运行测试

```bash
# 单元测试（底池计算器、手牌评估）
npm test

# 集成测试（完整游戏流程）
npm test useGameState.integration.test.ts

# 所有测试（含覆盖率）
npm test -- --coverage
```

### 构建

```bash
npm run build
```

### 测试结构

- **单元测试**: `src/utils/__tests__/` - 算法正确性（底池计算、胜率模拟、听牌检测、翻前手牌强度）
- **集成测试**: `src/e2eTests/` - 完整游戏流程（端到端）
- **Hook 测试**: `src/hooks/__tests__/` - Hook 行为测试
- **组件测试**: `src/components/__tests__/` - UI、结算、权益面板和玩家数据浮层测试
- **测试覆盖**: 91 个测试套件，共 1700 个测试用例（1698 通过，2 跳过）—— 以 `npm test` 的实际输出为准
