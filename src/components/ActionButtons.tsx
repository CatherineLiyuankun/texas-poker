import React, { useState } from 'react';
import type { Action } from '../types/poker';
import { translations } from '../utils/translations';
import { BIG_BLIND } from '../utils/constant';

interface ActionButtonsProps {
  onAction: (action: Action, amount?: number) => void;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  canFold: boolean;
  canAllIn: boolean;
  lastBet: number;
  playerBet: number;
  playerChips: number;
  disabled?: boolean;
  isBot?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onAction,
  canCheck,
  canCall,
  canRaise,
  canFold,
  canAllIn,
  lastBet,
  playerBet,
  playerChips,
  disabled = false,
  isBot = false,
}) => {
  const [showRaiseInput, setShowRaiseInput] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState('');

  React.useEffect(() => {
    setShowRaiseInput(false);
    setRaiseAmount('');
  }, [lastBet, playerBet, canRaise]);

  const toCall = lastBet - playerBet; // 需要跟注的金额 = 当前最高注金 - 玩家已下注金额

  const isFirstAction = toCall === 0 && lastBet === 0; // 如果当前没有人下注，且玩家也没有下注，则视为第一轮行动
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
    <div className="flex flex-col items-center gap-2">
      {isBot && (
        <div className="text-yellow-400 text-xs mb-1">
          {translations.actionButtons.botThinking}
        </div>
      )}
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={() => onAction("check")}
          disabled={!canCheck || disabled}
          className={`
            px-4 py-2 rounded-lg font-bold text-sm transition-all
            ${
              canCheck && !disabled
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          {translations.actionButtons.check}
        </button>

        <button
          onClick={() => onAction("call")}
          disabled={!canCall || disabled}
          className={`
            px-4 py-2 rounded-lg font-bold text-sm transition-all
            ${
              canCall && !disabled
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          {translations.actionButtons.call} {toCall > 0 ? `$${toCall}` : ""}
        </button>

        <button
          onClick={() => {
            setShowRaiseInput(true);
          }}
          disabled={!canRaise || disabled}
          className={`
            px-4 py-2 rounded-lg font-bold text-sm transition-all
            ${
              canRaise && !disabled
                ? "bg-orange-500 hover:bg-orange-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          {isFirstAction
            ? translations.actionButtons.bet
            : translations.actionButtons.raise}
        </button>

        <button
          onClick={() => onAction("fold")}
          disabled={!canFold || disabled}
          className={`
            px-4 py-2 rounded-lg font-bold text-sm transition-all
            ${
              canFold && !disabled
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          {translations.actionButtons.fold}
        </button>

        <button
          onClick={() => onAction("allin")}
          disabled={!canAllIn || disabled}
          className={`
            px-4 py-2 rounded-lg font-bold text-sm transition-all
            ${
              canAllIn && !disabled
                ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          {translations.actionButtons.allin}
        </button>
      </div>

      {showRaiseInput && (
        <div className="flex gap-2 items-center bg-black/40 p-2 rounded-lg">
          <input
            type="number"
            value={raiseAmount}
            onChange={(e) => setRaiseAmount(e.target.value)}
            placeholder={translations.actionButtons.raisePlaceholder(
              toCall,
              minTargetExtra,
              minTargetTotal,
            )}
            className="px-2 py-1 rounded bg-white/10 text-white border border-white/20 w-48 text-sm"
          />
          <button
            onClick={handleRaise}
            disabled={
              !raiseAmount ||
              parseInt(raiseAmount) < minTargetTotal ||
              parseInt(raiseAmount) <= playerBet ||
              parseInt(raiseAmount) > playerBet + playerChips
            }
            className="px-3 py-1 bg-yellow-500 text-black rounded font-bold text-sm disabled:opacity-50"
          >
            {translations.actionButtons.confirm}
          </button>
          <button
            onClick={() => {
              setShowRaiseInput(false);
              setRaiseAmount("");
            }}
            className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
          >
            {translations.actionButtons.cancel}
          </button>
        </div>
      )}
    </div>
  );
};