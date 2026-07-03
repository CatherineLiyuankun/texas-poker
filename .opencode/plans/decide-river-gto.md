# decideRiverGTO 实现计划

## 一、GTO River 策略核心原则

### 1. River 的独特性
**来源**: GTO Wizard, ThinkGTO, RiverOdds, DeucesCracked

**River 阶段特点**:
- 没有后续牌，手牌价值固定
- 不需要考虑牌面覆盖
- 纯价值下注和诈唬
- 极化策略：坚果或空气牌

### 2. 极化策略 (Polarized Strategy)

**价值手牌**:
- 强牌下注寻求更差手牌的跟注
- 顶对+、两对、暗三条、顺子、同花

**诈唬手牌**:
- 空气牌下注寻求更好手牌的弃牌
- 需要合适的 blocker 效应
- 需要可信的故事线

### 3. 下注尺寸与诈唬频率

| 下注尺寸 | MDF | GTO 诈唬频率 | 适用场景 |
|---------|-----|-------------|---------|
| 1/3 pot | 75% | 25% | 薄价值、阻断下注 |
| 1/2 pot | 67% | 33% | 合并价值手牌 |
| 2/3 pot | 60% | 40% | 标准价值+半诈唬 |
| 3/4 pot | 57% | 43% | 强价值手牌 |
| 1x pot | 50% | 50% | 极化范围：坚果和纯诈唬 |
| 1.5x pot | 40% | 60% | 坚果手牌 vs 封顶范围 |
| 2x pot | 33% | 67% | 坚果优势、封顶对手 |

### 4. 关键公式

**MDF (最小防御频率)**:
```
MDF = pot ÷ (pot + bet)
```

**GTO 诈唬频率**:
```
Bluff Frequency = bet ÷ (bet + pot)
```

**跟注盈亏平衡点**:
```
Break-even Equity = bet ÷ (bet + pot + bet) = bet ÷ (2 × bet + pot)
```

### 5. 抓诈唬决策树

**手牌分类**:
1. **价值手牌**: 你击败对手价值下注范围的一部分 → 跟注
2. **抓诈唬手牌**: 你击败所有诈唬，输给所有价值手牌 → 根据频率决定
3. **垃圾手牌**: 你连诈唬都打不过 → 弃牌

**决策流程**:
```
1. 估算对手的价值/诈唬比例
2. 计算你需要的胜率 (MDF)
3. 评估你的手牌在对手范围中的位置
4. 决定跟注或弃牌
```

---

## 二、实现设计

### 1. 函数签名

```typescript
export function decideRiverGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision
```

### 2. 核心数据结构

```typescript
interface RiverConfig {
  equity: number;                    // 手牌胜率
  potOdds: number;                   // 底池赔率
  handStrength: HandStrength;        // 手牌强度分类
  boardTexture: BoardTexture;        // 牌面纹理
  isIP: boolean;                     // 是否有位置优势
  numOpponents: number;              // 对手数量
  spr: number;                       // Stack-to-Pot Ratio
  toCall: number;                    // 需要跟注的金额
  totalPot: number;                  // 总底池
  lastRaiseBet: number;              // 上一次加注金额
}

enum HandStrength {
  NUTS = 'nuts',                     // 坚果牌
  STRONG = 'strong',                 // 强牌
  MEDIUM = 'medium',                 // 中等牌
  WEAK = 'weak',                     // 弱牌
  AIR = 'air',                       // 空气牌
}
```

### 3. 实现逻辑

```typescript
export function decideRiverGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  // 1. 计算基本数据
  const community = getCommunityByPhase(state);
  const texture = analyzeBoard(community);
  const equity = calculateEquity(player.hand, community, ctx.numOpponents, 500);
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyRiverStrength(equity, evaluated.rank, texture);
  const ip = isIP(ctx);
  const spr = calculateSPR(ctx);
  
  // 2. 面对下注
  if (ctx.toCall > 0) {
    return handleRiverFacingBet(player, state, flags, ctx, {
      equity, strength, texture, ip, spr,
    });
  }
  
  // 3. 主动下注
  return handleRiverNoBet(player, state, flags, ctx, {
    equity, strength, texture, ip, spr,
  });
}
```

### 4. 面对下注处理

