import React from 'react';
import { translations } from '../utils/translations';

interface PotDisplayProps {
  pot: number;
  phase: string;
}

const PHASE_NAMES: Record<string, string> = {
  preflop: translations.communityCards.preflop,
  flop: translations.communityCards.flop,
  turn: translations.communityCards.turn,
  river: translations.communityCards.river,
  showdown: translations.communityCards.showdown,
  ended: '游戏结束 Ended'
};

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, phase }) => {
  return (
    <div className="flex items-center justify-center gap-8 py-4">
      <div className="bg-black/40 backdrop-blur px-8 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">{translations.potDisplay.pot}</div>
          <div className="text-4xl font-bold text-yellow-400">
            ${pot}
          </div>
        </div>
      </div>
      <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">{translations.potDisplay.phase}</div>
          <div className="text-xl font-medium text-white">
            {PHASE_NAMES[phase]}
          </div>
        </div>
      </div>
    </div>
  );
};