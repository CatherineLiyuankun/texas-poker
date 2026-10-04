# 翻后行动收窄范围（Postflop Range Narrowing）

> 状态：**已实现**（按本文方案落地，决策项 1–5 全部执行）。实现见 `src/utils/postflopRange.ts`、
> `src/utils/postflopFrequencies.ts`，以及 `equityCalculator.ts` / `rangeEquity.ts` /
> `HandAnalysis.tsx` / `GameBoard.tsx` 的改动。本文保留作为设计与取舍记录。
>
> 关联模块：`src/utils/rangeEquity.ts`、`src/utils/equityCalculator.ts`、`src/utils/postflopRange.ts`、`src/utils/postflopFrequencies.ts`、`src/components/HandAnalysis.tsx`、`src/components/GameBoard.tsx`、`src/utils/opponentModelUtil.ts`

---

## 1. 问题：范围不随翻后行动收窄

### 1.1 现状代码路径

唯一入口是 `estimateOpponentCombos(hero, state, community)`（`rangeEquity.ts:334`）。它的推断链条是：

```
currentHandPreflopEvents()          // rangeEquity.ts:321-329
  → getCurrentHand().events.filter(e => e.phase === 'preflop')
reconstructPreflopRoleFromEvents()  // 只吃 preflop 事件
  → role: opener | caller | threebettor
getContinuingRangeClasses()         // 位置表 + VPIP 宽度修正
expandRange(classes, deadCards)
  → Card[][]  → 交给 calculateEquity 的 options.opponentCombos
```

关键点在 `rangeEquity.ts:325`：

```ts
return hand.events.filter((e) => e.phase === 'preflop');
```

**翻后发生的一切都被这一行丢掉了。** 无论对手在翻牌过牌、下注 1/3、下注 2/3，还是在转牌加注全下，`estimateOpponentCombos` 返回的都是同一组 combos。

### 1.2 为什么这会系统性高估我方权益

翻后的下注/加注是**信息**：它把对手的手牌分布从一个宽泛的翻前范围，收窄到一条特定行动线对应的子集。

举例：hero 持 A♠A♥，翻前 CO 开池，hero 跟注。翻牌 K♦8♦3♣，hero 过牌，对手下注 2/3 底池。

- 模型现在给对手的仍是 CO 开池的 ~30% 范围：`22+`、`A2s+`、`K8s+`、`Q9s+`、`J9s+`、`T8s+`、`98s-54s`、`A9o+`、`KTo+`、`QTo+`、`JTo`、`98o`…
- 但一个在 K-high 面下注 2/3 的对手，范围里绝大部分**没有 K、没有听牌**的空气牌会被大幅过滤。
- 模型却仍然按 1:1 权重采样 `22/33/44/55/66/77`、`A2s-A5s`、`87o`、`98o` 这些牌 —— AA 对上这些几乎必胜。
- 结果：**hero 权益被显著高估**。

方向和单调性都很明确：**低估对手强度 ≡ 高估自己权益**，而且漏掉的信息量随街道单调递增。

### 1.3 为什么"越到河牌越失真"

除了"每条街多丢一次信息"这个线性累积之外，还有一个更隐蔽的机制：

河牌单挑走的是 `exactHeadsUpRiverEquity`（`equityCalculator.ts:60`）——**精确枚举**全部 C(45,2) 对手组合。它把当前 combos 集合**精确地**算了一遍：

- 方差 = 0（好事）
- 但**偏差 100% 保留**，没有任何随机噪声去稀释它

Monte Carlo 至少还有点采样噪声让错误不那么刺眼；河牌的精确枚举把"错误的 combos 集合"变成了一个**确定的错值**。所以河牌是失真最严重、也最"自信"的一街。

### 1.4 影响面不止于显示

`HandAnalysis.tsx:573`：

```ts
const decisionEquity = rangeEquity ?? randomEquity;
```

这个值同时驱动 `getRecommendation` 和 `gtoMath`（Call EV / Raise EV / required equity）。所以后果是：

- 边缘牌被建议**跟注**（权益被高估）
- 中等牌被建议**加注**
- Call EV / Raise EV 系统性偏高

而且 bot AI 走的是 `calculateRangeAwareEquity`（`AGENTS.md` 规定的决策入口），**机器人也吃同一个 bug** —— 所有 AI 在翻后都会低估对手、打得更松。这不只是面板数字问题，是会影响对局平衡的问题。

### 1.5 关键结论：数据已经有了，只是没人读

