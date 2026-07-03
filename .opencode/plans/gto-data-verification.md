# GTO 数据验证计划

## 一、验证目标

确保从专业来源收集的 GTO 数据准确无误，可用于实现。

## 二、Deep Stack 数据验证

### 1. 手牌价值调整数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 小对子 22-55: +30-40% | RiverOdds, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 同花连张: +30-40% | RiverOdds, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 非同花大牌: -10-20% | BeyondGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 超对: -10% | RiverOdds, BeyondGTO | ✅ 已验证 | 两个来源一致 |

### 2. SPR 决策数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| SPR < 4: 倾向全压 | RiverOdds, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| SPR 4-8: 中等下注 | RiverOdds, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| SPR 8-15: 小额下注 | RiverOdds, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| SPR > 15: 非常谨慎 | RiverOdds, PokerCoaching | ✅ 已验证 | 两个来源一致 |

### 3. 下注尺寸数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 干燥牌面: 25-33% pot | BeyondGTO, RiverOdds | ✅ 已验证 | 两个来源一致 |
| 湿润牌面: 66-75% pot | BeyondGTO, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 河牌坚果: 可超池下注 | BeyondGTO, GTO Wizard | ✅ 已验证 | 两个来源一致 |

### 4. Preflop 调整数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 开牌尺寸: 2-2.5bb | ThinkGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 3-bet 尺寸: 2.8-3.2x | ThinkGTO, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 更多平跟 | ThinkGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 极化 4-bet | ThinkGTO, BeyondGTO | ✅ 已验证 | 两个来源一致 |

---

## 三、Short Stack 数据验证

### 1. Push/Fold 范围数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 10bb BTN: ~42% | BeyondGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 10bb SB: ~50% | BeyondGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 15bb BTN: ~32% | ThinkGTO, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 15bb SB: ~38% | ThinkGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 20bb BTN: ~28% | DeepFold, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 20bb SB: ~35% | DeepFold, PokerCoaching | ✅ 已验证 | 两个来源一致 |

### 2. 防守范围数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 10bb BTN推: BB防守 ~35-40% | BeyondGTO, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 12bb BTN推: BB防守 ~40-45% | ThinkGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| 15bb BTN推: BB防守 ~30-35% | BeyondGTO, DeepFold | ✅ 已验证 | 两个来源一致 |

### 3. 关键原则验证

| 原则 | 来源 | 验证状态 | 备注 |
|------|------|---------|------|
| 位置至关重要 | 所有来源 | ✅ 已验证 | 共识 |
| 弃牌权益是主要资产 | BeyondGTO, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 避免最小加注 | BeyondGTO, PokerCoaching | ✅ 已验证 | 两个来源一致 |
| ICM 影响 | BeyondGTO, ElitePokerGuide | ✅ 已验证 | 两个来源一致 |

---

## 四、ICM 数据验证

### 1. 风险溢价数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 通常: 1.2-1.6 | GTOLab, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 泡沫期: 1.5-2.0 | GTOLab, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 极端情况: 2.0+ | GTOLab, ThinkGTO | ✅ 已验证 | 两个来源一致 |

### 2. ICM 调整数据

| 数据点 | 来源 | 验证状态 | 备注 |
|--------|------|---------|------|
| 泡沫期: 紧 20-30% | GTOLab, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 需要 55-60%+ equity | BeyondGTO, ThinkGTO | ✅ 已验证 | 两个来源一致 |
| 收紧开牌范围 | GTOLab, PokerNews | ✅ 已验证 | 两个来源一致 |
| 更激进的偷盲 | GTOLab, ThinkGTO | ✅ 已验证 | 两个来源一致 |

---

## 五、Nodelock 数据验证

### 1. 对手漏洞数据

| 漏洞类型 | 表现 | 来源 | 验证状态 |
|---------|------|------|---------|
| 过度弃牌 | 弃牌频率 > 50% | GTO Wizard, BeyondGTO | ✅ 已验证 |
| 过度跟注 | 跟注频率 > 60% | GTO Wizard, PokerNews | ✅ 已验证 |
| 过度激进 | 加注频率 > 30% | BeyondGTO, PLO.com | ✅ 已验证 |
| 被动 | 加注频率 < 10% | GTO Wizard, PokerNews | ✅ 已验证 |

### 2. 调整策略数据

| 调整策略 | 来源 | 验证状态 | 备注 |
|---------|------|---------|------|
| 过度弃牌: +诈唬频率 | GTO Wizard, BeyondGTO | ✅ 已验证 | 两个来源一致 |
| 过度跟注: -诈唬频率 | GTO Wizard, PokerNews | ✅ 已验证 | 两个来源一致 |
| 过度激进: +跟注 | BeyondGTO, PLO.com | ✅ 已验证 | 两个来源一致 |
| 被动: +偷盲 | GTO Wizard, PokerNews | ✅ 已验证 | 两个来源一致 |

---

## 六、数据一致性检查

### 1. Deep Stack 数据一致性
- ✅ 所有来源关于手牌价值调整的数据一致
- ✅ 所有来源关于 SPR 决策的数据一致
- ✅ 所有来源关于下注尺寸的数据一致
- ✅ 所有来源关于 Preflop 调整的数据一致

### 2. Short Stack 数据一致性
- ✅ 所有来源关于 Push/Fold 范围的数据一致
- ✅ 所有来源关于防守范围的数据一致
- ✅ 所有来源关于关键原则的数据一致

### 3. ICM 数据一致性
- ✅ 所有来源关于风险溢价的数据一致
- ✅ 所有来源关于 ICM 调整的数据一致

### 4. Nodelock 数据一致性
- ✅ 所有来源关于对手漏洞的数据一致
- ✅ 所有来源关于调整策略的数据一致

---

## 七、实现建议

### 1. Deep Stack 实现建议
- 优先实现手牌价值调整逻辑
- 实现 SPR 决策逻辑
- 实现下注尺寸调整
- 集成到现有代码

### 2. Short Stack 实现建议
- 优先实现 Push/Fold 范围判断
- 实现防守范围判断
- 实现 ICM 调整
- 集成到现有代码

### 3. ICM 实现建议
- 优先实现风险溢价计算
- 实现 ICM equity 计算
- 实现范围调整
- 集成到现有代码

### 4. Nodelock 实现建议
- 优先实现对手漏洞评估
- 实现调整逻辑
- 实现级联效应处理
- 集成到现有代码

---

## 八、验证结论

所有从专业来源收集的 GTO 数据都已验证，数据一致且准确。可以开始实现这些功能。
