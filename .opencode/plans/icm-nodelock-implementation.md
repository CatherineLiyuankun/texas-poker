# ICM & Nodelock 策略实现计划

## 一、专业数据验证

### 1. ICM 数据来源（已验证）

| 来源 | 数据点 | 验证状态 |
|------|--------|----------|
| GTO Wizard | Malmuth-Harville公式、CSTE指标 | ✅ 已验证 |
| GTOLab | 泡沫因子矩阵、风险溢价 | ✅ 已验证 |
| DeucesCracked | 四阶段风险溢价模型 | ✅ 已验证 |
| PokerCoaching | Jonathan Little风险溢价表 | ✅ 已验证 |
| BeyondGTO | 泡沫策略、下注尺度调整 | ✅ 已验证 |

### 2. Nodelock 数据来源（已验证）

| 来源 | 数据点 | 验证状态 |
|------|--------|----------|
| BeyondGTO | 节点锁定方法论、保守锁定原则 | ✅ 已验证 |
| GTO Wizard | 玩家画像工具、频率锁定 | ✅ 已验证 |
| PLO.com | 剥削策略、最大剥削方法 | ✅ 已验证 |
| Postflopizer | 锁定逻辑、级联效应 | ✅ 已验证 |
| DeucesCracked | GTO vs 剥削策略对比 | ✅ 已验证 |

---

## 二、ICM 策略实现

### 1. 核心数据（专业来源验证）

#### 风险溢价（Risk Premium）- 四阶段模型
| 阶段 | 剩余玩家比例 | 风险溢价 | 调整 |
|------|-------------|----------|------|
| Phase 1: 无压力期 | 35-20% | 0-4% | 接近筹码EV |
| Phase 2: 泡沫前构建 | 20-10% | 4-8% | 开始收紧 |
| Phase 3: 真正泡沫期 | 10%以内 | 10-20% | 显著收紧 |
| Phase 4: 泡沫破裂后 | 泡沫刚破 | <5% | 立即放宽 |

**关键原则**：
- 泡沫期需要55-60%+ equity才能跟注（vs 50%筹码EV）
- 短筹码压力来自筹码 vs 平均筹码，不是原始BB数
- 泡沫破裂后立即调整，不要渐进调整

#### 泡沫因子（Bubble Factor）
| 泡沫因子 | 所需权益 | 额外要求 | 典型场景 |
|----------|----------|----------|----------|
| ~1.0 | 50% | +0% | 筹码EV区域 |
| 1.2 | 54.5% | +4.5% | 轻度ICM - 中后期 |
| 1.4 | 58.3% | +8.3% | 中等 - 接近泡沫 |
| 1.6 | 61.5% | +11.5% | 高ICM - 直接泡沫 |
| 2.0+ | 66.7%+ | +16.7%+ | 极端 - 大筹码差距 |

**计算公式**：
```
Bubble Factor = EV_lost ÷ EV_gained
Required Equity = BF ÷ (BF + 1)
Risk Premium = Required Equity - 0.50
```

#### 筹码类别策略
| 筹码类别 | 策略 | 原因 |
|----------|------|------|
| 短筹码 | 更紧，生存优先 | 接近淘汰，ICM压力最高 |
| 中筹码 | 适中，保护权益 | 有权益可保护 |
| 大筹码 | 可攻击，利用弃牌 | ICM压力低，可施压 |

#### 下注尺度调整
| 场景 | 调整 | 原因 |
|------|------|------|
| 泡沫期3-bet | 增大尺寸 | 想在翻牌前赢下底池 |
| 大筹码施压 | 使用更大尺寸 | 利用对手ICM压力 |
| 中筹码防守 | 更小尺寸 | 保护筹码，避免冲突 |

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
  payoutStructure: number[];           // 奖金结构（百分比）
  playerStacks: number[];              // 各玩家筹码
  heroStack: number;                   // 英雄筹码
  blinds: number;                      // 当前盲注
  ante: number;                        // 前注
  numPlayers: number;                  // 剩余玩家数
  averageStack: number;                // 平均筹码
}

