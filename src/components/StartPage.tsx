import React, { useState } from 'react';
import { translations } from '../utils/translations';
import { loadGameProgress, clearGameProgress } from '../utils/gamePersistence';
import type { SavedProgress } from '../utils/gamePersistence';

interface StartPageProps {
  onStartGame: (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
  ) => void;
  onResumeGame: (progress: SavedProgress) => void;
}

export const StartPage: React.FC<StartPageProps> = ({ onStartGame, onResumeGame }) => {
  const [realPlayers, setRealPlayers] = useState(2);
  const [botPlayers, setBotPlayers] = useState(0);
  const [smallBlind, setSmallBlind] = useState(5);
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(
    () => loadGameProgress(),
  );

  const handleClearProgress = () => {
    if (confirm(translations.persistence.confirmClear)) {
      clearGameProgress();
      setSavedProgress(null);
    }
  };

  const totalPlayers = realPlayers + botPlayers;
  const isValid =
    totalPlayers >= 2 && totalPlayers <= 10 && smallBlind >= 1 && smallBlind <= 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/80 backdrop-blur-sm rounded-2xl p-8 max-w-lg w-full shadow-2xl border border-green-700">
        <h1 className="text-4xl font-bold text-white text-center mb-8">
          {translations.startPage.title}
        </h1>

        <div className="space-y-6 mb-8">
          <div className="flex items-start gap-6">
            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-white/80 text-lg mb-3">
                  {translations.startPage.realPlayers}
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setRealPlayers(Math.max(1, realPlayers - 1))}
                    className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
                  >
                    -
                  </button>
                  <span className="text-3xl font-bold text-white w-12 text-center">
                    {realPlayers}
                  </span>
                  <button
                    onClick={() => setRealPlayers(Math.min(2, realPlayers + 1))}
                    className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-white/80 text-lg mb-3">
                  {translations.startPage.botPlayers}
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setBotPlayers(Math.max(0, botPlayers - 1))}
                    className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
                  >
                    -
                  </button>
                  <span className="text-3xl font-bold text-white w-12 text-center">
                    {botPlayers}
                  </span>
                  <button
                    onClick={() => setBotPlayers(Math.min(8, botPlayers + 1))}
                    className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <div className="text-center py-4 px-5 bg-green-900/50 rounded-lg">
                <p className="text-white/60 text-sm">
                  {translations.startPage.totalPlayers}
                </p>
                <p className="text-2xl font-bold text-yellow-400">{totalPlayers}</p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-6">
            <div className="flex-1">
              <label className="block text-white/80 text-lg mb-3">
                {translations.startPage.smallBlindLabel}
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={smallBlind}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      setSmallBlind(Math.min(100, Math.max(1, val)));
                    }
                  }}
                  className="w-24 h-12 bg-green-900/50 border border-green-600 text-white text-2xl font-bold text-center rounded-lg focus:outline-none focus:border-yellow-400"
                />
                <span className="text-white/60 text-sm">1 - 100</span>
              </div>
            </div>

            <div className="flex items-center">
              <div className="text-center py-2 px-4 bg-green-900/30 rounded-lg space-y-1">
                <p className="text-white/60 text-sm">
                  {translations.startPage.smallBlindInfo(smallBlind)}
                </p>
                <p className="text-white/60 text-sm">
                  {translations.startPage.initialChipsInfo(smallBlind)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => isValid && onStartGame(realPlayers, botPlayers, smallBlind)}
          disabled={!isValid}
          className={`w-full py-4 text-2xl font-bold rounded-xl transition-all ${
            isValid
              ? 'bg-yellow-500 hover:bg-yellow-600 text-black hover:scale-105'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
        >
          {translations.startPage.startGame}
        </button>

        {savedProgress && (
          <div className="mt-6 border-t border-green-600 pt-6">
            <button
              onClick={() => onResumeGame(savedProgress)}
              className="w-full py-3 text-xl font-bold rounded-xl bg-blue-500 hover:bg-blue-600 text-white transition-all hover:scale-105 mb-2"
            >
              {translations.persistence.continueGame}
            </button>

            <button
              onClick={handleClearProgress}
              className="w-full py-2 text-sm font-bold rounded-xl bg-red-900/40 hover:bg-red-700/60 text-white/70 hover:text-white transition-all mb-4"
            >
              {translations.persistence.clearProgress}
            </button>

            <div className="text-center mb-4">
              <p className="text-white/80 text-lg font-bold">
                {translations.persistence.savedProgress}
              </p>
              <p className="text-white/50 text-sm">
                {translations.persistence.savedAt(
                  new Date(savedProgress.savedAt).toLocaleString(),
                )}
              </p>
            </div>

            <div className="bg-green-900/50 rounded-lg p-3 space-y-1">
              {savedProgress.chips.map((chips, idx) => {
                const isReal = savedProgress.realPlayers.includes(idx + 1);
                const name = isReal
                  ? `玩家${idx + 1}`
                  : `Bot${idx + 1}`;
                return (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className={isReal ? 'text-white' : 'text-white/60'}>
                      {name}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-yellow-400 font-bold">${chips}</span>
                      {savedProgress.buyInCounts[idx] > 0 && (
                        <span className="text-orange-400 text-xs">
                          (-{savedProgress.buyInCounts[idx] * savedProgress.smallBlind * 200})
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
