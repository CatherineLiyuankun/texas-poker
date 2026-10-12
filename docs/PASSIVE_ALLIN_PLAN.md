# 被动 All-in（盲注打光筹码）引发的两个 Bug —— 分析与修改方案

> 状态：**已实施完成**（见 §10 实施记录）
> 关联：截图 `Screenshot 2026-10-12 at 17.12.15.png`（6 人桌，BB=Bot4 只有 4 筹码）
> 报告人现象：① Bot4 被动全下却不显示 All in；② 真人点 Bet 输入 10 点 ✓ 无反应，一直卡在等真人操作。

---

## 1. 背景与目标

### 现象

1. **Bot4（BB）** 翻前只有 4 筹码，全部压进盲注后筹码归零，属于**被动 all-in**
   （没有主动点 All in，但事实上已经无法再行动）。UI 右下角状态却显示 `Waiting`，
   而不是 `All In`。
2. 之后轮到真人（玩家1）行动时，点 `Bet` → 输入 `10` → 点 `✓` 确认，
   **毫无反应**，界面仍然停在「等待玩家1操作」，街道也不推进。

### 目标

- 被动 all-in 与主动 all-in 在**状态语义**上一致（`Player.allIn` 是唯一真相）。
- 当对手已经全下、加注**无人可应**时：不该把真人拉进一个「点了没反应」的死局。
- 不改变正常牌局的下注/摊牌行为，不破坏筹码守恒。

---

## 2. 复现（实测）

### 2.1 复现方法

用真实 `useGameState` + 真实 `GameBoard`，把 BB 的带入筹码设为 4：

```tsx
jest.spyOn(Math, 'random').mockReturnValue(0.9);  // 固定洗牌 + 庄家 = 2 → SB=3, BB=4
render(
  <GameBoard
    playerConfig={{ realPlayers: 1, botPlayers: 5, smallBlind: 5 }}
    savedChips={[14261, 3183, 1735, 4, 1373, 1209]}   // ← Bot4(BB) = 4
    onBackToMenu={() => {}}
  />,
);
// 机器人策略钉成「有跟注就弃牌，否则过牌」；真人依次 Call → Check，然后到 Turn 点 Bet 输 10
```

### 2.2 实测输出（与截图逐项吻合）

```
>>> [翻前] Bot4 座位 = "Bot4BB$0Bet: $4All bet: $4Waiting"      ← ① 显示 Waiting 而非 All In
>>> [跟注后] 阶段 = 翻牌
>>> [过牌后] 阶段 = 转牌
>>> [转牌] Bet 按钮存在 = true | disabled = false
>>> [转牌] All In 按钮存在 = true
>>> [转牌] 输入框 placeholder = Min0=已下0+跟0+加0                ← 与截图输入框逐字一致
>>> [转牌] 确认按钮 disabled = false
>>> [点确认后] 阶段 = 转牌 | pot 19 -> 19 | Bet 按钮仍在 = true | 输入框 = (无输入框)
>>> [点确认后] Bot4 座位 = "Bot4BB$0Bet: $0All bet: $4Waiting"    ← 与截图 Bot4 逐字一致
```

**结论**：
- 输入框消失了（说明 `ActionButtons.handleRaise` **确实执行了**），但底池 `19 → 19`、
  阶段仍停在 `转牌` → 动作在 reducer 里被**静默丢弃**。
- 复现结果与截图完全一致（`Min0=已下0+跟0+加0`、Bot4 `$0 / Bet: $0 / All bet: $4 / Waiting`）。

---

## 3. 根因分析

两个 bug 是**同一个根因**的两种表现。

### 3.1 根因：盲注打光筹码时没有置 `allIn`

`src/hooks/useGameState.ts:309-317`（`START_GAME`）：

```ts
const sbAmount = Math.min(smallBlind, newPlayers[sbIdx].chips);
newPlayers[sbIdx].bet = sbAmount;
newPlayers[sbIdx].totalBet = sbAmount;
newPlayers[sbIdx].chips -= sbAmount;

const bbAmount = Math.min(bigBlind, newPlayers[bbIdx].chips);
newPlayers[bbIdx].bet = bbAmount;
newPlayers[bbIdx].totalBet = bbAmount;
newPlayers[bbIdx].chips -= bbAmount;          // ← chips 变成 0，但 allIn 从未置位
```