interface ICMRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold' | 'check';
  sizing?: number;
  riskPremium: number;                 // 风险溢价 (0-1)
  bubbleFactor: number;                // 泡沫因子
  icmAdjustment: number;               // ICM调整系数
  reasoning: string;
}

// Malmuth-Harville ICM 计算
function calculateICMEquity(
  stacks: number[],
  payouts: number[],
): number[];

// 泡沫因子计算
function calculateBubbleFactor(
  heroStack: number,
  villainStack: number,
  totalChips: number,
  payoutStructure: number[],
  numPlayers: number,
): number;

// 风险溢价计算
function calculateRiskPremium(
  bubbleFactor: number,
): number;

// ICM 推荐
function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
  action: 'rfi' | 'facing_open' | 'facing_3bet' | 'facing_shove',
): ICMRecommendation;

// 锦标赛阶段判断
function getTournamentStage(
  numPlayersRemaining: number,
  numPlayersPaid: number,
): 'early' | 'middle' | 'bubble' | 'final_table';
```

#### 核心逻辑
```typescript
// 1. Malmuth-Harville ICM 计算
function calculateICMEquity(stacks: number[], payouts: number[]): number[] {
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  const n = stacks.length;
  const equity = new Array(n).fill(0);

  // 递归计算每个位置的概率
  function calculatePositionProbs(
    remainingStacks: number[],
    remainingPayouts: number[],
    probs: number[],
    position: number,
  ) {
    if (remainingPayouts.length === 0 || remainingStacks.length === 0) return;

    const totalRemaining = remainingStacks.reduce((a, b) => a + b, 0);

    for (let i = 0; i < remainingStacks.length; i++) {
      const winProb = remainingStacks[i] / totalRemaining;

      // 如果这个玩家赢得当前位置
      if (position < payouts.length) {
        const playerOriginalIdx = stacks.indexOf(remainingStacks[i]);
        equity[playerOriginalIdx] += winProb * payouts[position] * probs.reduce((a, b) => a * b, 1);
      }

      // 递归计算剩余位置
      const newRemaining = remainingStacks.filter((_, idx) => idx !== i);
      const newProbs = [...probs, winProb];
      calculatePositionProbs(newRemaining, remainingPayouts.slice(1), newProbs, position + 1);
    }
  }

  calculatePositionProbs(stacks, payouts, [], 0);
  return equity;
}

// 2. 泡沫因子计算
function calculateBubbleFactor(
  heroStack: number,
  villainStack: number,
  totalChips: number,
  payoutStructure: number[],
  numPlayers: number,
): number {
  // 计算英雄的当前ICM权益
  const currentStacks = new Array(numPlayers).fill(totalChips / numPlayers);
  const heroIdx = 0;
  currentStacks[heroIdx] = heroStack;

  const currentEquity = calculateICMEquity(currentStacks, payoutStructure);
  const heroCurrentEquity = currentEquity[heroIdx];

  // 计算英雄赢后的ICM权益
  const winStacks = [...currentStacks];
  winStacks[heroIdx] += villainStack;
  const winEquity = calculateICMEquity(winStacks, payoutStructure);
  const heroWinEquity = winEquity[heroIdx];

  // 计算英雄输后的ICM权益
  const loseStacks = [...currentStacks];
  loseStacks[heroIdx] = 0; // 英雄被淘汰
  const loseEquity = calculateICMEquity(loseStacks, payoutStructure);
  const heroLoseEquity = loseEquity[heroIdx];

  // 泡沫因子 = |EV_lost| / EV_gained
  const evGained = heroWinEquity - heroCurrentEquity;
  const evLost = heroCurrentEquity - heroLoseEquity;

  if (evGained === 0) return 1.0;
  return Math.abs(evLost) / evGained;
}

// 3. 风险溢价计算
function calculateRiskPremium(bubbleFactor: number): number {
  // Risk Premium = BF / (BF + 1) - 0.5
  return bubbleFactor / (bubbleFactor + 1) - 0.5;
}

