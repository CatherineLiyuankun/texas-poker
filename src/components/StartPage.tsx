import React, { useRef, useState } from 'react';
import { translations } from '../utils/translations';
import { loadGameProgress, clearGameProgress } from '../utils/gamePersistence';
import { resetLongTermStats, exportStats, importStats } from '../utils/longOpponentModel';
import type { SavedProgress } from '../utils/gamePersistence';
import { NO_RAKE, type RakeConfig, type RakeMode } from '../utils/rake';

/** 抽水输入的上限，和输入框的 min/max 保持一致。 */
const RAKE_PERCENT_MAX = 20;
const RAKE_BB_MAX = 10;
const RAKE_CAP_MAX = 20;

interface StartPageProps {
  onStartGame: (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
    rake: RakeConfig,
  ) => void;
  onResumeGame: (progress: SavedProgress) => void;
}

export const StartPage: React.FC<StartPageProps> = ({ onStartGame, onResumeGame }) => {
  const [realPlayers, setRealPlayers] = useState(2);
  const [botPlayers, setBotPlayers] = useState(0);
  const [smallBlind, setSmallBlind] = useState(5);
  // 抽水：模式 + 数值 + 封顶。三者分开存，切换模式时不清空用户已填的数值。
  const [rakeMode, setRakeMode] = useState<RakeMode>(NO_RAKE.mode);
  const [rakeValue, setRakeValue] = useState(NO_RAKE.value);
  const [rakeCapBB, setRakeCapBB] = useState(NO_RAKE.capBB);
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(
    () => loadGameProgress(),
  );
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const handleClearProgress = () => {
    if (confirm(translations.persistence.confirmClear)) {
      clearGameProgress();
      setSavedProgress(null);
    }
  };

  const handleExport = () => {
    exportStats();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importStats(file);
    if (result.success) {
      setSavedProgress(loadGameProgress());
      setImportMessage(
        result.hasProgress
          ? translations.playerStats.importSuccessWithProgress
          : translations.playerStats.importSuccess,
      );
    } else {
      setImportMessage(translations.playerStats.importFailed);
    }
    setTimeout(() => setImportMessage(null), 3000);
    e.target.value = '';
  };

  const totalPlayers = realPlayers + botPlayers;
  const isValid =
    totalPlayers >= 2 && totalPlayers <= 10 && smallBlind >= 1 && smallBlind <= 100;

  const bigBlind = smallBlind * 2;
  // 封顶只在「按百分比」下有意义：固定大盲模式的抽水本身就是固定值，
  // 再封顶只是把它变成另一个更小的固定值。所以 bb 模式提交时把 capBB 归零。
  const rake: RakeConfig = {
    mode: rakeMode,
    value: rakeValue,
    capBB: rakeMode === 'percent' ? rakeCapBB : 0,
  };
  const rakeText = translations.startPage.rake;
  // 摘要行：把 (模式, 数值, 封顶) 翻成一句人话，顺带把「几个大盲」换算成筹码。
  const rakeSummary = (() => {
    if (rakeMode === 'none' || rakeValue <= 0) return rakeText.none;
    if (rakeMode === 'percent') {
      return rakeText.percent(rakeValue, rakeCapBB, rakeCapBB * bigBlind);
    }
    return rakeText.bb(rakeValue);
  })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-8 max-w-lg w-full shadow-2xl border border-green-700">
        <h1 className="text-4xl font-bold text-white text-center mb-8">
          {translations.startPage.title}
        </h1>

        <div className="space-y-6 mb-8">
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
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

          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
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

          <div className="flex flex-col sm:flex-row items-start gap-2 sm:gap-6">
            <div className="flex-1 w-full">
              {/* 一行放下「标签 + 模式」，下方只在需要时出现数值输入 —— 尽量紧凑。 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="text-white/80 text-sm whitespace-nowrap">
                  {rakeText.label}
                </label>
                <div className="flex items-center gap-1">
                  {(['none', 'percent', 'bb'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setRakeMode(m);
                        // 两个模式的上限不同（比例 20 / 大盲 10）。数值是共享的，
                        // 所以切模式时必须重新夹一次，否则会留下「显示 15 但上限 10」
                        // 这种自相矛盾的状态，而且那个 15 会被当成 15BB 用。
                        if (m === 'percent') {
                          setRakeValue((v) => Math.min(RAKE_PERCENT_MAX, v));
                        } else if (m === 'bb') {
                          setRakeValue((v) => Math.min(RAKE_BB_MAX, v));
                        }
                      }}
                      aria-pressed={rakeMode === m}
                      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
                        rakeMode === m
                          ? 'bg-yellow-500 text-black'
                          : 'bg-green-900/50 text-white/60 hover:text-white'
                      }`}
                    >
                      {m === 'none'
                        ? rakeText.modeNone
                        : m === 'percent'
                          ? rakeText.modePercent
                          : rakeText.modeBb}
                    </button>
                  ))}
                </div>
                {rakeMode !== 'none' && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <input
                      type="number"
                      aria-label={rakeText.valueAria}
                      min={0}
                      max={rakeMode === 'percent' ? RAKE_PERCENT_MAX : RAKE_BB_MAX}
                      step={rakeMode === 'percent' ? 1 : 0.5}
                      value={rakeValue}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const max = rakeMode === 'percent' ? RAKE_PERCENT_MAX : RAKE_BB_MAX;
                        setRakeValue(isNaN(val) ? 0 : Math.min(max, Math.max(0, val)));
                      }}
                      className="w-14 h-8 bg-green-900/50 border border-green-600 text-white text-base font-bold text-center rounded focus:outline-none focus:border-yellow-400"
                    />
                    <span className="text-white/60 text-xs whitespace-nowrap">
                      {rakeMode === 'percent' ? rakeText.valuePercent : rakeText.valueBb}
                    </span>
                    {/* 封顶只在「按百分比」下有意义（固定大盲已是固定值）。 */}
                    {rakeMode === 'percent' && (
                      <>
                        <input
                          type="number"
                          aria-label={rakeText.capAria}
                          min={0}
                          max={RAKE_CAP_MAX}
                          step={1}
                          value={rakeCapBB}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            setRakeCapBB(
                              isNaN(val) ? 0 : Math.min(RAKE_CAP_MAX, Math.max(0, val)),
                            );
                          }}
                          className="w-14 h-8 bg-green-900/50 border border-green-600 text-white text-base font-bold text-center rounded focus:outline-none focus:border-yellow-400"
                        />
                        <span className="text-white/60 text-xs whitespace-nowrap">
                          {rakeText.capLabel}({rakeText.capUnit})
                        </span>
                        <span className="text-white/40 text-[10px] whitespace-nowrap">
                          {rakeText.capHint}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="text-center py-1.5 px-3 bg-green-900/30 rounded-lg max-w-[15rem]">
              <p className="text-white/60 text-xs">{rakeSummary}</p>
              <p className="text-white/40 text-[10px]">{rakeText.tournamentNote}</p>
            </div>
          </div>
        </div>

        <button
          onClick={() => isValid && onStartGame(realPlayers, botPlayers, smallBlind, rake)}
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

        <div className="mt-6 border-t border-green-600 pt-4">
          {importMessage && (
            <p className="text-center text-yellow-400 text-sm mb-3">{importMessage}</p>
          )}
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => {
                if (confirm(translations.playerStats.resetStats + '?')) {
                  resetLongTermStats();
                }
              }}
              className="px-3 py-1.5 bg-blue-900/40 hover:bg-red-700/60 text-white/70 hover:text-white text-xs rounded font-bold"
              title={translations.playerStats.resetStats}
            >
              {translations.playerStats.resetStats}
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 bg-blue-900/40 hover:bg-blue-700/60 text-white/70 hover:text-white text-xs rounded font-bold"
              title={translations.playerStats.exportStats}
            >
              {translations.playerStats.exportStats}
            </button>
            <label
              className="px-3 py-1.5 bg-blue-900/40 hover:bg-green-700/60 text-white/70 hover:text-white text-xs rounded font-bold cursor-pointer"
              title={translations.playerStats.importStats}
            >
              {translations.playerStats.importStats}
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
