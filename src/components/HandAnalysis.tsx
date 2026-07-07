import React, { useMemo, useState, useEffect } from 'react';
import type { Card, GamePhase, PlayerId } from '../types/poker';
import { HAND_RANK_NAMES } from '../types/poker';
import { getPreflopStrength, getPreflopTier } from '../utils/preflopHandStrength';
import { detectDraws, type DrawInfo } from '../utils/drawDetector';
import { calculateEquity } from '../utils/equityCalculator';
import { evaluateHand } from '../utils/handEvaluator';
import { translations } from '../utils/translations';
import type { OpponentProfile, BotStatsWithAF } from '../utils/opponentModel';
import type { PlayerLongStats } from '../utils/longOpponentModel';
import type { GtoPostflopRecommendation } from '../utils/gtoPostflop';
import type { NodelockRecommendation, LeakType } from '../utils/gtoNodelock';
import {
  calculateMDF,
  calculateValueBluffRatio,
  calculateCallEV,
  calculateBluffFrequency,
  classifyRange,
  type RangeCategory,
} from '../utils/gtoMath';

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
  gtoPostflopRecommendation?: GtoPostflopRecommendation | null;
  nodelockRecommendation?: NodelockRecommendation | null;
  opponentProfile?: OpponentProfile;
  longStats?: PlayerLongStats[];
  viewingPlayerId?: PlayerId;
  realPlayerSessionStats?: BotStatsWithAF[];
}

