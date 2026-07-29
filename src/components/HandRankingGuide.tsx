import React, { useState } from 'react';
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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-[50] bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-yellow-400 text-sm font-bold shadow-lg border border-white/20 min-[1400px]:hidden"
      >
        {isOpen ? '✕' : '?'}
      </button>

      <div className={`fixed bottom-14 right-4 z-[50] bg-black/80 backdrop-blur-sm rounded-lg p-3 text-white text-xs shadow-lg border border-white/20 transition-all ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      } min-[1400px]:opacity-100 min-[1400px]:pointer-events-auto min-[1400px]:bottom-4 min-[1400px]:right-4`}>
        <div className="font-bold mb-2 text-yellow-400 text-sm">牌型大小 Hand Rankings</div>
        <div className="grid grid-cols-2 grid-rows-5 grid-flow-col min-[1330px]:grid-cols-1 min-[1330px]:grid-flow-row gap-x-4">
          {HAND_RANKS_IN_ORDER.map((rank, index) => (
            <div key={rank} className="flex items-center gap-2 py-0.5">
              <span className="text-yellow-300 w-4">{1 + index}.</span>
              <span>{HAND_RANK_NAMES[rank]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
