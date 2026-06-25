import React, { useState } from 'react';
import type { Player, GamePhase, Action, Card as CardType } from '../types/poker';
import { Card } from './Card';
import { HandAnalysis } from './HandAnalysis';
import { HAND_RANK_NAMES, type HandRank } from '../types/poker';
import { translations } from '../utils/translations';
import { INITIAL_CHIPS } from '../utils/constant';
import type { OpponentProfile } from '../utils/opponentModel';

interface PlayerAreaProps {
  player: Player;
  displayName?: string;
  isCurrentPlayer: boolean;
  isWinner?: boolean;
  handRank?: HandRank;
  positionLabel?: string;
  actionButtons?: React.ReactNode;
  phase?: GamePhase;
  lastAction?: Action;
  chipChange?: number;
  communityCards?: CardType[];
  numActiveOpponents?: number;
  potOdds?: number;
  opponentProfile?: OpponentProfile;
}

export const PlayerArea: React.FC<PlayerAreaProps> = ({ 
  player, 
  displayName,
  isCurrentPlayer, 
  isWinner = false,
  handRank,
  positionLabel,
  actionButtons,
  phase,
  lastAction,
  chipChange,
  communityCards,
  numActiveOpponents,
  potOdds,
  opponentProfile,
}) => {
  const [isViewing, setIsViewing] = useState(false);
  const handleToggleView = () => {
    setIsViewing(v => !v);
  };

  React.useEffect(() => {
    setIsViewing(false);
  }, [isCurrentPlayer, player.id, player.hand]);

  const isShowdown = phase === 'showdown' || phase === 'ended';
  const canShowHand = (isShowdown && !player.folded) || (player.isRealPlayer && isCurrentPlayer && isViewing);

  const getStatus = () => {
    if (player.folded) return translations.playerArea.folded;
    if (player.allIn) return translations.playerArea.allIn || translations.actionButtons.allin;
    if (player.isRealPlayer && isCurrentPlayer) return translations.playerArea.viewingHand;
    return translations.playerArea.waiting;
  };

  const getHandRankStatus = () => {
    if (isShowdown && !player.folded) {
      return handRank
        ? HAND_RANK_NAMES[handRank]
        : translations.playerArea.showingHand;
    }
  }

  return (
    <div className="flex items-start gap-2">
      <div
        className={`
        p-3 rounded-xl transition-all duration-300 min-w-[200px]
        ${isWinner ? 'bg-yellow-500/20 border-2 border-yellow-400 animate-pulse-win' : ''}
        ${isCurrentPlayer && !isWinner ? 'bg-white/10 border-2 border-blue-400' : 'bg-black/20 border-2 border-transparent'}
        ${player.isRealPlayer ? 'max-w-[300px]' : ''}
      `}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">
              {displayName || translations.gameBoard.player(player.id)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {positionLabel && (
              <span className="bg-purple-600 text-white text-sm px-2 py-0.5 rounded-full font-medium">
                {positionLabel}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-green-400">
              ${player.chips}
              {player.buyInCount > 0 && (
                <span className="text-sm text-orange-400 ml-1">
                  (-{player.buyInCount * INITIAL_CHIPS})
                </span>
              )}
              {chipChange !== undefined && chipChange !== 0 && (
                <span className={`text-sm ml-1 ${chipChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {chipChange > 0 ? '+' : ''}{chipChange}
                </span>
              )}
            </div>
            <div className="text-sm text-white/60">
              {translations.playerArea.thisRoundBet} ${player.bet}
            </div>
            <div className="text-sm text-white/60">
              {translations.playerArea.totalBet} ${player.totalBet}
            </div>
          </div>
        </div>

        <div className="relative flex gap-2 justify-center mb-3">
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
        <div
          className={`
           px-3 py-1 rounded-full text-sm
           ${
             player.folded
               ? 'bg-red-500/30 text-red-300'
               : player.allIn
                 ? 'bg-orange-500/30 text-orange-300'
                 : isShowdown && !player.folded
                   ? 'bg-green-500/30 text-green-300'
                   : 'bg-blue-500/30 text-blue-300'
           }
         `}
        >
          {getStatus()}
        </div>
        {isShowdown && !player.folded && (
          <div
            className="px-3 py-1 rounded-full text-sm bg-green-500/30 text-yellow-300"
          >
            {getHandRankStatus()}
          </div>
        )}

        {!isShowdown &&
          isCurrentPlayer &&
          !player.folded &&
          player.isRealPlayer && (
            <button
              onClick={handleToggleView}
              className={`
              px-3 py-1.5 rounded-lg font-medium text-sm transition-all
              ${isViewing ? 'bg-blue-600' : 'bg-blue-500 hover:bg-blue-600'}
              text-white
            `}
              aria-pressed={isViewing}
              tabIndex={0}
            >
              {isViewing
                ? translations.playerArea.hideCards
                : translations.playerArea.viewCards}
            </button>
          )}

        {lastAction && !isShowdown && (
          <span
            className={`
            text-sm px-2 py-0.5 rounded-full font-bold animate-pulse
            ${
              lastAction === 'raise'
                ? 'bg-orange-500 text-white'
                : lastAction === 'call'
                  ? 'bg-blue-500 text-white'
                  : lastAction === 'fold'
                    ? 'bg-red-500 text-white'
                    : lastAction === 'allin'
                      ? 'bg-purple-500 text-white'
                      : 'bg-green-500 text-white'
            }
          `}
          >
            {lastAction === 'raise'
              ? 'Raise'
              : lastAction === 'call'
                ? 'Call'
                : lastAction === 'fold'
                  ? 'Fold'
                  : lastAction === 'allin'
                    ? 'All In'
                    : 'Check'}
          </span>
        )}
      </div>

        {actionButtons && <div className="mt-3">{actionButtons}</div>}
      </div>
      {canShowHand && player.isRealPlayer && !isShowdown && phase && (
        <HandAnalysis
          holeCards={player.hand}
          communityCards={communityCards || []}
          phase={phase}
          numOpponents={numActiveOpponents || 0}
          potOdds={potOdds || 0}
          opponentProfile={opponentProfile}
        />
      )}
    </div>
  );
};