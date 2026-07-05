# Nodelock 策略实现计划

## 一、目标

实现Nodelock策略模块，用于：
1. **对手画像构建** - 从历史数据构建对手统计画像
2. **漏洞评估** - 识别对手的策略漏洞（过度弃牌、过度跟注、过度激进、被动）
3. **调整逻辑** - 根据漏洞类型调整GTO策略（保守锁定原则）
4. **AI分析显示** - 在HandAnalysis中显示"对手漏洞类型"和"调整建议"

---

## 二、核心数据结构

### 1. 对手画像接口

```typescript
interface OpponentNodelockProfile {
  // 基础统计
  vpip: number;                  // 入池率 (VPIP)
  pfr: number;                   // 加注率 (PFR)
  threeBet: number;              // 3-bet 率
  foldToThreeBet: number;        // 面对 3-bet 弃牌率
  cBet: number;                  // 持续下注率 (C-Bet)
  foldToCbet: number;            // 面对 c-bet 弃牌率
  aggression: number;            // 攻击性指数 (AF)
  wtsd: number;                  // 摊牌率 (WtSD)
  msw: number;                   // 大底池获胜率 (W$SD)
  sampleSize: number;            // 样本量
  
  // 漏洞评估结果
  leakType: LeakType;
  leakMagnitude: number;         // 漏洞幅度 (0-1)
  confidence: number;            // 置信度 (0-1)
}
```

### 2. 漏洞类型枚举

```typescript
type LeakType = 
  | 'overfold'           // 过度弃牌 (弃牌率 > 50%)
  | 'underfold'          // 过度跟注 (跟注率 > 60%)
  | 'overfold_to_bet'    // 面对下注过度弃牌
  | 'underfold_to_bet'   // 面对下注过度跟注
  | 'overaggressive'     // 过度激进 (加注率 > 30%)
  | 'passive'            // 被动 (加注率 < 10%)
  | 'neutral';           // 无明显漏洞
```

### 3. Nodelock推荐接口

```typescript
interface NodelockRecommendation {
  action: Action;
  amount?: number;
  sizing?: number;              // 下注尺寸 (% of pot)
  adjustmentType: LeakType;
  adjustmentMagnitude: number;  // 调整幅度 (-0.3 到 +0.3)
  confidence: number;           // 置信度 (0-1)
  reasoning: string;
}
```

### 4. Nodelock配置接口

```typescript
interface NodelockConfig {
  opponentProfile: OpponentNodelockProfile;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  nodeType: 'bet' | 'raise' | 'call' | 'fold';
  baseStrategy: {
    action: Action;
    sizing?: number;
  };
  leakThreshold: number;         // 漏洞阈值 (默认 0.10 = 10%)
}
```

---

## 三、核心函数设计

### 1. 从对手数据构建画像

```typescript
function buildNodelockProfile(
  handsData: HandData[],
): OpponentNodelockProfile
```

**输入**：历史手牌数据数组
**输出**：完整的对手画像，包含漏洞评估

**实现逻辑**：
```typescript
// 1. 计算基础统计
const vpip = handsData.filter(h => h.vpip).length / totalHands;
const pfr = handsData.filter(h => h.pfr).length / totalHands;
// ... 其他统计

// 2. 评估漏洞
const leakType = evaluateLeak(vpip, pfr, foldToCbet, aggression);
const leakMagnitude = calculateLeakMagnitude(leakType, baseline, actual);
const confidence = calculateConfidence(sampleSize);

// 3. 返回画像
return { vpip, pfr, ..., leakType, leakMagnitude, confidence };
```

### 2. 漏洞评估函数

```typescript
function evaluateLeak(
  vpip: number,
  pfr: number,
  foldToCbet: number,
  aggression: number,
): LeakType
```

**评估逻辑**（基于专业数据验证）：