// 4. 锦标赛阶段判断
function getTournamentStage(
  numPlayersRemaining: number,
  numPlayersPaid: number,
): 'early' | 'middle' | 'bubble' | 'final_table' {
  const percentRemaining = numPlayersRemaining / numPlayersPaid;

  if (percentRemaining > 0.35) return 'early';
  if (percentRemaining > 0.20) return 'middle';
  if (percentRemaining > 0.10) return 'bubble';
  return 'final_table';
}

// 5. ICM 推荐
function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
  action: 'rfi' | 'facing_open' | 'facing_3bet' | 'facing_shove',
): ICMRecommendation {
  const stage = getTournamentStage(config.numPlayers, config.payoutStructure.length);

  // 根据阶段调整策略
  const stageAdjustment = {
    early: 1.0,
    middle: 1.1,
    bubble: 1.3,
    final_table: 1.2,
  }[stage];

  // 计算风险溢价
  const avgBubbleFactor = calculateBubbleFactor(
    config.heroStack,
    config.averageStack,
    config.averageStack * config.numPlayers,
    config.payoutStructure,
    config.numPlayers,
  );
  const riskPremium = calculateRiskPremium(avgBubbleFactor);

  // 根据位置和动作调整
  const positionAdjustment = getPositionAdjustment(position);

  // 最终调整系数
  const icmAdjustment = stageAdjustment * positionAdjustment;

  // 基础推荐（使用现有GTO逻辑）
  // 根据ICM调整修改推荐

  return {
    action: 'fold', // 默认，实际会根据手牌和位置调整
    riskPremium,
    bubbleFactor: avgBubbleFactor,
    icmAdjustment,
    reasoning: `ICM调整: ${stage}阶段, 风险溢价 ${(riskPremium * 100).toFixed(1)}%`,
  };
}

function getPositionAdjustment(position: Position): number {
  const adjustments: Record<Position, number> = {
    UTG: 1.2,    // 早期位置更紧
    MP: 1.1,
    CO: 1.0,
    BTN: 0.9,    // 按钮位更松
    SB: 1.1,
    BB: 1.0,
  };
  return adjustments[position] || 1.0;
}
```

### 3. 集成点

#### botAI.ts 修改
```typescript
import { getICMRecommendation, isTournamentBubble } from './gtoICM';

function decidePreflop(...) {
  // 检测是否为锦标赛泡沫期
  if (isTournamentBubble(state)) {
    const icmRec = getICMRecommendation(
      getICMConfig(state),
      player.hand,
      getPositionName(position, state.players.length),
      'rfi',
    );

    // ICM调整：收紧范围
    if (icmRec.riskPremium > 0.10) {
      // 高ICM压力：收紧20-30%
      // 使用更紧的范围
    }
  }

  // 原有逻辑
}
```

---

## 三、Nodelock 策略实现

### 1. 核心数据（专业来源验证）

#### 对手漏洞类型
| 漏洞类型 | 表现 | 调整策略 | 数据来源 |
|----------|------|----------|----------|
| 过度弃牌 | 弃牌频率 > 50% | 增加诈唬 | BeyondGTO |
| 过度跟注 | 跟注频率 > 60% | 减少诈唬，增加价值下注 | GTO Wizard |
| 过度激进 | 加注频率 > 30% | 增加跟注，减少诈唬 | PLO.com |
| 被动 | 加注频率 < 10% | 增加偷盲和持续下注 | Postflopizer |

#### 关键调整原则
1. **保守锁定**：如果数据显示57%弃牌率，锁定53-54%（留安全边际）
2. **级联效应**：早期锁定会影响后续街道策略
3. **最大剥削**：假设对手不会调整，但不要过度剥削
4. **多节点锁定**：单节点锁定不是最大剥削，需要多节点

#### 频率调整表
| 对手倾向 | 调整 | 幅度 |
|----------|------|------|
| 弃牌率+10% | 诈唬频率+5-8% | 中等 |
| 跟注率+10% | 诈唬频率-3-5%，价值下注+2-3% | 中等 |
| 加注率+10% | 跟注范围+5-8%，诈唬-2-3% | 中等 |
| 加注率-10% | 偷盲+5-8%，持续下注+3-5% | 中等 |

### 2. 实现设计

#### 文件结构
```
src/utils/gtoNodelock.ts
src/utils/__tests__/gtoNodelock.test.ts
```

#### 核心接口
```typescript
interface OpponentProfile {
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
}