// 建议逻辑：仅基于胜率 + 赔率
// Monte Carlo 胜率已包含听牌概率，不再单独叠加
function getRecommendation(
  equity: number,
  potOdds: number,
  phase: GamePhase,
): string {
  const { rec } = translations.handAnalysis;
  if (phase === 'preflop') {
    if (equity >= 10) return rec.raise;
    if (equity >= 7) return rec.callRaise;
    if (equity >= 4 && potOdds < 0.25) return rec.call;
    if (potOdds === 0) return rec.check;
    return rec.fold;
  }
  if (equity >= 0.70) return rec.raise;
  if (equity >= 0.55) return rec.callRaise;
  if (equity >= potOdds + 0.05) return rec.call;
  if (potOdds === 0) return rec.check;
  if (potOdds < 0.10) return rec.callCheap;
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

function getCommunityByPhase(
  communityCards: Card[],
  phase: GamePhase,
): Card[] {
  switch (phase) {
    case 'preflop': return [];
    case 'flop': return communityCards.slice(0, 3);
    case 'turn': return communityCards.slice(0, 4);
    case 'river': return communityCards.slice(0, 5);
    default: return communityCards;
  }
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

function getPotOddsColor(odds: number): string {
  if (odds <= 0.10) return 'text-green-400';
  if (odds <= 0.25) return 'text-yellow-400';
  return 'text-red-400';
}

function getMDFColor(mdf: number): string {
  if (mdf >= 0.75) return 'text-green-400';
  if (mdf >= 0.50) return 'text-yellow-400';
  return 'text-red-400';
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

function getCardsToCome(phase: GamePhase): number {
  switch (phase) {
    case 'preflop': return 5;
    case 'flop': return 2;
    case 'turn': return 1;
    default: return 0;
  }
}

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-14 h-1.5 bg-white/20 rounded-full overflow-hidden inline-block ml-1 align-middle">
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
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-white/60 text-[9px]">{label}</span>
      <span className={`text-[10px] font-medium ${color}`}>{value}</span>
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
  gtoPostflopRecommendation,
  nodelockRecommendation,
  opponentProfile,
  longStats,
  viewingPlayerId,
  realPlayerSessionStats,
}) => {
  const [equity, setEquity] = useState<number | null>(null);

  const community = getCommunityByPhase(communityCards, phase);
  const cardsToCome = getCardsToCome(phase);

  const preflopStrength = useMemo(
    () => (phase === 'preflop' ? getPreflopStrength(holeCards) : null),
    [holeCards, phase],
  );

  const preflopTier = useMemo(
    () => (phase === 'preflop' ? getPreflopTier(holeCards) : null),
    [holeCards, phase],
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

  const shouldCalculate = useMemo(
    () =>
      phase !== 'preflop' &&
      phase !== 'showdown' &&
      phase !== 'ended' &&
      holeCards.length >= 2 &&
      community.length >= 3,
    [phase, holeCards, community],
  );

  useEffect(() => {
    if (!shouldCalculate) return;

    const timer = setTimeout(() => {
      const result = calculateEquity(holeCards, community, numOpponents, 200);
      setEquity(result);
    }, 50);
    return () => clearTimeout(timer);
  }, [holeCards, community, numOpponents, shouldCalculate]);

  // Monte Carlo 胜率已包含听牌概率，直接使用
  const displayEquity =
    phase === 'preflop' ? preflopStrength : (equity ?? 0);

  const recommendation = useMemo(() => {
    if (displayEquity === null) return '';
    return getRecommendation(displayEquity, potOdds, phase);
  }, [displayEquity, potOdds, phase]);

  // GTO Math calculations
  const gtoMath = useMemo(() => {
    const pot = currentPot ?? 0;
    const bet = betToCall ?? 0;
    const eq = displayEquity ?? 0;
    const raiseSize = playerRaiseAmount ?? 0;

    // MDF: only when facing a bet
    const mdf = bet > 0 && pot > 0 ? calculateMDF(bet, pot) : null;

    // Value/Bluff ratio: when considering betting
    const vbRatio = (bet > 0 || raiseSize > 0) && pot > 0
      ? calculateValueBluffRatio(bet > 0 ? bet : raiseSize, pot)
      : null;

    // Bluff frequency
    const bluffFreq = (bet > 0 || raiseSize > 0) && pot > 0
      ? calculateBluffFrequency(bet > 0 ? bet : raiseSize, pot)
      : null;

    // EV calculations
    const callEV = bet > 0 ? calculateCallEV(eq, pot, bet) : null;

    // Raise EV: when player is considering a bet/raise
    let raiseEV: number | null = null;
    if (raiseSize > 0 && pot > 0) {
      // Estimate fold equity (simplified model)
      const betSizePercent = (raiseSize / pot) * 100;
      const estimatedFoldPct = Math.min(
        0.3 + (betSizePercent - 50) * 0.005,
        0.7
      );
      const callPct = 1 - estimatedFoldPct;

      // Raise EV = fold% × pot + call% × (equity × (pot + bet) - (1-equity) × bet)
      raiseEV = estimatedFoldPct * pot +
        callPct * (eq * (pot + raiseSize) - (1 - eq) * raiseSize);
    }

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
      ? classifyRange(eq, bet > 0 ? bet : raiseSize, pot, phase)
      : null;

    return { mdf, vbRatio, bluffFreq, callEV, raiseEV, bestAction, bestEV, rangeCat };
  }, [displayEquity, currentPot, betToCall, playerRaiseAmount, phase]);

  // Calculate pot odds to display (facing bet OR making bet)
  const displayPotOdds = useMemo(() => {
    // If player is making a bet/raise, show odds offered to opponent
    if (playerRaiseAmount && playerRaiseAmount > 0 && currentPot) {
      return playerRaiseAmount / (currentPot + playerRaiseAmount);
    }
    // Otherwise show pot odds when facing a bet
    return potOdds > 0 ? potOdds : null;
  }, [playerRaiseAmount, currentPot, potOdds]);

  return (
    <div className="w-54 bg-black/50 rounded-lg p-2 text-xs space-y-1 border border-white/10">
      <div className="text-white/50 font-medium text-center mb-1 tracking-wide">
        {translations.handAnalysis.title}
      </div>

      {phase === 'preflop' && preflopStrength !== null && (
        <>
          <Row
            label={translations.handAnalysis.preflop}
            value={
              <>
                {preflopStrength}
                <StrengthBar
                  value={preflopStrength / 20}
                  color={
                    preflopStrength >= 10
                      ? 'bg-red-400'
                      : preflopStrength >= 7
                        ? 'bg-orange-400'
                        : preflopStrength >= 4
                          ? 'bg-green-400'
                          : 'bg-purple-400'
                  }
                />
              </>
            }
          />
          {preflopTier !== null && (
            <div className={`text-center font-medium ${
              preflopTier === 1 ? 'text-red-400'
                : preflopTier === 2 ? 'text-orange-400'
                : preflopTier === 3 ? 'text-amber-500'
                : preflopTier === 4 ? 'text-green-400'
                : preflopTier === 5 ? 'text-blue-400'
                : 'text-purple-400'
            }`}>
              {translations.handAnalysis.tier} {preflopTier} — {translations.handAnalysis.tierNames[preflopTier]}
            </div>
          )}
        </>
      )}

      {/* Postflop: Win rate + Current hand (需要 community cards) */}
      {phase !== 'preflop' && shouldCalculate && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {/* Left column: Win rate */}
            <GridRow
              label={translations.handAnalysis.winRate}
              value={
                equity !== null ? (
                  <>
                    {(equity * 100).toFixed(0)}%
                    <StrengthBar
                      value={equity}
                      color={
                        equity >= 0.6
                          ? 'bg-green-400'
                          : equity >= 0.4
                            ? 'bg-yellow-400'
                            : 'bg-red-400'
                      }
                    />
                  </>
                ) : (
                  <span className="text-yellow-400 animate-pulse">...</span>
                )
              }
            />

            {/* Right column: Current hand */}
            {currentHandRank && currentHandRank !== 'high_card' && (
              <GridRow
                label={translations.handAnalysis.currentHand}
                value={HAND_RANK_NAMES[currentHandRank]}
                color="text-emerald-300"
              />
            )}
          </div>
        </div>
      )}

      {/* All phases: Pot odds + SPR (独立计算) */}
      {(displayPotOdds !== null || (spr !== undefined && spr > 0)) && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {/* Left column: Pot odds */}
            {displayPotOdds !== null && (
              <GridRow
                label={translations.handAnalysis.potOdds}
                value={`${(displayPotOdds * 100).toFixed(0)}%`}
                color={getPotOddsColor(displayPotOdds)}
              />
            )}

            {/* Right column: SPR */}
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
          </div>
        </div>
      )}

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

      {displayEquity !== null && recommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <Row
            label={translations.handAnalysis.suggest}
            value={recommendation}
            color={getRecColor(recommendation)}
          />
          {phase !== 'preflop' && equity !== null && equity > 0 && displayPotOdds !== null && displayPotOdds >= 0 && (
            <div className="text-white/30 text-center mt-0.5">
              {equity >= displayPotOdds ? '>=' : '<'}
              {' '}
              {(equity * 100).toFixed(0)}% vs {(displayPotOdds * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}

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

      {phase !== 'preflop' && gtoPostflopRecommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {/* Left column: Board texture */}
            <GridRow
              label={translations.gtoPostflop.board}
              value={
                <span className={`text-[10px] ${
                  gtoPostflopRecommendation.boardTexture.classification === 'very_dry' || gtoPostflopRecommendation.boardTexture.classification === 'dry'
                    ? 'text-blue-400'
                    : gtoPostflopRecommendation.boardTexture.classification === 'medium'
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}>
                  {({
                    very_dry: translations.gtoPostflop.veryDry,
                    dry: translations.gtoPostflop.dry,
                    medium: translations.gtoPostflop.medium,
                    wet: translations.gtoPostflop.wet,
                    very_wet: translations.gtoPostflop.veryWet,
                  } as Record<string, string>)[gtoPostflopRecommendation.boardTexture.classification]}
                  {' '}({gtoPostflopRecommendation.boardTexture.wetness}/10)
                </span>
              }
            />

            {/* Right column: Bet action */}
            <GridRow
              label={translations.gtoPostflop.bet}
              value={
                <span className="text-[10px]">
                  {gtoPostflopRecommendation.isAllIn
                    ? translations.gtoPostflop.allIn
                    : gtoPostflopRecommendation.sizingPercent
                      ? `${gtoPostflopRecommendation.sizingPercent}% pot`
                      : gtoPostflopRecommendation.action === 'check'
                        ? translations.gtoPostflop.check
                        : gtoPostflopRecommendation.action === 'fold'
                          ? translations.gtoPostflop.fold
                          : gtoPostflopRecommendation.action === 'call'
                            ? translations.gtoPostflop.call
                            : translations.gtoPostflop.raise}
                </span>
              }
              color={getGtoActionColor(gtoPostflopRecommendation.action === 'raise' ? 'R' : gtoPostflopRecommendation.action === 'call' ? 'C' : gtoPostflopRecommendation.action === 'fold' ? 'F' : 'check')}
            />

            {/* Full width: Reasoning */}
            {gtoPostflopRecommendation.freq && (
              <div className="col-span-2">
                <GridRow
                  label={translations.gtoPostflop.reasoning}
                  value={
                    <span className="text-[9px] text-white/50">
                      {gtoPostflopRecommendation.reasoning}
                    </span>
                  }
                />
              </div>
            )}
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
            <div className="text-white/50 font-medium text-center tracking-wide">
              {translations.playerStats.title}
            </div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-white/30 text-[8px]">
                  <th className="text-left" />
                  <th colSpan={4} className="text-center border-b border-white/10">{translations.playerStats.preflop}</th>
                  <th colSpan={6} className="text-center border-b border-white/10">{translations.playerStats.postflop}</th>
                  <th colSpan={2} className="text-center border-b border-white/10">{translations.playerStats.showdown}</th>
                </tr>
                <tr className="text-white/50">
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

      {/* GTO Math: Two-Column Grid */}
      {(gtoMath.mdf !== null || gtoMath.callEV !== null || gtoMath.raiseEV !== null) && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="text-white/50 font-medium text-center tracking-wide text-[9px] mb-1">
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
                        color={gtoMath.mdf >= 0.67 ? 'bg-green-400' : gtoMath.mdf >= 0.50 ? 'bg-yellow-400' : 'bg-red-400'}
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
              {gtoMath.vbRatio !== null && (
                <GridRow
                  label={translations.gtoMath.vbRatio}
                  value={`${Math.round(gtoMath.vbRatio.valuePct * 100)}:${Math.round(gtoMath.vbRatio.bluffPct * 100)}`}
                />
              )}
              {gtoMath.rangeCat !== null && phase !== 'preflop' && (
                <GridRow
                  label=""
                  value={
                    <span className={getRangeCategoryColor(gtoMath.rangeCat)}>
                      {getRangeCategoryEmoji(gtoMath.rangeCat)} {getRangeCategoryLabel(gtoMath.rangeCat)}
                    </span>
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}

      {nodelockRecommendation && nodelockRecommendation.adjustmentType !== 'neutral' && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <div className="text-white/50 font-medium text-center tracking-wide text-[9px] mb-1">
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
    </div>
  );
};
