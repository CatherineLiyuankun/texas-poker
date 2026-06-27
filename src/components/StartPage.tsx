import React, { useState } from 'react';
import { translations } from '../utils/translations';

interface StartPageProps {
  onStartGame: (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
  ) => void;
}

export const StartPage: React.FC<StartPageProps> = ({ onStartGame }) => {
  const [realPlayers, setRealPlayers] = useState(2);
  const [botPlayers, setBotPlayers] = useState(0);
  const [smallBlind, setSmallBlind] = useState(5);

  const totalPlayers = realPlayers + botPlayers;
  const isValid =
    totalPlayers >= 2 && totalPlayers <= 10 && smallBlind >= 1 && smallBlind <= 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/80 backdrop-blur-sm rounded-2xl p-8 max-w-md w-full shadow-2xl border border-green-700">
        <h1 className="text-4xl font-bold text-white text-center mb-8">
          {translations.startPage.title}
        </h1>

        <div className="space-y-6 mb-8">
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

          <div>
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

          <div className="text-center py-4 bg-green-900/50 rounded-lg">
            <p className="text-white/60 text-sm">
              {translations.startPage.totalPlayers}
            </p>
            <p className="text-2xl font-bold text-yellow-400">{totalPlayers}</p>
          </div>

          <div className="text-center py-2 bg-green-900/30 rounded-lg space-y-1">
            <p className="text-white/60 text-sm">
              {translations.startPage.smallBlindInfo(smallBlind)}
            </p>
            <p className="text-white/60 text-sm">
              {translations.startPage.initialChipsInfo(smallBlind)}
            </p>
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
      </div>
    </div>
  );
};
