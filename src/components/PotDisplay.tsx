import React from 'react';
import type { SidePot } from '../types/poker';
import { translations } from '../utils/translations';

interface PotDisplayProps {
  mainPot: number;
  sidePots?: SidePot[];
  phase: string;
}

const PHASE_NAMES: Record<string, string> = {
  preflop: translations.communityCards.preflop,
  flop: translations.communityCards.flop,
  turn: translations.communityCards.turn,
  river: translations.communityCards.river,
  showdown: translations.communityCards.showdown,
  ended: '游戏结束 Ended',
};

export const PotDisplay: React.FC<PotDisplayProps> = ({
  mainPot: mainPot,
  sidePots = [],
  phase,
}) => {
  const totalPot = mainPot + sidePots.reduce((sum, sp) => sum + sp.amount, 0);

  return (
    <div className="flex items-center justify-center gap-8 py-4">
      <div className="bg-black/40 backdrop-blur px-8 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">
            {translations.potDisplay.totalPot}
          </div>
          <div className="text-4xl font-bold text-yellow-400">${totalPot}</div>
        </div>
      </div>
      {sidePots.length > 0 && (
        <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-2xl border border-orange-500/30">
          <div className="text-center">
            <div className="text-green-400/80 text-sm mb-1">
              {translations.potDisplay.mainPot}
            </div>
            <div className="text-lg font-semibold text-green-400">
              ${mainPot}
            </div>
          </div>
        </div>
      )}
      {sidePots.length > 0 && (
        <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-2xl border border-orange-500/30">
          <div className="text-center">
            <div className="text-orange-400/80 text-sm mb-1">
              {sidePots.length === 1
                ? 'Side Pot'
                : `Side Pots (${sidePots.length})`}
            </div>
            <div className="space-y-1">
              {sidePots.map((sp) => {
                const playerIds = sp.eligiblePlayers.join(', ');
                return (
                  <div key={sp.id}>
                    <div className="text-lg font-semibold text-orange-400">
                      ${sp.amount}
                    </div>
                    <div className="text-xs text-orange-300/60">
                      Player: {playerIds}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">
            {translations.potDisplay.phase}
          </div>
          <div className="text-xl font-medium text-white">
            {PHASE_NAMES[phase]}
          </div>
        </div>
      </div>
    </div>
  );
};
