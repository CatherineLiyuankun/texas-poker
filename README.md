# Texas Hold'em Poker / 德州扑克

[English](#english) | [中文](#中文)

---

## English

A React-based Texas Hold'em Poker game with intelligent bots, hand evaluation, and full game flow.

### Features

- **Multiplayer Support**: 2-10 players (real players + AI bots)
- **Smart Bot AI**: Bots make decisions based on hand strength, position, and pot odds
- **Complete Game Flow**: Pre-flop → Flop → Turn → River → Showdown
- **Hand Evaluation**: Recognizes all hand ranks from High Card to Royal Flush
- **Chip System**: Starting 1000 chips, with betting and pot tracking
- **Blind Structure**: Small blind and Big blind
- **Bilingual**: English and Chinese (auto-detected)
- **Responsive UI**: Built with Tailwind CSS

### Game Actions

- **Check**: Skip betting when no bet to call
- **Call**: Match the current bet
- **Raise**: Increase the bet
- **Fold**: Surrender the hand

### Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Jest (testing)

### Getting Started

```bash
npm install
npm run dev
```

### Run Tests

```bash
npm test
```

### Build

```bash
npm run build
```

---

## 中文

一个基于 React 的德州扑克游戏，包含智能机器人、手牌评估和完整的游戏流程。

### 功能特性

- **多人支持**: 2-10 名玩家（真人 + AI 机器人）
- **智能机器人 AI**: 机器人根据手牌强度、位置和底池赔率做决策
- **完整游戏流程**: 翻牌前 → 翻牌 → 转牌 → 河牌 → 摊牌
- **手牌评估**: 识别所有牌型，从高牌到皇家同花顺
- **筹码系统**: 初始 1000 筹码，支持下注和底池追踪
- **盲注结构**: 小盲和大盲
- **双语支持**: 中文和英文（自动检测）
- **响应式 UI**: 使用 Tailwind CSS 构建

### 游戏操作

- **过牌 (Check)**: 无需跟注时跳过下注
- **跟注 (Call)**: 匹配当前下注
- **加注 (Raise)**: 增加下注金额
- **弃牌 (Fold)**: 放弃本局

### 技术栈

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Jest (测试)

### 快速开始

```bash
npm install
npm run dev
```

### 运行测试

```bash
npm test
```

### 构建

```bash
npm run build
```