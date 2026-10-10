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
- **Hand Analysis Panel**: Real-time display of **random-hand equity** and **range-aware equity**, pot odds, draw info, and action recommendations
  - **Random equity**: hero vs. N uniformly random hands (Monte Carlo; heads-up river uses exact enumeration)
  - **Range equity**: hero vs. an inferred opponent continuing range (preflop role + position tables + card removal + VPIP, then narrowed by the observed postflop action line)
  - Available from preflop onward; the recommendation and EV figures are driven by range equity, falling back to random equity when no range can be inferred
- **Player Stats Tracking (VPIP/PFR)**: Long-term tracking of real players' preflop behavior across multiple hands
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
  - **Stats Table**: Displayed in AI Analysis panel showing VPIP, PFR, and player type per real player
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

| | Opponent model | Engine | Role |
|---|---|---|---|
| **Random equity** | N uniformly random hands | Monte Carlo (300–400 iterations); heads-up river uses exact enumeration of all C(45,2) villain hands | Baseline / sanity check |
| **Range equity** | One inferred continuing range (remaining opponents stay random) | Same Monte Carlo engine, with the primary opponent sampled from the weighted combos | Drives the recommendation and the EV figures |

**Range inference** (`estimateOpponentCombos` in `src/utils/rangeEquity.ts`):

1. Reconstruct the preflop role from the action log (most-invested player = opener, otherwise defender vs. the aggressor) and look the position up in the `gtoPreflop.ts` tables.
2. Apply card removal against hero + board, and optionally tune the width from the opponent's tracked VPIP.
3. **Narrow by the postflop action line** (`src/utils/postflopRange.ts`). Each street the opponent acted on contributes one factor: their combos are bucketed into `strong / medium / draw / weak / air` against that street's board, then weighted by that category's propensity to take the observed action. Bet and raise frequencies come from the shared tables in `postflopFrequencies.ts` (the same numbers the bot itself uses), bluff weight comes from the GTO value:bluff closed form in `gtoMath.ts`, and facing-bet responses are anchored on MDF.

Weights multiply across streets and are floored per street, so a combo is never removed — the range degrades smoothly instead of collapsing. With no postflop history every weight is 1 and the result is identical to the preflop-only range. When the opponent's tracked aggression (AF / tendency) is available, bluff weights are scaled by it, which makes the figure an **exploitative** range rather than a purely GTO one — the panel labels this explicitly.

Iteration counts live in one shared table (`src/utils/equityIterations.ts`): preflop 400, flop 350, turn/river 300 — the **same numbers for the bot and the panel**, so a figure shown to the user is the figure the bot decided on. They no longer scale down with the opponent count.

**Known limits**: only the primary opponent is range-modelled (multiway range equity reads high); the postflop line is reconstructed from recorded actions rather than solved, so it is a heuristic; river frequencies are derived from the turn row because the bot's river branch never used the c-bet table; side pots, unequal stacks and ICM are not modelled *inside the equity figure itself* (ICM changes the bot's preflop thresholds only under the heuristic engine — see Strategy Configuration & Advice Channels); the Monte Carlo estimate still carries a few points of variance.

### Strategy Configuration & Advice Channels

Two **orthogonal** switches on the table screen — but their blast radius differs, which is easy to misread:

| Axis | Values | Sole consumer in the repo | Affects the bot | Affects the panel |
|---|---|---|---|---|
| **Engine** (GTO toggle) | `gto` / `heuristic` | `botAI.ts` (three dispatch sites: preflop / postflop / river) | ✅ | ❌ **zero** |
| **Scenario** | `cash` / `tournament` | `gtoICM` (risk premium), `gtoShortStack`, `rake`, `gtoPreflop` (range tables) | ✅ | ✅ 3 sites (range tables / rake / caveat text) |

The analysis panel shows **four** things that all look like "the recommended action". They take different inputs, so they may legitimately disagree — that is a difference of convention, not a bug:

