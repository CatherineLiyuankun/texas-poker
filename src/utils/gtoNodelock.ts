import type { Player, GameState, Action } from '../types/poker';
import type { PlayerStats } from './opponentModelUtil';

/**
 * 漏洞类型枚举
 */
export type LeakType =
  | 'overfold'           // 过度弃牌 (弃牌率 > 60%)
  | 'underfold'          // 过度跟注 (跟注率 < 35%)
  | 'overfold_to_bet'    // 面对下注过度弃牌
  | 'underfold_to_bet'   // 面对下注过度跟注
  | 'overaggressive'     // 过度激进 (加注率 > 30%)
  | 'passive'            // 被动 (加注率 < 15%)
  | 'neutral';           // 无明显漏洞

/**
 * 对手Nodelock画像
 *
 * **单位约定**：所有「率」都是 0–1 的比例，**不是** 0–100 的百分数；
 * `aggression` 是 AF 比值，`sampleSize` 是手数。
 * 上游 `PlayerStats`（`opponentModelUtil`）的单位并不统一 —— `vpip` / `pfr` 是比例，
 * 而 `threeBet` / `cbet` / `foldToCbet` / `wtsd` 是百分数（`compute*FromEvents`
 * 一律 `* 100` 后返回，面板表格也直接拼 `%` 渲染）。所以进入本画像前必须由
 * `buildNodelockProfile` 把百分数折成比例：本模块内部（`evaluateLeak` 的 `0.60`、
 * `calculateLeakMagnitude` 的基线 `0.45`、`generateReasoning` 的 `* 100`）
 * 全部按比例处理，混用单位不会报错、只会静默判错。
 */
export interface OpponentNodelockProfile {
  // 基础统计（所有「率」为 0–1 比例）
  vpip: number;                  // 入池率 (VPIP)
  pfr: number;                   // 加注率 (PFR)
  threeBet: number;              // 3-bet 率
  foldToThreeBet: number;        // 面对 3-bet 弃牌率
  cBet: number;                  // 持续下注率 (C-Bet)
  foldToCbet: number;            // 面对 c-bet 弃牌率
  aggression: number;            // 攻击性指数 (AF，比值)
  wtsd: number;                  // 摊牌率 (WtSD)
  msw: number;                   // 大底池获胜率 (W$SD)
  sampleSize: number;            // 样本量

  // 漏洞评估结果
  leakType: LeakType;
  leakMagnitude: number;         // 漏洞幅度 (0-1)
  confidence: number;            // 置信度 (0-1)
}

/**
 * Nodelock推荐接口
 */
export interface NodelockRecommendation {
  action: Action;
  amount?: number;
  sizing?: number;              // 下注尺寸 (% of pot)
  adjustmentType: LeakType;
  adjustmentMagnitude: number;  // 调整幅度 (-0.3 到 +0.3)
  confidence: number;           // 置信度 (0-1)
  reasoning: string;
}

/**
 * Nodelock配置接口
 */
export interface NodelockConfig {
  opponentProfile: OpponentNodelockProfile;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  nodeType: 'bet' | 'raise' | 'call' | 'fold';
  baseStrategy: {
    action: Action;
    sizing?: number;
  };
  leakThreshold: number;         // 漏洞阈值 (默认 0.10 = 10%)
}

/**
 * 百分数 → 比例。`PlayerStats` 里 `threeBet` / `cbet` / `foldToCbet` / `wtsd`
 * 是 0–100，而本模块内部一律按 0–1 处理（详见 `OpponentNodelockProfile` 的单位约定）。
 * 漏掉这一步的后果不是抛错而是静默判错：65% 会被当成 65 读 → 恒判 overfold、
 * 漏洞幅度恒为 1、reasoning 打印出 `4500%`。
 */
function percentToRate(value: number | null | undefined): number {
  return (value ?? 0) / 100;
}

/**
 * 从PlayerStats构建Nodelock画像
 */
export function buildNodelockProfile(stats: PlayerStats): OpponentNodelockProfile {
  const { vpip, pfr, threeBet, foldToCbet, cbet, af, wtsd, handsDealt } = stats;

  // 评估漏洞（注意：这里用的必须是折成比例后的值）
  const afValue = af ?? 0;
  const foldToCbetRate = percentToRate(foldToCbet);
  const leakType = evaluateLeak(vpip, pfr, foldToCbetRate, afValue);
  const leakMagnitude = calculateLeakMagnitude(leakType, foldToCbetRate, pfr);
  const confidence = calculateConfidence(handsDealt);

  return {
    vpip,
    pfr,
    threeBet: percentToRate(threeBet),
    foldToThreeBet: 0, // 默认值，需要从数据中计算
    cBet: percentToRate(cbet),
    foldToCbet: foldToCbetRate,
    aggression: af ?? 0,
    wtsd: percentToRate(wtsd),
    msw: 0, // 默认值，需要从数据中计算
    sampleSize: handsDealt,
    leakType,
    leakMagnitude,
    confidence,
  };
}

