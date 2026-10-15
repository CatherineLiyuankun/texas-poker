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

### 3. 同一张参数表同时喂启发式引擎与 GTO 引擎的范围派生（重标后暴露）

- **位置**：`src/utils/botPersonality.ts` 的 `PERSONALITY_PARAMS` —— 有两个消费者：
  - **启发式引擎** `botAI.decidePreflop`（经 `preflopWidths`）；
  - **GTO 引擎**的范围派生 `gtoPreflop.derivePreflopRangeTable` —— 那里 `openWiden` 是
    **整个 RFI 范围的倍率**、`defendVsOpen` 是 `C` 的倍率、`threeBetFreq` 是 `R` 的倍率。
- **现象/证据**：两侧对 `openWiden` 的**语义不同** —— 启发式侧它只缩放 tier3–4 的**边缘
  开池**（tier1–2 有恒定加注打底），GTO 侧它是**整表倍率**且**按对子 6 / 同花 4 / 非同花 12
  组合量化**。缺口①重标后（方案 §17.3），GTO 面板里 Fish/CS 在 UTG@10 的推注范围从
  123 / 114 格**缩到 16 / 10 格**（`gtoShortDeep.persona.test.ts` 的 `RFI_COUNTS`）。
- **影响**：① 为启发式标定出的参数会在 GTO 面板里产生**非预期的极端范围** —— 重标前是反向
  极端（Fish/CS 2.6–2.8 → 169 格打满），重标后是缩到 AA 量级。② **Nit 的 `openWiden`
  不能低于约 0.10**：否则 UTG 推注范围只剩 AA+KK = 12 组合，`gtoPreflop.persona.test.ts` 的
  「锦标赛 ⊂ 现金局」断言退化（本轮实测：0.04 时 cash/tournament 都是 12 格、测试失败；
  抬到 0.12 才恢复区分度）。这把「为启发式调参」的自由度**反过来绑在 GTO 面板的可读性上**。
- **修法方向**：两条路，须先拍板 —— (a) **拆表**：给 GTO 侧单独的宽度（如按场景的
  `gtoWidths`），启发式参数只喂启发式；(b) **保留共享但改语义**：把 GTO 侧的 `openWiden`
  解释成「tier 阈值偏移」而非「整表倍率」，与启发式侧对齐。在此之前，**任何 `openWiden`
  校准都必须同时跑 `gtoShortDeep` / `gtoPreflop` 的 persona 套件**（本轮已按此验证）。

### 4. Fish 的 `WTSD ≤ 30` 目标与「松被动」语义冲突

- **位置**：`docs/BOT_PERSONALITY_PLAN.md` §4 的 Fish 目标 `WTSD ≤ 30`。
- **现象/证据**：P9-4 实测 Fish `WTSD = 50.2`（同盘 VPIP 41.0、多跟注）；而**同一份 §4**
  给 CS 的目标却是 `WTSD ≥ 36`（高）。两条目标语义方向相反。
- **影响**：Fish 的 ≤30 在「高 VPIP + 多跟注」下**不可达** —— 这不是旋钮量程问题，
  是目标本身与「松被动」语义相悖。
- **修法方向**：若确认为语义错误，应改成与 CS 同向的**高** WTSD 目标（属验收口径变更，
  须先拍板）。注意这不是改代码能解决的。

### 5. Maniac 未被校准 runner 采样

- **位置**：`scripts/calibrationRunner.ts` 的固定桌型（R1/B5，6 人）与 §5 的 A′ 配额。
- **现象/证据**：按 §5 配额，B=5 的多重集只含 TAG/LAG/Fish/Nit/CS **五类**，
  Maniac 只在 B=6 才出现 ⇒ runner 的 6 人桌（1 真人 + 5 Bot）**采样不到 Maniac**
  （§17.1 实测表里没有 Maniac 行）。
- **影响**：Maniac 的 `PERSONALITY_PARAMS` 保持 §7.1 初值、**未经校准**；
  同理 `sizingMult` 的量级也只经过间接验证（`botAI.personaSizing` 的穷举安全性测试，
  不是闭环实测）。
- **修法方向**：把 runner 的桌型扩到能覆盖 Maniac（或单开 Maniac 专用跑法）后再校准。
  对应 §13 决策 34 的「七人 R1/B6 追加 Maniac 真实对局专项」。
