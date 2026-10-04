# potOdds 口径一致性（Pot Odds Consistency）

> 状态：**阶段 0 / 1 / 3 / 4 已实现；阶段 2（MDF 口径）按用户决定暂缓**。
> 本文保留问题分析，末尾追加「实现记录」。
>
> 关联文件：`src/utils/potOdds.ts`（新增）、`src/components/HandAnalysis.tsx`、
> `src/components/GameBoard.tsx`、`src/components/PlayerArea.tsx`、
> `src/components/ActionButtons.tsx`、`src/utils/botAI.ts`、`src/utils/gtoMath.ts`、
> `src/utils/gtoRiver.ts`、`src/utils/gtoPostflop.ts`、`src/utils/postflopRange.ts`、
> `src/utils/translations.ts`

---

## 1. 问题现象

面板上「赔率 Pot Odds」显示 **20%**，但同一块的「建议」给出 **fold**，看起来自相矛盾
（20% 的赔率意味着只要有 20% 权益就该跟注）。

根因不是某个公式算错了，而是 **同一个标签「赔率」被用在了两个不同的量上**，
而且**显示用的那个量并不是决策用的那个量**。

---

## 2. 现状：全部口径清单

| # | 位置 | 变量 / 表达式 | 数值定义 | 语义 | 决策是否采用 |
|---|---|---|---|---|---|
| A | `HandAnalysis.tsx:635-642` `displayPotOdds`（分支 1） | `playerRaiseAmount / (currentPot + playerRaiseAmount)` | 分子=raise-to 总额 | **我方下注提供给对手的赔率**（近似） | ❌ 不参与任何判断 |
| B | `HandAnalysis.tsx:641` `displayPotOdds`（分支 2） | `potOdds` prop = `toCall / (totalPot + toCall)` | — | 跟注所需权益 | ❌ 同上 |
| C | `HandAnalysis.tsx:567` `getRecommendation(decisionEquity, potOdds, phase)` | `potOdds` prop | `toCall / (totalPot + toCall)` | 跟注所需权益 | ✅ 面板「建议」 |
| D | `HandAnalysis.tsx:571-632` `gtoMath` | `calculateMDF(bet, currentPot)` / `calculateCallEV(eq, currentPot, bet)` | `pot = currentPot`（**含本轮下注**） | MDF / Call EV | ✅ 面板「MDF / Call EV」 |
| E | `GameBoard.tsx:663-673` | `toCall / (totalPot + toCall)` | — | 跟注所需权益 | 传给 A/B/C |
| F | `GameBoard.tsx:819-841` `getGtoPostflopRecommendation({ potOdds })` | `toCall / (totalPot + toCall)` | — | 跟注所需权益 | ✅ 面板「GTO」行 |
| G | `botAI.ts:1007` `ctx.potOdds` | `toCall / (totalPot + toCall)` | — | 跟注所需权益 | ✅ **机器人实际决策** |
| H | `gtoRiver.ts:485` | `ctx.toCall / (ctx.totalPot + ctx.toCall)` | — | 跟注所需权益 | ✅ 河牌决策（与 G 同源） |
| I | `gtoRiver.ts:187` | `calculateMDF(toCall, totalPot)` | `pot` 含本轮下注 | MDF | ✅ 河牌强度分档 |

**结论：B / C / E / F / G / H 六处是同一个量（跟注赔率），完全一致。**
**A 是另一个量，但复用了 B 的标签与显示位。**
**D / I 的 MDF 用了含注底池，与 `calculateMDF` 自身语义不符。**

---

## 3. 逐条拆解

### 3.1 显示分支为什么会切到「另一个量」

`ActionButtons.tsx:39-57` 里，玩家在加注输入框里输入数字时，会把**raise-to 总额**通过
`onRaiseAmountChange` 一路传到 `GameBoard` 的 `playerRaiseAmounts`，再作为
`playerRaiseAmount` 传进 `HandAnalysis`。

于是 `displayPotOdds` 走到分支 1：

```ts
if (playerRaiseAmount && playerRaiseAmount > 0 && currentPot) {
  return playerRaiseAmount / (currentPot + playerRaiseAmount); // 我方下注给对手的赔率
}
return potOdds > 0 ? potOdds : null;                            // 跟注赔率
```

两个分支的**语义不同**：

- 分支 1：**我主动下注/加注时，我提供给对手的赔率**（衡量「我的下注需要对手多频繁弃牌」，
  近似等于 `bet / (pot + bet)`）。
- 分支 2：**我面对下注时需要跟注的赔率**（衡量「我需要多少权益才能跟」）。

但两者共用一个标签 `translations.handAnalysis.potOdds = '赔率 Pot Odds'`
（`translations.ts:89`），用户无从分辨。

> 顺带一个量纲问题：`playerRaiseAmount` 是 raise-to **总额**（`ActionButtons.tsx:63-71`，
> `targetTotal = parseInt(raiseAmount)`），而 `currentPot` 已经含了对手本轮的下注。
> 两者相加得到的不是干净的「对手跟注 X 去赢 Y」，只是量级近似。

### 3.2 决策用的是 `potOdds`，不是 `displayPotOdds`

`HandAnalysis.tsx:565-568`：

```ts
const decisionEquity = rangeEquity ?? randomEquity;
const recommendation = useMemo(
  () => getRecommendation(decisionEquity, potOdds, phase),   // ← potOdds，不是 displayPotOdds
  [decisionEquity, potOdds, phase],
);
```

所以**显示的数**和**判定用的数**在分支 1 下必然分叉。这就是「显示 20% 却建议 fold」的
最直接来源。

### 3.3 机器人侧其实是自洽的

`botAI.ts:1005-1007` 与 `gtoRiver.ts:485` 都算 `toCall / (totalPot + toCall)`，
且所有 `equity >= ctx.potOdds` 的判断（`gtoPostflop.ts`、`gtoDeepStack.ts`、
`gtoShortStack.ts`、`botAI.ts` 共 20+ 处）都读同一个 `ctx.potOdds`。
**机器人内部没有口径分裂** —— 分裂只发生在「面板显示」与「面板判定」之间。

