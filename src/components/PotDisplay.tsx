import React from 'react';

interface PotDisplayProps {
  pot: number;
  phase: string;
}

const PHASE_NAMES: Record<string, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  ended: '游戏结束'
};

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, phase }) => {
  return (
    <div className="flex items-center justify-center gap-8 py-4">
      <div className="bg-black/40 backdrop-blur px-8 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">奖池</div>
          <div className="text-4xl font-bold text-yellow-400">
            ${pot}
          </div>
        </div>
      </div>
      <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-2xl border border-white/10">
        <div className="text-center">
          <div className="text-white/60 text-sm mb-1">阶段</div>
          <div className="text-xl font-medium text-white">
            {PHASE_NAMES[phase]}
          </div>
        </div>
      </div>
    </div>
  );
};
