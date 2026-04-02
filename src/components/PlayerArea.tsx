import React, { useState } from 'react';
import type { Player, GamePhase, Action } from '../types/poker';
import { Card } from './Card';
import { HAND_RANK_NAMES, type HandRank } from '../types/poker';
import { translations } from '../utils/translations';

interface PlayerAreaProps {
  player: Player;
  displayName?: string;
  isCurrentPlayer: boolean;
  isDealer: boolean;
  isWinner?: boolean;
  handRank?: HandRank;
  blind?: '小盲' | '大盲';
  actionButtons?: React.ReactNode;
  phase?: GamePhase;
  lastAction?: Action;
}

export const PlayerArea: React.FC<PlayerAreaProps> = ({ 
  player, 
  displayName,
  isCurrentPlayer, 
  isDealer,
  isWinner = false,
  handRank,
  blind,
  actionButtons,
  phase,
  lastAction,
}) => {
  const [isViewing, setIsViewing] = useState(false);
  const handleToggleView = () => {
    setIsViewing(v => !v);
  };

  React.useEffect(() => {
    setIsViewing(false);
  }, [isCurrentPlayer, player.id, player.hand]);

  const isShowdown = phase === 'showdown' || phase === 'ended';
  const canShowHand = isShowdown || (player.isRealPlayer && isCurrentPlayer && isViewing);

  const getStatus = () => {
    if (player.folded) return translations.playerArea.folded;
    if (isShowdown && !player.folded) {
      return handRank ? HAND_RANK_NAMES[handRank] : translations.playerArea.showingHand;
    }
    if (player.isRealPlayer && isCurrentPlayer) return translations.playerArea.viewingHand;
    return translations.playerArea.waiting;
  };

  const getBlindLabel = () => {
    if (blind === '小盲') return translations.blind.smallBlind;
    if (blind === '大盲') return translations.blind.bigBlind;
    return undefined;
  };

  return (
    <div className={`
      p-4 rounded-xl transition-all duration-300
      ${isWinner ? 'bg-yellow-500/20 border-2 border-yellow-400 animate-pulse-win' : ''}
      ${isCurrentPlayer && !isWinner ? 'bg-white/10 border-2 border-blue-400' : 'bg-black/20 border-2 border-transparent'}
    `}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">
            {displayName || translations.gameBoard.player(player.id)}
          </span>
          {!player.isRealPlayer && (
            <span className="bg-gray-600 text-white text-xs px-2 py-0.5 rounded-full ml-1">
              {translations.playerArea.bot}
            </span>
          )}
          {blind && getBlindLabel() && (
            <span className="bg-purple-700 text-white text-xs px-2 py-0.5 rounded-full ml-1">
              {getBlindLabel()}
            </span>
          )}
          {isDealer && (
            <span className="bg-amber-600 text-white text-xs px-2 py-0.5 rounded-full ml-1">
              {translations.playerArea.dealer}
            </span>
          )}
          {lastAction && !player.isRealPlayer && !isShowdown && (
            <span className={`
              ml-1 text-xs px-2 py-0.5 rounded-full font-bold animate-pulse
              ${lastAction === 'raise' ? 'bg-orange-500 text-white' : 
                lastAction === 'call' ? 'bg-blue-500 text-white' : 
                lastAction === 'fold' ? 'bg-red-500 text-white' : 
                'bg-green-500 text-white'}
            `}>
              {lastAction === 'raise' ? 'Raise' : 
               lastAction === 'call' ? 'Call' : 
               lastAction === 'fold' ? 'Fold' : 'Check'}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">
            ${player.chips}
          </div>
          <div className="text-sm text-white/60">
            {translations.playerArea.thisRoundBet} ${player.bet}
          </div>
          <div className="text-sm text-yellow-400/80">
            {translations.playerArea.totalBet} ${player.totalBet}
          </div>
        </div>
      </div>

      <div className="relative flex gap-3 justify-center mb-3">
        {player.hand.map((card, index) => (
          <Card
            key={index}
            card={canShowHand ? card : null}
            hidden={!canShowHand}
            delay={index * 100}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className={`
          px-3 py-1 rounded-full text-sm
          ${player.folded ? 'bg-red-500/30 text-red-300' : 
            isShowdown && !player.folded ? 'bg-green-500/30 text-green-300' : 
            'bg-blue-500/30 text-blue-300'}
        `}>
          {getStatus()}
        </div>

        {!isShowdown && isCurrentPlayer && !player.folded && player.isRealPlayer && (
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
            {isViewing ? translations.playerArea.hideCards : translations.playerArea.viewCards}
          </button>
        )}
      </div>

      {actionButtons && (
        <div className="mt-3">
          {actionButtons}
        </div>
      )}
    </div>
  );
};