对比其它三条置位路径（`call` / `check` / `raise` / `allin` 分支，见
`useGameState.ts:389/400/417/442`）都写了 `if (actingPlayer.chips === 0) allIn = true`。
**只有「下盲注」这条路径漏了**。于是产生一个畸形状态：

```
chips === 0  &&  allIn === false
```

### 3.2 表现一：状态标签错（Bug ①）

`src/components/PlayerArea.tsx:82-87`：

```ts
if (player.folded) return folded;
if (player.allIn) return allIn;      // ← false，跳过
if (player.isRealPlayer && isCurrentPlayer) return viewingHand;
return waiting;                      // ← 落到这里 → 显示 "Waiting"
```

`allIn` 为 false → 直接落到 `Waiting`。

### 3.3 表现二：加注被静默吞掉 + 死锁（Bug ②）

关键在 reducer 的**最后一道防线**（`useGameState.ts:367-369`）：

```ts
if (bettingComplete(state) && action.action === 'raise') {
  return state;                      // ← 静默 return，界面无任何反馈
}
```

而 `bettingComplete`（`useGameState.ts:241-250`）的第一句是：

```ts
const activePlayers = state.players.filter(
  (p) => !p.folded && (p.allIn || p.chips > 0),   // ← 畸形状态两头都不满足
);
if (activePlayers.length <= 1) return true;       // ← 只剩真人一个 → 判定「回合已结束」
```

截图局面（转牌）下：
| 玩家 | folded | allIn | chips | 是否计入 activePlayers |
|---|---|---|---|---|
| 玩家1 | false | false | 14261 | ✅ |
| Bot2 | true | – | – | ❌（已弃牌）|
| Bot3 | true | – | – | ❌（已弃牌）|
| Bot4 | **false** | **false** | **0** | **❌（两头都不满足）** |
| Bot5/6 | true | – | – | ❌（已弃牌）|

→ `activePlayers.length === 1` → `bettingComplete === true` → **所有 `raise` 被吞**。

> 验证：`PLAYER_ACTION` 里唯一能吞掉这次 raise 的只有两条路径，另一条
> `additional <= toCall || newBet <= lastBet`（`useGameState.ts:410`）在转牌
> （`toCall=0, additional=10, newBet=10 > lastBet=0`）不成立，故必然是 `bettingComplete`。

**死锁的成因是两处判定口径不一致**：

| | `useGameState.bettingComplete`（reducer 用） | `GameBoard.bettingRoundComplete`（UI 用） |
|---|---|---|
| 位置 | `useGameState.ts:241-250` | `GameBoard.tsx:305-323` |
| `activePlayers` | `!folded && (allIn \|\| chips>0)` | `!folded` |
| 结论 | **true**（只剩真人一个） | **false**（还要 `allActed`） |

- reducer 认为「回合已结束」→ 吞掉加注、且不再接受任何 `raise`；
- UI 认为「回合未结束」→ 继续给真人亮按钮、且**不触发街道推进**（`GameBoard.tsx:383`）。

两者对不上 → 真人点 Bet 无反应、街道永不推进，**只有点 `Check` 才能脱身**
（`check` 不在被吞的分支里，点完 `hasActed=true` 才让 UI 的判定变成 true）。

### 3.4 附带确认：`allIn` 置位后会不会打破现有流程

已逐条核对，**不会**（细节见 §5 风险）：
`getNextActivePlayer`（:197）、`NEXT_STREET` 的选人循环（:877-887）、
`allPlayersActed`/`allBetsEqual`（:208-225）、`canPlayerAct`（:1134）、
`potOdds.futureWinningsFrom`（`potOdds.ts:217-219`）**本来就是按
`!allIn && chips > 0` 判的**，与「置位 allIn」结论一致。