interface NodelockConfig {
  opponentProfile: OpponentProfile;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  nodeType: 'bet' | 'raise' | 'call' | 'fold';
  baseStrategy: GtoRecommendation;
  leakThreshold: number;         // 漏洞阈值 (默认 10%)
}

interface NodelockRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold' | 'check';
  sizing?: number;
  adjustmentType: 'overfold' | 'underfold' | 'overfold_to_bet' | 'underfold_to_bet' | 'neutral';
  adjustmentMagnitude: number;   // 调整幅度 (-1 到 1)
  confidence: number;            // 置信度 (0-1)
  reasoning: string;
}

// 评估对手漏洞
function evaluateLeak(
  profile: OpponentProfile,
  stat: string,
  baseline: number,
  threshold: number,
): 'overfold' | 'underfold' | 'neutral';

// 计算调整幅度
function calculateAdjustment(
  leakType: 'overfold' | 'underfold' | 'overfold_to_bet' | 'underfold_to_bet' | 'neutral',
  leakMagnitude: number,
): number;

// Nodelock 推荐
function getNodelockRecommendation(
  config: NodelockConfig,
  hand: Card[],
  equity: number,
  boardTexture?: BoardTexture,
): NodelockRecommendation;

// 从对手数据构建画像
function buildOpponentProfile(
  handsData: HandData[],
): OpponentProfile;

// 检查样本量是否足够
function isSampleSufficient(profile: OpponentProfile): boolean;
```

#### 核心逻辑
```typescript
// 1. 评估对手漏洞
function evaluateLeak(
  profile: OpponentProfile,
  stat: string,
  baseline: number,
  threshold: number,
): 'overfold' | 'underfold' | 'neutral' {
  const value = profile[stat as keyof OpponentProfile] as number;
  const deviation = (value - baseline) / baseline;

  if (deviation > threshold) return 'overfold';
  if (deviation < -threshold) return 'underfold';
  return 'neutral';
}

// 2. 计算调整幅度
function calculateAdjustment(
  leakType: 'overfold' | 'underfold' | 'overfold_to_bet' | 'underfold_to_bet' | 'neutral',
  leakMagnitude: number,
): number {
  // 调整幅度基于漏洞大小，但有上限
  const maxAdjustment = 0.30; // 最大30%调整

  switch (leakType) {
    case 'overfold':
      // 过度弃牌：增加诈唬频率
      return Math.min(leakMagnitude * 0.5, maxAdjustment);
    case 'underfold':
      // 过度跟注：减少诈唬，增加价值下注
      return Math.max(-leakMagnitude * 0.3, -maxAdjustment);
    case 'overfold_to_bet':
      // 面对下注过度弃牌：增加下注频率
      return Math.min(leakMagnitude * 0.4, maxAdjustment);
    case 'underfold_to_bet':
      // 面对下注过度跟注：减少下注，增加过牌
      return Math.max(-leakMagnitude * 0.2, -maxAdjustment);
    default:
      return 0;
  }
}

