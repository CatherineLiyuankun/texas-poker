import type { Card, Player, GameState, Action } from '../types/poker';
import type { BoardTexture } from './boardTexture';
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
 */
export interface OpponentNodelockProfile {
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
 * 从PlayerStats构建Nodelock画像
 */
export function buildNodelockProfile(stats: PlayerStats): OpponentNodelockProfile {
  const { vpip, pfr, threeBet, foldToCbet, cbet, af, wtsd, handsDealt } = stats;

  // 评估漏洞
  const afValue = af ?? 0;
  const foldToCbetValue = foldToCbet ?? 0;
  const leakType = evaluateLeak(vpip, pfr, foldToCbetValue, afValue);
  const leakMagnitude = calculateLeakMagnitude(leakType, foldToCbet ?? 0, pfr);
  const confidence = calculateConfidence(handsDealt);

  return {
    vpip,
    pfr,
    threeBet: threeBet ?? 0,
    foldToThreeBet: 0, // 默认值，需要从数据中计算
    cBet: cbet ?? 0,
    foldToCbet: foldToCbet ?? 0,
    aggression: af ?? 0,
    wtsd: wtsd ?? 0,
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

  const leakName = leakTypeNames[profile.leakType];
  const adjustmentPercent = (adjustment * 100).toFixed(0);
  const adjustmentDirection = adjustment > 0 ? '增加' : '减少';

  if (profile.leakType === 'neutral') {
    return '无明显漏洞，使用基础策略';
  }

  return `对手${leakName}(${(profile.foldToCbet * 100).toFixed(0)}%)，${adjustmentDirection}调整${adjustmentPercent}%`;
}

/**
 * Nodelock主决策函数
 */
export function getNodelockRecommendation(
  config: NodelockConfig,
  hand: Card[],
  equity: number,
  boardTexture?: BoardTexture,
): NodelockRecommendation {
  const { opponentProfile, baseStrategy, leakThreshold } = config;

  // 验证手牌和牌面数据
  if (hand.length > 0 && !boardTexture) {
    console.warn('Nodelock: 提供了手牌但未提供牌面纹理');
  }

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