这是本方案最重要的一条事实 —— **不需要新增任何埋点**：

| 事实 | 证据 |
|---|---|
| 翻后事件已经在记录 | `GameBoard.tsx:255-263`（bot）与 `:269-278`（真人）都会调 `recordAction(event)`，且 `handleAction` 对所有街道通用（`GameBoard.tsx:844`） |
| 事件字段够用 | `ActionEvent` 有 `phase / action / amount / toCall / currentBet / potSize / position / timestamp`（`types/stats.ts:3-15`） |
| 翻后事件确实被写入了 | `opponentModelUtil.ts` 已经在消费 `e.phase === 'flop' / 'turn' / 'river'`（`:154, 225-231, 320, 376, 390`）算 AF / c-bet / check-raise / WTSD |
| 已有成熟的取事件模式 | `groupEventsByHand` + 按 street filter + 按 timestamp sort（`opponentModelUtil.ts:257-266`） |

**所以修复的核心不是"补数据"，而是"补一个把翻后行动翻译成范围收窄的纯函数模块"。**

### 1.6 顺带发现的坑：`ActionEvent.isFacingRaise` 是死字段且值是错的

`GameBoard.tsx:121`：

```ts
isFacingRaise: state.lastBet > 0 && phase === 'preflop',
```

翻后被硬编码成 `false`。查证结果：

- `.isFacingRaise` 在整个 `src/` 下**零个读取方**（`botAI.ts` 里的同名变量是从 `ctx.toCall` 现算的局部变量，与此字段无关）
- 所以这个字段目前是 write-only 的死字段

结论：**不要依赖这个字段做收窄**，应该直接从 `toCall` / `currentBet` 现算。修正它属于可选的清理项，风险为零（无消费者），但不修正也不阻塞本方案。

---

## 2. 方案设计

### 2.1 核心思路

在"翻前范围"和"最终 combos"之间插一层 **postflop filter**，把对手的翻后行动线翻译成对每个 combo 的**权重**：

```
翻前 classes
  → expandRange → Card[][]
  → 【新增】按 (牌面, 对手行动线) 给每个 combo 打分 → weight ∈ (0, 1]
  → 加权 combos
  → calculateEquity(options.weightedCombos)
```

### 2.2 最重要的设计决策：软过滤（权重），不是硬过滤（集合减法）

**必须用权重，不能用硬过滤。** 原因：

`estimateOpponentCombos` 末尾有兜底（`rangeEquity.ts:398`）：

```ts
return combos.length >= 3 ? combos : null;   // null → 上层退回随机权益
```

硬过滤很容易把范围砍到 < 3 个 combo（例如"对手在 K-high 面加注"这类强约束），一旦触发兜底就**退回随机权益**，等于白做 —— 而且退回的是比现在还差的口径。

权重方案下 combo 数量永不塌缩，只是弱牌权重趋近 0。

### 2.3 新增模块 `src/utils/postflopRange.ts`

```ts
import type { Card } from '../types/poker';
import type { ActionEvent } from '../types/stats';
import type { BoardTexture } from './boardTexture';

export interface PostflopAction {
  street: 'flop' | 'turn' | 'river';
  board: Card[];                    // 该街公共牌：flop=3 / turn=4 / river=5
  kind: 'check' | 'call' | 'bet' | 'raise' | 'allin';
  betToPot: number;                 // amount / potSize（potSize 为行动前底池）
  facingBet: boolean;               // toCall > 0
  isLastToAct: boolean;
}

export interface WeightedCombo {
  cards: Card[];
  weight: number;                   // (0, 1]
}

export function extractPostflopLine(
  events: ActionEvent[],
  opponentId: number,
  community: Card[],
): PostflopAction[];

export function scoreCombo(
  combo: Card[],
  board: Card[],
  action: PostflopAction,
  texture: BoardTexture,
): number;

export function narrowRangeByPostflopAction(
  combos: Card[][],
  line: PostflopAction[],
  community: Card[],
): WeightedCombo[];
```

**行动线解析规则**（全部可从现有字段推出）：

| 条件 | 判定 |
|---|---|
| `toCall === 0` 且 `action === 'check'` | 过牌 |
| `toCall === 0` 且 `action === 'raise' \| 'allin'` | 领先下注 |
| `toCall > 0` 且 `action === 'call'` | 跟注 |
| `toCall > 0` 且 `action === 'raise' \| 'allin'` | 加注（含 check-raise） |

`betToPot = amount / potSize`，其中 `potSize` 已经是**行动前**的底池（`createActionEvent` 用闭包里的 stale `state`，语义正确）。