| 漏洞类型 | 判断条件 | 基线值 | 阈值 |
|----------|----------|--------|------|
| overfold | foldToCbet > 60% | 45% | +15% |
| underfold | foldToCbet < 35% | 45% | -10% |
| overaggressive | pfr > 30% | 22% | +8% |
| passive | pfr < 15% | 22% | -7% |
| neutral | 其他情况 | - | - |

### 3. 漏洞幅度计算

```typescript
function calculateLeakMagnitude(
  leakType: LeakType,
  baseline: number,
  actual: number,
): number
```

**计算公式**：
```typescript
// 归一化到 0-1 范围
const deviation = Math.abs(actual - baseline) / baseline;
return Math.min(deviation, 1.0);  // 上限为1.0
```

### 4. 置信度计算

```typescript
function calculateConfidence(sampleSize: number): number
```

**基于样本量的置信度**：

| 样本量 | 置信度 |
|--------|--------|
| ≥ 500 | 0.95 |
| ≥ 300 | 0.85 |
| ≥ 200 | 0.75 |
| ≥ 100 | 0.65 |
| < 100 | 0.50 |

### 5. 调整幅度计算

```typescript
function calculateAdjustment(
  leakType: LeakType,
  leakMagnitude: number,
): number
```

**调整策略**（保守锁定原则）：

| 漏洞类型 | 调整方向 | 调整幅度 | 原因 |
|----------|----------|----------|------|
| overfold | 增加诈唬 | +5-15% | 对手弃牌率高，增加诈唬收益 |
| underfold | 减少诈唬，增加价值下注 | -3-10% | 对手跟注率高，诈唬无效 |
| overaggressive | 增加跟注范围 | +5-12% | 对手激进，用中等牌力跟注 |
| passive | 偷盲和持续下注 | +5-10% | 对手被动，可频繁施压 |

**保守锁定原则**：
- 如果数据显示60%弃牌率，锁定57-58%（留3%安全边际）
- 不要过度剥削，假设对手可能会调整

### 6. 主决策函数

```typescript
export function getNodelockRecommendation(
  config: NodelockConfig,
  hand: Card[],
  equity: number,
  boardTexture?: BoardTexture,
): NodelockRecommendation
```

**决策流程**：
```typescript
// 1. 检查样本量是否足够
if (config.opponentProfile.sampleSize < 100) {
  return {
    action: config.baseStrategy.action,
    adjustmentType: 'neutral',
    adjustmentMagnitude: 0,
    confidence: 0.5,
    reasoning: '样本量不足，使用基础策略',
  };
}

// 2. 根据漏洞类型调整策略
let adjustedAction = config.baseStrategy.action;
let adjustedSizing = config.baseStrategy.sizing;

if (config.opponentProfile.leakType === 'overfold') {
  // 对手过度弃牌：增加诈唬
  if (handStrength < 0.5) {
    adjustedAction = 'bet';
    adjustedSizing = (config.baseStrategy.sizing || 0.5) * 1.2;
  }
} else if (config.opponentProfile.leakType === 'underfold') {
  // 对手过度跟注：减少诈唬，增加价值下注
  if (handStrength > 0.7) {
    adjustedAction = 'bet';
    adjustedSizing = (config.baseStrategy.sizing || 0.5) * 0.8;
  } else {
    adjustedAction = 'check';
  }
}

// 3. 计算调整幅度
const adjustmentMagnitude = calculateAdjustment(
  config.opponentProfile.leakType,
  config.opponentProfile.leakMagnitude,
);

// 4. 返回推荐
return {
  action: adjustedAction,
  sizing: adjustedSizing,
  adjustmentType: config.opponentProfile.leakType,
  adjustmentMagnitude,
  confidence: config.opponentProfile.confidence,
  reasoning: generateReasoning(config.opponentProfile, adjustmentMagnitude),
};
```

### 7. 推理生成函数

```typescript
function generateReasoning(
  profile: OpponentNodelockProfile,
  adjustment: number,
): string
```