唯一会被**激活**的是摊牌资格里的 `minAllInBet` 过滤（`useGameState.ts:672-687`）：
以前 `allInPlayers` 不含被动全下者（= 空数组 → 走 `totalBet > 0` 分支），
置位后改为 `totalBet >= minAllInBet`。本例两者结果相同（Bot4 totalBet=4，
其余未弃牌者 10/5 均 ≥ 4），但需要跑全量测试确认无回归。

---

## 4. 修改方案

分**两步、两个独立提交**，逐个验证。

### 第 1 步（根因，Bug ①）：盲注打光筹码时置 `allIn`

**文件**：`src/hooks/useGameState.ts`（`START_GAME`，:309-317 之后）

```ts
const sbAmount = Math.min(smallBlind, newPlayers[sbIdx].chips);
...
newPlayers[sbIdx].chips -= sbAmount;
// 盲注把筹码打光 = 被动 all-in：与 call/raise 分支同口径，把 allIn 一并置位。
// 不置位会留下 chips===0 && allIn===false 的畸形态，UI 标签与回合判定都会读错（见 #15）。
if (newPlayers[sbIdx].chips === 0) newPlayers[sbIdx].allIn = true;

const bbAmount = Math.min(bigBlind, newPlayers[bbIdx].chips);
...
newPlayers[bbIdx].chips -= bbAmount;
if (newPlayers[bbIdx].chips === 0) newPlayers[bbIdx].allIn = true;
```

- `hasActed` 保持 `false`（下盲注不算行动；置位 `allIn` 后该玩家本就被排除在
  `canActPlayers` 之外，`hasActed` 不再被读）。
- **单独一个 commit**，跑 `useGameState` / `sidePot` / `multipleSidePot` 等受影响套件。

### 第 2 步（Bug ②）：加注无人可应时结束本轮

**2a. 统一「本轮下注是否结束」的判定（推荐）**

现在同一个语义有**两份实现**（§3.3 表格），这次 bug 就是两份漂移的产物。
建议把 reducer 里那份 `bettingComplete` 提为**唯一来源**并 `export`，
`GameBoard` 改为 import 它，同时补一条规则：

```ts
// src/hooks/useGameState.ts
export function bettingComplete(state: GameState): boolean {
  const activePlayers = state.players.filter((p) => !p.folded);
  const canActPlayers = activePlayers.filter((p) => !p.allIn && p.chips > 0);

  if (activePlayers.length <= 1 || canActPlayers.length === 0) return true;

  // 【新增】只剩一个人能下注、且他不欠跟注 → 无人可应（对手全下/没筹码），本轮结束。
  // 少了这条：reducer 判「已结束」吞掉加注，UI 判「未结束」继续亮按钮 → 死锁（见 #15）。
  if (canActPlayers.length === 1 && canActPlayers[0].bet >= state.lastBet) return true;

  if (!hasPlayerActedAfterAllIn(state)) return false;
  return allPlayersActed(state) && allBetsEqual(state);
}
```

`GameBoard.tsx:305-323` 的 `bettingRoundComplete` useMemo 改为
`useMemo(() => bettingComplete(state), [state])`。

**效果**：转牌一开局就判定本轮结束 → 自动推进到河牌 → 摊牌（正确的「跑完公共牌」行为），
真人**不会再被拉进一个点了没反应的死局**。

**2b. 无人可应时禁用无意义的按钮（防御）**

**文件**：`src/hooks/useGameState.ts:1131-1158`（`canPlayerAct`）

```ts
// 还有没有「能继续下注」的对手（全下 / 弃牌 / 没筹码的都不算）
const hasLiveOpponent = state.players.some(
  (p) => p.id !== playerId && !p.folded && !p.allIn && p.chips > 0,
);

case 'raise':
  return hasLiveOpponent && canRaise(...);
case 'allin':
  // 无人可应时，全押只在「跟注都不够」时才有意义（短筹码跟注），否则等同无意义的加注
  return canAllIn(player.chips) && (hasLiveOpponent || toCall > player.chips);
```

- 对应截图场景（转牌、`toCall = 0`）：`Bet` 与 `All in` 都会灰掉。
- 保留 `toCall > player.chips` 例外，是因为 `canCall` 要求 `toCall <= chips`
  （`useGameState.ts:157-164`）——否则筹码不够跟注的玩家将**无法跟注**（只能弃牌）。