| Dimension | ① `GTO preflop` (preflop only) | ② Recommendation | ③ `Action` (postflop only) | ④ Bot's actual action (seat bubble) |
|---|---|---|---|---|
| **Street** | preflop only | preflop + postflop | postflop only (flop/turn/river) | all |
| **Data source** | the 13×13 hand-authored range tables in `gtoPreflop` (7 RFI / 21 defend / 6 four-bet / 3 cold three-bet); derived tightened tables for tournaments | `rangeEquity` (Monte Carlo over an inferred opponent range, falling back to random equity) + `callThresholdFor` | `gtoPostflop` / `gtoRiver` + `postflopFrequencies` | `botAI.getBotAction`, dispatched by `isGtoEngine()` |
| **Decision rule** | pick the table by (position, preflop scenario) → look up the hand-class cell → `R`/`C`/`F`; mixed frequencies from `MIX`; sizing from position + stack band | `edge = equity − callThreshold`, graded by street-specific thresholds | board texture + hand class + equity + pot odds + SPR + position + draws | the engine's own rules **+ action-availability filtering** |
| **Uses equity?** | ❌ never | ✅ **the only input** | ✅ | ✅ |
| **Uses position?** | ✅ **primary key** | ❌ | ✅ | ✅ |
| **Uses board / draws?** | ❌ (no board preflop) | ⚠️ indirectly (equity already includes them; the rule does not read texture) | ✅ **primary input** | ✅ (postflop) |
| **Uses pot odds?** | ❌ never | ✅ **core** | ✅ (`callThreshold`) | ✅ (`ctx.potOdds`) |
| **Uses an opponent profile?** | ❌ no `adj` parameter | ⚠️ indirectly (the range is narrowed / exploitative) | ❌ no `adj` parameter | ✅ **the only one** |
| **Uses stack depth / ICM?** | stack ✅ / ICM ❌ | ❌ / ❌ | stack ✅ (SPR) / ICM ❌ | ✅ / ✅ (ICM only when GTO is OFF) |
| **Output granularity** | `action` + `sizingBB` + `freq{r,c,f}` + `isAllIn` | a single action word (no size, no frequency) | `action` + size + board texture + `reasoning` + `freq` | `{action, amount?, reasoning?}`; the bubble shows only the action |
| **Randomness** | ❌ deterministic | ⚠️ rule is deterministic; equity is Monte Carlo (seeded) | ✅ yes (seeded) | ✅ yes (seeded via `setRandomSeed`) |
| **Constrained by action availability?** | ❌ | ❌ | ❌ | ✅ **the only one** (`canXxxResult`) |
| **Affected by the GTO toggle?** | ❌ | ❌ | ❌ | ✅ **the only one** |
| **Affected by the scenario?** | ✅ (tightened tables) | ✅ indirectly (rake; preflop equity via tightened opponent ranges) | ⚠️ only via pot odds (rake) | ✅ everything |
| **Relation to the bot** | shares the tables **and** `detectPreflopScenario` with `decidePreflopGTO` when GTO is on; the bot additionally applies the ICM premium / opponent adjustments / all-in feasibility / randomness | shares only the call-price convention | shares the same functions as `decidePostflopGTO` / `decideRiverGTO` (river shares `getRiverStrategy`); the bot additionally applies ICM / opponent adjustments | it *is* the bot |
| **Question it answers** | "what does the GTO preflop chart say for this hand in this seat?" | "is this hand's equity enough for this price?" | "on this board at this SPR, how much do we bet / check / call / fold?" | "what did the bot actually do?" |

Per-combination breakdown:

| Chain | OFF · cash | OFF · tournament | ON · cash | ON · tournament |
|---|---|---|---|---|
| Bot preflop engine | heuristic `decidePreflop` | same, **ICM may take over** | `decidePreflopGTO` (table lookup) | same, **tightened tables** |
| Bot preflop ICM risk premium | ❌ always 0 | ✅ **yes** (~+16% measured) | ❌ none | ❌ **none** |
| Bot short-stack push/fold (`gtoShortStack`) | ✅ used | ✅ used + `isBubble` tightening | ❌ **not used** (goes through `jamInsteadOfSizing` / `shouldAllInBySPR`) | ❌ not used |
| Bot call-threshold rake | per StartPage rake config | ❌ never | per config | ❌ never |
| Bot postflop / river engine | heuristic | same | `decidePostflopGTO` / `decideRiverGTO` | same |
| Panel ① `GTO preflop` | ✅ GTO table (**toggle-independent**) | ✅ **tightened table** | same | same |
| Panel ② Recommendation | equity vs rake-adjusted price | same + preflop equity shifts from tightened ranges | same | same |
| Panel ③ `Action` | GTO postflop module | same (no rake, ❌ no ICM) | same | same |
| Panel caveat line | `… · 未计 ICM · 未计抽水` | `… · 未计 ICM（机器人已计） · 未计抽水 · 锦标赛范围收紧` | same | same |

