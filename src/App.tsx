import { useState } from 'react';
import { StartPage } from './components/StartPage';
import { GameBoard } from './components/GameBoard';
import { clearGameProgress } from './utils/gamePersistence';
import type { SavedProgress } from './utils/gamePersistence';

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [playerConfig, setPlayerConfig] = useState({
    realPlayers: 2,
    botPlayers: 0,
    smallBlind: 10,
  });
  const [savedChips, setSavedChips] = useState<number[] | undefined>(undefined);
  const [savedBuyInCounts, setSavedBuyInCounts] = useState<number[] | undefined>(undefined);

  const handleStartGame = (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
  ) => {
    clearGameProgress();
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
    setPlayerConfig({
      realPlayers: realPlayerCount,
      botPlayers: botPlayerCount,
      smallBlind,
    });
    setGameStarted(true);
  };

  const handleResumeGame = (progress: SavedProgress) => {
    setPlayerConfig({
      realPlayers: progress.realPlayers.length,
      botPlayers: progress.botPlayers.length,
      smallBlind: progress.smallBlind,
    });
    setSavedChips(progress.chips);
    setSavedBuyInCounts(progress.buyInCounts);
    setGameStarted(true);
  };

  const handleBackToMenu = () => {
    setGameStarted(false);
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
  };

  if (!gameStarted) {
    return <StartPage onStartGame={handleStartGame} onResumeGame={handleResumeGame} />;
  }

  return <GameBoard playerConfig={playerConfig} savedChips={savedChips} savedBuyInCounts={savedBuyInCounts} onBackToMenu={handleBackToMenu} />;
}

export default App;
