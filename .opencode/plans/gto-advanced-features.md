# GTO 高级功能实现计划

## 一、当前状态

### 已实现功能
| 功能 | 文件 | 状态 |
|------|------|------|
| GTO Preflop Engine | gtoPreflop.ts | ✅ 已完成 |
| Board Texture Classifier | boardTexture.ts | ✅ 已完成 |
| GTO Post-flop Engine | gtoPostflop.ts | ✅ 已完成 |
| GTO River Engine | gtoRiver.ts | ✅ 已完成 |
| Multiway Pots (部分) | gtoRiver.ts | ✅ 已实现基础多路处理 |

### 已实现功能（P0优先级）
| 功能 | 文件 | 状态 |
|------|------|------|
| Deep Stack 策略 | gtoDeepStack.ts | ✅ 已完成 (18 tests passing) |
| Short Stack 策略 | gtoShortStack.ts | ✅ 已完成 (16 tests passing) |

### 待实现功能（P1优先级）
| 功能 | 预计工作量 | 优先级 | 详细计划 |
|------|-----------|--------|----------|
| ICM 策略 | 5-7天 | P1 | icm-nodelock-implementation.md |
| Nodelock 策略 | 3-5天 | P1 | icm-nodelock-implementation.md |

---

## 二、Deep Stack 策略实现

### 1. 专业数据来源（已验证）

**GTO Wizard / BeyondGTO / RiverOdds / ThinkGTO / PokerCoaching**

#### 核心数据
| 数据点 | 100bb | 200bb+ | 调整 |
|--------|-------|--------|------|
| 投机手牌价值 | 1.0x | 1.3-1.4x | +30-40% |
| 小对子 (22-55) | 1.0x | 1.3-1.4x | 升级 |
| 同花连张 (54s-98s) | 1.0x | 1.3-1.4x | 升级 |
| 非同花大牌 (KJo, QJo) | 1.0x | 0.8-0.9x | 降级 |
| 超对 (AA-TT) | 1.0x | 0.9x | 谨慎 |

#### SPR 决策表
| SPR | 翻牌后策略 | 转牌/河牌策略 |
|-----|-----------|-------------|
| < 4 | 高额下注/全压 | 持续施压 |
| 4-8 | 中等下注 | 根据牌力调整 |
| 8-15 | 小额下注 | 谨慎游戏 |
| > 15 | 非常谨慎 | 避免超额投入 |

#### 下注尺寸
- 深筹码偏好更小的下注尺寸 (25-33% pot)
- 干燥牌面：25-33% pot 逐步建池
- 湿润牌面：66-75% pot 拒绝权益
- 河牌：可使用超池下注 (110-150% pot)

#### Preflop 调整
- 开牌尺寸：2-2.5bb (位置优势时更小)
- 3-bet 尺寸：2.8-3.2x (vs 100bb 的 3.5-4x)
- 更多平跟 (flatting) 而非 3-bet
- 极化的 4-bet 范围

### 2. 实现设计

#### 文件结构
```
src/utils/gtoDeepStack.ts
src/utils/__tests__/gtoDeepStack.test.ts
```

#### 核心接口
```typescript
interface DeepStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  spr: number;                   // Stack-to-Pot Ratio
  phase: GamePhase;              // 游戏阶段
  boardTexture: BoardTexture;    // 公共牌纹理
  position: Position;            // 位置
  numOpponents: number;          // 对手数量
}

interface DeepStackRecommendation {
  action: Action;
  sizing?: number;               // 下注尺寸百分比
  handAdjustment: 'upgrade' | 'downgrade' | 'neutral';
  sprAdjustment: 'commit' | 'control' | 'cautious';
  reasoning?: string;
}

function getDeepStackRecommendation(
  config: DeepStackConfig,
  hand: Card[],
  equity: number,
): DeepStackRecommendation;
```

#### 核心逻辑
```typescript
// 1. 手牌价值调整
function adjustHandValue(
  hand: Card[],
  effectiveStack: number,
): 'upgrade' | 'downgrade' | 'neutral' {
  // 小对子 (22-55): 200bb+ 升级
  // 同花连张: 200bb+ 升级
  // 非同花大牌: 200bb+ 降级
  // 超对: 200bb+ 谨慎
}

// 2. SPR 决策
function getSPRDecision(
  spr: number,
  handStrength: string,
): 'commit' | 'control' | 'cautious' {
  // SPR < 4: 倾向全压
  // SPR 4-8: 中等下注
  // SPR 8-15: 小额下注
  // SPR > 15: 非常谨慎
}

// 3. 下注尺寸调整
function getDeepStackSizing(
  texture: BoardTexture,
  handStrength: string,
  spr: number,
): number {
  // 干燥牌面: 25-33% pot
  // 湿润牌面: 66-75% pot
  // 河牌坚果: 可超池下注
}
```