**Two asymmetries worth knowing** (each also recorded in the source comments):

1. **ICM only affects the bot when GTO is OFF.** The risk premium (`gtoICM.riskPremiumFor`), `getICMRecommendation` and `getShortStackRecommendation` are reached only from `botAI.decidePreflop` — the *heuristic* preflop path. When GTO is ON, tournament tightening is expressed solely through the derived range tables in `gtoPreflop` (`TOURNAMENT_*_KEEP`), which do **not** stack a risk premium. So "tournaments adjust by ICM" must be qualified with "under the heuristic engine".
2. **The panel never applies ICM.** `HandAnalysis` does not import `gtoICM`; none of its numbers (the recommendation row, MDF / Call EV / Raise EV / V:B) is ICM-adjusted. The caveat line therefore starts with *未计 ICM* in both scenarios and only annotates *（机器人已计）* under tournaments. What *does* change under tournaments is the opponent's modelled range (tightened preflop) — and that has its own label, *锦标赛范围收紧*. The quoted strings are the literal UI labels, which are Chinese.

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
- **Component Tests**: `src/components/__tests__/` - UI, settlement, and equity panel tests
- **Test Coverage**: 919 tests across 47 test suites (917 passed, 2 skipped) — run `npm test` for the current figure

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
- **手牌分析面板**: 实时显示**随机权益**与**范围权益**、底池赔率、听牌信息和行动建议
  - **随机权益**: 我方手牌 vs N 手均匀随机牌（Monte Carlo；单挑河牌走精确枚举）
  - **范围权益**: 我方手牌 vs 推断出的对手续玩范围（翻前角色 + 位置表 + 去牌 + VPIP 宽度修正，再按观测到的翻后行动线收窄）
  - 翻前起即可用；行动建议与 EV 数字由范围权益驱动，无法推断范围时回退为随机权益
- **玩家数据统计 (VPIP/PFR)**: 跨多局长期追踪真人玩家的翻牌前行为
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
  - **统计表格**: 在 AI 分析面板中显示每位真人玩家的 VPIP、PFR 和玩家类型
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

| | 对手模型 | 计算引擎 | 作用 |
|---|---|---|---|
| **随机权益** | N 手均匀随机牌 | Monte Carlo（300–400 次迭代）；单挑河牌走精确枚举（全部 C(45,2) 对手组合） | 基准值 / 交叉验证 |
| **范围权益** | 一个推断出的续玩范围（其余对手仍视为随机牌） | 同一 Monte Carlo 引擎，主要对手从估算组合中采样 | 驱动行动建议与 EV 数字 |

**范围推断**（`src/utils/rangeEquity.ts` 的 `estimateOpponentCombos`）：

1. 从行动历史重建翻前角色（下注最多者为开池方，否则为面对加注方的防守方），在 `gtoPreflop.ts` 位置表中查表。
2. 对 hero + 公共牌做去牌，并可依据对手的历史 VPIP 调整范围宽度。
3. **按翻后行动线收窄**（`src/utils/postflopRange.ts`）。对手行动过的每条街贡献一个因子：先按其面对该街牌面的强度分桶为 `strong / medium / draw / weak / air`，再乘以该类别采取观测行动的概率作为权重。下注/加注频率取自 `postflopFrequencies.ts` 中的共享表（与 bot 自身使用同一套数字），诈唬权重来自 `gtoMath.ts` 的 GTO 价值:诈唬闭式解，面对下注的应对以 MDF 为锚。

权重跨街道连乘，且每条街单独设下限，因此组合永不会被彻底剔除 —— 范围是平滑退化而非坍缩。没有翻后历史时所有权重均为 1，结果与纯翻前范围完全一致。当对手的历史激进度（AF / 倾向）可用时，诈唬权重会按其缩放，使该数字成为**剥削性**范围而非纯 GTO 范围 —— 面板对此有明确标注。

