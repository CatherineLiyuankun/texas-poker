import React, { useMemo, useState, useEffect } from 'react';
import type { Card, GamePhase, PlayerId, GameState, Player } from '../types/poker';
import { HAND_RANK_NAMES } from '../types/poker';
import { getPreflopStrength, getPreflopTier } from '../utils/preflopHandStrength';
import { detectDraws, type DrawInfo } from '../utils/drawDetector';
import { calculateEquity } from '../utils/equityCalculator';
import { estimateOpponentCombos, currentHandEventSignature } from '../utils/rangeEquity';
import { evaluateHand } from '../utils/handEvaluator';
import { translations } from '../utils/translations';
import type { OpponentProfile, BotStatsWithAF } from '../utils/opponentModel';
import type { PlayerLongStats } from '../utils/longOpponentModel';
import {
  getGtoPostflopRecommendation,
  analyzeBoardWithEquity,
  type GtoPostflopRecommendation,
} from '../utils/gtoPostflop';
import type { NodelockRecommendation, LeakType } from '../utils/gtoNodelock';
import { SMALL_BLIND } from '../utils/constant';
import {
  calculateValueBluffRatio,
  calculateCallEV,
  raiseEVFromContext,
  calculateRequiredFoldEquity,
  classifyRange,
  mdfFrom,
  type RangeCategory,
} from '../utils/gtoMath';
import { canOpenFromPosition } from '../utils/preflopOpenRanges';
import { getCommunityByPhase, getCardsToCome } from '../utils/communityByPhase';

interface HandAnalysisProps {
  holeCards: Card[];
  communityCards: Card[];
  phase: GamePhase;
  numOpponents: number;
  potOdds: number;
  currentPot?: number;
  betToCall?: number;
  spr?: number;
  playerRaiseAmount?: number | null;
  gtoRecommendation?: {
    action: string;
    sizingBB?: number;
    freq?: { r: number; c: number; f: number };
    isAllIn?: boolean;
  } | null;
  nodelockRecommendation?: NodelockRecommendation | null;
  opponentProfile?: OpponentProfile;
  longStats?: PlayerLongStats[];
  viewingPlayerId?: PlayerId;
  realPlayerSessionStats?: BotStatsWithAF[];
  positionLabel?: string;
  /** 完整对局状态，用于推断对手继续范围（范围权益） */
  gameState?: GameState;
  /** 当前面板所属的真人玩家对象 */
  heroPlayer?: Player;
}

// 建议逻辑：仅基于胜率（0–1 概率）+ 赔率
// Monte Carlo 胜率已包含听牌概率，不再单独叠加
function getRecommendation(
  equity: number,
  potOdds: number,
  phase: GamePhase,
): string {
  const { rec } = translations.handAnalysis;
  if (potOdds <= 0) {
    // 无注可跟：明显领先就下注，否则过牌
    return equity >= 0.6 ? rec.raise : rec.check;
  }
  if (phase === 'preflop') {
    // 翻前多路底池的权益会被稀释（AA 对 8 人随机牌也只有约 33%），
    // 因此用相对赔率的阈值，而非绝对胜率阈值。
    if (equity >= potOdds + 0.35) return rec.raise;
    if (equity >= potOdds + 0.15) return rec.callRaise;
    if (equity >= potOdds) return rec.call;
    if (potOdds < 0.1) return rec.callCheap;
    return rec.fold;
  }
  if (equity >= 0.7) return rec.raise;
  if (equity >= 0.55) return rec.callRaise;
  if (equity >= potOdds + 0.05) return rec.call;
  if (potOdds < 0.1) return rec.callCheap;
  return rec.fold;
}

function drawLabel(type: string): string {
  const { draws } = translations.handAnalysis;
  const map: Record<string, string> = {
    flush_draw: draws.flushDraw,
    open_ended_straight: draws.openEndedStraight,
    gutshot: draws.gutshot,
  };
  return map[type] || type;
}

function getRecColor(rec: string): string {
  if (rec.includes('Raise')) return 'text-green-400';
  if (rec.includes('Call')) return 'text-blue-400';
  if (rec.includes('Check')) return 'text-yellow-400';
  if (rec.includes('Fold')) return 'text-red-400';
  return 'text-white';
}


function getPlayerTypeColor(playerType: string): string {
  switch (playerType) {
    case 'TAG': return 'text-green-400';
    case 'LAG': return 'text-orange-400';
    case 'Nit': return 'text-blue-400';
    case 'Calling Station': return 'text-red-400';
    case 'Maniac': return 'text-purple-400';
    case 'Others': return 'text-white';
    default: return 'text-white/50';
  }
}

function getVpipColor(v: number): string {
  if (v <= 20) return 'text-red-400';
  if (v <= 28) return 'text-orange-400';
  if (v <= 35) return 'text-green-400';
  return 'text-blue-400';
}

function getPfrColor(v: number): string {
  if (v <= 17) return 'text-blue-400';
  if (v <= 25) return 'text-green-400';
  if (v <= 30) return 'text-orange-400';
  return 'text-purple-400';
}

function getAfColor(v: number): string {
  if (v < 1) return 'text-blue-400';
  if (v <= 1.5) return 'text-green-400';
  if (v <= 2.5) return 'text-orange-400';
  if (v <= 3) return 'text-red-400';
  return 'text-purple-400';
}

function getCbetColor(v: number): string {
  if (v < 30) return 'text-blue-400';
  if (v <= 55) return 'text-green-400';
  if (v <= 77) return 'text-yellow-400';
  return 'text-red-400';
}

function getWtsdColor(v: number): string {
  if (v < 24) return 'text-red-400';
  if (v <= 26) return 'text-orange-400';
  if (v <= 32) return 'text-green-400';
  if (v <= 38) return 'text-blue-400';
  return 'text-purple-400';
}

function getCrColor(v: number): string {
  if (v <= 4) return 'text-blue-400';
  if (v <= 9) return 'text-green-400';
  if (v <= 11) return 'text-orange-400';
  if (v <= 18) return 'text-orange-400';
  return 'text-red-400';
}