---

## 5. 风险与回滚

| 风险 | 说明 | 处置 |
|---|---|---|
| 摊牌资格被激活 | 第 1 步让 `minAllInBet` 过滤从「不生效」变为「生效」（§3.4） | 跑全量 `npm test`；补一条短码全下的摊牌单测 |
| 街道提前推进 | 2a 新增规则可能让某些局面提前结束本轮 | 规则只在 `canActPlayers.length === 1 && bet >= lastBet` 时触发；2 人以上有筹码时不触发。`bettingRoundLoop.integration.test.tsx` 必须仍绿 |
| 死循环回归 | `#15` 修的「机器人回合结束后再行动」依赖 `bettingRoundComplete` | 统一后口径只会更严（`canActPlayers.length===1` 直接 true），方向安全 |
| 全押按钮被误禁 | 2b 若漏掉短筹码跟注例外 → 筹码不足者无法跟注 | 例外条件已在方案里写死，补单测覆盖 |
| 回滚 | 两步各自独立提交 | `git revert` 单步即可，互不依赖 |

---

## 6. 验证与测试清单

1. **新增单测**（`src/hooks/__tests__/useGameState.test.ts` 或新文件）：
   - 短筹码 BB（4 筹码 / 大盲 10）→ `START_GAME` 后该玩家 `chips === 0 && allIn === true`。
   - 短筹码 SB 同理。
   - 只剩「真人 + 已全下对手」时：`bettingComplete` 为 true（转牌不再要求真人行动）。
   - `canPlayerAct(hero, 'raise') === false` / `'allin'` 按方案规则；
     且 `toCall > chips` 时 `'allin'` 仍为 true。
2. **新增 e2e**（`src/e2eTests/`）：即 §2.1 的复现脚本——断言
   Bot4 座位出现 `All In`、转牌**不出现** `Bet` 按钮、阶段自动推进到河牌/摊牌。
3. **逐改动相关套件**：`npx jest src/hooks src/e2eTests/useGameState.integration.test.ts`。
4. **提 PR 前全量**：`npm test`（含 e2e）+ `npm run build` + `npm run lint`，
   记录实测通过数。
5. **手动**：`npm run dev`，用 6 人桌复现截图局面，确认 Bot4 显示 All In、
   转牌自动跑完、摊牌结算与筹码守恒正确。

---

## 7. 待确认问题（含建议）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 第 2 步用「统一判定」还是「两处各打补丁」？ | ✅ **统一**。`bettingComplete` 已提为唯一来源并 `export`，`GameBoard.bettingRoundComplete` 改为转发 |
| 2 | `All in` 按钮是否也禁用？ | ✅ **禁用**，保留「`toCall > 筹码` 时的短筹码跟注」例外 |
| 3 | 对手全下后，街道自动跑完（不询问真人）是否符合预期？ | ✅ **符合**。已加规则：只剩一人能下注且不欠跟注 → 本轮结束 |
| 4 | 是否顺带修「`lastAction` 徽章跨街道不消失」？ | ⏸ **暂不**。属展示层小问题，与本 bug 无关 |
| 5 | 是否顺带修「`call` 分支 `chips -= toCall` 可能为负」？ | ⏸ **暂不**。`canCall` 已挡住 UI 路径，属既有隐患 |
| 6 | 机器人侧是否也要感知「无人可应」？（本次新发现） | ⏸ **暂不，已记入 `TODO.md` 技术债 3**。实测机器人持 AA 会做无意义加注（`raise:13`），但筹码守恒（多余部分经边池退回），仅口径不干净 |

---

## 8. 源码索引