**每街公共牌的取法**：`ActionEvent` 没记公共牌，但 `state.communityCards` 按顺序累积且 `phase` 已知，直接切片即可 —— 与 `HandAnalysis.getCommunityByPhase`（`:99-110`）是同一套逻辑，建议**提取为共享 util**，避免两处重复。

### 2.4 权重表（以"对手是翻后下注方"为例）

按 combo 在当前牌面上的类别定权重：

| combo 类别（对当前牌面） | 判定依据 | 面对我方过牌后下注 | 面对我方下注后加注 |
|---|---|---|---|
| 强成牌 | 三条+ / 两对 | 1.0 | 1.0 |
| 顶对好踢脚 | TPTK | 0.9 | 0.7 |
| 中对 / 弱顶对 | 第二对 | 0.6 | 0.25 |
| 强听牌 | 同花听 / 两头顺 | 0.8 | 0.6 |
| 弱听牌 | 卡顺 / 后门 | 0.4 | 0.15 |
| 空气 | 高牌无听牌 | 0.35（诈唬频率） | 0.08 |

权重来源应当**从已有 GTO 模块推导**而不是拍脑袋，以保持与 bot AI 策略自洽：

- 诈唬权重 ← `gtoPostflop.ts` 的 c-bet 频率 / `gtoMath.ts` 的 value:bluff 比例
- 牌面湿润度 ← `analyzeBoard(board)`（`boardTexture.ts:242`）调整听牌类权重
- 整体缩放 ← 可选：`getOpponentTendency(id)` / `getOpponentAF(id)`（`opponentModel.ts:370, 137`）

⚠️ 注意这是"假设对手近似 GTO"的**假设**，不是事实。若引入 AF 缩放，产出就从"GTO 范围权益"变成"针对该对手的剥削性权益"，UI 上需要区分说明（见 §4 待决策项 2）。

### 2.5 需要改动的接口

**1. `EquityOptions` 支持权重 combos**（`equityCalculator.ts:23`）

```ts
export interface WeightedCombo { cards: Card[]; weight: number }

export interface EquityOptions {
  opponentCombos?: Card[][];        // 保留：等权
  weightedCombos?: WeightedCombo[]; // 新增：加权（二者取一）
}
```

采样：构建一次前缀和数组，每次 `Math.random() * totalWeight` 后二分查找。**注意**：`exactHeadsUpRiverEquity` 的 combos 分支（`:68-82`）也要同步支持权重（把 `equity += 1 / += 0.5` 改成乘以权重，最后除以总权重）—— 河牌恰恰是最需要收窄的一街，不能漏。

**2. `estimateOpponentCombos` 读取翻后历史**

```ts
function currentHandEvents(): ActionEvent[] {   // 不再只 filter preflop
  ...
}
```

把结果 split 成 `preflopEvents`（喂 `reconstructPreflopRoleFromEvents`）和 `postflopEvents`（喂新模块）。
`getCurrentHand()` 每次调用都会 `loadFromStorage()` + `JSON.parse`，**只调一次**再在内存里 split，不要新增 I/O。

**3. 返回值改为带签名的对象（可选但推荐）**

```ts
export function estimateOpponentCombos(...): { combos: Card[][]; signature: string } | null
```

`signature` 由"事件条数 + 最后一条事件 timestamp + 牌面"构成，供 `HandAnalysis` 的 `useEffect` 做依赖，替代现在不够精确的 `rangeSignature`。

**4. `HandAnalysis.rangeSignature` 扩容**（`HandAnalysis.tsx:524-534`）

现在折叠的是 `dealer / phase / lastBet / 每个玩家的 folded,totalBet,chips`。存在一个漏触发场景：翻牌上 hero check、对手也 check —— `lastBet` 不变、`totalBet` 不变、`chips` 不变 → 签名不变 → effect 不重跑。虽然"双方过牌"对范围的收窄影响很小，但这是**正确性缺口**，建议把事件条数一起折进去。

**5. `getCommunityByPhase` 提取为共享 util**

目前只存在于 `HandAnalysis.tsx`。新模块需要同一逻辑，提取到 `src/utils/` 下（例如 `communityByPhase.ts`）供两处复用。

---

## 3. 落地阶段