### 3.4 MDF 的口径错位（独立问题）

`gtoMath.ts` 的约定是 `potSize` = **下注前**的底池：

- `calculateMDF(bet, pot) = pot / (pot + bet)`，参考表 `getMDFReferenceTable()` 用 `pot = 1`，
  半个底池注 → `0.667`，这是标准值。
- `calculateCallEV(eq, pot, bet) = eq * pot - (1 - eq) * bet`，其盈亏平衡点恰好是
  `bet / (pot + bet)`。

但 `HandAnalysis.tsx:572` 传的是 `pot = currentPot`，而 `currentPot = mainPot + sidePots`
**已经包含本轮的下注**（`useGameState.ts:382/413` 在 call/raise 时 `newPot += …`，
`NEXT_STREET` 只把 `player.bet` 归零、`mainPot` 结转）。

于是 `calculateMDF(betToCall, currentPot)` 实际算的是
`(P+B)/((P+B)+B)`，而正确值是 `P/(P+B)`：

| 场景（下注前底池 P=100） | 正确 MDF | 面板显示 | 偏差 |
|---|---|---|---|
| 对手下 50（半个池） | 0.667 | 0.750 | +0.083 |
| 对手下 100（一个池） | 0.500 | 0.667 | +0.167 |

颜色阈值是 `≥0.67 绿 / ≥0.50 黄`（`HandAnalysis.tsx:329-333`），
所以「一个底池的下注」会被染成绿色，与面板自己的 MDF 参考表打架。

正确写法是 `calculateMDF(betToCall, currentPot - betToCall)`
（因为 `potBeforeBet = currentPot - toCall`，见 §5）。

`gtoRiver.ts:187` 有同样问题；而且那里把 `equity >= mdf` 当作强度分档条件，
是把「权益」和「防御频率」两个不同量纲的东西直接比大小，属于概念混用。

---

## 4. 「显示 20% 却建议 fold」的三个可能剧本

| 剧本 | 触发条件 | 显示 | 判定实际用的数 | 观感 |
|---|---|---|---|---|
| **A. 加注输入触发（主因）** | 玩家在加注框里输了数字 | `raise/(pot+raise)`，例如 33% | 跟注赔率 `toCall/(pot+toCall)`，例如 8% | 显示 33%，却按 8% 给了「call」→ 反向矛盾；或显示 25% 却 fold |
| **B. 两个权益并排** | 随机权益 ≫ 范围权益 | 同时显示「随机 30%」「范围 15%」 | 只用 `rangeEquity`（15%） | 用户拿 30% 对比赔率 20% → 觉得该 call，实际 fold |
| **C. 面板启发式 ≠ 机器人 GTO** | 同一手牌 | 面板「建议」行 | 面板 `getRecommendation` 的阈值 | 面板建议与紧邻的「GTO」行给出不同动作 |

剧本 A 是纯粹的口径 bug；B、C 是「口径正确但**披露不足**」——用户不知道判定用的是哪一个数。

---

## 5. 可以合并来源吗？

**可以合并「来源」，但必须保留「概念」的区分。**

### 5.1 能合并的部分

跟注赔率这一个量在 B/C/E/F/G/H 六处重复实现了六遍，且写法完全一致。
应抽成唯一入口，例如 `src/utils/potOdds.ts`：

```ts
export interface PotOddsInput {
  mainPot: number;
  sidePotTotal: number;
  lastBet: number;      // state.lastBet
  playerBet: number;    // 当前玩家本轮已下注
}

export interface PotOddsResult {
  toCall: number;        // lastBet - playerBet，下限 0
  potBeforeBet: number;  // 下注前底池 = totalPot - toCall
  totalPot: number;      // mainPot + sidePotTotal（含本轮下注）
  callPotOdds: number;   // toCall / (totalPot + toCall)   ← 跟注所需权益
  mdf: number;           // potBeforeBet / (potBeforeBet + toCall)
}

export function computePotOdds(input: PotOddsInput): PotOddsResult;
```

> 关键恒等式（已在 §3.4 验证）：
> - `potBeforeBet = totalPot - toCall`
> - `callPotOdds = toCall / (totalPot + toCall)`
> - `mdf = potBeforeBet / totalPot = 1 - toCall / totalPot`

`botAI.ts`、`gtoRiver.ts`、`GameBoard.tsx`、`HandAnalysis.tsx` 全部改为读这个 util，
消除六处重复与「一处改了别处忘改」的风险。

### 5.2 不能合并的部分

「我方下注提供给对手的赔率」是**另一个概念**（衡量我的下注要求对手弃牌的频率），
不能塞进 `callPotOdds`。它要么：

- 单独算、单独命名、单独占一行（推荐），例如 `offeredOdds`；
- 要么直接删掉（面板已有 MDF / Value-Bluff / Bluff Freq 三行，信息已够）。

另外 MDF 与 callPotOdds 虽然都由 `potBeforeBet` / `toCall` 派生，
但**公式不同**，必须保持两个字段，不能互相替代。

---

## 6. 解决方案（分阶段，建议按序落地）

### 阶段 0 — 抽共享 util（无行为变化）

- 新建 `src/utils/potOdds.ts`，导出 `computePotOdds` 与 `PotOddsResult`。
- 把 `GameBoard.tsx:663-673`、`GameBoard.tsx:812-824`、`botAI.ts:1005-1007`、
  `gtoRiver.ts:485` 四处内联计算替换为调用该 util。
- 目标：**先纯重构，所有数字不变**，用现有测试兜底。

### 阶段 1 — 修正面板显示口径（主修复）

- `HandAnalysis` 的 `potOdds` 行**只显示跟注赔率**（`callPotOdds`），不再随
  `playerRaiseAmount` 切换语义。
- 若确实想保留「我下注给对手的赔率」，新增**独立一行**并配独立标签
  （如 `translations.handAnalysis.offeredOdds = '下注给对手赔率'`），
  且修正量纲：`offeredOdds = betToCallEffective / (potAfterHeroBet)`，
  或直接改用「我方下注的盈亏平衡权益 = bet/(pot+bet)」并改名。
