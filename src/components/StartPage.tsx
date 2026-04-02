import React, { useState } from 'react';
import { translations } from '../utils/translations';

interface StartPageProps {
  onStartGame: (realPlayerCount: number, botPlayerCount: number) => void;
}

export const StartPage: React.FC<StartPageProps> = ({ onStartGame }) => {
  const [realPlayers, setRealPlayers] = useState(2);
  const [botPlayers, setBotPlayers] = useState(0);

  const totalPlayers = realPlayers + botPlayers;
  const isValid = totalPlayers >= 2 && totalPlayers <= 10;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/80 backdrop-blur-sm rounded-2xl p-8 max-w-md w-full shadow-2xl border border-green-700">
        <h1 className="text-4xl font-bold text-white text-center mb-8">{translations.startPage.title}</h1>

        <div className="space-y-6 mb-8">
          <div>
            <label className="block text-white/80 text-lg mb-3">{translations.startPage.realPlayers}</label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setRealPlayers(Math.max(1, realPlayers - 1))}
                className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
              >
                -
              </button>
              <span className="text-3xl font-bold text-white w-12 text-center">{realPlayers}</span>
              <button
                onClick={() => setRealPlayers(Math.min(2, realPlayers + 1))}
                className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
              >
                +
              </button>
            </div>
          </div>

          <div>
            <label className="block text-white/80 text-lg mb-3">{translations.startPage.botPlayers}</label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setBotPlayers(Math.max(0, botPlayers - 1))}
                className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
              >
                -
              </button>
              <span className="text-3xl font-bold text-white w-12 text-center">{botPlayers}</span>
              <button
                onClick={() => setBotPlayers(Math.min(8, botPlayers + 1))}
                className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-lg transition-colors"
              >
                +
              </button>
            </div>
          </div>

          <div className="text-center py-4 bg-green-900/50 rounded-lg">
            <p className="text-white/60 text-sm">{translations.startPage.totalPlayers}</p>
            <p className="text-2xl font-bold text-yellow-400">{totalPlayers}</p>
          </div>
        </div>

        <button
          onClick={() => isValid && onStartGame(realPlayers, botPlayers)}
          disabled={!isValid}
          className={`w-full py-4 text-2xl font-bold rounded-xl transition-all ${
            isValid
              ? 'bg-yellow-500 hover:bg-yellow-600 text-black hover:scale-105'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
        >
          {translations.startPage.startGame}
        </button>

        <div className="mt-6 text-white/60 text-center text-sm">
          <p>{translations.startPage.smallBlind}</p>
          <p>{translations.startPage.initialChips}</p>
        </div>
      </div>
    </div>
  );
};