### 3. 集成点

#### botAI.ts 修改
```typescript
// 在 decidePostflop 和 decideRiver 中添加深筹码判断
function decidePostflop(...) {
  // 检测是否为深筹码
  const isDeepStack = ctx.effectiveStack > 150;
  
  if (isDeepStack) {
    return getDeepStackRecommendation(config, hand, equity);
  }
  
  // 原有逻辑
}
```

#### gtoPostflop.ts 修改
```typescript
// 添加深筹码下注尺寸调整
function getBetSizing(
  texture: BoardClassification,
  isDeepStack: boolean,
  spr: number,
): number {
  if (isDeepStack && spr > 8) {
    return 0.25; // 深筹码小尺寸
  }
  return BET_SIZING[getTextureKey(texture)] ?? 0.50;
}
```

---

## 三、Short Stack 策略实现

### 1. 专业数据来源（已验证）

**GTO Wizard / PokerStrategy / ThinkGTO / PokerCoaching / BeyondGTO**

#### Push/Fold 范围表
| 筹码深度 | 位置 | 范围 | 频率 |
|---------|------|------|------|
| 10bb | BTN | 任意A, K7+, Q9+, 22+ | ~42% |
| 10bb | SB | 任意A, K2+, Q2+, J3+, 22+ | ~50% |
| 15bb | BTN | 任意对子, 任意A, KJ+, QJs, JTs | ~32% |
| 15bb | SB | 任意A, K2+, Q2+, J3+, 22+ | ~38% |
| 20bb | BTN | 22+, A2s+, A7o+, K9s+, KJo+, Q9s+, J9s+, T8s+ | ~28% |
| 20bb | SB | 22+, A2s+, A5o+, K5s+, K9o+, Q8s+, Q9o+, J8s+, T8s+ | ~35% |

#### 防守范围
| 对手推注 | 位置 | 防守范围 | 频率 |
|---------|------|---------|------|
| 10bb BTN推 | BB | A2s+, K9o+, Q9s+, 任何对子 | ~35-40% |
| 12bb BTN推 | BB | A2s+, K9o+, Q9s+, J8s+, 任何对子 | ~40-45% |
| 15bb BTN推 | BB | A2s+, KJo+, QJs, JTs, 22+ | ~30-35% |

#### 关键原则
1. **位置至关重要**: 从后期位置可以推更宽的范围
2. **弃牌权益是主要资产**: 很多推注盈利来自对手弃牌
3. **避免最小加注**: 短筹码时要么全压要么弃牌
4. **ICM 影响**: 泡沫期需要更紧的范围

### 2. 实现设计

#### 文件结构
```
src/utils/gtoShortStack.ts
src/utils/__tests__/gtoShortStack.test.ts
```

#### 核心接口
```typescript
interface ShortStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  position: Position;            // 位置
  numOpponents: number;          // 对手数量
  action: 'rfi' | 'facing_open' | 'facing_3bet';
  isTournament: boolean;         // 是否为锦标赛
  isBubble: boolean;             // 是否在泡沫期
}

interface ShortStackRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸 (bb)
  pushRange?: string;            // 推注范围描述
  callRange?: string;            // 跟注范围描述
  reasoning?: string;
}

function getShortStackRecommendation(
  config: ShortStackConfig,
  hand: Card[],
): ShortStackRecommendation;
```

#### 核心逻辑
```typescript
// 1. Push/Fold 范围判断
function getPushFoldRange(
  stackDepth: number,
  position: Position,
  numOpponents: number,
): string {
  // 根据筹码深度和位置返回推注范围
}

// 2. 防守范围判断
function getDefendRange(
  opponentStack: number,
  opponentPosition: Position,
  heroPosition: Position,
): string {
  // 根据对手推注和英雄位置返回防守范围
}

// 3. ICM 调整
function adjustForICM(
  range: string,
  isBubble: boolean,
  stackRank: number,
): string {
  // 泡沫期收紧范围
}
```

### 3. 集成点