- 移除 `displayPotOdds` 这个混合语义的 useMemo。

### 阶段 2 —— 修正 MDF 口径（已落地）

**根因**：同一个 memo 里混用了两种底池口径。`calculateMDF` / `calculateValueBluffRatio`
/ `calculateBluffFrequency` 要的是**下注前底池**，而 `calculateCallEV` / `calculateRaiseEV`
要的是**含注底池**；面板与河牌一律传了含注底池，于是 MDF 偏高。

| 调用 | 需要的底池 | 是否受影响 |
|---|---|---|
| `calculateMDF(bet, pot)` | 下注前 | ✗ 偏高 |
| `calculateValueBluffRatio(bet, pot)` | 下注前 | 仅在 hero 本轮已有投入时偏 |
| `calculateBluffFrequency(bet, pot)` | 下注前 | 同上 |
| `calculateCallEV(eq, pot, bet)` | 含注 | ✓ 本来就对 |
| `calculateRaiseEV(eq, pot, raise, foldPct)` | 含注 | ✓ 本来就对 |
| `classifyRange(eq, bet, pot, phase)` | 下注前 | 仅在 hero 本轮已有投入时偏 |

为什么只有 MDF 必须改：MDF 描述的是**对手那一注**，而 `currentPot` 已经包含对手
本轮的注；其余几个量描述的是**我方下注**，`currentPot` 恰好等于「我方下注前底池」
（hero 本轮未投入时）。

**改动**：

- `potOdds.ts` 新增 `mdfFrom(totalPot, toCall)`，与 `callPotOddsFrom` 对称，
  让只持有「含注底池 + 跟注额」的调用方不必自己写 `totalPot - toCall`；
  `computePotOdds` 改为复用它，保证两处 mdf 是同一个函数。
- `HandAnalysis.tsx`：`calculateMDF(bet, pot)` → `mdfFrom(pot, bet)`，
  并以 `potBeforeBet > 0` 作为渲染条件。
- `gtoRiver.ts`：`calculateMDF(toCall, totalPot)` → `calculateMDF(toCall, totalPot - toCall)`。

**颜色阈值**：`getMDFColor` 用 0.75/0.50，而 MDF 数字旁的 `StrengthBar` 内联用
0.67/0.50 —— 修正口径后这个不一致会从「几乎不可见」变成「1/3~1/2 池之间整段打架」。
统一为**精确分数 2/3 与 1/2**，并抽出 `getMDFBarColor` 与 `getMDFColor` 共用同一组常量：

| 对手注码 | MDF | 档位 |
|---|---|---|
| 25% pot | 0.800 | 绿 |
| 33% pot | 0.750 | 绿 |
| 50% pot | 0.667 | 绿（恰为 2/3，用 0.67 会掉到黄） |
| 75% pot | 0.571 | 黄 |
| 100% pot | 0.500 | 黄 |
| 200% pot | 0.333 | 红 |

选 2/3 而非 0.75 的好处：修正口径前后**颜色分档完全不变**（半池原来显示 0.75 是绿，
现在显示 0.667 仍是绿），阶段 2 于是成为一次纯粹的数字纠正，不会顺手改掉用户看到的
红黄绿分布。

**河牌行为变化**：`getPolarizedCategory` 的 `equity >= mdf` 门槛随之下降
（半池 0.75→0.667、一池 0.667→0.5），于是 equity 落在 `[mdf_new, mdf_old)` 的
MEDIUM / WEAK 手牌从 BLUFF 变为 BLUFF_CATCHER，进而在 `equity >= potOdds`
检查下改为跟注。方向是「小注更愿意跟」，比原来合理（原阈值 0.75 高于 MEDIUM
的上界 0.75，导致 MEDIUM 手牌在小注面前几乎永远进不了该分支）。
`gtoRiver.test.ts` 全绿，没有用例翻转。

**仍未处理（单独立项）**：

- `gtoRiver.ts:188` 用 `equity >= mdf` 把「权益」与「防御频率」直接比大小，量纲不同。
  手牌级的正确判据应是 `equity >= potOdds`（= `toCall/(totalPot+toCall)`）；
  MDF 是**范围级**的分位概念，不该当手牌强度阈值用。本次只修口径、未动判据。
- `gtoRiver.ts` 仍自带一份 `calculateMDF`，与 `gtoMath.calculateMDF` 公式相同但
  退化输入行为不同（0.5 vs 0），已加注释说明，合并需先解决上一条。
- `gtoMath.MDFReference.requiredEquity` 字段名有误导（实为 1 − MDF，即所需弃牌率，
  不是跟注方所需权益）。已加注释，重命名需同步消费方。

### 阶段 3 — 披露口径（消除剧本 B / C 的观感矛盾）

> **落地方式已变更**（见 §9）：不加说明行，改为给判定依据所在的权益行加绿色边框。

- 在「赔率」行旁标注它是**跟注赔率**；在「建议」行标注判定依据是**范围权益**
  （`decisionEquity = rangeEquity ?? randomEquity`）。
- 当随机权益与范围权益分居赔率两侧（一个 ≥ 一个 <）时，加一行提示，
  例如「建议依据：范围权益 15%（随机 30%）」。
- 若面板「建议」与「GTO」行不一致，可考虑加一句「面板建议为简化启发式，
  与 GTO 建议口径不同」，或干脆让面板建议直接复用 GTO 模块的结果（改动更大，需评估）。

### 阶段 4 — 测试与回归

- 新增 `src/utils/__tests__/potOdds.test.ts`：
  - `potBeforeBet + toCall === totalPot` 的恒等式；
  - `mdf + toCall/totalPot === 1`；
  - `callPotOdds` 与 `calculateCallEV` 的盈亏平衡点一致（同一组输入下
    `calculateCallEV(callPotOdds, totalPot, toCall) ≈ 0`）；
  - 边界：`toCall = 0`、`totalPot = 0`、`playerBet = lastBet`。
