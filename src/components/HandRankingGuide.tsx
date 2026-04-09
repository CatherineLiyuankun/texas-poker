import React from 'react';
import { HAND_RANK_NAMES, type HandRank } from '../types/poker';

const HAND_RANKS_IN_ORDER: HandRank[] = [
  'royal_flush',
  'straight_flush',
  'four_of_kind',
  'full_house',
  'flush',
  'straight',
  'three_of_kind',
  'two_pair',
  'pair',
  'high_card',
];

export const HandRankingGuide: React.FC = () => {
  return (
    <div className="fixed bottom-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-white text-xs shadow-lg border border-white/20">
      <div className="font-bold mb-2 text-yellow-400 text-sm">牌型大小 Hand Rankings</div>
      {HAND_RANKS_IN_ORDER.map((rank, index) => (
        <div key={rank} className="flex items-center gap-2 py-0.5">
          <span className="text-yellow-300 w-4">{1 + index}.</span>
          <span>{HAND_RANK_NAMES[rank]}</span>
        </div>
      ))}
    </div>
  );
};
