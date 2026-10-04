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
  `gtoRiver.ts:188` 的 `equity >= mdf` 判据仍是量纲混用（权益 vs 防御频率），
  手牌级正确判据应为 `equity >= potOdds`。
- `gtoRiver.ts` 自带一份 `calculateMDF`，与 `gtoMath.calculateMDF` 退化输入行为不同。
- `gtoMath.MDFReference.requiredEquity` 字段名误导（实为 1 − MDF）。
