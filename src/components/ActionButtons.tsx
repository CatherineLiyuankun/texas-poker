import React, { useState } from "react";
import type { Action } from "../types/poker";

interface ActionButtonsProps {
  onAction: (action: Action, amount?: number) => void;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  canFold: boolean;
  lastBet: number;
  playerBet: number;
  disabled?: boolean;
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
}) => {
  const [showRaiseInput, setShowRaiseInput] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState("");

  // 保证每次关键bet上下文变化都重置输入框UI
  React.useEffect(() => {
    setShowRaiseInput(false);
    setRaiseAmount("");
  }, [lastBet, playerBet, canRaise]);

  const toCall = lastBet - playerBet;
  // --- 修正德州扑克标准最少加注逻辑 ---
  // 1. 初次加注：最少加注为大盲值
  // 2. 后续加注，最少加注为上一次加注“增量”
  // 这里直接import大盲数值

  const BIG_BLIND = 20; // TODO: 若以后动态，请将其通过props传递

  let minTargetTotal = lastBet + (lastBet - playerBet);
  if (minTargetTotal <= lastBet) {
    minTargetTotal = lastBet + BIG_BLIND;
  }



  const handleRaise = () => {
    const targetTotal = parseInt(raiseAmount);
    if (!isNaN(targetTotal) && targetTotal >= minTargetTotal && targetTotal > playerBet) {
      const realRaise = targetTotal - playerBet;
      onAction("raise", realRaise);
      setRaiseAmount("");
      setShowRaiseInput(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={() => onAction("check")}
          disabled={!canCheck || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canCheck && !disabled
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          看牌 (Check)
        </button>

        <button
          onClick={() => onAction("call")}
          disabled={!canCall || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canCall && !disabled
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          跟注 {toCall > 0 ? `$${toCall}` : ""} (Call)
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
          加注 (Raise)
        </button>

        <button
          onClick={() => onAction("fold")}
          disabled={!canFold || disabled}
          className={`
            px-6 py-3 rounded-lg font-bold text-lg transition-all
            ${
              canFold && !disabled
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-gray-500/30 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          弃牌 (Fold)
        </button>
      </div>

      {showRaiseInput && (
        <div className="flex gap-2 items-center bg-black/40 p-3 rounded-lg">
          <input
            type="number"
            value={raiseAmount}
            onChange={(e) => setRaiseAmount(e.target.value)}
            placeholder={`输入你想本轮最终下注的总额（至少 $${minTargetTotal}，你当前已下注 $${playerBet}）`}
            className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 w-80"
          />
          <button
            onClick={handleRaise}
            disabled={!raiseAmount || parseInt(raiseAmount) < minTargetTotal || parseInt(raiseAmount) <= playerBet}
            className="px-4 py-2 bg-yellow-500 text-black rounded font-bold disabled:opacity-50"
          >
            确认
          </button>
          <button
            onClick={() => {
              setShowRaiseInput(false);
              setRaiseAmount("");
            }}
            className="px-4 py-2 bg-gray-500 text-white rounded"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
};
