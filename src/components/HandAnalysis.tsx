import React, { useMemo, useState, useEffect } from 'react';
import type { Card, GamePhase } from '../types/poker';
import { HAND_RANK_NAMES } from '../types/poker';
import { getPreflopStrength } from '../utils/preflopHandStrength';
import { detectDraws, type DrawInfo } from '../utils/drawDetector';
import { calculateEquity } from '../utils/equityCalculator';
import { evaluateHand } from '../utils/handEvaluator';
import { translations } from '../utils/translations';

interface HandAnalysisProps {
  holeCards: Card[];
  communityCards: Card[];
  phase: GamePhase;
  numOpponents: number;
  potOdds: number;
}

function getRecommendation(
  equity: number,
  potOdds: number,
  phase: GamePhase,
): string {
  const { rec } = translations.handAnalysis;
  if (phase === 'preflop') {
    if (equity >= 0.70) return rec.raise;
    if (equity >= 0.50) return rec.callRaise;
    if (equity >= 0.38 && potOdds < 0.25) return rec.call;
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

export const HandAnalysis: React.FC<HandAnalysisProps> = ({
  holeCards,
  communityCards,
  phase,
  numOpponents,
  potOdds,
}) => {
  const [equity, setEquity] = useState<number | null>(null);

  const community = getCommunityByPhase(communityCards, phase);
  const cardsToCome = getCardsToCome(phase);

  const preflopStrength = useMemo(
    () => (phase === 'preflop' ? getPreflopStrength(holeCards) : null),
    [holeCards, phase],
  );

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

  const effectiveEquity = useMemo(() => {
    if (!shouldCalculate) return 0;
    return equity ?? 0;
  }, [equity, shouldCalculate]);

  const displayEquity =
    phase === 'preflop' ? preflopStrength : effectiveEquity;

  const recommendation = useMemo(() => {
    if (displayEquity === null) return '';
    return getRecommendation(displayEquity, potOdds, phase);
  }, [displayEquity, potOdds, phase]);

  return (
    <div className="w-48 bg-black/50 rounded-lg p-2 text-xs space-y-1 border border-white/10">
      <div className="text-white/50 font-medium text-center mb-1 tracking-wide">
        {translations.handAnalysis.title}
      </div>

      {phase === 'preflop' && preflopStrength !== null && (
        <Row
          label={translations.handAnalysis.preflop}
          value={
            <>
              {(preflopStrength * 100).toFixed(0)}%
              <StrengthBar
                value={preflopStrength}
                color={
                  preflopStrength >= 0.65
                    ? 'bg-green-400'
                    : preflopStrength >= 0.5
                      ? 'bg-yellow-400'
                      : preflopStrength >= 0.38
                        ? 'bg-orange-400'
                        : 'bg-red-400'
                }
              />
            </>
          }
        />
      )}

      {phase !== 'preflop' && shouldCalculate && (
        <Row
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
      )}

      {currentHandRank && currentHandRank !== 'high_card' && (
        <Row
          label={translations.handAnalysis.currentHand}
          value={HAND_RANK_NAMES[currentHandRank]}
          color="text-emerald-300"
        />
      )}

      {potOdds > 0 && (
        <Row
          label={translations.handAnalysis.potOdds}
          value={`${(potOdds * 100).toFixed(0)}%`}
          color="text-cyan-300"
        />
      )}

      {drawInfo && drawInfo.draws.length > 0 && (
        <div className="space-y-0.5">
          {drawInfo.draws.map((d, i) => (
            <Row
              key={i}
              label={drawLabel(d.type)}
              value={`${d.outs} outs`}
              color="text-orange-300"
            />
          ))}
          {drawInfo.totalOuts > 0 && (
            <Row
              label={translations.handAnalysis.drawEq}
              value={`+${(drawInfo.estimatedEquity * 100).toFixed(0)}%`}
              color="text-white/50"
            />
          )}
        </div>
      )}

      {displayEquity !== null && recommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <Row
            label={translations.handAnalysis.suggest}
            value={recommendation}
            color={getRecColor(recommendation)}
          />
          {phase !== 'preflop' && effectiveEquity > 0 && potOdds > 0 && (
            <div className="text-white/30 text-center mt-0.5">
              {effectiveEquity >= potOdds ? '>=' : '<'}
              {' '}
              {(effectiveEquity * 100).toFixed(0)}% vs {(potOdds * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
};