迭代次数集中在 `src/utils/equityIterations.ts` 一张表里（翻前 400、翻牌 350、转牌/河牌 300），**机器人与面板共用同一套数字** —— 面板显示给用户的胜率就是机器人据以决策的胜率。已不再按对手数降档。

**已知局限**：只对主要对手建模范围（多人底池的范围权益偏高）；翻后行动线由记录的行动重建而非求解，属启发式；河牌频率由转牌行推导而来（bot 的河牌分支未使用 c-bet 表）；**权益数字本身**不含边池、不等筹码与 ICM（ICM 只在启发式引擎下改变机器人的翻前门槛，见「策略配置与建议口径」）；Monte Carlo 本身仍有几个百分点的方差。

### 策略配置与建议口径

牌桌上有两个**正交**的开关，但它们的影响面并不相同 —— 这一点最容易误读：

| 轴 | 取值 | 全仓唯一消费者 | 影响机器人 | 影响面板 |
|---|---|---|---|---|
| **引擎**（GTO 开关） | `gto` / `heuristic` | `botAI.ts`（翻前 / 翻后 / 河牌三处派发） | ✅ | ❌ **0 处** |
| **赛制** | `现金局` / `锦标赛` | `gtoICM`（风险溢价）、`gtoShortStack`、`rake`、`gtoPreflop`（范围表） | ✅ | ✅ 3 处（范围表 / 抽水 / 标注文案） |

分析面板上有**四条**看起来都像「建议动作」的通道。它们的输入不同，所以**可以合法地互相矛盾** —— 那不是 bug，是口径不同：

| 维度 | ① `GTO preflop`（仅翻前） | ② 「胜率 vs 赔率 → 建议」 | ③ `Action`（仅翻后） | ④ 机器人真实动作（座位气泡） |
|---|---|---|---|---|
| **生效街** | 仅翻前 | 翻前 + 翻后 | 仅翻后（翻牌/转牌/河牌） | 全部 |
| **数据来源** | `gtoPreflop` 的 13×13 手编范围表（RFI 7 张 / 防守 21 张 / 4bet 6 张 / 冷 3bet 3 张）；锦标赛用派生收紧表 | `rangeEquity`（对推断出的对手范围做 Monte Carlo，退化时用随机权益）+ `callThresholdFor` | `gtoPostflop` / `gtoRiver` + `postflopFrequencies` | `botAI.getBotAction`，按 `isGtoEngine()` 派发 |
| **判定方式** | 按（位置, 翻前场景）选表 → 查手牌类格子 → `R`/`C`/`F`；混合频率来自 `MIX`；尺寸按位置 + 筹码档 | `edge = equity − callThreshold`，按街用各自的相对阈值分级 | 牌面纹理 + 手牌档 + 权益 + 赔率 + SPR + 位置 + 听牌 | 引擎自身的判据 **+ 行动权限过滤** |
| **用胜率？** | ❌ 完全不用 | ✅ **唯一主输入** | ✅ | ✅ |
| **用位置？** | ✅ **主键** | ❌ | ✅ | ✅ |
| **用牌面 / 听牌？** | ❌（翻前无牌面） | ⚠️ 间接（权益已含，判定不看纹理） | ✅ **主输入之一** | ✅（翻后） |
| **用底池赔率？** | ❌ 完全不用 | ✅ **核心** | ✅（`callThreshold`） | ✅（`ctx.potOdds`） |
| **用对手画像？** | ❌ 签名里没有 `adj` | ⚠️ 间接（范围含收窄 / 剥削性调整） | ❌ 签名里没有 `adj` | ✅ **唯一用画像的通道** |
| **用筹码深度 / ICM？** | 筹码 ✅ / ICM ❌ | ❌ / ❌ | 筹码 ✅（SPR）/ ICM ❌ | ✅ / ✅（ICM 仅在 GTO OFF 时接管翻前） |
| **输出粒度** | `action` + `sizingBB` + `freq{r,c,f}` + `isAllIn` | 一个动作词（无尺寸、无频率） | `action` + 尺寸 + 牌面纹理 + `reasoning` + `freq` | `{action, amount?, reasoning?}`；气泡只显示动作词 |
| **随机性** | ❌ 纯确定性 | ⚠️ 判据确定；权益是 Monte Carlo（受 seed 控制） | ✅ 有（受 seed 控制） | ✅ 有（受 `setRandomSeed` 控制） |
| **受行动权限约束？** | ❌ | ❌ | ❌ | ✅ **唯一受约束**（`canXxxResult`） |
| **受 GTO 开关影响？** | ❌ | ❌ | ❌ | ✅ **唯一受影响** |
| **受赛制影响？** | ✅ 查收紧表 | ✅ 间接（抽水；翻前权益因对手范围收紧而变） | ⚠️ 只通过赔率（抽水） | ✅ 全部 |
| **与机器人的关系** | GTO ON 时与 `decidePreflopGTO` **共用同一套表 + 同一个 `detectPreflopScenario`**；机器人另外还叠 ICM 溢价 / 对手调整 / 全下可行性 / 随机性 | 只共享「跟注价格」这一处口径 | 与 GTO ON 的 `decidePostflopGTO` / `decideRiverGTO` **同源函数**（河牌共用 `getRiverStrategy`）；机器人另外还叠 ICM / 对手调整 | 就是它本身 |
| **回答的问题** | 「按 GTO 翻前图，这手牌在这个位置该怎么打？」 | 「这手牌的胜率够不够这个价格？」 | 「这个牌面 + 这个 SPR，该下注 / 过牌 / 跟注 / 弃牌多少？」 | 「机器人这手到底怎么打？」 |