function getWsdColor(v: number): string {
  if (v < 46) return 'text-red-400';
  if (v < 48) return 'text-orange-400';
  if (v <= 54) return 'text-green-400';
  return 'text-blue-400';
}

function get3BetColor(v: number): string {
  if (v < 5) return 'text-blue-400';
  if (v <= 10) return 'text-green-400';
  if (v <= 12) return 'text-orange-400';
  return 'text-red-400';
}

function getFoldToCbetColor(v: number): string {
  if (v < 40) return 'text-red-400';
  if (v <= 60) return 'text-green-400';
  return 'text-blue-400';
}

function getAFqColor(v: number): string {
  if (v < 35) return 'text-blue-400';
  if (v <= 55) return 'text-green-400';
  return 'text-red-400';
}

function getTurnCbetColor(v: number): string {
  if (v < 40) return 'text-blue-400';
  if (v <= 65) return 'text-green-400';
  return 'text-red-400';
}

function getGtoActionLabel(
  action: string,
  sizingBB?: number,
  freq?: { r: number; c: number; f: number },
  isAllIn?: boolean,
): React.ReactNode {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const isMixed = freq !== undefined &&
    [freq.r, freq.c, freq.f].filter((v) => v > 0).length > 1;

  const mainLabel = action === 'R'
    ? (isAllIn
      ? (sizingBB ? `All-in ${sizingBB.toFixed(0)}BB` : 'All-in')
      : (sizingBB ? `Raise ${sizingBB.toFixed(1)}BB` : 'Raise'))
    : action === 'C' ? 'Call' : 'Fold';

  if (!freq || !isMixed) return mainLabel;

  const parts: string[] = [];
  if (action === 'R' && freq.r < 1) parts.push(`${pct(freq.r)}`);
  if (action === 'C' && freq.c < 1) parts.push(`${pct(freq.c)}`);
  if (action === 'F' && freq.f < 1) parts.push(`${pct(freq.f)}`);

  const secondaries: string[] = [];
  if (freq.r > 0 && action !== 'R') secondaries.push(`R${pct(freq.r)}`);
  if (freq.c > 0 && action !== 'C') secondaries.push(`C${pct(freq.c)}`);
  if (freq.f > 0 && action !== 'F') secondaries.push(`F${pct(freq.f)}`);

  if (secondaries.length > 0) {
    return `${mainLabel} ${parts.join('')} / ${secondaries.join(' ')}`;
  }
  return parts.length > 0 ? `${mainLabel} ${parts.join('')}` : mainLabel;
}

function getGtoActionColor(action: string): string {
  if (action === 'R') return 'text-green-400';
  if (action === 'C') return 'text-blue-400';
  if (action === 'check') return 'text-yellow-400';
  if (action === 'F') return 'text-red-400';
  return 'text-white';
}

function getOutsColor(outs: number): string {
  if (outs <= 4) return 'text-yellow-400';
  if (outs <= 8) return 'text-orange-400';
  if (outs <= 9) return 'text-red-400';
  return 'text-green-400';
}

function getSprColor(v: number): string {
  if (v < 3) return 'text-red-400';
  if (v <= 6) return 'text-yellow-400';
  return 'text-green-400';
}

function getSprLabel(v: number): string {
  const { sprShallow, sprMedium, sprDeep } = translations.handAnalysis;
  if (v < 3) return sprShallow;
  if (v <= 6) return sprMedium;
  return sprDeep;
}

function getSprBarColor(v: number): string {
  if (v < 3) return 'bg-red-400';
  if (v <= 6) return 'bg-yellow-400';
  return 'bg-green-400';
}

function getPreflopStrengthBarColor(v: number): string {
  if (v >= 10) return 'bg-red-400';
  if (v >= 7) return 'bg-orange-400';
  if (v >= 4) return 'bg-green-400';
  return 'bg-purple-400';
}

function getPreflopTierColor(v: number): string {
  if (v === 1) return 'text-red-400';
  if (v === 2) return 'text-orange-400';
  if (v === 3) return 'text-amber-500';
  if (v === 4) return 'text-green-400';
  if (v === 5) return 'text-blue-400';
  if (v === 6) return 'text-purple-400';
  return 'text-white-400';
}

function getEquityBarColor(equity: number | null): string {
  if (equity === null) return 'bg-gray-400';
  return equity >= 0.6
    ? 'bg-green-400'
    : equity >= 0.4
      ? 'bg-yellow-400'
      : 'bg-red-400';
}

function getEquityTextColor(equity: number | null): string {
  if (equity === null) return 'text-white';
  return equity >= 0.6
    ? 'text-green-400'
    : equity >= 0.4
      ? 'text-yellow-400'
      : 'text-red-400';
}

function getCurrentHandRankColor(rank: string): string {
  if (rank === 'high_card') return 'text-white/50';
  if (rank === 'pair') return 'text-blue-400';
  if (rank === 'two_pair') return 'text-green-400';
  if (rank === 'three_of_a_kind') return 'text-yellow-400';
  if (rank === 'straight') return 'text-orange-400';
  if (rank === 'flush') return 'text-red-400';
  if (rank === 'full_house') return 'text-purple-400';
  if (rank === 'four_of_a_kind') return 'text-pink-400';
  if (rank === 'straight_flush') return 'text-rose-400';
  return 'text-white/50';
}

function getLeakTypeLabel(leakType: LeakType): string {
  const { leakTypes } = translations.nodelock;
  return leakTypes[leakType] || leakType;
}

function getLeakTypeColor(leakType: LeakType): string {
  switch (leakType) {
    case 'overfold': return 'text-orange-400';
    case 'underfold': return 'text-blue-400';
    case 'overaggressive': return 'text-red-400';
    case 'passive': return 'text-green-400';
    case 'neutral': return 'text-white/50';
    default: return 'text-white/50';
  }
}

function getPotOddsColor(odds: number | null): string {
  if (odds === null) return 'text-white';
  if (odds <= 0.10) return 'text-green-400';
  if (odds <= 0.25) return 'text-yellow-400';
  return 'text-red-400';
}