**示例输出**：
- "对手过度弃牌(弃牌率60%)，增加诈唬频率+10%"
- "对手过度跟注(跟注率65%)，减少诈唬-5%，增加价值下注"
- "样本量不足(50手)，使用基础策略"

---

## 四、文件结构

### 1. 主模块文件

```
src/utils/gtoNodelock.ts
```

**包含**：
- 接口定义（OpponentNodelockProfile, LeakType, NodelockRecommendation, NodelockConfig）
- 核心函数（buildNodelockProfile, evaluateLeak, calculateLeakMagnitude, calculateConfidence, calculateAdjustment, getNodelockRecommendation）
- 辅助函数（generateReasoning, getBaseline, getStatForNodeType）

### 2. 测试文件

```
src/utils/__tests__/gtoNodelock.test.ts
```

**测试用例**（15-20个）：
1. 构建画像函数测试
2. 漏洞评估函数测试（过度弃牌、过度跟注、过度激进、被动）
3. 置信度计算测试
4. 调整幅度计算测试
5. 主决策函数测试（不同漏洞类型）
6. 样本量不足测试
7. 推理生成测试

### 3. 集成文件修改

**botAI.ts**：
- 导入 `getNodelockRecommendation`, `buildNodelockProfile`, `isSampleSufficient`
- 在 `getBotAction()` 中添加Nodelock检查逻辑

**HandAnalysis.tsx**：
- 添加 `nodelockRecommendation` prop
- 显示对手漏洞类型和调整建议

---

## 五、集成点

### 1. botAI.ts 修改

```typescript
// 在文件顶部添加导入
import { getNodelockRecommendation, buildNodelockProfile, isSampleSufficient } from './gtoNodelock';

// 在 getBotAction() 函数中添加Nodelock检查
function getBotAction(player: Player, state: GameState): BotDecision {
  // ... 现有代码 ...
  
  // 检查是否有对手数据
  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const nodelockProfile = buildNodelockProfile(getHandsData(player.id));
  
  if (isSampleSufficient(nodelockProfile)) {
    // 使用 Nodelock 调整
    const nodelockRec = getNodelockRecommendation(
      {
        opponentProfile: nodelockProfile,
        street: state.phase,
        nodeType: determineNodeType(ctx, flags),
        baseStrategy: baseStrategy,
        leakThreshold: 0.10,
      },
      player.hand,
      equity,
      boardTexture,
    );
    
    // 应用调整（如果置信度足够高）
    if (nodelockRec.confidence > 0.7) {
      return {
        action: nodelockRec.action,
        amount: nodelockRec.sizing,
        reasoning: nodelockRec.reasoning,
      };
    }
  }
  
  // 原有逻辑
}
```

### 2. HandAnalysis.tsx 修改

**添加Props**：
```typescript
interface HandAnalysisProps {
  // ... 现有props ...
  nodelockRecommendation?: NodelockRecommendation | null;
}
```

**显示逻辑**：
```typescript
{phase !== 'preflop' && nodelockRecommendation && (
  <div className="border-t border-white/10 pt-1 mt-1">
    <Row
      label="对手漏洞"
      value={
        <span className={`text-[10px] ${
          nodelockRecommendation.adjustmentType === 'overfold' ? 'text-orange-400' :
          nodelockRecommendation.adjustmentType === 'underfold' ? 'text-blue-400' :
          nodelockRecommendation.adjustmentType === 'overaggressive' ? 'text-red-400' :
          nodelockRecommendation.adjustmentType === 'passive' ? 'text-green-400' :
          'text-white/50'
        }`}>
          {getLeakTypeLabel(nodelockRecommendation.adjustmentType)}
        </span>
      }
    />
    <Row
      label="调整建议"
      value={
        <span className="text-[10px] text-white/70">
          {nodelockRecommendation.adjustmentMagnitude > 0 ? '+' : ''}
          {(nodelockRecommendation.adjustmentMagnitude * 100).toFixed(0)}%
        </span>
      }
    />
    <Row
      label="置信度"
      value={
        <span className="text-[10px]">
          {(nodelockRecommendation.confidence * 100).toFixed(0)}%
        </span>
      }
    />
  </div>
)}
```

