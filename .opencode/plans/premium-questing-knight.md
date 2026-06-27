# Plan: Chen Formula 改用原始分数，4 级颜色系统

## Summary
将 `getPreflopStrength` 从归一化值 (0-1) 改为返回 Bill Chen 原始分数 (2-20)，UI 颜色分级改为标准 4 级：≥10 红 / 7-9 橙 / 4-6 绿 / <4 紫。

## 修改文件

### 1. `src/utils/preflopHandStrength.ts` (第 61 行)

**改动**：去掉归一化，返回原始分数。

```
- return Math.max(0, Math.min(1, score / 20));
+ return Math.max(0, score);
```

- 返回值范围：2 (72o) ~ 20 (AA)，整数
- JSDoc 注释同步更新：去掉 "Normalize: score / 20 → [0, 1]"，改为 "Return raw Chen score (range ~2-20)"

---

### 2. `src/components/HandAnalysis.tsx`

#### 2a. 显示文本 (第 190 行)

```
- {(preflopStrength * 100).toFixed(0)}%
+ {preflopStrength}
```

显示原始分数如 "12" 而非 "60%"。

#### 2b. StrengthBar 宽度

不改 StrengthBar 组件（postflop 也用），在 preflop 调用处传入归一化值给 width：

```tsx
<StrengthBar
  value={preflopStrength / 20}   // 仅用于宽度计算
  color={...}                     // 用原始分数判断颜色
/>
```

#### 2c. 颜色阈值 (第 193-204 行)

```
旧 (6级归一化):                  新 (4级原始分):
>= 0.65  → bg-red-400           >= 10   → bg-red-400     (Premium)
>= 0.45  → bg-orange-400        >= 7    → bg-orange-400  (Strong)
>= 0.35  → bg-amber-500         >= 4    → bg-green-400   (Speculative)
>= 0.25  → bg-green-400         < 4     → bg-purple-400  (Fold)
>= 0.15  → bg-blue-400
< 0.15   → bg-purple-400
```

#### 2d. getRecommendation preflop 阈值 (第 28-33 行)

```
旧:                               新:
equity >= 0.50 → raise            equity >= 10  → raise
equity >= 0.35 → callRaise        equity >= 7   → callRaise
equity >= 0.20 → call             equity >= 4   → call
```

Postflop 分支 (第 35-40 行) 不受影响，仍使用 0-1 范围的 Monte Carlo equity。

---

### 3. `src/utils/__tests__/preflopHandStrength.test.ts`

#### 范围测试 (第 45-58 行)
```
- expect(s).toBeLessThanOrEqual(1);
+ expect(s).toBeLessThanOrEqual(20);
```

#### 特定值测试 (第 65-73 行)

| 手牌 | 旧值 | 新值 |
|------|------|------|
| AA   | 1.00 | 20   |
| KK   | 0.80 | 16   |
| AKs  | 0.60 | 12   |
| 98s  | 0.55 | 11   |
| K8s  | 0.25 | 5    |
| K3o  | 0.15 | 3    |
| 72o  | 0.10 | 2    |

#### 其他测试
- 第 11 行 `AA toBe(1)` → `toBe(20)`
- 第 16 行 `72o toBeLessThan(0.2)` → `toBeLessThan(4)`
- 比较类测试（高对>低对, 同花>非同花, 连张>间隔）：不变

---

## 不变的部分

- **Tier T1-T6 文字显示** (HandAnalysis 第 210-221 行)：保持原有 6 色
- **`getPreflopTier`** 函数：完全不变
- **`botAI.ts`**：仅使用 `getPreflopTier`，不受影响
- **Postflop 显示**：使用 Monte Carlo equity (0-1)，不受影响

## 验证

```bash
npm run lint
npm test
```