- 扩展 `HandAnalysis.equity.test.tsx`：
  - 有 `playerRaiseAmount` 时，显示的赔率**仍等于跟注赔率**（回归防呆）；
  - MDF 显示值等于 `1 - toCall/currentPot`。
- 跑全量 jest，确认筹码守恒与既有 GTO 用例不受影响。

---

## 7. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| 改 MDF 会动到河牌分档 | `gtoRiver.ts:188` 的 `equity >= mdf` 参与 `PolarizedCategory` 判定，修正后门槛下降、更多 MEDIUM/WEAK 手牌变 BLUFF_CATCHER | **已执行**：`gtoRiver.test.ts` 全绿、无用例翻转；判据本身的量纲问题另立专项（见 §9） |
| `playerRaiseAmount` 量纲 | 它是 raise-to 总额，`offeredOdds` 若要严谨需减去 `playerBet` | 阶段 1 一并修正，或在 UI 上明确写「按 raise-to 总额近似」 |
| 六处替换引入回归 | 纯重构也可能手滑 | 阶段 0 不改公式、只换调用点，靠现有测试与 `git diff` 逐处核对 |
| 面板建议与 GTO 合并 | 改动面最大，可能改变用户习惯 | 阶段 3 先只做「披露」，是否合并留待单独决策 |

---

## 8. 验收标准

1. 面板「赔率」在任何输入状态下都表示**同一个量**（跟注赔率），且与
   `botAI.ctx.potOdds` 逐位相等。
2. 不再出现「显示赔率 ≥ 建议所需阈值，却给 fold」的自相矛盾（剧本 A 消除）。
3. MDF 显示值与 `getMDFReferenceTable()` 对同一注码一致（剧本 D 消除）。
   → 已由 `HandAnalysis.equity.test.tsx` 的 `it.each` 对 25/50/100/200% pot 逐个锁定。
4. 随机/范围权益与判定依据的关系在 UI 上可读：判定依据所在权益行带绿色边框（剧本 B 缓解）。
5. `computePotOdds` 单测覆盖恒等式与边界；全量 jest 绿。

---

## 9. 实现记录（阶段 0 / 1 / 2 / 3 / 4 已落地）

用户决策：**阶段 1 采用「主行固定跟注赔率 + 新增下注行」**；
首轮实施范围 **阶段 0 + 1 + 3 + 4**，阶段 2 后续补做（已落地，见下文「阶段 2」）。

### 阶段 0 —— 抽出唯一口径来源

新增 `src/utils/potOdds.ts`：

- `computePotOdds(input)` → `{ toCall, totalPot, potBeforeBet, callPotOdds, mdf }`
- `computePotOddsFor(state, player)` —— 省去调用方手工汇总 sidePots
- `callPotOddsFrom(toCall, totalPot)` —— 已持有 toCall/totalPot 的调用方使用
- ~~`equityStraddlesOdds(random, range, potOdds)`~~ —— 原为阶段 3 的说明行服务，
  说明行改行高亮后已无生产消费者，**已删除**（连同其单测）。

替换的内联计算：

| 位置 | 替换前 | 替换后 |
|---|---|---|
| `botAI.ts` | `toCall` / `totalPot` / `potOdds` 三行内联 | `computePotOddsFor(state, player)` |
| `gtoRiver.ts:485` | `ctx.toCall > 0 ? ctx.toCall/(ctx.totalPot+ctx.toCall) : 0` | `callPotOddsFrom(ctx.toCall, ctx.totalPot)` |
| `GameBoard.tsx` 面板 props | `currentPot` / `betToCall` / `potOdds` 三个 IIFE | `potOddsInfo.{totalPot,toCall,callPotOdds}` |
| `GameBoard.tsx` GTO postflop | 内联 `toCall` / `totalPot` / `potOdds` | 解构自 `potOddsInfo` |

顺带把同一 map 作用域内另外两处重复的底池计算（`spr` prop、翻前 GTO 的 `ctxForGto`）
也改为读 `potOddsInfo`，值完全一致。

### 阶段 1 —— 显示口径不再分裂

- 删除 `displayPotOdds` 这个混合语义的 memo（它会在有加注输入时切到另一个量）。
- 「赔率 Pot Odds」行恒为**跟注赔率**，与 `botAI.ctx.potOdds` 同源；
  无需跟注时显示 `—`（原先显示 `...`，与「加载中」混淆）。
- 新增独立行 `所需弃牌率 Req. Fold`，仅在加注框有值时出现，值为
  `calculateRequiredEquity(raiseTo − heroBet, currentPot − heroBet)`。
- `getRecommendation` **保持不变**，仍用跟注赔率 —— 加注框是尺度输入，
  不应让「该不该跟」的判断翻转。

### 阶段 3 —— 披露判定依据（改为行高亮）

初版实现是加一行说明文字（`判定依据 范围权益 83% ／ 赔率 25%`），
落地后按用户反馈改成**不新增说明行**，改为给判定依据所在的权益行加**绿色边框**：

- `GridRow` 新增 `highlight?: boolean`，为真时挂 `border border-green-400/80 rounded`。
- 建议实际依据 `decisionEquity = rangeEquity ?? randomEquity`；
  `decisionBasis` 决定哪一行加框：
  - `rangeFlags.applied === true` → 「范围权益 Equity」行加框；
  - `rangeFlags.applied === false` → 「随机权益 Equity」行加框。
- **关键点**：不能用 `rangeEquity === null` 判断依据，因为推断失败时
  `rangeEquity` 会被赋成随机值（同一个数），必须靠 `rangeFlags.applied`
  才能区分「真的用了范围」与「回退到随机」。
- 因此 `rangeFlags` 从 `{ narrowed, exploited }` 扩展为
  `{ applied, narrowed, exploited }`。
- 随之删除 `translations.handAnalysis` 里的 `decisionBasisTag` /
  `basisRange` / `basisRandom` / `straddleLine`（不再有说明行）。
- 纯 UI 披露，数学未改动。

### 阶段 4 —— 测试

