# GTO 功能扩展计划

## 一、当前已实现功能

| 功能 | 文件 | 状态 |
|------|------|------|
| GTO Preflop Engine | gtoPreflop.ts | ✅ 已完成 |
| Board Texture Classifier | boardTexture.ts | ✅ 已完成 |
| GTO Post-flop Engine | gtoPostflop.ts | ✅ 已完成 |

---

## 二、可扩展的 GTO 功能

### 高优先级（P0）

#### 1. Multiway Pots (多人底池策略)
**来源**: GTO Wizard, ThinkGTO, PokerNews

**验证数据**:
- **C-bet 频率**: 从单挑 70% 降低到三人底池 35% (ThinkGTO)
- **下注尺寸**: 从单挑 33% pot 增加到 62% pot (GTO Ranges+)
- **下注频率**: 三人底池中仅 11.7% 的手牌下注 (GTO Wizard)
- **防御范围**: 多人底池中防御范围更紧
- **停止范围下注**: 多人底池中不应该使用范围下注策略

**具体场景数据 (T♠7♥4♠)**:
| 配置 | CO c-bet 频率 | BTN raise | BTN call |
|------|-------------|-----------|----------|
| HU (CO vs BTN) | ~70% | ~17% | ~73% |
| 3-way (CO vs BTN vs BB) | ~35% | ~30% | ~39% |

**策略调整**:
- 更强的价值下注和诈唬
- 需要有听牌权益的诈唬才能继续
- 纯诈唬在多人底池中无效

**实现文件**:
- `src/utils/gtoMultiway.ts` (新建)
- `src/utils/multiwayRanges.ts` (新建)

**核心功能**:
```typescript
interface MultiwayConfig {
  playerCount: number;           // 2-9 人
  positions: Position[];         // 各玩家位置
  boardTexture: BoardTexture;    // 公共牌纹理
  isIP: boolean;                 // 是否有位置优势
}

interface MultiwayRecommendation {
  action: 'bet' | 'check' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸百分比
  frequency?: number;            // 该行动频率
  reasoning?: string;            // 推理说明
}

function getMultiwayRecommendation(
  config: MultiwayConfig,
  hand: Card[],
  equity: number,
  draws: DrawInfo | null,
): MultiwayRecommendation;
```

**范围调整**:
| 玩家数 | C-bet 频率 | 平均下注尺寸 | 价值门槛 |
|--------|-----------|-------------|---------|
| 2人 (HU) | ~70% | ~33% pot | 中对+ |
| 3人 | ~35% | ~62% pot | 顶对+ |
| 4人+ | ~20% | ~70% pot | 两对+ |

---

#### 2. Deep Stack (深筹码策略)
**来源**: GTO Wizard, BeyondGTO, RiverOdds

**关键数据**:
- 筹码深度: 150-200bb+
- 投机手牌价值提升 30-40%
- 小对子和同花连张更适合深筹码
- 更小的下注尺寸 (25-33% pot)
- 更高的隐含赔率

**实现文件**:
- `src/utils/gtoDeepStack.ts` (新建)

**核心功能**:
```typescript
interface DeepStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  spr: number;                   // Stack-to-Pot Ratio
  phase: GamePhase;              // 游戏阶段
  boardTexture: BoardTexture;    // 公共牌纹理
}

interface DeepStackRecommendation {
  action: 'bet' | 'check' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸百分比
  handAdjustment: 'upgrade' | 'downgrade' | 'neutral';
  reasoning?: string;
}

function getDeepStackRecommendation(
  config: DeepStackConfig,
  hand: Card[],
  equity: number,
): DeepStackRecommendation;
```

**手牌价值调整**:
| 手牌类型 | 100bb 价值 | 200bb+ 价值 | 调整 |
|---------|-----------|-------------|------|
| 小对子 (22-55) | 1.0x | 1.3-1.4x | 升级 |
| 同花连张 (54s-98s) | 1.0x | 1.3-1.4x | 升级 |
| 非同花大牌 (KJo, QJo) | 1.0x | 0.8-0.9x | 降级 |
| 超对 (AA-TT) | 1.0x | 0.9x | 谨慎 |

**SPR 决策表**:
| SPR | 翻牌后策略 | 转牌/河牌策略 |
|-----|-----------|-------------|
| < 4 | 高额下注/全压 | 持续施压 |
| 4-8 | 中等下注 | 根据牌力调整 |
| 8-15 | 小额下注 | 谨慎游戏 |
| > 15 | 非常谨慎 | 避免超额投入 |

---

#### 3. Short Stack (短筹码策略)
**来源**: GTO Wizard, PokerStrategy