| 位置 | 作用 |
|---|---|
| `src/hooks/useGameState.ts:309-317` | `START_GAME` 下盲注（**根因，第 1 步改这里**） |
| `src/hooks/useGameState.ts:227-239` | `hasPlayerActedAfterAllIn` |
| `src/hooks/useGameState.ts:241-250` | `bettingComplete`（**第 2a 步改这里并 export**） |
| `src/hooks/useGameState.ts:367-369` | reducer 吞掉加注的守卫 |
| `src/hooks/useGameState.ts:410` | 加注合法性第二条判据（已排除） |
| `src/hooks/useGameState.ts:653-660` | `NEXT_STREET` 重置 `bet`/`hasActed`（`lastAction` 不清） |
| `src/hooks/useGameState.ts:672-687` | 摊牌资格 `minAllInBet`（第 1 步会激活它） |
| `src/hooks/useGameState.ts:1131-1158` | `canPlayerAct`（**第 2b 步改这里**） |
| `src/components/GameBoard.tsx:305-323` | `bettingRoundComplete`（**第 2a 步改为复用**） |
| `src/components/GameBoard.tsx:296-298` | `noRealCanAct` |
| `src/components/GameBoard.tsx:325-355` | 机器人行动 gate |
| `src/components/GameBoard.tsx:383-394` | 街道自动推进定时器 |
| `src/components/GameBoard.tsx:657-663` | `showActionButtons` |
| `src/components/PlayerArea.tsx:82-87` | `getStatus`（Bug ① 的读取点） |
| `src/components/ActionButtons.tsx:59-75` | `toCall`/`minRaiseTotal`/`handleRaise` |
| `src/components/ActionButtons.tsx:179-186` | ✓ 按钮的 disabled 条件 |
| `src/utils/potOdds.ts:210-225` | 已有的「chips>0」防御性写法（可参考，保持不动） |
| `src/utils/__tests__/potOdds.test.ts:522` | 既有测试：明确承认「未标记 allIn 但筹码为 0」是畸形态 |

---

## 9. 附录：复现脚本要点

```ts
// 关键点 1：用 savedChips 把 BB 的带入筹码设成 4
<GameBoard playerConfig={{ realPlayers: 1, botPlayers: 5, smallBlind: 5 }}
           savedChips={[14261, 3183, 1735, 4, 1373, 1209]} ... />

// 关键点 2：Math.random 钉成 0.9 → 庄家固定为 2 → SB=3, BB=4（与截图一致）
jest.spyOn(Math, 'random').mockReturnValue(0.9);

// 关键点 3：机器人策略钉成「有跟注就弃牌，否则过牌」
jest.spyOn(botAIModule, 'getBotAction').mockImplementation((player, state) =>
  state.lastBet - player.bet > 0 ? { action: 'fold' } : { action: 'check' });

// 关键点 4：定时器必须逐个推进（advanceTimersToNextTimer），
//          否则机器人 400ms 与街道推进 500ms 会落在同一批次，掩盖问题。
```

---

## 10. 实施记录

| 提交 | 内容 | 验证 |
|---|---|---|
| `218ee04` docs(plan) | 本方案文档 | — |
| `63f3b4b` fix(allin) | 第 1 步：盲注打光筹码时置 `allIn`（根因） | 4 suites / **73** tests passed（71 → 73） |
| `f56ede1` fix(betting) | 第 2 步：统一回合判定 + 无人可应时结束本轮 + `canPlayerAct` 门控 | 7 suites / **81** tests passed（73 → 81） |

- lint：改动文件 `npx eslint` → **0 errors**；GameBoard 的 3 条
  `react-hooks/exhaustive-deps` 警告与 HEAD **逐条相同**（仅行号位移），非本次引入。
- 新增测试：
  - `src/hooks/__tests__/useGameState.test.ts`：短筹码打光置 `allIn`、
    大盲不足置 `allIn`、无人可应时回合结束、`raise` 禁用 / `call` 可用、
    短筹码跟注例外、有 live opponent 时照常可用（共 6 条）。
  - `src/e2eTests/passiveAllIn.integration.test.tsx`：真实 `GameBoard` 端到端
    回归 —— 断言 Bot4 显示 `All In`、对手全下后一路跑到摊牌、中途未亮 `Bet`。
- 遗留（已记入 `TODO.md` 技术债 3）：机器人侧 `canRaise`/`canAllIn` 仍不感知
  「无人可应」，持 AA 时会做无意义加注（实测 `raise:13`）；筹码守恒，
  仅口径不干净。
