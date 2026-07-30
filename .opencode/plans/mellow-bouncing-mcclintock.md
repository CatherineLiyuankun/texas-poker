# GTO Preflop VPIP 修正（已完成）：BB vs Limpers + HJ 独立范围

## Context

GTO ON 模式下 bot 入池率偏低，主要因为两个位置使用了错误的范围表：
1. **BB RFI**：当所有对手 limp 时，BB 使用 UTG 范围（~17%），GTO 正确做法应为 ~40%+
2. **HJ 位**：被映射到 MP 范围（~20%），应为独立的 HJ 范围（~25%）

同时 `decidePreflopGTO` 未感知 `ctx.hasLimpers`，导致 BB 无法针对 limp 局调整策略。

## 修改文件

仅修改 **1 个源文件** + **1 个测试文件**：
- `src/utils/gtoPreflop.ts`
- `src/utils/__tests__/gtoPreflop.test.ts`

---

## 变更详情（`gtoPreflop.ts`）

### 1. 类型更新（第 41 行）

```ts
// Before
type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

// After
type Position = 'UTG' | 'HJ' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
```

### 2. 新增 RFI_HJ 范围表（~25%）

在 `RFI_MP` 之后（第 196 行后），新增 `RFI_HJ`。范围在 MP 基础上增加：
- 33, 22（小对子）
- K6s-K2s, Q8s-Q2s, J8s-J5s, T8s-T7s（更多同花手牌）
- 96s, 86s, 75s, 64s（更多连接牌/单间隔牌）
- K8o, Q8o, J8o, T8o, 98o, A8o, KTo, QTo, JTo（更多杂色手牌）

### 3. 新增 RFI_BB_LIMP 范围表（~40%）

在 `RFI_SB` 之后，新增 `RFI_BB_LIMP`，用于 BB 面对 limp 局：
- 所有对子：22+
- 所有同花 A：A2s+
- 同花 K 宽：K2s+
- 同花 Q 宽：Q3s+
- 同花 J：J5s+
- 同花 T/9：T7s+, 97s+
- 同花连接牌：87s, 76s, 65s, 54s
- 同花单间隔：75s, 64s
- 杂色 A：A7o+
- 杂色 K：K9o+
- 杂色 Q：Q9o+
- 杂色 J：J9o+

### 4. 更新 RFI_TABLES（第 237-244 行）

```ts
// Before
const RFI_TABLES: Record<Position, GtoAction[][]> = {
  UTG: RFI_UTG, MP: RFI_MP, CO: RFI_CO, BTN: RFI_BTN, SB: RFI_SB, BB: RFI_UTG,
};

// After
const RFI_TABLES: Record<Position, GtoAction[][]> = {
  UTG: RFI_UTG, HJ: RFI_HJ, MP: RFI_MP, CO: RFI_CO,
  BTN: RFI_BTN, SB: RFI_SB, BB: RFI_UTG,
};
```

注意：`BB: RFI_UTG` 保留不变（无 limper 时的默认 BB RFI 范围）。

### 5. 修改 `getRfiPosition`（第 108-115 行）

```ts
// Before
function getRfiPosition(ctx: ContextInfo): Position {
  if (ctx.isButton) return 'BTN';
  if (ctx.position === 1) return 'SB';
  if (ctx.position === 2) return 'BB';
  if (ctx.isCutoff) return 'CO';
  if (ctx.isHijack) return 'MP';   // <-- 改为 'HJ'
  return 'UTG';
}

// After
function getRfiPosition(ctx: ContextInfo): Position {
  if (ctx.isButton) return 'BTN';
  if (ctx.position === 1) return 'SB';
  if (ctx.position === 2) return 'BB';
  if (ctx.isCutoff) return 'CO';
  if (ctx.isHijack) return 'HJ';   // <-- 改 'MP' -> 'HJ'
  return 'UTG';
}
```

注意：`getDefenderPosition`（第 117-124 行）暂不修改，因为 `FACING_OPEN_TABLES` 没有 'HJ' 键。HJ 防守仍使用 CO 的 facing-open 表，近似可接受。

