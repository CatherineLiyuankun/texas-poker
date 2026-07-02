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

interface HandAnalysisProps {
  holeCards: Card[];
  communityCards: Card[];
  phase: GamePhase;
  numOpponents: number;
  potOdds: number;
  spr?: number;
  gtoRecommendation?: {
    action: string;
    sizingBB?: number;
    freq?: { r: number; c: number; f: number };
  } | null;
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

function getGtoActionLabel(
  action: string,
  sizingBB?: number,
  freq?: { r: number; c: number; f: number },
): React.ReactNode {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const isMixed = freq !== undefined &&
    [freq.r, freq.c, freq.f].filter((v) => v > 0).length > 1;

  const mainLabel = action === 'R'
    ? (sizingBB ? `Raise ${sizingBB.toFixed(1)}BB` : 'Raise')
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
  return 'text-red-400';
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

function getPotOddsColor(odds: number): string {
  if (odds <= 0.10) return 'text-green-400';
  if (odds <= 0.25) return 'text-yellow-400';
  return 'text-red-400';
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
  spr,
  gtoRecommendation,
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
          color={getPotOddsColor(potOdds)}
        />
      )}

      {spr !== undefined && spr > 0 && (
        <Row
          label={translations.handAnalysis.spr}
          value={
            <>
              {spr.toFixed(1)}
              <StrengthBar
                value={Math.min(spr / 12, 1)}
                color={getSprBarColor(spr)}
              />
              <span className={`ml-1 text-[10px] ${getSprColor(spr)}`}>
                {getSprLabel(spr)}
              </span>
            </>
          }
          color={getSprColor(spr)}
        />
      )}

      {drawInfo && drawInfo.draws.length > 0 && (
        <div className="space-y-0.5">
          {drawInfo.draws.map((d, i) => (
            <Row
              key={i}
              label={drawLabel(d.type)}
              value={`${d.outs} outs`}
              color={getOutsColor(d.outs)}
            />
          ))}
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
                <tr className="text-white/50">
                  <th className="text-left">{translations.playerStats.name}</th>
                  <th className="text-right">{translations.playerStats.vpip}</th>
                  <th className="text-right">{translations.playerStats.pfr}</th>
                  <th className="text-right">{translations.playerStats.af}</th>
                  <th className="text-right">{translations.playerStats.cbet}</th>
                  <th className="text-right">{translations.playerStats.wtsd}</th>
                  <th className="text-right">{translations.playerStats.checkRaise}</th>
                  <th className="text-right">{translations.playerStats.type}</th>
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
                      <td className={`text-right ${stat.af !== null ? getAfColor(stat.af) : ''}`}>
                        {stat.af !== null ? stat.af.toFixed(1) : '—'}
                      </td>
                      <td className={`text-right ${stat.cbet !== null ? getCbetColor(stat.cbet) : ''}`}>
                        {stat.cbet !== null ? `${stat.cbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.wtsd !== null ? getWtsdColor(stat.wtsd) : ''}`}>
                        {stat.wtsd !== null ? `${stat.wtsd.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${stat.checkRaise !== null ? getCrColor(stat.checkRaise) : ''}`}>
                        {stat.checkRaise !== null ? `${stat.checkRaise.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right font-medium ${typeColor}`}>
                        {stat.playerType === 'Unknown' && stat.handsDealt < 10
                          ? translations.playerStats.insufficientData
                          : typeLabel}
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
                      <td className={`text-right ${display.af !== null ? getAfColor(display.af) : ''}`}>
                        {display.af !== null ? display.af.toFixed(1) : '—'}
                      </td>
                      <td className={`text-right ${display.cbet !== null ? getCbetColor(display.cbet) : ''}`}>
                        {display.cbet !== null ? `${display.cbet.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.wtsd !== null ? getWtsdColor(display.wtsd) : ''}`}>
                        {display.wtsd !== null ? `${display.wtsd.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right ${display.checkRaise !== null ? getCrColor(display.checkRaise) : ''}`}>
                        {display.checkRaise !== null ? `${display.checkRaise.toFixed(0)}%` : '—'}
                      </td>
                      <td className={`text-right font-medium ${typeColor}`}>
                        {display.playerType === 'Unknown' && display.handsDealt < 10
                          ? translations.playerStats.insufficientData
                          : typeLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {displayEquity !== null && recommendation && (
        <div className="border-t border-white/10 pt-1 mt-1">
          <Row
            label={translations.handAnalysis.suggest}
            value={recommendation}
            color={getRecColor(recommendation)}
          />
          {phase !== 'preflop' && equity !== null && equity > 0 && potOdds > 0 && (
            <div className="text-white/30 text-center mt-0.5">
              {equity >= potOdds ? '>=' : '<'}
              {' '}
              {(equity * 100).toFixed(0)}% vs {(potOdds * 100).toFixed(0)}%
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
                )}
              </span>
            }
            color={getGtoActionColor(gtoRecommendation.action)}
          />
        </div>
      )}
    </div>
  );
};