// 3. Nodelock 推荐
function getNodelockRecommendation(
  config: NodelockConfig,
  hand: Card[],
  equity: number,
  boardTexture?: BoardTexture,
): NodelockRecommendation {
  const { opponentProfile, street, nodeType, baseStrategy, leakThreshold } = config;

  // 评估漏洞
  const stat = getStatForNodeType(street, nodeType);
  const baseline = getBaseline(street, nodeType);
  const leakType = evaluateLeak(opponentProfile, stat, baseline, leakThreshold);
  const leakMagnitude = Math.abs(
    (opponentProfile[stat as keyof OpponentProfile] as number - baseline) / baseline,
  );

  // 计算调整
  const adjustmentMagnitude = calculateAdjustment(leakType, leakMagnitude);

  // 根据漏洞类型调整策略
  let adjustedAction = baseStrategy.action;
  let adjustedSizing = baseStrategy.sizing;

  if (leakType === 'overfold') {
    // 对手过度弃牌：增加诈唬
    if (handStrength < 0.5) {
      adjustedAction = 'bet';
      adjustedSizing = baseStrategy.sizing * 1.2;
    }
  } else if (leakType === 'underfold') {
    // 对手过度跟注：减少诈唬，增加价值下注
    if (handStrength > 0.7) {
      adjustedAction = 'bet';
      adjustedSizing = baseStrategy.sizing * 0.8;
    } else {
      adjustedAction = 'check';
    }
  }

  return {
    action: adjustedAction,
    sizing: adjustedSizing,
    adjustmentType: leakType,
    adjustmentMagnitude,
    confidence: calculateConfidence(opponentProfile.sampleSize),
    reasoning: `对手${leakType === 'overfold' ? '过度弃牌' : '过度跟注'}，调整幅度 ${(adjustmentMagnitude * 100).toFixed(1)}%`,
  };
}

// 4. 从对手数据构建画像
function buildOpponentProfile(handsData: HandData[]): OpponentProfile {
  const totalHands = handsData.length;

  const vpip = handsData.filter(h => h.vpip).length / totalHands;
  const pfr = handsData.filter(h => h.pfr).length / totalHands;
  const threeBet = handsData.filter(h => h.threeBet).length / totalHands;
  const foldToThreeBet = handsData.filter(h => h.foldToThreeBet).length / totalHands;
  const cBet = handsData.filter(h => h.cBet).length / totalHands;
  const foldToCbet = handsData.filter(h => h.foldToCbet).length / totalHands;
  const aggression = handsData.filter(h => h.aggressiveAction).length /
    Math.max(handsData.filter(h => h.passiveAction).length, 1);
  const wtsd = handsData.filter(h => h.wentToShowdown).length / totalHands;
  const msw = handsData.filter(h => h.wonAtShowdown).length /
    Math.max(handsData.filter(h => h.wentToShowdown).length, 1);

  return {
    vpip,
    pfr,
    threeBet,
    foldToThreeBet,
    cBet,
    foldToCbet,
    aggression,
    wtsd,
    msw,
    sampleSize: totalHands,
  };
}

// 5. 检查样本量
function isSampleSufficient(profile: OpponentProfile): boolean {
  // 至少需要100手牌才能可靠地评估漏洞
  return profile.sampleSize >= 100;
}

function getStatForNodeType(street: string, nodeType: string): string {
  const statMap: Record<string, Record<string, string>> = {
    preflop: {
      raise: 'pfr',
      call: 'vpip',
      fold: 'foldToThreeBet',
    },
    flop: {
      bet: 'cBet',
      call: 'foldToCbet',
      raise: 'aggression',
    },
    turn: {
      bet: 'cBet',
      call: 'foldToCbet',
      raise: 'aggression',
    },
    river: {
      bet: 'wtsd',
      call: 'msw',
      raise: 'aggression',
    },
  };
  return statMap[street]?.[nodeType] || 'aggression';
}

function getBaseline(street: string, nodeType: string): number {
  const baselineMap: Record<string, Record<string, number>> = {
    preflop: {
      pfr: 0.25,
      vpip: 0.30,
      foldToThreeBet: 0.55,
    },
    flop: {
      cBet: 0.50,
      foldToCbet: 0.40,
      aggression: 1.5,
    },
    turn: {
      cBet: 0.45,
      foldToCbet: 0.45,
      aggression: 1.3,
    },
    river: {
      wtsd: 0.30,
      msw: 0.55,
      aggression: 1.2,
    },
  };
  return baselineMap[street]?.[nodeType] || 0.5;
}

function calculateConfidence(sampleSize: number): number {
  // 置信度随样本量增加
  if (sampleSize >= 500) return 0.95;
  if (sampleSize >= 300) return 0.85;
  if (sampleSize >= 200) return 0.75;
  if (sampleSize >= 100) return 0.65;
  return 0.5;
}
```

### 3. 集成点

#### botAI.ts 修改
```typescript
import { getNodelockRecommendation, buildOpponentProfile, isSampleSufficient } from './gtoNodelock';

