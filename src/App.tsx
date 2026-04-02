import { useState } from 'react';
import { StartPage } from './components/StartPage';
import { GameBoard } from './components/GameBoard';

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [playerConfig, setPlayerConfig] = useState({ realPlayers: 2, botPlayers: 0 });

  const handleStartGame = (realPlayerCount: number, botPlayerCount: number) => {
    setPlayerConfig({ realPlayers: realPlayerCount, botPlayers: botPlayerCount });
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