```typescript
function handleRiverFacingBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: RiverConfig,
): BotDecision {
  const { equity, strength, spr } = config;
  const potOdds = ctx.toCall / (ctx.totalPot + ctx.toCall);
  
  // 大额加注处理
  if (ctx.toCall > state.lastRaiseBet * 2) {
    return handleRiverBigRaise(player, state, flags, config);
  }
  
  // 根据手牌强度决策
  switch (strength) {
    case HandStrength.NUTS:
      // 坚果牌：总是跟注或加注
      if (flags.canRaiseResult && Math.random() < 0.6) {
        return createRaiseAction(player, state, ctx, 0.75);
      }
      return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
    
    case HandStrength.STRONG:
      // 强牌：跟注为主
      if (equity >= potOdds + 0.05) {
        return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
    
    case HandStrength.MEDIUM:
      // 中等牌：抓诈唬
      if (equity >= potOdds) {
        return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
    
    case HandStrength.WEAK:
    case HandStrength.AIR:
      // 弱牌/空气牌：弃牌为主
      if (equity >= potOdds + 0.1) {
        return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
  }
}
```

### 5. 主动下注处理

```typescript
function handleRiverNoBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: RiverConfig,
): BotDecision {
  const { equity, strength, ip } = config;
  
  // 坚果牌：总是下注
  if (strength === HandStrength.NUTS) {
    return createBetAction(player, state, ctx, 0.75, 'River value bet with nuts');
  }
  
  // 强牌：下注为主
  if (strength === HandStrength.STRONG) {
    if (flags.canRaiseResult && Math.random() < 0.7) {
      return createBetAction(player, state, ctx, 0.67, 'River value bet');
    }
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }
  
  // 中等牌：过牌为主
  if (strength === HandStrength.MEDIUM) {
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }
  
  // 弱牌/空气牌：诈唬
  if ((strength === HandStrength.WEAK || strength === HandStrength.AIR) && ip) {
    if (flags.canRaiseResult && Math.random() < 0.3) {
      return createBetAction(player, state, ctx, 0.75, 'River bluff attempt');
    }
  }
  
  return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
}
```

### 6. 手牌强度分类

```typescript
function classifyRiverStrength(
  equity: number,
  handRank: HandRank | null,
  texture: BoardTexture,
): HandStrength {
  // 坚果牌：暗三条+、坚果顺子、坚果同花
  if (handRank && handRank.handRank >= HandRankType.THREE_OF_A_KIND) {
    return HandStrength.NUTS;
  }
  
  // 强牌：顶对顶踢脚、两对
  if (equity >= 0.7) {
    return HandStrength.STRONG;
  }
  
  // 中等牌：中对、弱顶对
  if (equity >= 0.5) {
    return HandStrength.MEDIUM;
  }
  
  // 弱牌：底对、高牌
  if (equity >= 0.3) {
    return HandStrength.WEAK;
  }
  
  // 空气牌
  return HandStrength.AIR;
}
```

---

## 三、与现有代码的集成

### 1. 修改 botAI.ts

```typescript
case 'river':
  return useGtoStrategy
    ? decideRiverGTO(player, state, flags, ctx, adj)  // ← 新增
    : decideRiver(player, state, flags, ctx, adj);
```

### 2. 导出函数

```typescript
// gtoRiver.ts
export function decideRiverGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  // 实现
}
```

### 3. 测试用例

```typescript
describe('decideRiverGTO', () => {
  it('should value bet with nuts', () => {
    // 测试坚果牌下注
  });
  
  it('should bluff with air in position', () => {
    // 测试空气牌诈唬
  });
  
  it('should call with medium strength vs small bet', () => {
    // 测试中等牌抓诈唬
  });
  
  it('should fold weak hands vs large bet', () => {
    // 测试弱牌弃牌
  });
});
```

---

## 四、验证数据

### 权威来源
- GTO Wizard: River 策略原则
- ThinkGTO: 抓诈唬决策树
- RiverOdds: 下注尺寸与诈唬频率表
- DeucesCracked: GTO 诈唬频率 2026

### 关键数据验证
| 数据点 | 来源 | 验证状态 |
|--------|------|---------|
| MDF 公式 | RiverOdds | ✅ 已验证 |
| GTO 诈唬频率 | DeucesCracked | ✅ 已验证 |
| 极化策略 | GTO Wizard | ✅ 已验证 |
| 抓诈唬决策树 | ThinkGTO | ✅ 已验证 |

---

## 五、实现优先级

| 任务 | 优先级 | 预计工作量 |
|------|--------|-----------|
| 创建 gtoRiver.ts 文件 | P0 | 0.5 天 |
| 实现 decideRiverGTO 函数 | P0 | 1 天 |
| 修改 botAI.ts 集成 | P0 | 0.5 天 |
| 编写测试用例 | P0 | 1 天 |
| 验证和调试 | P0 | 0.5 天 |

**总计**: 约 3.5 天

---

## 六、下一步行动

1. 确认计划细节
2. 创建 gtoRiver.ts 文件
3. 实现 decideRiverGTO 函数
4. 修改 botAI.ts 集成
5. 编写测试用例
6. 验证和调试
