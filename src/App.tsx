import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { StartPage } from './components/StartPage';
import { GameBoard } from './components/GameBoard';
import { clearGameProgress } from './utils/gamePersistence';
import type { SavedProgress } from './utils/gamePersistence';
import type { GameScenario } from './utils/gtoConfig';
import { NO_RAKE, type RakeConfig } from './utils/rake';

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [playerConfig, setPlayerConfig] = useState({
    realPlayers: 2,
    botPlayers: 0,
    smallBlind: 10,
    rake: { ...NO_RAKE } as RakeConfig,
  });
  const [savedChips, setSavedChips] = useState<number[] | undefined>(undefined);
  const [savedBuyInCounts, setSavedBuyInCounts] = useState<number[] | undefined>(undefined);
  const [savedGtoEnabled, setSavedGtoEnabled] = useState<boolean | undefined>(undefined);
  const [savedScenario, setSavedScenario] = useState<GameScenario | undefined>(undefined);
  const [savedRake, setSavedRake] = useState<RakeConfig | undefined>(undefined);

  const handleStartGame = (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
    rake: RakeConfig,
  ) => {
    clearGameProgress();
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
    setSavedGtoEnabled(undefined);
    setSavedScenario(undefined);
    setSavedRake(undefined);
    setPlayerConfig({
      realPlayers: realPlayerCount,
      botPlayers: botPlayerCount,
      smallBlind,
      rake,
    });
    setGameStarted(true);
  };

  const handleResumeGame = (progress: SavedProgress) => {
    setPlayerConfig({
      realPlayers: progress.realPlayers.length,
      botPlayers: progress.botPlayers.length,
      smallBlind: progress.smallBlind,
      rake: { ...NO_RAKE },
    });
    setSavedChips(progress.chips);
    setSavedBuyInCounts(progress.buyInCounts);
    setSavedGtoEnabled(progress.gtoEnabled);
    setSavedScenario(progress.scenario);
    setSavedRake(progress.rake);
    setGameStarted(true);
  };

  const handleBackToMenu = () => {
    setGameStarted(false);
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
    setSavedGtoEnabled(undefined);
    setSavedScenario(undefined);
    setSavedRake(undefined);
  };

  if (!gameStarted) {
    return (
      <>
        <StartPage onStartGame={handleStartGame} onResumeGame={handleResumeGame} />
        <Analytics />
      </>
    );
  }

  return (
    <>
      <GameBoard playerConfig={playerConfig} savedChips={savedChips} savedBuyInCounts={savedBuyInCounts} savedGtoEnabled={savedGtoEnabled} savedScenario={savedScenario} savedRake={savedRake} onBackToMenu={handleBackToMenu} />
      <Analytics />
    </>
  );
}

export default App;
