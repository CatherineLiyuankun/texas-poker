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
  - **Range equity**: hero vs. an inferred opponent continuing range (preflop role + position tables + card removal, VPIP-tuned)
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
- **Complete Game Flow**: Pre-flop → Flop → Turn → River → Showdown
- **Hand Evaluation**: Recognizes all hand ranks from High Card to Royal Flush
- **Accurate Pot Calculation**: Main pot and side pots with proper multi-level splitting
- **Chip System**: Starting 1000 chips, with betting and pot tracking
- **Blind Structure**: Small blind ($10) and Big blind ($20)
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
| **Random equity** | N uniformly random hands | Monte Carlo (120–400 iterations); heads-up river uses exact enumeration of all C(45,2) villain hands | Baseline / sanity check |
| **Range equity** | One inferred continuing range (remaining opponents stay random) | Same Monte Carlo engine, with the primary opponent sampled from the estimated combos | Drives the recommendation and the EV figures |

Range inference (`estimateOpponentCombos` in `src/utils/rangeEquity.ts`) reconstructs the preflop role from the action history (most-invested player = opener, otherwise defender vs. the aggressor), looks the position up in the `gtoPreflop.ts` tables, applies card removal against hero + board, and optionally tunes width from the opponent's tracked VPIP. When no range can be inferred, the panel falls back to random equity.

Iteration counts scale with the street and opponent count (preflop 400, flop 350, turn/river 300, floored at 120) so multiway pots stay responsive.

**Known limits**: only the primary opponent is range-modelled (multiway range equity reads high); the range is not narrowed by postflop betting; side pots, unequal stacks and ICM are not modelled; the Monte Carlo estimate still carries a few points of variance.

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
- **Test Coverage**: 515 tests across 26 test suites (513 passed, 2 skipped)

---

## 中文

一个基于 React 的德州扑克游戏，包含智能机器人、精确的底池计算和完整的游戏流程。

### 功能特性

- **多人支持**: 2-10 名玩家（真人 + AI 机器人）
- **智能机器人 AI**: 专业级 AI，具备混合策略、位置感知和对手画像
  - **翻前策略**: TAG-LAG 混合风格（VPIP ~28%, PFR ~20%），基于 169 种起手牌分级系统
  - **混合策略**: 随机化决策，防止被对手反推牌型
  - **位置打法**: 后位范围更宽、偷盲、轻 3-bet
  - **翻后 AI**: Monte Carlo 胜率模拟（200-500 次迭代）+ 底池赔率比较
  - **听牌检测**: 同花听牌、两头顺子、卡顺，基于 Outs 概率计算
  - **对手画像**: 自动识别激进/被动型对手，动态调整决策阈值
- **手牌分析面板**: 实时显示**随机权益**与**范围权益**、底池赔率、听牌信息和行动建议
  - **随机权益**: 我方手牌 vs N 手均匀随机牌（Monte Carlo；单挑河牌走精确枚举）
  - **范围权益**: 我方手牌 vs 推断出的对手续玩范围（翻前角色 + 位置表 + 去牌 + VPIP 宽度修正）
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
- **完整游戏流程**: 翻牌前 → 翻牌 → 转牌 → 河牌 → 摊牌
- **手牌评估**: 识别所有牌型，从高牌到皇家同花顺
- **精确底池计算**: 主池和边池的多层级正确拆分
- **筹码系统**: 初始 1000 筹码，支持下注和底池追踪
- **盲注结构**: 小盲 ($10) 和大盲 ($20)
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
| **随机权益** | N 手均匀随机牌 | Monte Carlo（120–400 次迭代）；单挑河牌走精确枚举（全部 C(45,2) 对手组合） | 基准值 / 交叉验证 |
| **范围权益** | 一个推断出的续玩范围（其余对手仍视为随机牌） | 同一 Monte Carlo 引擎，主要对手从估算组合中采样 | 驱动行动建议与 EV 数字 |

范围推断（`src/utils/rangeEquity.ts` 的 `estimateOpponentCombos`）从行动历史重建翻前角色（下注最多者为开池方，否则为面对加注方的防守方），在 `gtoPreflop.ts` 位置表中查表，对 hero + 公共牌做去牌，并可依据对手的历史 VPIP 调整范围宽度。无法推断范围时，面板回退为随机权益。

迭代次数随街道与对手数缩放（翻前 400、翻牌 350、转牌/河牌 300，下限 120），保证多人底池仍能流畅响应。

**已知局限**：只对主要对手建模范围（多人底池的范围权益偏高）；范围不随翻后下注收窄；不含边池、不等筹码与 ICM；Monte Carlo 本身仍有几个百分点的方差。

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
- **测试覆盖**: 26 个测试套件，共 515 个测试用例（513 通过，2 跳过）