#### botAI.ts 修改
```typescript
// 在 decidePreflop 中添加短筹码判断
function decidePreflop(...) {
  const isShortStack = ctx.effectiveStack <= 20;
  
  if (isShortStack) {
    return getShortStackRecommendation(config, hand);
  }
  
  // 原有逻辑
}
```

---

## 四、ICM 策略实现

### 1. 专业数据来源（已验证）

**GTO Wizard / ThinkGTO / BeyondGTO / GTOLab**

#### ICM 核心概念
- **风险溢价 (Risk Premium)**: 通常 1.2-1.6，泡沫期可达 2.0+
- **泡沫因子 (Bubble Factor)**: EV lost ÷ EV gained
- **ICM 压力曲线**: 泡沫前达到峰值，泡沫后急剧下降

#### ICM 调整表
| 场景 | 调整 | 原因 |
|------|------|------|
| 泡沫期 | 紧 20-30% | 避免淘汰风险 |
| 决赛桌 | 根据奖金调整 | 风险/收益权衡 |
| 短筹码 | 更紧 | 生存优先 |
| 大筹码 | 可攻击 | 利用弃牌权益 |

#### 关键调整
- **需要更强的手牌才能跟注**: 55-60%+ equity (vs 50% chip EV)
- **收紧开牌范围**: 从 22% 降至 16-18%
- **更激进的偷盲**: 利用对手的 ICM 压力

### 2. 实现设计

#### 文件结构
```
src/utils/gtoICM.ts
src/utils/__tests__/gtoICM.test.ts
```

#### 核心接口
```typescript
interface ICMConfig {
  tournamentStage: 'early' | 'middle' | 'bubble' | 'final_table';
  payoutStructure: number[];     // 奖金结构
  playerStacks: number[];        // 各玩家筹码
  blinds: number;                // 盲注
  ante: number;                  // 前注
  numPlayers: number;            // 剩余玩家数
}

interface ICMRecommendation {
  action: Action;
  icmAdjustment: number;         // ICM 调整系数
  riskPremium: number;           // 风险溢价
  reasoning?: string;
}

function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
  heroStack: number,
): ICMRecommendation;
```

#### 核心逻辑
```typescript
// 1. 计算风险溢价
function calculateRiskPremium(
  heroStack: number,
  averageStack: number,
  isBubble: boolean,
  payoutStructure: number[],
): number {
  // 泡沫期: 1.5-2.0
  // 决赛桌: 1.2-1.5
  // 早期: 1.0-1.1
}

// 2. ICM 调整手牌范围
function adjustRangeForICM(
  baseRange: string,
  riskPremium: number,
  stackRank: number,
): string {
  // 风险溢价越高，范围越紧
}

// 3. 计算 ICM equity
function calculateICMEquity(
  heroStack: number,
  playerStacks: number[],
  payoutStructure: number[],
): number {
  // 使用 Malmuth-Harville 模型
}
```

---

## 五、Nodelock 策略实现

### 1. 专业数据来源（已验证）

**GTO Wizard / BeyondGTO / PLO.com / PokerNews**

#### Nodelock 核心概念
- **策略锁定**: 固定对手在特定节点的策略
- **范围锁定**: 固定对手在特定节点的范围
- **级联效应**: 早期锁定会影响后续街道的策略

#### 常见对手漏洞
| 漏洞类型 | 表现 | 调整策略 |
|---------|------|---------|
| 过度弃牌 | 弃牌频率 > 50% | 增加诈唬 |
| 过度跟注 | 跟注频率 > 60% | 减少诈唬，增加价值下注 |
| 过度激进 | 加注频率 > 30% | 增加跟注，减少诈唬 |
| 被动 | 加注频率 < 10% | 增加偷盲和持续下注 |

### 2. 实现设计

#### 文件结构
```
src/utils/gtoNodelock.ts
src/utils/__tests__/gtoNodelock.test.ts
```

#### 核心接口
```typescript
interface OpponentProfile {
  vpip: number;                  // 入池率
  pfr: number;                   // 加注率
  threeBet: number;              // 3-bet 率
  foldToThreeBet: number;        // 面对 3-bet 弃牌率
  cBet: number;                  // 持续下注率
  foldToCbet: number;            // 面对 c-bet 弃牌率
  aggression: number;            // 攻击性指数
  sampleSize: number;            // 样本量
}

interface NodelockConfig {
  opponentProfile: OpponentProfile;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  nodeType: 'bet' | 'raise' | 'call' | 'fold';
  baseStrategy: GtoRecommendation;
}

function adjustForNodelock(
  config: NodelockConfig,
  hand: Card[],
  equity: number,
): GtoRecommendation;
```