- 新增 `src/utils/__tests__/potOdds.test.ts`：
  口径恒等式（`potBeforeBet + toCall === totalPot`、`mdf === 1 − toCall/totalPot`）、
  与 `calculateCallEV` 的盈亏平衡一致性、与 `calculateMDF` 的一致性、
  `equityStraddlesOdds` 边界、以及 `toCall > 底池` 等畸形输入不产生负数/NaN。
- 扩展 `src/components/__tests__/HandAnalysis.equity.test.tsx`：
  - 无加注输入时「赔率」= 跟注赔率且不渲染弃牌率行；
  - 有加注输入时「赔率」**仍是跟注赔率**、下注口径改为独立行；
  - 能推断范围时绿色边框落在「范围权益」行；
  - 推断失败回退随机时绿色边框落在「随机权益」行。
  - 断言方式：`GridRow` 根 div 即 label `span` 的 `parentElement`，
    检查其 `className` 是否含 `border-green-400/80`。

### 顺手修复：`botAI.test.ts` 的偶发失败用例

首轮全量运行出现 `Bot AI 决策 › 底池赔率 › 赔率好时更多跟注` 失败
（`expect(['call','check']).toContain('raise')`）。排查结论：

- 同一输入下 `getBotAction` 采样 2000 次 = `{ call: 1802, raise: 198 }`，
  raise ≈ **9.9%**。该用例对**随机函数做单次采样**却断言结果必须 ∈ `['call','check']`，
  因此约 1/10 概率随机失败 —— **既有缺陷，非本次回归**
  （该路径上 potOdds 重构前后 `toCall/totalPot/potOdds` 数值完全一致）。
- 改法：按用例名「更多跟注」的统计语义，采样 100 次后断言
  `counts.call > counts.raise + counts.fold`。
- 另外 6 条窄断言用例采样 300 次均为单一结果（确定性），未改动。

### 验证结果

- `tsc -b` 干净；eslint 改动文件 0 error。
- 全量 jest：**28 suites / 581 passed / 2 skipped (583)**，全绿。
- 遗留风险：`botAI.test.ts` 仍有多条对随机函数做单次采样的断言，
  建议后续统一改为统计断言或固定随机种子。

### 仍未处理（阶段 2 的遗留，单独立项）

- `HandAnalysis` 与 `gtoRiver` 的 MDF **口径**已在阶段 2 修正；但
  `gtoRiver.ts:196` 的 `equity >= mdf` 判据仍是量纲混用（权益 vs 防御频率），
  详见 §10 分析。（**本次仍未改**，属行为变更，待单独提交。）
- ~~`gtoRiver.ts` 自带一份 `calculateMDF`，与 `gtoMath.calculateMDF` 退化输入行为不同~~
  → **已解决**（§10.5）：本地副本已删除，公式收敛到 `gtoMath.calculateMDF` 一处。
- `gtoMath.MDFReference.requiredEquity` 字段名误导（实为 1 − MDF）。

---

## 10. 分析：`equity >= mdf` 该不该作为 BLUFF_CATCHER 的判据

（本节为分析，未改代码。）

### 10.1 现状：`category` 只有 BLUFF_CATCHER 这一个分支被消费

`getPolarizedCategory` 返回三值枚举，但 `PolarizedCategory.VALUE`（3 处 return）
与 `PolarizedCategory.BLUFF`（1 处 return）**从未被任何地方比较过**。
唯一的消费点是 `handleRiverFacingBet` 里两处
`if (category === PolarizedCategory.BLUFF_CATCHER)`。所以这个函数实际是一个
布尔判定：「这手牌算不算 bluff catcher」。

两处消费点的结构：

```
case MEDIUM:                          // equity ∈ [0.5, 0.75)
  if (category === BLUFF_CATCHER) {
    if (equity >= potOdds) return call;
  }
  return fold;

case WEAK: case AIR:                  // equity < 0.5
  if (category === BLUFF_CATCHER) {
    if (equity >= potOdds + 0.05) return call;
  }
  return fold;
```

注意内层本来就已经是**正确的 EV 判据**（`equity >= potOdds` 就是跟注的盈亏平衡点）。
外层 `category` 是一道**额外的门**。

### 10.2 为什么 `equity >= mdf` 是错的量

| 量 | 定义 | 含义 | 量纲 |
|---|---|---|---|
| MDF | `P/(P+B)` | **范围级**：为让对手诈唬不赚，我必须继续的范围比例 | 范围比例 |
| potOdds | `B/(P+2B)` | **手牌级**：跟注的盈亏平衡权益 | 手牌权益 |

MDF 是「我的整条范围要防守多少」，不是「我这手牌需要多少权益才能跟」。
把 MDF 当手牌权益阈值用，就是拿范围分位数去比单手持牌的权益。

更糟的是两者的**单调性相反**：

| B/P | MDF = P/(P+B) | potOdds = B/(P+2B) | MDF > potOdds? |
|---|---|---|---|
| 0.25 | 0.800 | 0.167 | 是 |
| 0.33 | 0.750 | 0.200 | 是 |
| 0.50 | 0.667 | 0.250 | 是 |
| 0.75 | 0.571 | 0.300 | 是 |
| 1.00 | 0.500 | 0.333 | 是 |
| 1.50 | 0.400 | 0.375 | 是 |
| **1.618** | **0.382** | **0.382** | **相等** |
| 2.00 | 0.333 | 0.400 | 否 |

MDF 随注码**递减**（注越大越可以少防守），potOdds 随注码**递增**（注越大越贵）。
拿 MDF 当门槛，等于「小注要求高权益、大注要求低权益」——对跟注决策完全反了。

**交叉点恰好是黄金比**：

```
MDF > potOdds
⟺ P/(P+B) > B/(P+2B)
⟺ P² + PB − B² > 0
⟺ 令 r = B/P： r² − r − 1 < 0
⟺ r < (1+√5)/2 = φ ≈ 1.618
```