/**
 * 评估对手漏洞类型
 */
export function evaluateLeak(
  vpip: number,
  pfr: number,
  foldToCbet: number,
  af: number | null,
): LeakType {
  // 过度激进 (加注率 > 30% 或 攻击性因子 > 2.0)
  if (pfr > 0.30 || (af !== null && af > 2.0)) return 'overaggressive';

  // 被动 (加注率 < 15%)
  if (pfr < 0.15) return 'passive';

  // 过度弃牌 (面对c-bet弃牌率 > 60%)
  if (foldToCbet > 0.60) return 'overfold';

  // 过度跟注 (面对c-bet弃牌率 < 35%)
  if (foldToCbet < 0.35 && foldToCbet > 0) return 'underfold';

  // 使用vpip验证参与率合理性
  if (vpip > 0 && pfr > vpip) return 'overaggressive';

  return 'neutral';
}

/**
 * 计算漏洞幅度
 */
export function calculateLeakMagnitude(
  leakType: LeakType,
  foldToCbet: number,
  pfr: number,
): number {
  switch (leakType) {
    case 'overfold': {
      // 基线45%，实际60%，偏差15%
      const baseline = 0.45;
      const deviation = Math.abs(foldToCbet - baseline) / baseline;
      return Math.min(deviation, 1.0);
    }
    case 'underfold': {
      const baseline = 0.45;
      const deviation = Math.abs(foldToCbet - baseline) / baseline;
      return Math.min(deviation, 1.0);
    }
    case 'overaggressive': {
      const baseline = 0.22;
      const deviation = Math.abs(pfr - baseline) / baseline;
      return Math.min(deviation, 1.0);
    }
    case 'passive': {
      const baseline = 0.22;
      const deviation = Math.abs(pfr - baseline) / baseline;
      return Math.min(deviation, 1.0);
    }
    default:
      return 0;
  }
}

/**
 * 计算置信度
 */
export function calculateConfidence(sampleSize: number): number {
  if (sampleSize >= 500) return 0.95;
  if (sampleSize >= 300) return 0.85;
  if (sampleSize >= 200) return 0.75;
  if (sampleSize >= 100) return 0.65;
  return 0.50;
}

/**
 * 计算调整幅度
 */
export function calculateAdjustment(
  leakType: LeakType,
  leakMagnitude: number,
): number {
  const maxAdjustment = 0.30; // 最大30%调整

  switch (leakType) {
    case 'overfold':
      // 过度弃牌：增加诈唬频率
      return Math.min(leakMagnitude * 0.5, maxAdjustment);
    case 'underfold':
      // 过度跟注：减少诈唬，增加价值下注
      return Math.max(-leakMagnitude * 0.3, -maxAdjustment);
    case 'overaggressive':
      // 过度激进：增加跟注范围
      return Math.min(leakMagnitude * 0.4, maxAdjustment);
    case 'passive':
      // 被动：偷盲和持续下注
      return Math.min(leakMagnitude * 0.4, maxAdjustment);
    default:
      return 0;
  }
}

/**
 * 检查样本量是否足够
 */
export function isSampleSufficient(profile: OpponentNodelockProfile): boolean {
  return profile.sampleSize >= 100;
}

/**
 * 生成推理字符串
 */
function generateReasoning(
  profile: OpponentNodelockProfile,
  adjustment: number,
): string {
  const leakTypeNames: Record<LeakType, string> = {
    overfold: '过度弃牌',
    underfold: '过度跟注',
    overfold_to_bet: '面对下注过度弃牌',
    underfold_to_bet: '面对下注过度跟注',
    overaggressive: '过度激进',
    passive: '被动',
    neutral: '无明显漏洞',
  };

  if (profile.leakType === 'neutral') {
    return '无明显漏洞，使用基础策略';
  }

  const leakName = leakTypeNames[profile.leakType];
  const adjustmentPercent = (adjustment * 100).toFixed(0);
  const adjustmentDirection = adjustment > 0 ? '增加' : '减少';

  // 括号里的数字必须与判据对应，否则会自相矛盾：`evaluateLeak` 判
  // overfold / underfold 看的是面对 c-bet 的弃牌率，判 overaggressive / passive
  // 看的是 PFR。旧实现一律打印 foldToCbet，于是「被动」被渲染成
  // 「对手被动(0%)」—— 0% 是 F/CB，与「被动」毫无关系。
  const basis =
    profile.leakType === 'overfold' || profile.leakType === 'underfold'
      ? `${(profile.foldToCbet * 100).toFixed(0)}%`
      : `PFR ${(profile.pfr * 100).toFixed(0)}%`;

  return `对手${leakName}(${basis})，${adjustmentDirection}调整${adjustmentPercent}%`;
}