function getBotAction(player: Player, state: GameState): BotDecision {
  // ... 现有代码 ...

  // 检查是否有对手数据
  const oppProfile = calculateOpponentProfile(state.players, player.id);

  if (isSampleSufficient(oppProfile)) {
    // 使用 Nodelock 调整
    const nodelockRec = getNodelockRecommendation(
      {
        opponentProfile: oppProfile,
        street: state.phase,
        nodeType: determineNodeType(ctx, flags),
        baseStrategy: baseStrategy,
        leakThreshold: 0.10,
      },
      player.hand,
      equity,
      boardTexture,
    );

    // 应用调整
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

---

## 四、测试策略

### 1. ICM 测试用例

| 测试场景 | 输入 | 预期输出 |
|----------|------|----------|
| 3人泡沫期 | 筹码 [5000, 3000, 2000] | 泡沫因子 1.5-2.0 |
| 泡沫破裂后 | 剩余玩家刚过线 | 风险溢价 <5% |
| 短筹码推注 | 10bb 筹码 | 需要55%+ equity |
| 大筹码施压 | 50bb vs 10bb | 可以推更宽范围 |
| 决赛桌 | 3人，奖金结构 | 根据奖金调整 |

### 2. Nodelock 测试用例

| 测试场景 | 对手数据 | 预期调整 |
|----------|----------|----------|
| 过度弃牌 | 弃牌率60% | 增加诈唬+5-8% |
| 过度跟注 | 跟注率65% | 减少诈唬-3-5% |
| 被动 | 加注率8% | 偷盲+5-8% |
| 过度激进 | 加注率35% | 增加跟注+5-8% |
| 样本不足 | <100手牌 | 不调整 |

---

## 五、实现优先级

### Phase 1: ICM 核心 (3-4天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| Malmuth-Harville ICM 计算 | 1天 | 无 |
| 泡沫因子计算 | 1天 | ICM计算 |
| 风险溢价计算 | 0.5天 | 泡沫因子 |
| 集成到 botAI.ts | 0.5天 | 所有计算 |
| 测试用例 | 1天 | 所有实现 |

### Phase 2: Nodelock 核心 (3-4天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 对手画像构建 | 1天 | 无 |
| 漏洞评估 | 1天 | 画像构建 |
| 调整逻辑 | 1天 | 漏洞评估 |
| 集成到 botAI.ts | 0.5天 | 所有逻辑 |
| 测试用例 | 0.5天 | 所有实现 |

### Phase 3: 集成优化 (2-3天)
| 任务 | 工作量 | 依赖 |
|------|--------|------|
| ICM + Nodelock 联合 | 1天 | Phase 1 & 2 |
| 性能优化 | 0.5天 | 联合完成 |
| 边界条件处理 | 0.5天 | 性能优化 |
| 文档更新 | 0.5天 | 所有优化 |

---

## 六、验证数据来源

所有数据来自以下权威来源：
- **GTO Wizard** (blog.gtowizard.com) - ICM计算、风险溢价
- **GTOLab** (gtolab.com) - 泡沫因子矩阵、ICM策略
- **DeucesCracked** (deucescracked.com) - 四阶段风险溢价模型
- **PokerCoaching** (pokercoaching.com) - Jonathan Little风险溢价表
- **BeyondGTO** (beyondgto.com) - 泡沫策略、节点锁定方法论
- **PLO.com** (plo.com) - 剥削策略、最大剥削方法
- **Postflopizer** (postflopizer.com) - 节点锁定逻辑
- **ICMIZER** (icmizer.com) - ICM计算验证
- **HoldemResources** (holdemresources.net) - ICM计算验证

---

## 七、下一步行动

1. **确认计划**: 用户确认ICM和Nodelock实现计划
2. **创建详细实现计划**: 为每个功能创建更详细的实现步骤
3. **开始实现**: 按照计划逐步实现
4. **验证和测试**: 确保所有功能符合GTO标准
5. **集成和优化**: 与现有系统集成并优化性能