结论：**只要注码小于 1.618 倍底池（实战绝大多数），`equity >= mdf` 严格严于
`equity >= potOdds`，外层门完全支配内层判据** —— 内层那个正确的 EV 判据
根本轮不到起决定作用。于是实际生效的门槛是 `max(mdf, potOdds) = mdf`。

### 10.3 具体的错误后果（非湿牌面）

「有效门槛 = max(mdf, potOdds)」，对照各档 equity 区间：

MEDIUM（equity ∈ [0.5, 0.75)）：

| B/P | 有效门槛 | 能跟的 MEDIUM 区间 | 应该能跟的区间（equity ≥ potOdds） |
|---|---|---|---|
| 0.25 | 0.800 | 无（上限 0.75 < 0.8） | 全部（0.167 门槛） |
| 0.50 | 0.667 | [0.667, 0.75) | 全部 |
| 1.00 | 0.500 | 全部 | 全部 |
| 2.00 | 0.400 | 全部 | 全部 |

→ **面对 1/4 池下注，MEDIUM 牌 100% 被弃掉**，而它的权益是所需权益（16.7%）
的 3~4 倍。

WEAK / AIR（equity < 0.5）：

| B/P | 有效门槛 | 能跟的区间 |
|---|---|---|
| 0.25 | max(0.800, 0.217) = 0.800 | 无 |
| 0.50 | max(0.667, 0.300) = 0.667 | 无 |
| 1.00 | max(0.500, 0.383) = 0.500 | 无（WEAK 上界 0.5 不含） |
| 1.50 | max(0.400, 0.425) = 0.425 | [0.425, 0.5) |
| 3.00 | max(0.250, 0.479) = 0.479 | [0.479, 0.5) |

→ **面对 ≤ 1 倍池的下注，WEAK/AIR 永远不可能跟注**，无论价格多好。

补充：`getPolarizedCategory` 还有一条 `texture.wetness > 7 && equity >= 0.25`
的兜底，会在**极湿牌面**上把上面这些牌重新标成 BLUFF_CATCHER 从而放行。
所以真实表现是「干燥牌面小注一律弃牌、极湿牌面才跟」——跟注意愿取决于
牌面纹理而不是价格，这本身也不合理。

### 10.4 结论与建议（按代价从低到高）

> **落地状态（2026-10-04，最终）：A / B / C 都没做，改成了「D：删掉这条分支」。**
> 最终选择既不动消费点的门、也不换成 `equity >= potOdds`，而是**把
> `getPolarizedCategory` 里那条 `equity >= mdf` 分支直接删掉** ——
> 即承认「MDF 不该参与手牌分档」，让 BLUFF_CATCHER 只由「极湿牌面」产生。
> 这是**行为变更**，方向与 A 相反（河牌更紧，不是更松），详见 §10.6。
>
> 演进过程：§10.5 只做了公式收敛（保留分支）→ §10.6 删掉了这条分支。

**A. 直接删掉外层门（推荐，但最终未采纳）**
`equity >= potOdds`（WEAK/AIR 为 `+0.05`）本来就是完整的 EV 判据，
删掉 `category` 之后：

```
case MEDIUM:      return equity >= potOdds        ? call : fold;
case WEAK/AIR:    return equity >= potOdds + 0.05 ? call : fold;
```

- 语义正确：按价格决定，与 `STRONG` 分支的口径一致（那边本来就没有门）。
- 副作用：`getPolarizedCategory`、`PolarizedCategory` 枚举、`calculateMDF`
  在 `gtoRiver` 里全部失去消费者 → 一并删除，`gtoRiver` 少 ~40 行。
- 风险：会显著提高河牌跟注频率（尤其小注）。需要跑 `gtoRiver.test.ts`
  并抽查 bot 行为，属于**行为变更**，应单独提交。

**B. 保留门但换成正确的手牌级判据**
把 `equity >= mdf` 改成 `equity >= potOdds`，则内外层判据重复（内层恒真），
等价于 A，但多留一层无意义代码。

**C. 真的要用 MDF，就得换维度**
MDF 的正确用法是「我的手牌在**我自己的范围**里排第几百分位」——
需要 hero 范围分布数据，`getPolarizedCategory` 拿不到，也不该在这里算。
所以 C 不是「换个变量」就能解决的，需要新的输入。

**已满足？** 是。内层 `equity >= potOdds` 已经完整回答了「该不该跟」，
外层门是冗余且方向相反的。所以答案不是「换成别的变量」，而是**去掉这一层**。

---

## 10.2 `calculateMDF`（gtoRiver 本地）能否与 `mdfFrom` 合并

### 三个实现的对照

| | 签名 | 语义 | `bet <= 0` | `pot <= 0` | 两者皆 0 |
|---|---|---|---|---|---|
| `gtoMath.calculateMDF` | `(bet, potBeforeBet)` | `P/(P+B)` | `0` | `0` | `0` |
| `gtoRiver.calculateMDF` | `(bet, potBeforeBet)` | `P/(P+B)` | `1`（P>0 时） | `0` | `0.5` |
| `potOdds.mdfFrom` | `(totalPot含注, toCall)` | `(T−B)/T` | `1`（T>0 时） | `0` | `0` |

- 前两者的**签名与公式完全相同**，只有退化输入不同。
- `mdfFrom` 的**参数约定是反的**（含注底池在前），但代数上等价：
  `mdfFrom(P+B, B) === calculateMDF(B, P)`。

### 能不能合并：能，且对可达输入零行为变化

`getPolarizedCategory` 只在 `handleRiverFacingBet` 里被调用，而后者只在
`ctx.toCall > 0` 时进入 → **`bet <= 0` 与「两者皆 0」都不可达**，
唯一可达的退化分支是 `potBeforeBet === 0`（即 `totalPot === toCall`，
实战中被盲注排除），此时三者都返回 0。所以：

- **方案 B1（推荐）**：删掉 `gtoRiver.calculateMDF`，直接改用
  `mdfFrom(ctx.totalPot, ctx.toCall)`。`gtoRiver` 已经 import 了 `./potOdds`
  （`callPotOddsFrom`），不引入新依赖；而且这样**河牌与面板用的是同一个函数、同一套约定**，
  正是阶段 0 想要的效果。
