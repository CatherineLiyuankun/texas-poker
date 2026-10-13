import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { StartPage } from './components/StartPage';
import { GameBoard } from './components/GameBoard';
import { clearGameProgress, isPrefixRoster } from './utils/gamePersistence';
import type { SavedProgress } from './utils/gamePersistence';
import type { GameScenario } from './utils/gtoConfig';
import { NO_RAKE, type RakeConfig } from './utils/rake';
import {
  allocateBotTypes,
  botIdsForRange,
  normalizeBotPersonalityConfig,
  toBotTypeMap,
  type BotTypeMap,
} from './utils/botPersonality';

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
  // Bot 性格的**有效**配置。分配只在「新盘初始化边界」发生一次，由 App 持有
  // （稳定归属），`GameBoard` 只透传、不重抽（方案 §5 / §6.3）。
  const [botPersonalityEnabled, setBotPersonalityEnabled] = useState(false);
  const [botTypes, setBotTypes] = useState<BotTypeMap>({});

  const handleStartGame = (
    realPlayerCount: number,
    botPlayerCount: number,
    smallBlind: number,
    rake: RakeConfig,
    personalityEnabled: boolean = true,
  ) => {
    clearGameProgress();
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
    setSavedGtoEnabled(undefined);
    setSavedScenario(undefined);
    setSavedRake(undefined);
    // 新盘边界：分配**只在这里**发生一次。这是事件处理器，不受 StrictMode 双执行
    // 影响，因此不会重抽（方案 §5）。B=0 时按 A′ 也得到空 map，但**保留**开关意图
    // `true`（方案 §6.2「B=0」行）。
    setBotPersonalityEnabled(personalityEnabled);
    setBotTypes(
      personalityEnabled
        ? toBotTypeMap(
            botIdsForRange(realPlayerCount, botPlayerCount),
            allocateBotTypes(botPlayerCount),
          )
        : {},
    );
    setPlayerConfig({
      realPlayers: realPlayerCount,
      botPlayers: botPlayerCount,
      smallBlind,
      rake,
    });
    setGameStarted(true);
  };

  const handleResumeGame = (progress: SavedProgress): boolean => {
    // 名单必须是前缀布局（真人 1..R、Bot R+1..R+B），否则按人数恢复会静默错位；
    // 拒绝恢复并交由 `StartPage` 提示（方案 §6.2）。
    if (!isPrefixRoster(progress)) return false;
    // 与「新局」共用同一份规范化：旧缺字段 → 关闭；true + map 损坏 → 整盘退回关闭
    // （决策 31/36）。恢复**不重抽**（决策 15）。
    const personality = normalizeBotPersonalityConfig(
      progress,
      botIdsForRange(progress.realPlayers.length, progress.botPlayers.length),
    );
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
    setBotPersonalityEnabled(personality.enabled);
    setBotTypes(personality.types);
    setGameStarted(true);
    return true;
  };

  const handleBackToMenu = () => {
    setGameStarted(false);
    setSavedChips(undefined);
    setSavedBuyInCounts(undefined);
    setSavedGtoEnabled(undefined);
    setSavedScenario(undefined);
    setSavedRake(undefined);
    // 返回菜单后另开新盘：清除旧分配，不借用前一盘的 state 默认（方案 §6.2）。
    setBotPersonalityEnabled(false);
    setBotTypes({});
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
      <GameBoard playerConfig={playerConfig} savedChips={savedChips} savedBuyInCounts={savedBuyInCounts} savedGtoEnabled={savedGtoEnabled} savedScenario={savedScenario} savedRake={savedRake} botPersonalityEnabled={botPersonalityEnabled} botTypes={botTypes} onBackToMenu={handleBackToMenu} />
      <Analytics />
    </>
  );
}

export default App;