// MDF 分档阈值。MDF = 下注前底池 / 含注底池，所以阈值直接对应标准下注尺度：
//   ≥ 2/3（对手下注 ≤ 半个底池）→ 绿：防守大部分范围
//   ≥ 1/2（半个到一个底池）      → 黄：常规
//   < 1/2（超过一个底池）        → 红：可以弃掉较多范围
// 用精确分数而非 0.67，是为了让「半个底池」这个最常用的注码正好落在绿档
// （MDF 恰为 2/3），数字与颜色条必须共用同一组阈值。
const MDF_GREEN_THRESHOLD = 2 / 3;
const MDF_YELLOW_THRESHOLD = 1 / 2;

function getMDFColor(mdf: number): string {
  if (mdf >= MDF_GREEN_THRESHOLD) return 'text-green-400';
  if (mdf >= MDF_YELLOW_THRESHOLD) return 'text-yellow-400';
  return 'text-red-400';
}

function getMDFBarColor(mdf: number): string {
  if (mdf >= MDF_GREEN_THRESHOLD) return 'bg-green-400';
  if (mdf >= MDF_YELLOW_THRESHOLD) return 'bg-yellow-400';
  return 'bg-red-400';
}

function getEVColor(ev: number): string {
  if (ev > 0) return 'text-green-400';
  if (ev < 0) return 'text-red-400';
  return 'text-yellow-400';
}

function getRangeCategoryColor(cat: RangeCategory): string {
  switch (cat) {
    case 'value': return 'text-green-400';
    case 'bluff_catcher': return 'text-yellow-400';
    case 'bluff': return 'text-orange-400';
    case 'fold': return 'text-red-400';
  }
}

function getRangeCategoryLabel(cat: RangeCategory): string {
  const { rangeCategories } = translations.gtoMath;
  switch (cat) {
    case 'value': return rangeCategories.value;
    case 'bluff_catcher': return rangeCategories.bluffCatcher;
    case 'bluff': return rangeCategories.bluff;
    case 'fold': return rangeCategories.fold;
  }
}

function getRangeCategoryEmoji(cat: RangeCategory): string {
  switch (cat) {
    case 'value': return '🟢';
    case 'bluff_catcher': return '🟡';
    case 'bluff': return '🟠';
    case 'fold': return '🔴';
  }
}

/**
 * 口径行里的对手数说明。`numOpponents` 来自「未弃牌的对手数」，
 * 全员弃牌时是 0 —— 此时既不是单挑也不是多人，不能落进 `<= 1` 的单挑分支。
 */
function opponentsCaveat(numOpponents: number): string {
  const { headsUp, multiway, noOpponent } = translations.gtoMath.caveat;
  if (numOpponents <= 0) return noOpponent;
  if (numOpponents === 1) return headsUp;
  return multiway(numOpponents);
}

// 蒙特卡洛迭代次数：翻前要模拟 5 张公共牌，成本最高；单次模拟成本随对手数
// 近似线性增长，因此多人底池自动下调迭代数，保证面板不卡顿。
const EQUITY_ITERATIONS: Record<string, number> = {
  preflop: 400,
  flop: 350,
  turn: 300,
  river: 300,
};

function equityIterations(phase: GamePhase, numOpponents: number): number {
  const base = EQUITY_ITERATIONS[phase] ?? 300;
  const trimmed = Math.round(base * (2 / Math.max(2, numOpponents)));
  return Math.min(base, Math.max(120, trimmed));
}

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-10 h-1.5 bg-white/20 rounded-full overflow-hidden inline-block ml-1 align-middle">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/70">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