| 阶段 | 内容 | 影响面 | 风险 |
|---|---|---|---|
| **0（前置）** | 提取 `getCommunityByPhase` 为共享 util；修 `isFacingRaise` 硬编码（可选，零风险） | 小 | 低 |
| **1** | `EquityOptions` 支持加权 combos + 加权采样；河牌精确枚举同步支持 | 中（动 MC 核心） | 中 —— 必须保证无权重路径行为**逐位不变**，用现有测试兜底 |
| **2** | 新增 `postflopRange.ts` 规则引擎 + 纯函数单测 | 中（纯函数，易测） | 低 |
| **3** | 接进 `estimateOpponentCombos`；扩 `rangeSignature` | 小 | 中（依赖数组易漏） |
| **4** | bot AI 自动受益（已调 `calculateRangeAwareEquity`，无需改动） | 0 | 需回归对局平衡 |
| **5** | UI 标注"范围已按翻后行动收窄" | 小 | 低 |

**性能预算**：收窄是纯 CPU 的 combo 遍历。~300 combo 的范围、每个 combo 一次 `evaluateHand(combo, board)`（5-7 张牌），量级在毫秒。建议按 `(board, lineSignature)` 做 memo。**绝不能引入新的 MC 调用**。

**明确不做的事**：

- ❌ 不要在 `estimateOpponentCombos` 里再调一次 `calculateEquity` 来"校准"收窄 —— 成本翻倍
- ❌ 不要把收窄做成硬过滤 —— 会塌缩到 < 3 combo 触发兜底
- ❌ 不要用 `player.bet` 判断翻后激进度 —— 它每街重置（`NEXT_STREET` 会清），且不区分"谁下的"；用事件历史
- ❌ 不要让收窄逻辑碰 `calculatePots` / 筹码 —— **筹码守恒是硬 invariant**，收窄必须是纯计算

---

## 4. 测试计划

**新增 `src/utils/__tests__/postflopRange.test.ts`**

- 给定 combos + "对手在 K-high 面面对过牌下注 2/3" → 断言弱牌权重下降、强牌不变、权重已归一化、combo 数不低于下限
- 边界：空历史 → 原样返回；只有 check → 轻微收窄；allin → 最窄但仍有 ≥3 个 combo

**扩展 `src/utils/__tests__/rangeEquity.test.ts`**

- 同一手牌，**仅**增加一条"对手翻牌加注"事件 → 断言 `calculateRangeAwareEquity` **显著低于**无翻后事件时
- 反向断言：hero 的 AA 在 K-high 面面对加注，权益应落在合理区间（如 0.35-0.6），而不是 0.8+

**扩展 `src/e2eTests/useGameState.integration.test.ts`**

- 走完 翻前 → 翻牌 → 转牌 → 河牌，每街断言权益**单调不增**（面对持续下注时）
- **筹码守恒不受影响**（硬 invariant 回归）

**扩展 `src/components/__tests__/HandAnalysis.equity.test.tsx`**

- 加"翻牌面对对手下注"用例，断言范围权益 < 随机权益，且差值明显大于现有无行动场景

---

## 5. 待决策项

1. **权重表来源**：硬编码规则表（简单可控）还是从 `gtoPostflop.ts` 频率数据推导（更自洽，但需先确认频率数据覆盖所有牌面类别）？
2. **是否引入对手激进度缩放**（`getOpponentAF` / `getOpponentTendency`）？更准，但会让产出从"GTO 范围权益"变成"剥削性权益"，UI 需要区分说明。
3. **河牌精确枚举是否支持权重**？倾向**必须支持**（河牌失真最严重），代价是重写 `exactHeadsUpRiverEquity` 的 combos 分支。
4. **是否顺带修 `rangeSignature` 的 check-check 漏触发**？
5. **是否修 `ActionEvent.isFacingRaise`**？零风险（无消费者），但与本方案不耦合。

---

## 6. 备选方案（不推荐，但记录）

**方案 B：按侵略性整体截断**——不做牌面分类，只按"对手翻后是否表现侵略性"整体缩放范围宽度（加注 → `topHandClasses(宽度 × 0.35)`，跟注 → ×0.6，过牌 → 保持）。

- 优点：~20 行，改动极小，能快速消除"对手加注后仍按全范围算"这个最严重的偏差
- 缺点：按 Chen 分数截断，**完全无视牌面**。会系统性偏向对子/大牌，在湿润牌面上把同花听牌、顺子听牌这类"翻后很强但 Chen 分不高"的牌砍掉 —— **反而引入方向相反的新偏差**

结论：只在"对手加注"这一个最极端场景下可作止血，**不要推广到跟注/过牌场景**。优先做 §2 的方案。