- **方案 B2**：删掉本地副本，改 import `gtoMath.calculateMDF`。
  签名已经对齐，也零行为变化；但会留下「面板用 `mdfFrom`、河牌用 `calculateMDF`」
  两种约定并存，口径仍有分叉。

### 该不该合并：分两个对象回答

**1. `gtoRiver.calculateMDF` → 已删除（落地结果）。**
初稿设想「若删门则函数失去调用者、删掉更干净；若留门则合并」。
实际决策是**留门 + 删本地副本**：`getPolarizedCategory` 保留，但它内部的
`calculateMDF(toCall, potBeforeBet)` 改成 `mdfFrom(totalPot, toCall)`。
本地那份 `calculateMDF`（唯一区别是退化输入返回 `0.5`）随之删除 ——
该分支不可达（`getPolarizedCategory` 只在 `ctx.toCall > 0` 时被调用），
所以行为零变化，同时河牌与面板从此共用同一个 MDF 入口。

**2. `gtoMath.calculateMDF` 与 `mdfFrom` → 建议不合并，但让公式只有一处。**
两者是**故意不同的签名**：
- `gtoMath.calculateMDF(bet, potBeforeBet)` 是教科书签名，
  `getMDFReferenceTable()` 用 `potSize = 1` 配 `betSize = 0.25/0.5/…` 造参考表，
  换签名会让那张表变得难读。
- `mdfFrom(totalPot, toCall)` 是**本代码库的自然约定**（`ctx.totalPot` /
  `state.mainPot` 都是含注底池）。

而「参数顺序相反」正是阶段 2 里两处调用同时写错的**根本原因**
（两处都把含注底池喂给了 `calculateMDF`）。把它们合成一个函数，
等于把这个陷阱留给下一次调用。建议保留两个入口名，但让**公式只有一份**。

**依赖方向（落地版，与本节初稿相反）**：初稿建议 `gtoMath` 调用 `mdfFrom`，
落地时按「公式归公式、业务归业务」重新定向为 **`gtoMath.calculateMDF` 持有公式，
`potOdds.mdfFrom` 调用它**。理由：`gtoMath` 是纯数学层（不 import 牌局状态），
`potOdds` 是业务口径层（知道什么是含注底池）；让数学层反向依赖业务层是错的。

```ts
// gtoMath.ts —— MDF 公式的唯一实现（教科书签名）
export function calculateMDF(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return potSize / (potSize + betSize);
}

// potOdds.ts —— 业务口径适配器：含注底池 → 下注前底池，再交给公式
export function mdfFrom(totalPot: number, toCall: number): number {
  const pot = Math.max(0, totalPot);
  if (pot <= 0) return 0;
  const bet = Math.max(0, toCall);
  if (bet <= 0) return 1;          // 「无需防守」——与 calculateMDF 的 0 哨兵故意不同
  return calculateMDF(bet, pot - bet);
}
```

对 `gtoMath.calculateMDF` 的既有契约**完全零变化**
（`calculateMDF(0.5,1)=0.667`、`(1,1)=0.5`、`(0,1)=0`、`(0.5,0)=0` 全部保持），
`mdfFrom` 对全部可达输入也**逐位相同**（含 `toCall = 0 → 1`、`toCall > pot → 0`），
但两处不再各写一遍公式。依赖方向 `potOdds → gtoMath → types/poker`，无环。

**3. 顺带**：`gtoMath.calculateMDF` 目前**没有任何生产消费者** ——
只有 `getMDFReferenceTable` / `getGTOMathSummary` 用它，而这两个函数也只在测试里出现。
另一个更彻底的选择是删掉这两个测试专用 helper，只留 `mdfFrom`；
不过参考表本身有文档价值，且阶段 2 新增的
`it.each` 用例（面板显示值 vs `getMDFReferenceTable()`）已经把它们**互相钉死**，
所以即使保留，也不会再悄悄漂移。

> 注：§10.5 收敛公式后，`gtoMath.calculateMDF` 多了 `potOdds.mdfFrom` 这个**生产消费者**
> （河牌 + 面板都经它进入），本节「没有任何生产消费者」的描述已过期。

---

## 10.5 落地记录：公式收敛（2026-10-04，本次提交）

### 采纳 / 未采纳

| 项 | 决策 | 结果 |
|---|---|---|
| §10.4 A：删掉外层门 | **未采纳** | `getPolarizedCategory` 与 `handleRiverFacingBet` 的门**原样保留**，河牌行为不变 |
| §10.2-1：删掉 `gtoRiver.calculateMDF` | **采纳** | 本地副本删除，改用 `mdfFrom(ctx.totalPot, ctx.toCall)` |
| §10.2-2：MDF 公式只留一份 | **采纳（方向与初稿相反）** | `gtoMath.calculateMDF` 持有公式；`potOdds.mdfFrom` 调用它 |

理由：河牌极化分档被有意保留为「策略粗糙度」，先不动行为；本次只做**纯重构**，
把重复的 MDF 公式收敛到一处，为将来单独提交的行为变更（§10.4 A）铺好地基。

### 改动清单

| 文件 | 改动 |
|---|---|
| `src/utils/gtoMath.ts` | `calculateMDF` 加文档，声明为「MDF 公式的唯一实现」（**无逻辑改动**） |
| `src/utils/potOdds.ts` | `mdfFrom` 改为 `import { calculateMDF } from './gtoMath'` 并委托；补分层说明 |
| `src/utils/gtoRiver.ts` | 删除本地 `calculateMDF`；`getPolarizedCategory` 内改用 `mdfFrom`；import 加 `mdfFrom` |
| `src/utils/__tests__/potOdds.test.ts` | 新增适配器一致性用例（`mdfFrom(P+B,B) === calculateMDF(B,P)` + 退化语义差异） |

### 行为等价性论证

