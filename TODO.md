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
