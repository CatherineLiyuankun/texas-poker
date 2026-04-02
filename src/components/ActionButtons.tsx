import React, { useState } from 'react';
import type { Action } from '../types/poker';
import { translations } from '../utils/translations';

interface ActionButtonsProps {
  onAction: (action: Action, amount?: number) => void;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  canFold: boolean;
  lastBet: number;
  playerBet: number;
  disabled?: boolean;
  isBot?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onAction,
  canCheck,
  canCall,
  canRaise,
  canFold,
  lastBet,
  playerBet,
  disabled = false,
  isBot = false,
}) => {
  const [showRaiseInput, setShowRaiseInput] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState('');

  React.useEffect(() => {
    setShowRaiseInput(false);
    setRaiseAmount('');
  }, [lastBet, playerBet, canRaise]);

  const toCall = lastBet - playerBet;
  const BIG_BLIND = 20;

  const isFirstAction = toCall === 0;
  const minTargetExtra = isFirstAction ? BIG_BLIND : lastBet;
  const minTargetTotal = toCall + minTargetExtra;

  const handleRaise = () => {
    const targetTotal = parseInt(raiseAmount);
    const raiseExtra = BIG_BLIND;
    if (
      !isNaN(targetTotal) &&
      targetTotal >= raiseExtra &&
      targetTotal > playerBet
    ) {
      const realRaise = targetTotal - playerBet;
      onAction('raise', realRaise);
      setRaiseAmount('');
      setShowRaiseInput(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {isBot && (
        <div className="text-yellow-400 text-sm mb-2">{translations.actionButtons.botThinking}</div>
      )}
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={() => onAction('check')}
          disabled={!canCheck || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canCheck && !disabled
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-gray-500/30 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          {translations.actionButtons.check}
        </button>

        <button
          onClick={() => onAction('call')}
          disabled={!canCall || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canCall && !disabled
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-500/30 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          {translations.actionButtons.call} {toCall > 0 ? `$${toCall}` : ''}
        </button>

        <button
          onClick={() => {
            setShowRaiseInput(true);
          }}
          className={`
             px-6 py-3 rounded-lg font-bold text-lg transition-all
             bg-orange-500 hover:bg-orange-600 text-white
           `}
        >
          {isFirstAction ? translations.actionButtons.bet : translations.actionButtons.raise}
        </button>

        <button
          onClick={() => onAction('fold')}
          disabled={!canFold || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canFold && !disabled
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-gray-500/30 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          {translations.actionButtons.fold}
        </button>
      </div>

      {showRaiseInput && (
        <div className="flex gap-2 items-center bg-black/40 p-3 rounded-lg">
          <input
            type="number"
            value={raiseAmount}
            onChange={(e) => setRaiseAmount(e.target.value)}
            placeholder={translations.actionButtons.raisePlaceholder(minTargetTotal)}
            className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 w-80"
          />
          <button
            onClick={handleRaise}
            disabled={
              !raiseAmount ||
              parseInt(raiseAmount) < minTargetTotal ||
              parseInt(raiseAmount) <= playerBet
            }
            className="px-4 py-2 bg-yellow-500 text-black rounded font-bold disabled:opacity-50"
          >
            {translations.actionButtons.confirm}
          </button>
          <button
            onClick={() => {
              setShowRaiseInput(false);
              setRaiseAmount('');
            }}
            className="px-4 py-2 bg-gray-500 text-white rounded"
          >
            {translations.actionButtons.cancel}
          </button>
        </div>
      )}
    </div>
  );
};