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
- **Hand Analysis Panel**: Real-time display of win rate, pot odds, draw info, and action recommendations
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
- **Component Tests**: `src/components/__tests__/` - UI and settlement tests
- **Test Coverage**: 179 tests across 14 test suites

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
- **手牌分析面板**: 实时显示胜率、底池赔率、听牌信息和行动建议
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
- **组件测试**: `src/components/__tests__/` - UI 和结算测试
- **测试覆盖**: 14 个测试套件，共 179 个测试用例