- `mdfFrom(P+B, B) = (P+B−B)/(P+B) = P/(P+B) = calculateMDF(B, P)`（代数恒等）。
- `toCall > totalPot`（钳位）时两者都返回 `0`。
- `toCall = 0` 时 `mdfFrom` 早退返回 `1`（无需防守），不进入公式 —— 与旧实现一致。
- `gtoRiver` 中被删的 `0.5` 哨兵分支不可达（`getPolarizedCategory` 仅在 `toCall > 0` 时调用）。
- **净效果：河牌分档与面板显示的数字逐位不变。**

### 验证

- `tsc -b` → `exit=0`；eslint（4 个改动文件）→ `exit=0`。
- 全量 jest：见本节下方「验证结果」。
- 已知遗留（未修，待单独提交）：§10.4 A 描述的量纲混用（`equity >= mdf`），
  以及 `gtoMath.MDFReference.requiredEquity` 字段名误导（实为 `1 − MDF`）。
  → **两项均在 §10.6 处理完毕**（前者删除分支，后者改名 + 复用函数）。

### 验证结果

- `tsc -b` → `exit=0`；eslint（4 个改动文件）→ `exit=0`。
- 全量 jest：**28 suites / 592 passed / 2 skipped / 595 total**。
  唯一失败是 `GameBoard.showdown.settlement.test.tsx`，属**既有负载偶发**
  （该用例靠定时器驱动整局，全量跑 825s 的机器负载下超时）；
  单独跑 `npx jest GameBoard.showdown.settlement` → **PASS（1.4s）**，
  与本次改动无关（未触碰 `useGameState` / `GameBoard`）。
- 抽查：`potOdds.test.ts` 的适配器用例对 5 组 `(bet, potBeforeBet)` 断言两者相等到 10 位小数。

---

## 10.6 落地记录：删掉 `equity >= mdf` 分支 + 命名收敛（2026-10-04）

### 与 §10.4 的关系

§10.4 的 A 是「删掉**消费点**那道门（`if (category === BLUFF_CATCHER)`），
改为纯按价格判断」—— 方向是**更松**（小注也能跟）。
最终决策不是 A，而是 **D：删掉 `getPolarizedCategory` 里产生 BLUFF_CATCHER 的
`equity >= mdf` 分支**，消费点的门保留。

两者效果**相反**：

| | A（未采纳） | D（已落地） |
|---|---|---|
| 改动位置 | 调用点的 `if (category === ...)` | 分类函数里的 `if (equity >= mdf)` |
| BLUFF_CATCHER 含义 | 不再参与决策 | 只剩「极湿牌面」一个来源 |
| MEDIUM 面对 1/4 池 | 跟（价格便宜） | 弃（干燥牌面判 BLUFF） |
| 净方向 | 河牌**更松** | 河牌**更紧** |

D 的语义：承认 MDF（范围级量）不该参与**手牌级**分档。删掉后
`getPolarizedCategory` 只看成手牌等级 + 牌面纹理，不再依赖底池/注码。

### 行为变更（已实测）

权益 0.65 的 MEDIUM 一对（J♠5♥ 配 2♠7♦9♣J♥4♠），面对 75/150 的下注：

- 旧：`mdf = (150−75)/150 = 0.5 ≤ 0.65` → BLUFF_CATCHER → `0.65 ≥ 0.333` → **call**
- 新：干燥牌面 → BLUFF → **fold**

验证方式：新增 `src/utils/__tests__/gtoRiver.polarized.test.ts`（mock
`calculateRangeAwareEquity` = 0.65、`analyzeBoardWithEquity` 可调 wetness），
再用 `git show HEAD:src/utils/gtoRiver.ts` 把旧实现换回来跑一遍 ——
干燥那条用例在旧代码下得到 `call`，确认用例真的钉住了这次变更
（此前这条分支**无任何用例覆盖**）。

### 改动清单

| 文件 | 改动 |
|---|---|
| `src/utils/gtoRiver.ts` | 删分支；`getPolarizedCategory` 去掉 `toCall`/`totalPot` 参数；不再 import `mdfFrom` |
| `src/utils/__tests__/gtoRiver.polarized.test.ts` | 新增（2 条）：干燥 → fold，极湿 → call |
| `src/utils/gtoMath.ts` | `mdfFrom` 从 `potOdds` 搬入；`requiredEquity` → `requiredFoldEquity`；参考表改调用 `calculateRequiredFoldEquity` |
| `src/utils/potOdds.ts` | 删 `mdfFrom`，改为 import 转发（本模块只留「赔率」） |
| `src/components/HandAnalysis.tsx` | `mdfFrom` 改从 `utils/gtoMath` 引入；`calculateRequiredEquity` → `calculateRequiredFoldEquity` |
| 测试 | `mdfFrom` 用例迁到 `gtoMath.test.ts`；`potOdds.test.ts` 留一条面板/河牌一致性用例 |

### 命名：为什么 `requiredEquity` 要改名

`requiredEquity = betSize / (potSize + betSize) = 1 − MDF`，含义是
**「我方下注所需的对手弃牌率」**，但字段名读起来像「跟注方的所需权益」。
后者是 `betSize / (potSize + 2·betSize)`，数值差很多（半池 **0.333 vs 0.25**）。
同理函数 `calculateRequiredEquity` 改名为 `calculateRequiredFoldEquity`
（`HandAnalysis` 的 UI 文案本来就是「所需弃牌率 Req. Fold」，改名后代码与文案一致）。

另外：`getMDFReferenceTable` 原本**内联**了 `betSize / (potSize + betSize)`，
没有调用该函数（两者恒等，守卫分支在 `potSize=1` 下不触发）。现已改为调用，
公式不再有第二份。

### 遗留

- 消费点的门（§10.4 A）仍在：MEDIUM/WEAK/AIR 只有在 BLUFF_CATCHER 时才做价格判断。
  若要改成纯价格决策，属另一次行为变更。
- `PolarizedCategory.VALUE` 仍无消费方（保留以维持三分语义）。
- 河牌行为变更只做了 2 条确定性用例的覆盖；建议后续用批量采样抽查 bot 的整体
  弃牌率是否可接受（本次未做统计层面的抽查）。
