# Bug Fixes: Draw Detector & Hand Analysis

## 问题清单 / Issues

### Bug 1: drawDetector.ts — 已成顺子被误检为听牌
**hasOpenEndedStraightDraw returns true for made straights**

场景: 手牌 5♠ 6♥，翻牌 4♣ 7♦ 8♥ → 已成顺子 4-5-6-7-8
问题: 检测到子窗口 [5,6,7,8]，误报为"两端顺子听牌 8 outs"

修复: 在 hasOpenEndedStraightDraw 开头增加守卫
```typescript
if (hasMadeStraight(cards)) return false;
```
新增 hasMadeStraight 函数（检测5张连续牌）

### Bug 2: drawDetector.ts — 已成同花被误检为听牌
**hasFlushDraw returns true for made flushes**

场景: 手牌 A♠ K♠，翻牌 2♠ 3♠ 7♠ → 已有5张♠（已成同花）
问题: suitCount = 5，不是 === 4，所以当前代码不会误报
结论: **无需修复**（=== 4 的判断已正确排除5张的情况）

### Bug 3: drawDetector.ts — Gutshot span 判断错误
**hasGutshotDraw checks span === 4, but span=4 is open-ended territory**

span=4 的4张牌 = open-ended（如 5-6-7-9 → 任意8即成顺，两端可补）
span=5 的4张牌 = gutshot（如 5-6-8-9 → 只有7能补，中间卡一张）

修复: 将 span === 4 改为 span === 5
```typescript
// 旧: if (span === 4) return true;
// 新: if (span === 5) return true;
```

同时需确保 hasGutshotDraw 也排除已成顺子的情况。

### Bug 4: HandAnalysis.tsx — 听牌补偿重复计算
**effectiveEquity double-counts draw equity**

当前: `effectiveEquity = equity + drawInfo.estimatedEquity * 0.5`
问题: 蒙特卡洛胜率已包含听牌击中概率，额外加补偿导致胜率虚高

修复: 去掉补偿，直接用蒙特卡洛原始胜率
```typescript
const effectiveEquity = equity ?? 0;
```

### 改进: HandAnalysis.tsx — 新增当前牌型显示
**Show current hand rank postflop**

翻后（flop/turn/river）显示当前牌型，让玩家一眼看到手牌状况:
```
当前 Current: 顺子 Straight
```

实现: 调用 evaluateHand(holeCards, community).rank，用 HAND_RANK_NAMES 显示

## 需要修改的文件 / Files

1. `src/utils/drawDetector.ts`
   - 新增 hasMadeStraight() 函数
   - hasOpenEndedStraightDraw: 开头守卫 if (hasMadeStraight) return false
   - hasGutshotDraw: span === 4 → span === 5，加守卫

2. `src/components/HandAnalysis.tsx`
   - effectiveEquity: 去掉 drawInfo.estimatedEquity * 0.5
   - 新增 currentHandRank (useMemo + evaluateHand)
   - 新增当前牌型显示行（翻后阶段）

3. `src/utils/__tests__/drawDetector.test.ts`
   - 更新/新增测试覆盖已成顺子、gutshot 修正

## Verification / 验证
- npm run lint — 0 errors
- npx tsc --noEmit — 0 errors
- npm test — all pass