四种组合逐条对照：

| 链路 | OFF · 现金局 | OFF · 锦标赛 | ON · 现金局 | ON · 锦标赛 |
|---|---|---|---|---|
| 机器人翻前引擎 | 启发式 `decidePreflop` | 同左，**ICM 可接管** | `decidePreflopGTO` 查表 | 同左，查**收紧表** |
| 机器人翻前 ICM 风险溢价 | ❌ 恒为 0 | ✅ **有**（实测 ≈ +16%） | ❌ 无 | ❌ **无** |
| 机器人短筹码推 / 弃（`gtoShortStack`） | ✅ 走 | ✅ 走 + `isBubble` 收紧 | ❌ **不走**（改走 `jamInsteadOfSizing` / `shouldAllInBySPR`） | ❌ 不走 |
| 机器人跟注门槛抽水 | 按 StartPage 的抽水配置 | ❌ 恒不抽水 | 按配置 | ❌ 恒不抽水 |
| 机器人翻后 / 河牌引擎 | 启发式 | 同左 | `decidePostflopGTO` / `decideRiverGTO` | 同左 |
| 面板 ① `GTO preflop` | ✅ 显示 GTO 表（**不受开关影响**） | ✅ 显示**收紧表** | 同左 | 同左 |
| 面板 ②「建议」 | 权益 vs 抽水后赔率 | 同左 + 翻前权益因范围收紧而变 | 同左 | 同左 |
| 面板 ③ `Action` | GTO 翻后模块 | 同左（不抽水、❌ 无 ICM） | 同左 | 同左 |
| 面板口径标注 | `… · 未计 ICM · 未计抽水` | `… · 未计 ICM（机器人已计） · 未计抽水 · 锦标赛范围收紧` | 同左 | 同左 |

**两处必须知道的不对称**（源码注释里也各记了一份）：

1. **ICM 只在 GTO OFF 时影响机器人。** 风险溢价 `gtoICM.riskPremiumFor`、`getICMRecommendation`、`getShortStackRecommendation` 的唯一调用点都在 `botAI.decidePreflop` —— **启发式**翻前那条路。GTO ON 时锦标赛的收紧全部由 `gtoPreflop` 的派生范围表（`TOURNAMENT_*_KEEP`）表达，**不叠**风险溢价。所以「锦标赛按 ICM 调整」这句话必须限定为「在启发式引擎下」。
2. **面板从不计 ICM。** `HandAnalysis` 不 import `gtoICM`，它的任何数字（建议行、MDF / Call EV / Raise EV / V:B）都不做 ICM 调整。所以口径标注在两种赛制下都以「未计 ICM」开头，锦标赛那句只是补注「机器人已计」。锦标赛下面板数字**确实**会变，但变的原因是**对手范围被收紧**，那件事有自己的标注「锦标赛范围收紧」。

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
- **组件测试**: `src/components/__tests__/` - UI、结算和权益面板测试
- **测试覆盖**: 47 个测试套件，共 919 个测试用例（917 通过，2 跳过）—— 以 `npm test` 的实际输出为准