**辅助函数**：
```typescript
function getLeakTypeLabel(leakType: LeakType): string {
  const labels: Record<LeakType, string> = {
    overfold: '过度弃牌',
    underfold: '过度跟注',
    overfold_to_bet: '面对下注过度弃牌',
    underfold_to_bet: '面对下注过度跟注',
    overaggressive: '过度激进',
    passive: '被动',
    neutral: '无明显漏洞',
  };
  return labels[leakType] || '未知';
}
```

---

## 六、测试策略

### 1. 单元测试用例

| 测试场景 | 输入 | 预期输出 |
|----------|------|----------|
| 过度弃牌 | foldToCbet=65% | leakType='overfold', adjustmentMagnitude>0 |
| 过度跟注 | foldToCbet=30% | leakType='underfold', adjustmentMagnitude<0 |
| 过度激进 | pfr=35% | leakType='overaggressive', adjustmentMagnitude>0 |
| 被动 | pfr=8% | leakType='passive', adjustmentMagnitude>0 |
| 无漏洞 | vpip=25%, pfr=20%, foldToCbet=45% | leakType='neutral' |
| 样本不足 | sampleSize=50 | confidence=0.5, 使用基础策略 |
| 高置信度 | sampleSize=500 | confidence=0.95 |
| 调整幅度限制 | leakMagnitude=2.0 | adjustmentMagnitude=1.0 (上限) |

### 2. 集成测试

1. **botAI集成测试**：
   - 测试Nodelock在GTO模式下的调用
   - 测试样本量不足时的降级处理

2. **HandAnalysis集成测试**：
   - 测试漏洞类型显示
   - 测试调整建议显示

### 3. 运行测试

```bash
# 运行所有测试
npm test

# 运行Nodelock测试
npm test gtoNodelock

# 运行ESLint检查
npm run lint

# 运行TypeScript编译
npm run build
```

---

## 七、实现步骤

### Phase 1: 核心模块 (2-3小时)

| 步骤 | 任务 | 时间 |
|------|------|------|
| 1 | 创建 `gtoNodelock.ts` 文件 | 0.5小时 |
| 2 | 实现接口定义和类型 | 0.5小时 |
| 3 | 实现 `buildNodelockProfile()` 函数 | 1小时 |
| 4 | 实现 `evaluateLeak()` 和 `calculateLeakMagnitude()` 函数 | 0.5小时 |
| 5 | 实现 `calculateConfidence()` 和 `calculateAdjustment()` 函数 | 0.5小时 |
| 6 | 实现 `getNodelockRecommendation()` 主函数 | 1小时 |

### Phase 2: 测试 (1-2小时)

| 步骤 | 任务 | 时间 |
|------|------|------|
| 7 | 创建 `gtoNodelock.test.ts` 文件 | 0.5小时 |
| 8 | 实现单元测试用例 | 1-2小时 |
| 9 | 运行测试并修复问题 | 0.5小时 |

### Phase 3: 集成 (1-2小时)

| 步骤 | 任务 | 时间 |
|------|------|------|
| 10 | 修改 `botAI.ts` 集成Nodelock | 1小时 |
| 11 | 修改 `HandAnalysis.tsx` 显示Nodelock信息 | 1小时 |
| 12 | 运行完整测试套件 | 0.5小时 |

### Phase 4: 验证 (0.5小时)

| 步骤 | 任务 | 时间 |
|------|------|------|
| 13 | 运行 `npm run lint` | 0.1小时 |
| 14 | 运行 `npm run build` | 0.1小时 |
| 15 | 运行 `npm test` | 0.3小时 |

**总计**：4.5-7.5小时

---

## 八、专业数据来源验证

所有数据来自以下权威来源（已在 `icm-nodelock-implementation.md` 中验证）：

