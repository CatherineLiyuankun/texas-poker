import React, { useState } from 'react';
import type { Player } from '../types/poker';
import { Card } from './Card';
import { HAND_RANK_NAMES, type HandRank } from '../types/poker';

interface PlayerAreaProps {
  player: Player;
  isCurrentPlayer: boolean;
  isDealer: boolean;
  isWinner?: boolean;
  handRank?: HandRank;
  blind?: '小盲' | '大盲';
}

export const PlayerArea: React.FC<PlayerAreaProps> = ({ 
  player, 
  isCurrentPlayer, 
  isDealer,
  isWinner = false,
  handRank,
  blind,
}) => {
  // 单按钮点击控制底牌显示状态
  const [isViewing, setIsViewing] = useState(false);
  // 点击按钮切换显示/隐藏底牌
  const handleToggleView = () => {
    setIsViewing(v => !v);
  };

  // 当前玩家切换或手牌新发时自动复位isViewing
  React.useEffect(() => {
    setIsViewing(false);
  }, [isCurrentPlayer, player.id, player.hand]);

  const status = player.folded 
    ? '已弃牌' 
    : player.revealed 
      ? (handRank ? HAND_RANK_NAMES[handRank] : '已看牌')
      : isCurrentPlayer 
        ? '查看底牌' 
        : '等待中';

  return (
    <div className={`
      p-4 rounded-xl transition-all duration-300
      ${isWinner ? 'bg-yellow-500/20 border-2 border-yellow-400 animate-pulse-win' : ''}
      ${isCurrentPlayer && !isWinner ? 'bg-white/10 border-2 border-blue-400' : 'bg-black/20 border-2 border-transparent'}
    `}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">
            玩家 {player.id}
          </span>
          {blind && (
            <span className="bg-purple-700 text-white text-xs px-2 py-0.5 rounded-full ml-1">
              {blind}
            </span>
          )}
          {isDealer && (
            <span className="bg-amber-600 text-white text-xs px-2 py-0.5 rounded-full ml-1">
              庄
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">
            ${player.chips}
          </div>
          <div className="text-sm text-white/60">
            下注: ${player.bet}
          </div>
        </div>
      </div>

      <div className="relative flex gap-3 justify-center mb-3">
        {player.hand.map((card, index) => (
          <Card
            key={index}
            card={isViewing || player.revealed ? card : null} // 只在isViewing或revealed时正面
            hidden={!(isViewing || player.revealed)}           // 其余时间全部背面
            delay={index * 100}
          />
        ))}
        {/* Visual cue overlay when viewing */}
      </div>

      <div className="flex items-center justify-between">
        <div className={`
          px-3 py-1 rounded-full text-sm
          ${player.folded ? 'bg-red-500/30 text-red-300' : 
            player.revealed ? 'bg-green-500/30 text-green-300' : 
            'bg-blue-500/30 text-blue-300'}
        `}>
          {status}
        </div>

        {isCurrentPlayer && !player.folded && (
          <button
            onClick={handleToggleView}
            className={`
              px-4 py-2 rounded-lg font-medium transition-all
              ${isViewing
                ? 'bg-blue-600' 
                : 'bg-blue-500 hover:bg-blue-600'
              }
              text-white
            `}
            aria-pressed={isViewing}
            tabIndex={0}
          >
            {isViewing ? '隐藏看牌' : '点击看牌'}
          </button>
        )}
      </div>
    </div>
  );
};