**关键数据**:
- 筹码深度: 10-40bb
- 推/弃 (Push/Fold) 策略
- 更紧的范围
- 更激进的打法

**实现文件**:
- `src/utils/gtoShortStack.ts` (新建)

**核心功能**:
```typescript
interface ShortStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  position: Position;            // 位置
  numOpponents: number;          // 对手数量
  action: 'rfi' | 'facing_open' | 'facing_3bet';
}

interface ShortStackRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸 (bb)
  reasoning?: string;
}

function getShortStackRecommendation(
  config: ShortStackConfig,
  hand: Card[],
): ShortStackRecommendation;
```

**Push/Fold 范围**:
| 筹码深度 | 位置 | 范围 |
|---------|------|------|
| 10bb | BTN | ~42% (任意A, K7+, Q9+) |
| 10bb | SB | ~50% |
| 15bb | BTN | ~32% (任意对子, 任意A, KJ+) |
| 15bb | SB | ~38% |
| 20bb | BTN | ~28% |
| 20bb | SB | ~35% |

---

### 中优先级（P1）

#### 4. ICM (独立筹码模型)
**来源**: GTO Wizard, PokerNews

**关键数据**:
- 锦标赛泡沫策略
- 决赛桌策略
- 风险溢价调整
- ICM 压力降低攻击频率

**实现文件**:
- `src/utils/gtoICM.ts` (新建)

**核心功能**:
```typescript
interface ICMConfig {
  tournamentStage: 'early' | 'middle' | 'bubble' | 'final_table';
  payoutStructure: number[];     // 奖金结构
  playerStacks: number[];        // 各玩家筹码
  blinds: number;                // 盲注
  ante: number;                  // 前注
}

interface ICMRecommendation {
  action: Action;
  icmAdjustment: number;         // ICM 调整系数
  reasoning?: string;
}

function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
): ICMRecommendation;
```

**ICM 影响**:
| 场景 | 调整 | 原因 |
|------|------|------|
| 泡沫期 | 紧 20-30% | 避免淘汰风险 |
| 决赛桌 | 根据奖金调整 | 风险/收益权衡 |
| 短筹码 | 更紧 | 生存优先 |

---

#### 5. Nodelocking (节点锁定)
**来源**: GTO Wizard

**关键数据**:
- 调整对手策略假设
- 针对特定对手的剥削策略
- 更贴近实战

**实现文件**:
- `src/utils/gtoNodelock.ts` (新建)

**核心功能**:
```typescript
interface OpponentProfile {
  vpip: number;                  // 入池率
  pfr: number;                   // 加注率
  threeBet: number;              // 3-bet 率
  foldToThreeBet: number;        // 面对 3-bet 弃牌率
  cBet: number;                  // 持续下注率
  foldToCbet: number;            // 面对 c-bet 弃牌率
}

function adjustForNodelock(
  baseRecommendation: GtoRecommendation,
  opponentProfile: OpponentProfile,
): GtoRecommendation;
```

---

### 低优先级（P2）

#### 6. Bunching Effect (聚集效应)
- 多人弃牌后的范围调整
- 影响后续玩家的范围估计

#### 7. Range Analysis (范围分析)
- 对手范围可视化
- 范围对抗范围的 equity 计算

#### 8. Advanced Equity Calculator (高级胜率计算)
- 更精确的 Monte Carlo 模拟
- 支持多人底池的 equity 计算

---

## 三、实现优先级

| 优先级 | 功能 | 预计工作量 | 影响 |
|--------|------|-----------|------|
| P0 | Multiway Pots | 3-5 天 | 高 - 覆盖常见场景 |
| P0 | Deep Stack | 2-3 天 | 高 - 深筹码游戏必备 |
| P0 | Short Stack | 2-3 天 | 高 - 短筹码推/弃策略 |
| P1 | ICM | 3-5 天 | 中 - 锦标赛玩家需要 |
| P1 | Nodelock | 2-3 天 | 中 - 剥削策略 |
| P2 | Bunching Effect | 1-2 天 | 低 - 边缘场景 |
| P2 | Range Analysis | 3-5 天 | 低 - 高级分析 |
| P2 | Advanced Equity | 2-3 天 | 低 - 精度提升 |

---

## 四、验证来源

所有数据来自以下权威来源：
- GTO Wizard (blog.gtowizard.com)
- ThinkGTO (thinkgto.com)
- PokerNews (pokernews.com)
- BeyondGTO (beyondgto.com)
- RiverOdds (riverodds.app)
- PokerStrategy (pokerstrategy.com)

---

## 五、下一步行动

1. 确认优先级和范围
2. 创建详细实现计划
3. 搜索更多具体数据验证
4. 开始实现 P0 功能