| 来源 | 数据类型 | 验证状态 |
|------|----------|----------|
| BeyondGTO | 节点锁定方法论、保守锁定原则 | ✅ 已验证 |
| GTO Wizard | 玩家画像工具、频率锁定 | ✅ 已验证 |
| PLO.com | 剥削策略、最大剥削方法 | ✅ 已验证 |
| Postflopizer | 锁定逻辑、级联效应 | ✅ 已验证 |
| DeucesCracked | GTO vs 剥削策略对比 | ✅ 已验证 |

**关键原则**：
1. **保守锁定**：如果数据显示57%弃牌率，锁定53-54%（留安全边际）
2. **级联效应**：早期锁定会影响后续街道策略
3. **最大剥削**：假设对手不会调整，但不要过度剥削
4. **多节点锁定**：单节点锁定不是最大剥削，需要多节点

---

## 九、成功标准

### 1. 功能标准

- [ ] `buildNodelockProfile()` 正确构建对手画像
- [ ] `evaluateLeak()` 正确识别4种漏洞类型
- [ ] `calculateLeakMagnitude()` 正确计算漏洞幅度
- [ ] `calculateConfidence()` 正确计算置信度
- [ ] `getNodelockRecommendation()` 返回正确的调整建议
- [ ] 推理字符串清晰易懂

### 2. 测试标准

- [ ] 所有单元测试通过
- [ ] 测试覆盖率达到80%+
- [ ] 边界条件测试完整
- [ ] 与现有361个测试兼容

### 3. 集成标准

- [ ] Nodelock正确集成到botAI.ts
- [ ] HandAnalysis正确显示漏洞类型和调整建议
- [ ] 无ESLint错误
- [ ] TypeScript编译成功
- [ ] 构建成功

### 4. 性能标准

- [ ] 决策函数执行时间 < 10ms
- [ ] 内存使用合理
- [ ] 无内存泄漏

---

## 十、风险与缓解

### 1. 风险：样本量不足

**问题**：对手数据不足时，漏洞评估可能不准确

**缓解**：
- 设置最小样本量阈值（100手）
- 样本不足时返回中性建议
- 显示置信度让用户了解可靠性

### 2. 风险：过度剥削

**问题**：过度调整可能导致策略不平衡

**缓解**：
- 实现保守锁定原则（留3%安全边际）
- 设置最大调整幅度（±30%）
- 定期重新评估对手画像

### 3. 风险：性能影响

**问题**：实时计算可能影响决策速度

**缓解**：
- 缓存对手画像（每手牌更新一次）
- 异步计算，不阻塞主线程
- 限制历史数据量（最近500手）

---

## 十一、后续优化

### 1. 多节点锁定

当前实现：单节点锁定（仅考虑当前决策点）

未来优化：多节点锁定（考虑整个决策树）
- 翻牌圈锁定影响转牌圈策略
- 转牌圈锁定影响河牌圈策略
- 需要实现级联效应逻辑

### 2. 动态调整

当前实现：固定阈值（10%漏洞阈值）

未来优化：动态阈值
- 根据对手水平调整阈值
- 根据筹码深度调整阈值
- 根据比赛阶段调整阈值

### 3. 机器学习集成

当前实现：基于规则的漏洞评估

未来优化：机器学习模型
- 使用历史数据训练漏洞检测模型
- 预测对手调整行为
- 自动优化调整策略

---

## 十二、总结

本计划实现了Nodelock策略的核心功能，包括：

1. **对手画像构建** - 从历史数据提取关键统计指标
2. **漏洞评估** - 识别4种主要漏洞类型
3. **调整逻辑** - 基于保守锁定原则的策略调整
4. **AI分析显示** - 在HandAnalysis中显示漏洞类型和调整建议

通过遵循现有的GTO模块模式，确保代码风格一致性和可维护性。测试策略覆盖所有核心功能，集成点清晰明确。

**下一步**：开始实现Phase 1（核心模块）
