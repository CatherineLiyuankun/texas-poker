# Texas Hold'em Poker / 德州扑克

[English](#english) | [中文](#中文)

---

## English

A React-based Texas Hold'em Poker game with intelligent bots, accurate pot calculation, and full game flow.

### Features

- **Multiplayer Support**: 2-10 players (real players + AI bots)
- **Smart Bot AI**: Bots make decisions based on hand strength, position, and pot odds
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

### Testing Structure

- **Unit Tests**: `src/utils/__tests__/` - Algorithm correctness
- **Integration Tests**: `src/e2eTests/` - Full game flow (end-to-end)
- **Test Coverage**: 9 integration tests + 11 unit tests covering all pot scenarios

---

## 中文

一个基于 React 的德州扑克游戏，包含智能机器人、精确的底池计算和完整的游戏流程。

### 功能特性

- **多人支持**: 2-10 名玩家（真人 + AI 机器人）
- **智能机器人 AI**: 机器人根据手牌强度、位置和底池赔率做决策
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

- **单元测试**: `src/utils/__tests__/potCalculator.test.ts` - 算法正确性
- **集成测试**: `src/hooks/__tests__/useGameState.integration.test.ts` - 完整游戏流程
- **测试覆盖**: 9个集成测试 + 11个单元测试，覆盖所有底池场景