function GridRow({
  label,
  value,
  color = 'text-white',
  highlight = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  color?: string;
  /** 判定依据所在行加绿色边框，让用户一眼看出建议是按哪个权益算的 */
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1 ${
        highlight ? 'border border-green-400/80 rounded' : ''
      }`}
    >
      <span className="text-white/60">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}

export const HandAnalysis: React.FC<HandAnalysisProps> = ({
  holeCards,
  communityCards,
  phase,
  numOpponents,
  potOdds,
  currentPot,
  betToCall,
  spr,
  playerRaiseAmount,
  gtoRecommendation,
  nodelockRecommendation,
  opponentProfile,
  longStats,
  viewingPlayerId,
  realPlayerSessionStats,
  positionLabel,
  gameState,
  heroPlayer,
}) => {
  const [randomEquity, setRandomEquity] = useState<number | null>(null);
  const [rangeEquity, setRangeEquity] = useState<number | null>(null);
  // 范围权益的附加状态：
  // applied —— 本轮是否真的推断出了范围（否则 rangeEquity 回退成随机值，
  //            此时「建议」的依据其实是随机权益，面板要据此高亮对应行）；
  // narrowed / exploited —— 是否按翻后行动收窄、是否叠加了对手激进度剥削调整
  const [rangeFlags, setRangeFlags] = useState({
    applied: false,
    narrowed: false,
    exploited: false,
  });

  // getCommunityByPhase 会 slice 出新数组，这里按引用缓存，
  // 避免每次渲染都重新触发蒙特卡洛模拟。
  const community = useMemo(
    () => getCommunityByPhase(communityCards, phase),
    [communityCards, phase],
  );
  const cardsToCome = getCardsToCome(phase);

  const preflopStrength = useMemo(
    () => (phase === 'preflop' ? getPreflopStrength(holeCards) : null),
    [holeCards, phase],
  );

  const preflopTier = useMemo(
    () => (phase === 'preflop' ? getPreflopTier(holeCards) : null),
    [holeCards, phase],
  );

  const canOpen = useMemo(
    () =>
      phase === 'preflop' && positionLabel
        ? canOpenFromPosition(holeCards, positionLabel)
        : null,
    [holeCards, phase, positionLabel],
  );

  // 听牌检测：仅用于展示，不叠加到胜率
  const drawInfo: DrawInfo | null = useMemo(() => {
    if (phase === 'preflop' || phase === 'showdown' || phase === 'ended')
      return null;
    if (community.length < 3) return null;
    return detectDraws(holeCards, community, cardsToCome);
  }, [holeCards, community, cardsToCome, phase]);

  const currentHandRank = useMemo(() => {
    if (phase === 'preflop' || phase === 'showdown' || phase === 'ended')
      return null;
    if (community.length < 3 || holeCards.length < 2) return null;
    return evaluateHand(holeCards, community).rank;
  }, [holeCards, community, phase]);

  // 牌面纹理：与上面的听牌、牌型共用同一个「按街切好」的 community，
  // 不能把还没发出的转牌/河牌算进当前街的牌面判断。
  const boardTexture = useMemo(
    () => (community.length >= 3 ? analyzeBoardWithEquity(community) : null),
    [community],
  );

  // 翻牌前同样走真实蒙特卡洛（模拟补齐 5 张公共牌），不再用 Chen 分数代替
  const shouldCalculate = useMemo(
    () =>
      phase !== 'showdown' &&
      phase !== 'ended' &&
      holeCards.length >= 2,
    [phase, holeCards],
  );

  // 对手的下注/弃牌会改变可推断的继续范围，用它作为额外依赖触发重算。
  // 事件签名必须一起折叠进来：同一街上双方连续过牌时 lastBet / totalBet /
  // chips 全都不变，只看 state 会漏掉这次行动。
  const rangeSignature = useMemo(() => {
    if (!gameState) return 'none';
    return [
      gameState.dealer,
      gameState.phase,
      gameState.lastBet,
      ...gameState.players.map(
        (p) => `${p.id}:${p.folded ? 'F' : 'A'}:${p.totalBet}:${p.chips}`,
      ),
      currentHandEventSignature(),
    ].join('|');
  }, [gameState]);

  useEffect(() => {
    if (!shouldCalculate) {
      setRandomEquity(null);
      setRangeEquity(null);
      setRangeFlags({ applied: false, narrowed: false, exploited: false });
      return;
    }

    const iterations = equityIterations(phase, numOpponents);
    const timer = setTimeout(() => {
      // 随机权益：所有对手都按随机牌建模
      const random = calculateEquity(
        holeCards, community, numOpponents, iterations,
      );
      setRandomEquity(random);

      // 范围权益：主要对手按推断出的继续范围建模，且该范围会随翻后行动收窄；
      // 无法推断范围时退化为随机权益（与上一行同一个数）。
      const range =
        heroPlayer && gameState
          ? estimateOpponentCombos(heroPlayer, gameState, community)
          : null;
      setRangeEquity(
        range
          ? calculateEquity(holeCards, community, numOpponents, iterations, {
            weightedCombos: range.combos,
          })
          : random,
      );
      setRangeFlags({
        applied: range !== null,
        narrowed: range?.narrowedByPostflop ?? false,
        exploited: range?.exploitationApplied ?? false,
      });
    }, 50);
    return () => clearTimeout(timer);
    // gameState 中影响范围推断的字段已折叠进 rangeSignature；
    // heroPlayer 在同一手牌内保持稳定，故不单独作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeCards, community, numOpponents, shouldCalculate, phase, rangeSignature]);

  // 蒙特卡洛胜率已包含听牌概率，直接使用。
  // 决策以范围权益为准（更接近真实对手），无法推断范围时等同随机权益。
  const decisionEquity = rangeEquity ?? randomEquity;

  // 「建议」实际依据的是哪一个权益。
  // 注意不能只看 rangeEquity 是否为 null —— 推断失败时它会被赋成随机值，
  // 必须用 rangeFlags.applied 才能区分「真的用了范围」与「回退到随机」。
  const decisionBasis: 'range' | 'random' | null =
    randomEquity === null || rangeEquity === null
      ? null
      : rangeFlags.applied
        ? 'range'
        : 'random';

  const recommendation = useMemo(() => {
    if (decisionEquity === null) return '';
    return getRecommendation(decisionEquity, potOdds, phase);
  }, [decisionEquity, potOdds, phase]);

  // 翻后 GTO 建议（面板「Board 牌面 / Action / Reasoning」三行）。
  //
  // 这里必须用 decisionEquity —— 它就是「范围权益」那一行显示的值（推断失败时
  // 是随机权益），这样 Reasoning 里的 Equity 与面板权益行是同一个数，不会再出现
  // 「Reasoning 说 16.7%、面板却显示 29%」这种同屏矛盾。
  //
  // boardTexture / drawInfo / currentHandRank 也都基于按街切好的 community，
  // 不会把尚未发出的转牌、河牌算进当前街的判断。
  //
  // 权益还在算（effect 有 50ms 防抖）时返回 null，整块延后渲染，
  // 避免短暂的「建议已更新、权益还是上一手」的同屏矛盾。
  const postflopRecommendation = useMemo<GtoPostflopRecommendation | null>(() => {
    if (phase === 'preflop' || phase === 'showdown' || phase === 'ended')
      return null;
    if (community.length < 3 || holeCards.length < 2) return null;
    if (!boardTexture || !heroPlayer) return null;
    if (decisionEquity === null) return null;

    const totalPlayers = gameState?.players.length ?? numOpponents + 1;
    const position = gameState
      ? (heroPlayer.id - gameState.dealer + totalPlayers) % totalPlayers
      : 0;

    return getGtoPostflopRecommendation({
      hand: holeCards,
      communityCards: community,
      phase,
      equity: decisionEquity,
      potOdds,
      // 与面板 SPR 行同口径：有效筹码 / 底池
      spr: spr ?? 999,
      position,
      totalPlayers,
      numOpponents,
      isButton: position === 0,
      isCutoff: position === totalPlayers - 1 && position > 2,
      isHijack: position === totalPlayers - 2 && position > 2,
      boardTexture,
      handRank: currentHandRank,
      draws: drawInfo,
      toCall: betToCall ?? 0,
      totalPot: currentPot ?? 0,
      smallBlind: gameState?.smallBlind ?? SMALL_BLIND,
      chips: heroPlayer.chips,
      playerBet: heroPlayer.bet,
      lastRaiseBet: gameState?.lastRaiseBet ?? 0,
    });
  }, [
    phase, community, holeCards, boardTexture, decisionEquity, potOdds, spr,
    numOpponents, currentHandRank, drawInfo, betToCall, currentPot, gameState,
    heroPlayer,
  ]);

  // GTO Math calculations
  const gtoMath = useMemo(() => {
    const pot = currentPot ?? 0;
    const bet = betToCall ?? 0;
    const eq = decisionEquity ?? 0;
    const raiseTo = playerRaiseAmount ?? 0;
    const heroBet = heroPlayer?.bet ?? 0;

    // 口径：gtoMath 的比率函数（MDF / V:B / 所需弃牌率）一律吃
    // 「下注前底池 + 本次投入增量」，而 currentPot 是**含注底池**。
    // - 面对对手下注：描述对手那一注 → 下注前底池 = 含注底池 − 跟注额
    // - 我方下注/加注：下注前底池 = 含注底池 − 我方本轮已投入
    //   增量 = 加注框的 raise-to 总额 − 我方本轮已投入
    // 直接把含注底池当分母会把半池算成 0.75、满池算成 0.667（正确为 0.667 / 0.5）。
    const facingPotBefore = Math.max(0, pot - bet);

    // 加注 EV 的换算（含注底池 → 下注前底池 + 增量 + toCall）收敛在
    // gtoMath.raiseEVFromContext 里，顺带取回 heroPotBefore / heroIncrement
    // 供 V:B 复用，避免同一套换算在面板里写两遍。
    const raiseEv = raiseEVFromContext({
      equity: eq,
      totalPot: pot,
      heroBet,
      raiseTo,
      toCall: bet,
    });
    const { heroPotBefore, heroIncrement } = raiseEv;

    // MDF: only when facing a bet.
    const mdf = bet > 0 && facingPotBefore > 0 ? mdfFrom(pot, bet) : null;

    // V:B 与牌力分类共用同一组「注码 + 下注前底池」：优先描述对手那一注。
    const facingBet = bet > 0;
    const refBet = facingBet ? bet : heroIncrement;
    const refPotBefore = facingBet ? facingPotBefore : heroPotBefore;

    const vbRatio = refBet > 0 && refPotBefore > 0
      ? calculateValueBluffRatio(refBet, refPotBefore)
      : null;

    // EV calculations
    const callEV = bet > 0 ? calculateCallEV(eq, pot, bet) : null;

    // Raise EV：弃牌率由「1 − MDF」推出（GTO 对手按 MDF 防守），
    // 不再手写 `0.3 + (尺度 − 50) × 0.005` 的线性模型。
    // 换算已收敛在 raiseEVFromContext；toCall 让对手跟注只补「加注增量 − 已投入」，
    // 不再按「对称下注」把对手那一注多算一份。
    const raiseEV = raiseEv.raiseEV;

    // Select best action
    let bestAction: 'call' | 'fold' | 'check' | 'raise' = 'check';
    let bestEV = 0;

    if (raiseEV !== null && raiseEV > bestEV) {
      bestAction = 'raise';
      bestEV = raiseEV;
    }
    if (callEV !== null && callEV > bestEV) {
      bestAction = 'call';
      bestEV = callEV;
    }
    if (bestEV <= 0 && callEV !== null) {
      bestAction = 'fold';
      bestEV = 0;
    }

    // Range classification
    const rangeCat = eq > 0
      ? classifyRange(eq, refBet, refPotBefore, phase)
      : null;

    return { mdf, vbRatio, callEV, raiseEV, bestAction, bestEV, rangeCat, vbSource: facingBet ? 'facing' : 'hero' };
  }, [decisionEquity, currentPot, betToCall, playerRaiseAmount, phase, heroPlayer]);

  // GTO Math 区块的口径说明：这些数是单街闭式 + 单挑推导，未计抽水与 ICM。
  // 显式标出来，避免把近似值误读成完整 GTO 解。
  const gtoMathCaveat = useMemo(() => {
    const street = translations.gtoMath.caveat.street[phase];
    return [street, opponentsCaveat(numOpponents), translations.gtoMath.caveat.noIcm].join(' · ');
  }, [phase, numOpponents]);

  // 底池赔率行恒为「跟注赔率」，与机器人 ctx.potOdds 同口径。
  // 没有跟注额（可以免费过牌）时无意义，显示为 —。
  const callPotOdds = potOdds > 0 ? potOdds : null;

  // 我方下注/加注的「所需弃牌率」= 追加筹码 / (下注前底池 + 追加筹码)。
  // 这是与跟注赔率不同的量：衡量我的下注需要对手多频繁弃牌才划算，
  // 只在加注框有值时显示，且不参与 getRecommendation。
  const betRequiredFold = useMemo(() => {
    if (!playerRaiseAmount || playerRaiseAmount <= 0) return null;
    const heroBet = heroPlayer?.bet ?? 0;
    const betSize = playerRaiseAmount - heroBet; // 加注框填的是 raise-to 总额
    const potBeforeHeroBet = (currentPot ?? 0) - heroBet;
    if (betSize <= 0 || potBeforeHeroBet <= 0) return null;
    return calculateRequiredFoldEquity(betSize, potBeforeHeroBet);
  }, [playerRaiseAmount, heroPlayer, currentPot]);

  // 「建议」按 decisionBasis 对应的那一行权益算出来，该行加绿色边框标出
  // （见下方两个权益 GridRow 的 highlight），避免用户拿另一行的权益去比赔率
  // 得出相反结论时误以为面板算错。

  return (
    <div className="w-54 bg-black/50 rounded-lg p-2 text-[10px] space-y-1 border border-white/10">
      <div className="text-white/50 font-medium text-center mb-1 tracking-wide text-[12px]">
        {translations.handAnalysis.aiTitle}
      </div>
      {/* preflop: 手牌评估 Chen Formula + Tier 1-6 */}
      {phase === 'preflop' && preflopStrength !== null && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {/* Left column: Chen Formula  */}
          <GridRow
            label={translations.handAnalysis.preflop}
            value={
              <>
                {preflopStrength}
                <StrengthBar
                  value={preflopStrength / 20}
                  color={getPreflopStrengthBarColor(preflopStrength)}
                />
              </>
            }
          />
          {/* Right column: Tier */}
          <GridRow
            label={translations.handAnalysis.tier}
            value={
              <>
                {preflopTier} — {translations.handAnalysis.tierNames[preflopTier ?? 0]} {canOpen !== null ? (canOpen ? '✅' : '❌') : ''}
              </>
            }
            color={getPreflopTierColor(preflopTier ?? 0)}
          />
        </div>
      )}

      {/* SPR (独立计算) + Current hand (需要 community cards) */}
      <div className="border-t border-white/10 pt-1 mt-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {/* Left column: SPR */}
          {spr !== undefined && spr > 0 && (
            <GridRow
              label={translations.handAnalysis.spr}
              value={
                <>
                  {spr.toFixed(1)}
                  <StrengthBar
                    value={Math.min(spr / 12, 1)}
                    color={getSprBarColor(spr)}
                  />
                  <span className={`ml-1 text-[9px] ${getSprColor(spr)}`}>
                    {getSprLabel(spr)}
                  </span>
                </>
              }
              color={getSprColor(spr)}
            />
          )}

          {/* Right column: Current hand */}
          <GridRow
            label={translations.handAnalysis.currentHand}
            value={shouldCalculate && currentHandRank ? HAND_RANK_NAMES[currentHandRank] : '...'}
            color={getCurrentHandRankColor(currentHandRank ?? '')}
          />
        </div>
      </div>

      {/* Win rate + Pod odds + Action */}
      {<div className="border-t border-white/10 pt-1 mt-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {/* 随机权益：所有对手都按随机牌建模 */}
          <GridRow
            label={translations.handAnalysis.equity}
            highlight={decisionBasis === 'random'}
            value={
              randomEquity !== null ? (
                <>
                  {(randomEquity * 100).toFixed(0)}%
                  <StrengthBar
                    value={randomEquity}
                    color={getEquityBarColor(randomEquity)}
                  />
                </>
              ) : (
                <span className="text-yellow-400 animate-pulse">...</span>
              )
            }
          />

          {/* 范围权益：主要对手按推断的继续范围建模（决策依据） */}
          <GridRow
            label={translations.handAnalysis.rangeEquity}
            highlight={decisionBasis === 'range'}
            value={
              rangeEquity !== null ? (
                <>
                  {(rangeEquity * 100).toFixed(0)}%
                  <StrengthBar
                    value={rangeEquity}
                    color={getEquityBarColor(rangeEquity)}
                  />

                  {/* 范围权益的口径说明：收窄 / 剥削性调整时显式标注，避免误读为纯 GTO 范围 */}
                  {(rangeFlags.narrowed || rangeFlags.exploited) && (
                    <div className="col-span-2 text-[10px] leading-tight text-gray-400">
                      {rangeFlags.narrowed && (
                        <span>{translations.handAnalysis.rangeNarrowed}</span>
                      )}
                      {rangeFlags.narrowed && rangeFlags.exploited && <span> · </span>}
                      {rangeFlags.exploited && (
                        <span>{translations.handAnalysis.rangeExploitative}</span>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-yellow-400 animate-pulse">...</span>
              )
            }
            color={getEquityTextColor(rangeEquity)}
          />

          {/* 底池赔率：恒为跟注赔率，与机器人决策同口径 */}
          <GridRow
            label={translations.handAnalysis.potOdds}
            value={callPotOdds !== null ? `${(callPotOdds * 100).toFixed(0)}%` : '—'}
            color={getPotOddsColor(callPotOdds)}
          />

          {/* 胜率 vs 赔率 → 建议 */}
          <div className="justify-self-end">
            <GridRow
              label={' '}
              value={recommendation}
              color={getRecColor(recommendation)}
            />
          </div>

          {/* 我方下注的所需弃牌率：与跟注赔率是两个不同的量，只在加注框有值时出现 */}
          {betRequiredFold !== null && (
            <div className="col-span-2">
              <GridRow
                label={translations.handAnalysis.betRequiredFold}
                value={`${(betRequiredFold * 100).toFixed(0)}%`}
                color={getPotOddsColor(betRequiredFold)}
              />
            </div>
          )}
        </div>
      </div>}

      {/* GTO preflop Action Recommendation */}
      {phase === 'preflop' && gtoRecommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <Row
            label={translations.handAnalysis.gto}
            value={
              <span className="text-[10px]">
                {getGtoActionLabel(
                  gtoRecommendation.action,
                  gtoRecommendation.sizingBB,
                  gtoRecommendation.freq,
                  gtoRecommendation.isAllIn,
                )}
              </span>
            }
            color={getGtoActionColor(gtoRecommendation.action)}
          />
        </div>
      )}

      {/* Draws: only when draws exist 听牌牌型*/}
      {drawInfo && drawInfo.draws.length > 0 && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {drawInfo.draws.map((d, i) => (
              <GridRow
                key={i}
                label={drawLabel(d.type)}
                value={`${d.outs} outs`}
                color={getOutsColor(d.outs)}
              />
            ))}
          </div>
        </div>
      )}

      {/* GTO postflop 牌面纹理 + Action */}
      {postflopRecommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="grid grid-cols-[3fr_2fr] gap-x-2 gap-y-1">
            {/* Left column: Board texture */}
            <GridRow
              label={translations.gtoPostflop.board}
              value={
                <span className={`text-[10px] ${
                  postflopRecommendation.boardTexture.classification === 'very_dry' || postflopRecommendation.boardTexture.classification === 'dry'
                    ? 'text-blue-400'
                    : postflopRecommendation.boardTexture.classification === 'medium'
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}>
                  {({
                    very_dry: translations.gtoPostflop.veryDry,
                    dry: translations.gtoPostflop.dry,
                    medium: translations.gtoPostflop.medium,
                    wet: translations.gtoPostflop.wet,
                    very_wet: translations.gtoPostflop.veryWet,
                  } as Record<string, string>)[postflopRecommendation.boardTexture.classification]}
                  {' '}({postflopRecommendation.boardTexture.wetness}/10)
                </span>
              }
            />

            {/* Right column: Bet action */}
            <GridRow
              label={translations.gtoPostflop.action}
              value={
                <span className="text-[10px]">
                  {postflopRecommendation.isAllIn
                    ? translations.gtoPostflop.allIn
                    : postflopRecommendation.sizingPercent
                      ? `${translations.gtoPostflop.raise} ${postflopRecommendation.sizingPercent}% pot`
                      : postflopRecommendation.action === 'check'
                        ? translations.gtoPostflop.check
                        : postflopRecommendation.action === 'fold'
                          ? translations.gtoPostflop.fold
                          : postflopRecommendation.action === 'call'
                            ? translations.gtoPostflop.call
                            : translations.gtoPostflop.raise}
                </span>
              }
              color={getGtoActionColor(postflopRecommendation.action === 'raise' ? 'R' : postflopRecommendation.action === 'call' ? 'C' : postflopRecommendation.action === 'fold' ? 'F' : 'check')}
            />

            {/* Full width: Reasoning */}
            {postflopRecommendation.freq && (
              <div className="col-span-2">
                <GridRow
                  label={translations.gtoPostflop.reasoning}
                  value={
                    <span className="text-[9px] text-white/50">
                      {postflopRecommendation.reasoning}
                    </span>
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* GTO Math: Two-Column Grid  MDF + EV */}
      <div className="border-t border-white/10 pt-1 mt-1">
        <div className="text-white/50 font-medium text-center tracking-wide text-[12px] mb-1">
          {translations.gtoMath.title}
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {/* Left column: MDF + Call EV + Raise EV */}
          <div className="space-y-1">
            {gtoMath.mdf !== null && (
              <GridRow
                label={translations.gtoMath.mdf}
                value={
                  <>
                    {(gtoMath.mdf * 100).toFixed(0)}%
                    <StrengthBar
                      value={gtoMath.mdf}
                      color={getMDFBarColor(gtoMath.mdf)}
                    />
                  </>
                }
                color={getMDFColor(gtoMath.mdf)}
              />
            )}
            {gtoMath.callEV !== null && (
              <GridRow
                label={translations.gtoMath.callEv}
                value={
                  <span className={getEVColor(gtoMath.callEV)}>
                    {gtoMath.callEV > 0 ? '+' : ''}{gtoMath.callEV.toFixed(1)}
                    {gtoMath.bestAction === 'call' && ' ✅call'}
                    {gtoMath.bestAction === 'fold' && ' ❌fold'}
                  </span>
                }
              />
            )}
            {gtoMath.raiseEV !== null && (
              <GridRow
                label={translations.gtoMath.raiseEV}
                value={
                  <span className={getEVColor(gtoMath.raiseEV)}>
                    {gtoMath.raiseEV > 0 ? '+' : ''}{gtoMath.raiseEV.toFixed(1)}
                    {gtoMath.bestAction === 'raise' && ' ✅'}
                  </span>
                }
              />
            )}
          </div>

          {/* Right column: V:B ratio + Range classification */}
          <div className="space-y-1">
            {/* V:B 是「下注方」的指标，翻牌前没有意义（范围表驱动），不渲染。
                主值用标准比（3:1），百分比降为副标签便于对照。 */}
            {phase !== 'preflop' && gtoMath.vbRatio !== null && (
              <GridRow
                label={gtoMath.vbSource === 'facing'
                  ? translations.gtoMath.vbRatioFacing
                  : translations.gtoMath.vbRatioHero}
                value={
                  <>
                    {gtoMath.vbRatio.ratio}{' '}
                    <span className="text-[9px] text-white/40">
                      {Math.round(gtoMath.vbRatio.valuePct * 100)}/
                      {Math.round(gtoMath.vbRatio.bluffPct * 100)}
                    </span>
                  </>
                }
              />
            )}
            {gtoMath.rangeCat !== null && phase !== 'preflop' && (
              <GridRow
                label={translations.gtoMath.rangeCategory}
                value={
                  <span className={getRangeCategoryColor(gtoMath.rangeCat)}>
                    {getRangeCategoryEmoji(gtoMath.rangeCat)} {getRangeCategoryLabel(gtoMath.rangeCat)}
                    <span className="ml-1 text-[9px] text-white/40">
                      {translations.gtoMath.heuristic}
                    </span>
                  </span>
                }
              />
            )}
          </div>
        </div>

        {/* 口径说明：本区块是单街闭式 + 单挑推导，且未计抽水 / ICM */}
        <div className="text-[9px] leading-tight text-white/40 mt-1">
          {gtoMathCaveat}
        </div>
      </div>
      
      {/* NodeLock Recommendation lyk TODO */}
      {nodelockRecommendation && nodelockRecommendation.adjustmentType !== 'neutral' && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="text-white/50 font-medium text-center tracking-wide text-[12px] mb-1">
            {translations.nodelock.title}
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {/* Left column: Leak + Confidence */}
            <div className="space-y-1">
              <GridRow
                label={translations.nodelock.leak}
                value={
                  <span className={`text-[10px] ${getLeakTypeColor(nodelockRecommendation.adjustmentType)}`}>
                    {getLeakTypeLabel(nodelockRecommendation.adjustmentType)}
                  </span>
                }
              />
              <GridRow
                label={translations.nodelock.confidence}
                value={
                  <span className="text-[10px]">
                    {(nodelockRecommendation.confidence * 100).toFixed(0)}%
                  </span>
                }
              />
            </div>

            {/* Right column: Adjustment + Reasoning */}
            <div className="space-y-1">
              <GridRow
                label={translations.nodelock.adjustment}
                value={
                  <span className="text-[10px] text-white/70">
                    {nodelockRecommendation.adjustmentMagnitude > 0 ? '+' : ''}
                    {(nodelockRecommendation.adjustmentMagnitude * 100).toFixed(0)}%
                  </span>
                }
              />
              <GridRow
                label={translations.nodelock.reasoning}
                value={
                  <span className="text-[9px] text-white/50">
                    {nodelockRecommendation.reasoning}
                  </span>
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* 统一玩家统计 VPIP/PFR/AF 表格 */}
      {(() => {
        const botStats: BotStatsWithAF[] = opponentProfile?.botStats ?? [];
        const realStats: PlayerLongStats[] = longStats ?? [];
        if (botStats.length === 0 && realStats.length === 0) return null;
        return (
          <div className="border-t border-white/10 pt-1 mt-1 space-y-1">
            <div className="text-white/50 font-medium text-center tracking-wide text-[12px]">
              {translations.playerStats.title}
            </div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-white/30 text-[10px]">
                  <th className="text-left" />
                  <th colSpan={4} className="text-center border-b border-white/10">{translations.playerStats.preflop}</th>
                  <th colSpan={6} className="text-center border-b border-white/10">{translations.playerStats.postflop}</th>
                  <th colSpan={2} className="text-center border-b border-white/10">{translations.playerStats.showdown}</th>
                </tr>
                <tr className="text-white/50 text-[8px]">
                  <th className="text-left">{translations.playerStats.name}</th>
                  <th className="text-right">{translations.playerStats.vpip}</th>
                  <th className="text-right">{translations.playerStats.pfr}</th>
                  <th className="text-right">{translations.playerStats.threeBet}</th>
                  <th className="text-right border-r border-white/10">{translations.playerStats.type}</th>
                  <th className="text-right">{translations.playerStats.af}</th>
                  <th className="text-right">{translations.playerStats.afq}</th>
                  <th className="text-right">{translations.playerStats.cbet}</th>
                  <th className="text-right">{translations.playerStats.foldToCbet}</th>
                  <th className="text-right">{translations.playerStats.turnCbet}</th>
                  <th className="text-right border-r border-white/10">{translations.playerStats.checkRaise}</th>
                  <th className="text-right">{translations.playerStats.wtsd}</th>
                  <th className="text-right">{translations.playerStats.wsd}</th>
                </tr>
              </thead>
              <tbody>
                {botStats.map((stat) => {
                  const typeLabel = translations.playerStats.types[stat.playerType] || stat.playerType;
                  const typeColor = getPlayerTypeColor(stat.playerType);
                  return (
                    <tr key={`bot-${stat.playerId}`} className="text-white">
                      <td className="text-left">{translations.playerArea.bot}{stat.playerId}</td>
                      <td className={`text-right ${stat.handsDealt > 0 ? getVpipColor(stat.vpip * 100) : ''}`}>
                        {stat.handsDealt > 0 ? `${(stat.vpip * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.handsDealt > 0 ? getPfrColor(stat.pfr * 100) : ''}`}>
                        {stat.handsDealt > 0 ? `${(stat.pfr * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.threeBet !== null ? get3BetColor(stat.threeBet) : ''}`}>
                        {stat.threeBet !== null ? `${stat.threeBet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right font-medium border-r border-white/10 ${typeColor}`}>
                        {stat.playerType === 'Unknown' && stat.handsDealt < 10
                          ? translations.playerStats.insufficientData
                          : typeLabel}
                      </td>
                      <td className={`text-right ${stat.af !== null ? getAfColor(stat.af) : ''}`}>
                        {stat.af !== null ? stat.af.toFixed(1) : '—'}
                      </td>
                      <td className={`text-right ${stat.afq !== null ? getAFqColor(stat.afq) : ''}`}>
                        {stat.afq !== null ? `${stat.afq.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.cbet !== null ? getCbetColor(stat.cbet) : ''}`}>
                        {stat.cbet !== null ? `${stat.cbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.foldToCbet !== null ? getFoldToCbetColor(stat.foldToCbet) : ''}`}>
                        {stat.foldToCbet !== null ? `${stat.foldToCbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.turnCbet !== null ? getTurnCbetColor(stat.turnCbet) : ''}`}>
                        {stat.turnCbet !== null ? `${stat.turnCbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right border-r border-white/10 ${stat.checkRaise !== null ? getCrColor(stat.checkRaise) : ''}`}>
                        {stat.checkRaise !== null ? `${stat.checkRaise.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.wtsd !== null ? getWtsdColor(stat.wtsd) : ''}`}>
                        {stat.wtsd !== null ? `${stat.wtsd.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.wsd !== null ? getWsdColor(stat.wsd) : ''}`}>
                        {stat.wsd !== null ? `${stat.wsd.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
                {realStats.map((stat) => {
                  const isViewing = stat.playerId === viewingPlayerId;
                  const sessionStat = realPlayerSessionStats?.find(
                    (s) => s.playerId === stat.playerId,
                  );
                  const display = isViewing || !sessionStat ? stat : sessionStat;
                  const typeLabel = translations.playerStats.types[display.playerType] || display.playerType;
                  const typeColor = getPlayerTypeColor(display.playerType);
                  return (
                    <tr key={`real-${stat.playerId}`} className="text-white">
                      <td className="text-left">P{stat.playerId}</td>
                      <td className={`text-right ${display.handsDealt > 0 ? getVpipColor(display.vpip * 100) : ''}`}>
                        {display.handsDealt > 0 ? `${(display.vpip * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.handsDealt > 0 ? getPfrColor(display.pfr * 100) : ''}`}>
                        {display.handsDealt > 0 ? `${(display.pfr * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.threeBet !== null ? get3BetColor(display.threeBet) : ''}`}>
                        {display.threeBet !== null ? `${display.threeBet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right font-medium border-r border-white/10 ${typeColor}`}>
                        {display.playerType === 'Unknown' && display.handsDealt < 10
                          ? translations.playerStats.insufficientData
                          : typeLabel}
                      </td>
                      <td className={`text-right ${display.af !== null ? getAfColor(display.af) : ''}`}>
                        {display.af !== null ? display.af.toFixed(1) : '—'}
                      </td>
                      <td className={`text-right ${display.afq !== null ? getAFqColor(display.afq) : ''}`}>
                        {display.afq !== null ? `${display.afq.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.cbet !== null ? getCbetColor(display.cbet) : ''}`}>
                        {display.cbet !== null ? `${display.cbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.foldToCbet !== null ? getFoldToCbetColor(display.foldToCbet) : ''}`}>
                        {display.foldToCbet !== null ? `${display.foldToCbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.turnCbet !== null ? getTurnCbetColor(display.turnCbet) : ''}`}>
                        {display.turnCbet !== null ? `${display.turnCbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right border-r border-white/10 ${display.checkRaise !== null ? getCrColor(display.checkRaise) : ''}`}>
                        {display.checkRaise !== null ? `${display.checkRaise.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.wtsd !== null ? getWtsdColor(display.wtsd) : ''}`}>
                        {display.wtsd !== null ? `${display.wtsd.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.wsd !== null ? getWsdColor(display.wsd) : ''}`}>
                        {display.wsd !== null ? `${display.wsd.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
};