/**
 * Nodelock主决策函数
 *
 * 入参只剩「配置 + 权益」：原来的 `hand` / `boardTexture` 两个形参在函数体内
 * 从未被真正使用（只喂给一条 `console.warn`），而那条 warn 的判据
 * `hand.length > 0 && !boardTexture` 在翻前必然成立（翻前本来就没有公共牌），
 * 所以每次调用都会刷一条无意义的告警。两个死形参随告警一并删除。
 */
export function getNodelockRecommendation(
  config: NodelockConfig,
  equity: number,
): NodelockRecommendation {
  const { opponentProfile, baseStrategy, leakThreshold } = config;

  // 检查样本量是否足够
  if (!isSampleSufficient(opponentProfile)) {
    return {
      action: baseStrategy.action,
      sizing: baseStrategy.sizing,
      adjustmentType: 'neutral',
      adjustmentMagnitude: 0,
      confidence: 0.5,
      reasoning: '样本量不足，使用基础策略',
    };
  }

  // 检查漏洞幅度是否超过阈值
  if (opponentProfile.leakMagnitude < leakThreshold) {
    return {
      action: baseStrategy.action,
      sizing: baseStrategy.sizing,
      adjustmentType: 'neutral',
      adjustmentMagnitude: 0,
      confidence: opponentProfile.confidence,
      reasoning: '漏洞幅度不足，使用基础策略',
    };
  }

  // 计算调整幅度
  const adjustmentMagnitude = calculateAdjustment(
    opponentProfile.leakType,
    opponentProfile.leakMagnitude,
  );

  // 根据漏洞类型调整策略
  let adjustedAction = baseStrategy.action;
  let adjustedSizing = baseStrategy.sizing;

  if (opponentProfile.leakType === 'overfold') {
    // 对手过度弃牌：增加诈唬
    if (equity < 0.5) {
      adjustedAction = 'raise';
      adjustedSizing = (baseStrategy.sizing || 0.5) * 1.2;
    }
  } else if (opponentProfile.leakType === 'underfold') {
    // 对手过度跟注：减少诈唬，增加价值下注
    if (equity > 0.7) {
      adjustedAction = 'raise';
      adjustedSizing = (baseStrategy.sizing || 0.5) * 0.8;
    } else {
      adjustedAction = 'check';
    }
  } else if (opponentProfile.leakType === 'overaggressive') {
    // 对手过度激进：增加跟注范围
    if (equity >= 0.4 && equity <= 0.7) {
      adjustedAction = 'call';
    }
  } else if (opponentProfile.leakType === 'passive') {
    // 对手被动：偷盲和持续下注
    if (equity < 0.6) {
      adjustedAction = 'raise';
      adjustedSizing = (baseStrategy.sizing || 0.5) * 1.1;
    }
  }

  return {
    action: adjustedAction,
    sizing: adjustedSizing,
    adjustmentType: opponentProfile.leakType,
    adjustmentMagnitude,
    confidence: opponentProfile.confidence,
    reasoning: generateReasoning(opponentProfile, adjustmentMagnitude),
  };
}

/**
 * 从GameState和玩家数据创建Nodelock配置
 */
export function getNodelockConfig(
  state: GameState,
  player: Player,
  stats: PlayerStats,
): NodelockConfig {
  // 构建对手画像
  const profile = buildNodelockProfile(stats);

  // 确定当前街道
  const street = state.phase as 'preflop' | 'flop' | 'turn' | 'river';

  // 确定节点类型（简化版本）
  const nodeType = state.lastBet > 0 ? 'call' : 'bet';

  // 根据玩家筹码深度调整基础策略
  const bigBlind = state.smallBlind * 2;
  const stackRatio = player.chips / bigBlind;
  const baseSizing = stackRatio > 20 ? 0.5 : stackRatio > 10 ? 0.6 : 0.7;

  return {
    opponentProfile: profile,
    street,
    nodeType,
    baseStrategy: {
      action: 'check',
      sizing: baseSizing,
    },
    leakThreshold: 0.10,
  };
}

/**
 * 面板展示用的入口：给定「谁在决策」+「观察到的某个对手统计」+ 当前权益，
 * 直接产出一条可展示的 nodelock 建议；样本量不足（< 100 手）时返回 `null`，
 * 面板据此整块隐藏，而不是显示一个「样本量不足」的空壳。
 *
 * 之所以要这一层：`getNodelockConfig` + `getNodelockRecommendation` 两步调用
 * 里的「样本是否够」判断是调用方容易漏掉的，收敛到一处就不会出现
 * 「配置里判了一次、渲染时又判一次」的分叉。
 */
export function getNodelockForOpponent(
  state: GameState,
  player: Player,
  stats: PlayerStats,
  equity: number,
): NodelockRecommendation | null {
  const config = getNodelockConfig(state, player, stats);
  if (!isSampleSufficient(config.opponentProfile)) return null;
  return getNodelockRecommendation(config, equity);
}
