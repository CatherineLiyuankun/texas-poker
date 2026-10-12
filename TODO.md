# TODO

本仓库的**待办清单** —— 记「已知、但眼下不做」的问题、技术债与待定决策。

维护约定：

- 每条要能独立执行：**位置 + 现象/证据 + 影响 + 修法方向**，缺一不算一条待办。
- 做完一条就**整段删掉** —— 历史在 git 里，这里不留 ✅ 流水账。
- 只放「尚未开工」的；正在做的走分支/提交，不进这里。
- 这里的条目**不是**承诺，只是「别忘了」。要不要做、什么时候做，另行决定。

---

## 待定决策

### 三处死导出：删除还是保留

- **位置**
  - `src/utils/opponentModel.ts:102` `detectLimpers`
  - `src/utils/opponentModelUtil.ts:135` `detectLimpersFromEvents`
  - `src/utils/gamePersistence.ts:46` `hasGameProgress`
- **现状**：全仓（含测试）**零引用**。
- **判定：都不是 bug，也不是行为回归** ——
  - `detectLimpers*`：`7906dbe`「hasLimpers 从 state 直接推导」**有意弃用**它，改为从
    `state.players` 内联推导（`botAI.ts`），提交信息写明「不再依赖可能不同步的
    localStorage」。`hasLimpers` 这个能力本身仍在用（`gtoPreflop.ts`），只是生产者换了。
  - `hasGameProgress()`：`70761e5` 引入，计划文档
    `.opencode/plans/game-state-persistence.md` 里列了它，但从未接线；
    `StartPage.tsx` 用 `savedProgress` 的真值判断代替。
- **决策点**：删除纯属「减面积」，不影响正确性 —— 删或留由维护意愿决定。

---

## 技术债（已知问题，尚未修）

### 1. `gtoShortStack` 的 `sizing` 单位口径混用

- **位置**：`src/utils/gtoShortStack.ts:478`
  `const sizing = Math.min(effectiveStack, ctx.totalPot * 0.75);`
- **现象**：`effectiveStack` 是 **bb**（`effectiveStackBB` 的结果），`ctx.totalPot` 是
  **筹码**（`mainPot + sidePot`）。`Math.min` 把两个不同单位放一起比。
- **更深一层**：`ShortStackRecommendation.sizing` 声明为 `// 下注尺寸 (bb)`，但它经
  `botAI.decidePreflop` → `BotDecision.amount` → `playerAction` 进 reducer 后，
  `'raise'` 分支把 `amount` 当**筹码增量**用（`additional = action.amount`）——
  字段的「标注单位」与「实际单位」本就不一致。
- **影响**：当前**够不到**（见 `gtoShortStack.ts` 的长注释：6 人桌翻前 `strong`
  实际不可达），所以未暴露；一旦可达就是错误的下注量。
- **修法方向**：要修得**连 `getShortStackSizing`（同文件 :278）一起定单位**，统一
  「bb 还是筹码」，属跨模块口径问题，别只改这一行。

### 2. `gtoShortStack` 推注分支的 `stealBoost` 是空操作（概率恒真）

- **位置**：`src/utils/gtoShortStack.ts:349 / 366 / 374`

  ```ts
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  // …
  if (flags.canAllInResult && random() < (1.0 + stealBoost)) { … }
  if (flags.canRaiseResult  && random() < (1.0 + stealBoost)) { … }
  ```

- **现象**：`random()` ∈ `[0, 1)`，所以 `random() < 1.0 + stealBoost` **恒为真** ——
  `stealBoost` 从未起作用，这两处 `random()` 判断等于没写。
- **影响**：现金局、大盲、平跟底池、20bb 时，169 个手牌类**全部 allin**
  （数据见 `298cccf` 的探针）。本意是「对手弃牌率高时*更可能*偷盲」，实际成了
  「只要在推注范围内就一定偷」。
- **修法方向**：要么改成真正的概率（如 `random() < baseRate + stealBoost`），要么
  直接删掉 `stealBoost` 与这两处 `random()`。
  **注意**：同段 :397 的 `random() >= defendTighten` 是**正确的**（`defendTighten`
  ∈ {0, 0.05}，非零时确实有 5% 收紧），别顺手改。

### 3. 机器人不感知「无人可应」，会对已全下对手做无意义加注

- **位置**：`src/utils/botAI.ts:1058 / 1065`（`getBotAction` 里算 flags 的两处）

  ```ts
  const canRaiseResult = canRaise(state.lastBet, player.bet, player.chips,
                                  state.lastRaiseBet, state.raiseRightsOpened);
  const canAllInResult = canAllIn(player.chips);
  ```

- **现象**：`canRaise` / `canAllIn` 只看**自己**的筹码，不看对手。于是当机器人是
  最后一个还能下注的人、其余对手都已全下时，它仍会选加注/全押。
  **实测**（6 人桌退化成单挑：SB=1000 筹码、BB 只有 4 筹码被动全下，
  `startGame(0, 2, 5, [1000, 4])` 后对 SB 采样 `getBotAction` 40 次）：
  随机手牌 → `fold`；把 SB 换成 **AA** → **`raise:13`**。
- **影响**：**仅口径不干净，不是正确性问题**（已实测）。多下的筹码进主池显示
  （`mainPot` 由 9 变 22），摊牌时经 `calculatePots` 的阈值边池退回本人 ——
  实测 `底池分配 = [主池 8 → [4,4], 边池1 14 → [14,0]]`，最终筹码 `1000 / 4`
  = 开局 `1004`，**守恒**。所以只是「亮了一个没人跟得起的注」+ 底池数字虚高。
- **对照**：真人侧已经在 `useGameState.canPlayerAct` 里禁用了这两种动作
  （见 `docs/PASSIVE_ALLIN_PLAN.md`），机器人侧漏了 —— 两边不对称。
- **修法方向**：在 `getBotAction` 里给 flags 补一个「有 live opponent」的条件
  （与 `canPlayerAct` 同口径：`!folded && !allIn && chips > 0` 且不是自己；
  allin 保留 `toCall > chips` 的短筹码跟注例外）。
  **注意**：`flags.canRaiseResult` / `canAllInResult` 被 `decidePreflop*` /
  `decidePostflop*` / `decideRiver*` 大量引用，改它会移动机器人的实际行为，
  必须跑全套 `botAI*` / `gto*` 测试确认，别当成一行小改。