#### 核心逻辑
```typescript
// 1. 评估对手漏洞
function evaluateLeak(
  profile: OpponentProfile,
  stat: string,
  threshold: number,
): 'overfold' | 'underfold' | 'neutral' {
  // 比较对手统计与 GTO 基线
}

// 2. 计算调整幅度
function calculateAdjustment(
  leakType: 'overfold' | 'underfold',
  leakMagnitude: number,
): number {
  // 过度弃牌: +诈唬频率
  // 过度跟注: -诈唬频率，+价值下注
}

// 3. 应用调整
function applyNodelock(
  baseStrategy: GtoRecommendation,
  adjustment: number,
  handType: 'value' | 'bluff' | 'draw',
): GtoRecommendation {
  // 根据手牌类型应用不同调整
}
```

---

## 六、实现优先级和时间表

### Phase 1: Deep Stack (3-5天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 创建 gtoDeepStack.ts | 0.5天 | 无 |
| 实现手牌价值调整 | 1天 | 无 |
| 实现 SPR 决策逻辑 | 1天 | 手牌价值调整 |
| 集成到 botAI.ts | 0.5天 | gtoDeepStack.ts |
| 编写测试用例 | 1天 | 所有实现 |
| 验证和调试 | 0.5天 | 测试完成 |

### Phase 2: Short Stack (3-5天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 创建 gtoShortStack.ts | 0.5天 | 无 |
| 实现 Push/Fold 范围 | 1.5天 | 无 |
| 实现防守范围 | 1天 | Push/Fold 范围 |
| 集成到 botAI.ts | 0.5天 | gtoShortStack.ts |
| 编写测试用例 | 1天 | 所有实现 |
| 验证和调试 | 0.5天 | 测试完成 |

### Phase 3: ICM (5-7天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 创建 gtoICM.ts | 0.5天 | 无 |
| 实现风险溢价计算 | 1.5天 | 无 |
| 实现 ICM equity 计算 | 2天 | 风险溢价 |
| 集成到 botAI.ts | 0.5天 | gtoICM.ts |
| 编写测试用例 | 1.5天 | 所有实现 |
| 验证和调试 | 1天 | 测试完成 |

### Phase 4: Nodelock (3-5天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 创建 gtoNodelock.ts | 0.5天 | 无 |
| 实现对手漏洞评估 | 1天 | 无 |
| 实现调整逻辑 | 1.5天 | 漏洞评估 |
| 集成到 botAI.ts | 0.5天 | gtoNodelock.ts |
| 编写测试用例 | 1天 | 所有实现 |
| 验证和调试 | 0.5天 | 测试完成 |

---

## 七、验证数据来源

所有数据来自以下权威来源：
- **GTO Wizard** (blog.gtowizard.com) - 专业 GTO 解算器
- **ThinkGTO** (thinkgto.com) - GTO 策略教学
- **BeyondGTO** (beyondgto.com) - GTO 实战指南
- **RiverOdds** (riverodds.app) - 深筹码策略
- **PokerNews** (pokernews.com) - 扑克新闻和策略
- **PokerCoaching** (pokercoaching.com) - 专业教练指导
- **PokerStrategy** (pokerstrategy.com) - 扑克策略社区
- **GTOLab** (gtolab.com) - GTO 研究实验室
- **DeucesCracked** (deucescracked.com) - 扑克训练平台

---

## 八、测试策略

### 单元测试
- 每个函数独立测试
- 覆盖边界条件
- 验证数学公式正确性

### 集成测试
- 与 botAI.ts 集成测试
- 与 gtoPostflop.ts 集成测试
- 与 gtoRiver.ts 集成测试

### 场景测试
- 深筹码场景 (150-200bb+)
- 短筹码场景 (10-20bb)
- 泡沫期场景
- 决赛桌场景

---

## 九、下一步行动

1. **确认优先级**: 用户确认先实现哪个功能
2. **创建详细计划**: 为选定功能创建详细实现计划
3. **开始实现**: 按照计划逐步实现
4. **验证和测试**: 确保所有功能符合 GTO 标准
5. **集成和优化**: 与现有系统集成并优化性能