### 6. 修改 `decidePreflopGTO` 的 BB RFI 逻辑（第 848-861 行）

```ts
// Before
if (pos === 'BB') {
  const bbCode = lookup(RFI_TABLES['UTG'], hand);
  if (bbCode === 'R' && flags.canRaiseResult) {
    const target = getGtoOpenSize('UTG', state.smallBlind);
    return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
  }
  if (flags.canCheckResult) return { action: 'check' };
  ...
}

// After
if (pos === 'BB') {
  // BB vs limpers: 使用专用宽范围 (~40%)
  const bbRange = ctx.hasLimpers ? RFI_BB_LIMP : RFI_TABLES['UTG'];
  const bbCode = lookup(bbRange, hand);
  if (bbCode === 'R' && flags.canRaiseResult) {
    const openPos = ctx.hasLimpers ? 'BB' : 'UTG';
    const target = getGtoOpenSize(openPos, state.smallBlind);
    return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
  }
  if (flags.canCheckResult) return { action: 'check' };
  ...
}
```

关键：
- 有 limpers -> 使用 `RFI_BB_LIMP`（~40%），加注尺寸 2.5bb（默认）
- 无 limpers -> 使用 `RFI_UTG`（~17%），加注尺寸 2.5bb，行为不变

### 7. `getGtoOpenSize` 无需修改

`'BB'` 和 `'HJ'` 都走 default 分支（2.5bb），行为正确。

### 8. 更新 `posToLabel`（第 126-133 行）

`posToLabel` 用于 `getOpenerPosition`（识别对手的 opener 位置）。需要同步更新：

```ts
// Before
function posToLabel(pos: number, total: number): Position {
  ...
  if (pos === total - 2) return 'MP';   // <-- 改为 'HJ'
  ...
}

// After
function posToLabel(pos: number, total: number): Position {
  ...
  if (pos === total - 2) return 'HJ';   // <-- 改 'MP' -> 'HJ'
  ...
}
```

注意：这会让 `getOpenerPosition` 返回 'HJ' 而非 'MP'。`FACING_OPEN_TABLES` 中 'HJ' 不存在，`getFacingOpenTable` 的 fallback（第 705 行 `?? FACING_OPEN_TABLES['UTG']['IP']`）会兜底。为完整性，可选添加 'HJ' 条目映射到与 CO 相同的 IP 表。

---

## 变更详情（测试文件 `gtoPreflop.test.ts`）

### 9. 更新现有测试

**a. 第 13 行 `countActions` 类型注解**：添加 `'HJ'`
```ts
position: 'UTG' | 'HJ' | 'MP' | 'CO' | 'BTN' | 'SB',
```

**b. 第 592 行 6-player position mapping 测试**：pos 4 期望从 `'MP'` 改为 `'HJ'`
```ts
{ pos: 4, expected: 'HJ' as const, flags: { ..., isHijack: true, ... } },
```

### 10. 新增测试用例

- `HJ opens ~22-30% of hands`：验证 HJ 范围在 22-30% 之间
- `BB vs limp: raises wider than BB RFI`：通过 `getGtoPreflopRecommendation` 验证 BB_LIMP 的 raise 手牌数 > BB RFI (UTG) 的 raise 手牌数
- `later positions include HJ in ordering`：验证 UTG < MP < HJ < CO < BTN 的 raise 手牌递增关系

---

## 预期效果

| 位置 | 修改前 VPIP | 修改后 VPIP | GTO 参考值 |
|------|-----------|-----------|-----------|
| HJ | ~20% (MP) | ~25% | ~25-28% |
| BB (limp 局) | ~17% (UTG) | ~40% | ~35-40% |
| BB (无 limp) | ~17% | ~17% | ~15-17% |

---

## 验证步骤

1. `npm run build` -- TypeScript 编译通过
2. `npm run lint` -- ESLint 通过
3. `npm test gtoPreflop.test.ts` -- 所有测试通过
4. 手动验证：开启 GTO 模式，观察 bot 在 BB 位面对 limp 局时更频繁加注，HJ 位 open 范围明显比 MP 宽
