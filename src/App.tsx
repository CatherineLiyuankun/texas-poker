import { useState } from 'react';
import { StartPage } from './components/StartPage';
import { GameBoard } from './components/GameBoard';

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [playerConfig, setPlayerConfig] = useState({
    realPlayers: 2,
    botPlayers: 0,
    smallBlind: 5,
  });

  const handleStartGame = (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
  ) => {
    setPlayerConfig({
      realPlayers: realPlayerCount,
      botPlayers: botPlayerCount,
      smallBlind,
    });
    setGameStarted(true);
  };

  const handleBackToMenu = () => {
    setGameStarted(false);
  };

  if (!gameStarted) {
    return <StartPage onStartGame={handleStartGame} />;
  }

  return <GameBoard playerConfig={playerConfig} onBackToMenu={handleBackToMenu} />;
}

export default App;
