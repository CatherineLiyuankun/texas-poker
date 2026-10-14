import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGameState, bettingComplete, isActionAccepted } from '../hooks/useGameState';
import { PlayerArea } from './PlayerArea';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { ActionButtons } from './ActionButtons';
import { PokerTable } from './PokerTable';
import { HandRankingGuide } from './HandRankingGuide';
import { PlayerStatsTable } from './PlayerStatsTable';
import { calculatePlayerPositions, getPositionLabel } from '../utils/tablePositions';
import { getBotAction, computePositionFlags } from '../utils/botAI';
import { setGtoConfig, type GameScenario } from '../utils/gtoConfig';
// SPR / 有效筹码的唯一来源：面板 SPR 行不再自己内联 `min(hero, 各活跃对手) / pot`。
import { sprFromState } from '../utils/spr';
import { NO_RAKE, setRakeConfig, type RakeConfig } from '../utils/rake';
import {
  getGtoPreflopRecommendation,
  getRfiPositionForDisplay,
  getDefenderPositionForDisplay,
  getOpenerPosition,
  detectPreflopScenario,
} from '../utils/gtoPreflop';
import { computePotOddsFor } from '../utils/potOdds';
import { evaluateHand } from '../utils/handEvaluator';
import { calculateOpponentProfile, resetOpponentStats, startNewHand, recordAction, getCurrentHand, setCurrentHandShowdownPlayers, setCurrentHandFlopSeenPlayers, setCurrentHandShowdownWinners, beginSession, getSessionId, makeHandId } from '../utils/opponentModel';
import {
  saveHand,
  getAllPlayerLongStats,
  getTypeLongStats,
} from '../utils/longOpponentModel';
import { saveGameProgress } from '../utils/gamePersistence';
import type { BotTypeMap } from '../utils/botPersonality';
import { HAND_RANK_NAMES, type Action, type GamePhase, type PlayerId } from '../types/poker';
import type { ActionEvent, PlayerRole } from '../types/stats';
import { translations } from '../utils/translations';

interface PlayerConfig {
  realPlayers: number;
  botPlayers: number;
  smallBlind: number;
  /**
   * 抽水（桌面条件）。由 `StartPage` 设定，见 `rake.ts`。
   * 可选：缺省按「不抽水」兜底，与抽水可配置之前的行为逐位一致
   * （也让既有测试不必逐个补字段）。
   */
  rake?: RakeConfig;
}

interface GameBoardProps {
  playerConfig: PlayerConfig;
  savedChips?: number[];
  savedBuyInCounts?: number[];
  savedGtoEnabled?: boolean;
  savedScenario?: GameScenario;
  savedRake?: RakeConfig;
  /**
   * 本盘是否启用 Bot 性格，以及有效分配 map。由 `App` 在**新盘边界分配一次**后
   * 透传下来（方案 §6.3）；本组件只透传、**不重抽**。缺省视为关闭 + 空 map。
   */
  botPersonalityEnabled?: boolean;
  botTypes?: BotTypeMap;
  onBackToMenu: () => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  playerConfig,
  savedChips,
  savedBuyInCounts,
  savedGtoEnabled,
  savedScenario,
  savedRake,
  botPersonalityEnabled = false,
  botTypes = {},
  onBackToMenu,
}) => {
  const {
    state,
    startGame,
    playerAction,
    revealHand,
    nextStreet,
    collectPot,
    resetRound,
    canPlayerAct,
  } = useGameState();

  const gameInitialized = useRef(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasBettingCompleteRef = useRef(false);
  const handCounterRef = useRef(0);
  const handKeyRef = useRef<string>('');
  /**
   * 当前这一手的**稳定身份**（`sessionId + 盘内手序`，方案 §8.2）。
   *
   * `createActionEvent` 与开手记录共用它，不再各拼一遍字符串 —— 旧实现两处
   * 各自拼 `${handCounter}-${dealer}-${底牌}`，任一处改动就会让「事件的 handId」
   * 与「容器的 handId」分叉。
   */
  const handIdRef = useRef<string>('');
  const [gtoEnabled, setGtoEnabled] = useState(savedGtoEnabled ?? false);
  const [scenario, setScenario] = useState<GameScenario>(savedScenario ?? 'cash');
  const [playerRaiseAmounts, setPlayerRaiseAmounts] = useState<Record<number, number | null>>({});
  const [gameScale, setGameScale] = useState(1);
  const [chipSummaryOpen, setChipSummaryOpen] = useState(false);
  // 「玩家数据 Player Stats」浮层：默认收起，只显示右上角按钮。
  const [playerStatsOpen, setPlayerStatsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 引擎轴：把 UI 状态**双向**同步进全局配置。
  //
  // 旧实现只在 `savedGtoEnabled` 为真时写一次（`if (savedGtoEnabled) setGtoStrategy(true)`），
  // 于是「GTO 开 → 返回菜单 → 新开一局」会留下陈旧全局态：UI 显示 OFF，
  // 模块里却还是 GTO。改成按当前值无条件同步，顺带修掉这个 bug。
  useEffect(() => {
    setGtoConfig({ engine: gtoEnabled ? 'gto' : 'heuristic' });
  }, [gtoEnabled]);

  // 赛制轴：与引擎轴正交，两个 effect 各写自己那个字段（`setGtoConfig` 是合并语义，
  // 不会互相覆盖）。
  useEffect(() => {
    setGtoConfig({ scenario });
  }, [scenario]);

  // 抽水（桌面条件）：同样是「按当前值无条件同步」，避免「设了抽水 → 返回菜单 →
  // 新开一局」留下陈旧全局态。存档优先（续局时以存档为准）。
  const rakeSource = savedRake ?? playerConfig.rake;
  const rakeMode = rakeSource?.mode ?? NO_RAKE.mode;
  const rakeValue = rakeSource?.value ?? NO_RAKE.value;
  const rakeCapBB = rakeSource?.capBB ?? NO_RAKE.capBB;

  useEffect(() => {
    setRakeConfig({ mode: rakeMode, value: rakeValue, capBB: rakeCapBB });
  }, [rakeMode, rakeValue, rakeCapBB]);

  useEffect(() => {
    const updateScale = () => {
      const availableWidth = window.screen.width - 16;
      const availableHeight = window.screen.height - 160;
      const scaleX = availableWidth / 1050;
      const scaleY = availableHeight / 500;
      const scale = Math.min(1, scaleX, scaleY);
      setGameScale(scale);
    };
    updateScale();
    const mql = window.matchMedia('(orientation: portrait)');
    mql.addEventListener('change', updateScale);
    window.addEventListener('resize', updateScale);
    return () => {
      mql.removeEventListener('change', updateScale);
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  const createActionEvent = (
    playerId: number,
    action: Action,
    amount?: number,
    phaseOverride?: GamePhase,
  ): ActionEvent => {
    const player = state.players.find((p) => p.id === playerId);
    const toCall = state.lastBet - (player?.bet || 0);
    const position = (playerId - state.dealer + state.players.length) % state.players.length;
    const phase = phaseOverride ?? state.phase;
    const timestamp = Date.now();
    
    return {
      // 与容器记录同源：本手的身份在开手时算好放进 `handIdRef`（见下面的手牌检测 effect，
      // 它声明在机器人 effect 之前，所以任何动作事件派发时它已经就位）。
      handId: handIdRef.current,
      playerId: playerId as ActionEvent['playerId'],
      phase,
      action,
      amount,
      toCall,
      currentBet: state.lastBet,
      potSize: state.mainPot + (state.sidePots?.reduce((sum, pot) => sum + pot.amount, 0) || 0),
      position,
      // "面对下注/加注" 的语义就是「有需要跟注的金额」，全街道通用。
      // 原来写成 `state.lastBet > 0 && phase === 'preflop'`，翻后恒为 false，
      // 且翻前连大盲免费过牌也被判成 facing（lastBet 初始就是大盲）。
      isFacingRaise: toCall > 0,
      timestamp: timestamp,
    };
  };

  const handleRaiseAmountChange = (playerId: number, amount: number | null) => {
    setPlayerRaiseAmounts(prev => ({
      ...prev,
      [playerId]: amount,
    }));
  };

  useEffect(() => {
    if (
      !gameInitialized.current &&
      state.phase === 'preflop' &&
      state.players[0].hand.length === 0
    ) {
      gameInitialized.current = true;
      resetOpponentStats();
      // 新盘边界：换一个 sessionId 并清掉上一盘残留的手牌身份（方案 §8.2）。
      beginSession();
      handIdRef.current = '';
      startGame(
        playerConfig.realPlayers,
        playerConfig.botPlayers,
        playerConfig.smallBlind,
        savedChips,
        savedBuyInCounts,
        botPersonalityEnabled,
        botTypes,
      );
    }
  }, [
    state.phase,
    state.players,
    startGame,
    playerConfig,
    savedChips,
    savedBuyInCounts,
    botPersonalityEnabled,
    botTypes,
  ]);

  const currentPlayer = state.players[state.currentPlayer - 1];
  const roundSettled =
    state.winner !== null ||
    (state.phase === 'showdown' && state.mainPot === 0);

  const [adminRevealAll, setAdminRevealAll] = useState(false);

  const handleResetRound = () => {
    setAdminRevealAll(false);
    resetRound();
  };

  useEffect(() => {
    if (roundSettled && state.players.length > 0) {
      saveGameProgress({
        version: 1,
        chips: state.players.map((p) => p.chips),
        buyInCounts: state.players.map((p) => p.buyInCount),
        realPlayers: state.players.filter((p) => p.isRealPlayer).map((p) => p.id),
        botPlayers: state.players.filter((p) => !p.isRealPlayer).map((p) => p.id),
        smallBlind: state.smallBlind,
        dealer: state.dealer,
        savedAt: Date.now(),
        gtoEnabled,
        scenario,
        rake: { mode: rakeMode, value: rakeValue, capBB: rakeCapBB },
        // 有效开关 / map 随配置落盘（方案 §6.3）：以 state 为准（START_GAME 写入的
        // 就是本盘真正生效的那份），关闭时写 false + 空 map。
        botPersonalityEnabled: state.botPersonalityEnabled === true,
        botTypes: state.botTypes ?? {},
      });
    }
  }, [
    roundSettled,
    state.players,
    state.smallBlind,
    state.dealer,
    state.botPersonalityEnabled,
    state.botTypes,
    gtoEnabled,
    scenario,
    rakeMode,
    rakeValue,
    rakeCapBB,
  ]);

  const handleBackToMenu = () => {
    if (state.players.length > 0 && state.players[0].hand.length > 0) {
      saveGameProgress({
        version: 1,
        chips: state.players.map((p) => p.chips),
        buyInCounts: state.players.map((p) => p.buyInCount),
        realPlayers: state.players.filter((p) => p.isRealPlayer).map((p) => p.id),
        botPlayers: state.players.filter((p) => !p.isRealPlayer).map((p) => p.id),
        smallBlind: state.smallBlind,
        dealer: state.dealer,
        savedAt: Date.now(),
        gtoEnabled,
        scenario,
        rake: { mode: rakeMode, value: rakeValue, capBB: rakeCapBB },
        botPersonalityEnabled: state.botPersonalityEnabled === true,
        botTypes: state.botTypes ?? {},
      });
    }
    onBackToMenu();
  };

  useEffect(() => {
    const allFolded = state.players.filter((p) => !p.folded).length <= 1;
    if (allFolded && state.winner && state.mainPot > 0) {
      collectPot(state.winner);
    }
  }, [state.players, state.winner, state.mainPot, collectPot]);

  // 检测新牌局开始，记录长期统计（含开手快照，方案 §8.2）
  useEffect(() => {
    if (state.phase === 'preflop' && state.players.length > 0 && state.players[0].hand.length > 0) {
      const hero = state.players[0];
      // 手牌键必须带 `sessionId`：盘内以 (dealer, 底牌) 区分每一手，跨盘则天然不同。
      // 旧实现没带，返回菜单再开新盘时 handCounter 归零，于是「同 dealer + 同底牌」
      // 会被当成同一手（漏记）或撞上旧 id（长期库覆盖）。
      const currentHandKey = `${getSessionId()}-${state.dealer}-${hero.hand[0]?.rank}-${hero.hand[1]?.rank}`;
      if (handKeyRef.current !== currentHandKey) {
        handKeyRef.current = currentHandKey;
        handCounterRef.current++;
        const handId = makeHandId(handCounterRef.current);
        handIdRef.current = handId;
        const allPlayerIds = state.players.map((p) => p.id);
        // 开手快照（方案 §8.2）：在**开手这一刻**复制有效分配 map，不引用随后可变对象；
        // 关闭性格时写**空 map**（而不是省略字段），聚合侧据此区分「新记录且关闭」与
        // 「旧记录无字段」（方案 §8.3）。
        const playerTypes: BotTypeMap =
          state.botPersonalityEnabled === true ? { ...(state.botTypes ?? {}) } : {};
        // 开手身份快照：每座位 human/bot，不能从「当前 roles」反推 ——
        // 中途换人 / 换盘会把历史身份改错（方案 §8.2）。
        const playerRoles: Partial<Record<PlayerId, PlayerRole>> = {};
        for (const p of state.players) {
          playerRoles[p.id] = p.isRealPlayer ? 'human' : 'bot';
        }
        startNewHand(handId, allPlayerIds, playerTypes, playerRoles);
      }
    }
  }, [
    state.phase,
    state.players,
    state.dealer,
    state.botPersonalityEnabled,
    state.botTypes,
  ]);

  useEffect(() => {
    if (roundSettled) {
      const currentHand = getCurrentHand();
      const isShowdown = state.phase === 'showdown';
      const showdownPlayers = isShowdown
        ? state.players.filter(p => !p.folded).map(p => p.id)
        : undefined;

      if (showdownPlayers) {
        setCurrentHandShowdownPlayers(showdownPlayers);
      }

      // 翻牌是否真的发出：phase 一旦离开 preflop 就说明发了翻牌
      // （弃牌胜保留当前 phase，全下 runout 会推进到 showdown）。
      // 见翻牌名单 = 翻前未弃牌者，含翻前 all-in 后无动作的 runout ——
      // 不能用「本人是否有 flop 动作」推断（那样会漏掉全下者）。
      const preflopFoldedIds = new Set(
        (currentHand?.events ?? [])
          .filter(e => e.phase === 'preflop' && e.action === 'fold')
          .map(e => e.playerId),
      );
      const flopSeenPlayers = state.phase !== 'preflop'
        ? state.players.filter(p => !preflopFoldedIds.has(p.id)).map(p => p.id)
        : undefined;

      // 摊牌获奖者：从 potDistribution 汇总所有奖池中 > 0 的份额（含平分/边池）。
      // 单个 state.winner 无法表达多赢家/边池结果（WSD 需要真实获奖事实）。
      const showdownWinners = isShowdown
        ? state.players
            .filter((_, idx) =>
              state.potDistribution.some(pd => (pd.winnings[idx] ?? 0) > 0),
            )
            .map(p => p.id)
        : undefined;

      if (flopSeenPlayers) {
        setCurrentHandFlopSeenPlayers(flopSeenPlayers);
      }
      if (showdownWinners) {
        setCurrentHandShowdownWinners(showdownWinners);
      }

      if (currentHand) {
        const handWithResult: typeof currentHand = {
          ...currentHand,
          flopSeenPlayers,
          showdownPlayers,
          showdownWinners,
          result: {
            winner: state.winner,
            potAmount: state.players.reduce((sum, p) => sum + p.totalBet, 0),
          },
        };
        saveHand(handWithResult);
      }
    }
  }, [
    roundSettled,
    state.winner,
    state.players,
    state.phase,
    state.potDistribution,
  ]);

  const noRealCanAct = !state.players.some(
    (p) => p.isRealPlayer && !p.folded && !p.allIn && p.chips > 0,
  );

  // 本轮下注是否已经结束。判定收敛到 `useGameState.bettingComplete` 一处，
  // 让「机器人行动 / 真人按钮 / 街道推进」三处共用同一个口径：回合一旦结束，
  // 任何玩家都不该再行动 —— 否则最后一个行动者（翻前通常是机器人大盲）会在
  // 街道推进的动画间隙里再次加注，把其他人重新拉回行动，无限循环（见 #15）。
  //
  // 这里**只做转发，不再自己实现一遍**：以前两侧各写一份，遇到「盲注打光筹码的
  // 被动 all-in」时口径分叉（reducer 判「已结束」→ 吞掉加注；这里判「未结束」→
  // 亮按钮且不推进街道），真人卡在「点了没反应」的死局里（见
  // docs/PASSIVE_ALLIN_PLAN.md）。
  const bettingRoundComplete = useMemo(() => bettingComplete(state), [state]);

  useEffect(() => {
    if (!currentPlayer || currentPlayer.folded || roundSettled) return;
    if (currentPlayer.isRealPlayer) return;
    // 回合已结束：机器人不再行动，等街道推进。
    if (bettingRoundComplete) return;

    const decision = getBotAction(currentPlayer, state);
    const delay = noRealCanAct
      ? (decision.action === 'check' ? 200 : 400)
      : (decision.action === 'check' ? 400 : 600);

    const timer = setTimeout(() => {
      // 非法动作（金额越界 / 欠注 / 无权限等）会被 reducer 拒绝，此时**不得**
      // 记录统计事件 —— 否则统计里会出现一条从未真正发生过的动作（方案 §7.4）。
      if (!isActionAccepted(state, currentPlayer.id, decision.action, decision.amount)) {
        return;
      }
      playerAction(currentPlayer.id, decision.action, decision.amount);
      // Record action event for opponentModel
      const event = createActionEvent(
        currentPlayer.id,
        decision.action,
        decision.amount,
      );
      recordAction(event);
    }, delay);

    return () => clearTimeout(timer);
  }, [
    currentPlayer,
    roundSettled,
    state,
    playerAction,
    noRealCanAct,
    bettingRoundComplete,
  ]);

  const handleAction = (action: Action, amount?: number) => {
    const playerId = state.currentPlayer;
    const currentPhase = state.phase;
    // 与 reducer 共用同一接受口径：被拒绝的动作不派发、也不记统计事件。
    if (!isActionAccepted(state, playerId, action, amount)) return;
    playerAction(playerId, action, amount);
    const player = state.players.find((p) => p.id === playerId);
    if (player) {
      const event = createActionEvent(playerId, action, amount, currentPhase);
      recordAction(event);
    }
  };

  const handleNextPhase = () => {
    state.players.forEach((p) => revealHand(p.id));
    nextStreet();
  };

  useEffect(() => {
    if (roundSettled) {
      wasBettingCompleteRef.current = false;
      return;
    }
    if (state.phase === 'showdown') {
      wasBettingCompleteRef.current = false;
      return;
    }

    if (bettingRoundComplete && !wasBettingCompleteRef.current) {
      wasBettingCompleteRef.current = true;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
      }
      // 街道推进停顿：纯 UX 节奏（让玩家看清最后一次行动 / 底池变化），
      // 与正确性无关 —— 回合结束后机器人/真人都已被 bettingRoundComplete 拦下。
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        wasBettingCompleteRef.current = false;
        handleNextPhase();
      }, noRealCanAct ? 500 : 1000);
    } else if (!bettingRoundComplete) {
      wasBettingCompleteRef.current = false;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    }
  }, [
    state.phase,
    roundSettled,
    bettingRoundComplete,
    noRealCanAct,
    revealHand,
    nextStreet,
  ]);

  const currentPhaseCards =
    state.phase === 'preflop'
      ? []
      : state.phase === 'flop'
        ? state.communityCards.slice(0, 3)
        : state.phase === 'turn'
          ? state.communityCards.slice(0, 4)
          : state.communityCards;

  const getPlayerDisplayName = (
    player: (typeof state.players)[0],
    index: number,
  ): string => {
    if (player.isRealPlayer) {
      return `玩家${index + 1}`;
    }
    return `${translations.playerArea.bot}${index + 1}`;
  };

  const getNextPhaseLabel = () => {
    switch (state.phase) {
      case 'preflop':
        return translations.gameBoard.dealFlop;
      case 'flop':
        return translations.gameBoard.dealTurn;
      case 'turn':
        return translations.gameBoard.dealRiver;
      default:
        return translations.gameBoard.showCards;
    }
  };

  const realPlayerIds = state.players.filter((p) => p.isRealPlayer).map((p) => p.id);
  const botPlayerIds = state.players.filter((p) => !p.isRealPlayer).map((p) => p.id);
  const longStats = realPlayerIds.length > 0 ? getAllPlayerLongStats(realPlayerIds) : undefined;
  // Bot 行和真人行同口径：都读长期库（跨会话），不再只算当前会话。
  const botLongStats = botPlayerIds.length > 0 ? getAllPlayerLongStats(botPlayerIds) : undefined;
  // 按**分配类型**聚合的行（§8.1，P7）只在当前盘**开启性格**时展示 —— 关闭时传
  // `undefined`，表格退回「按座位展示实测类型」的旧形态，不伪装分配（决策 29）。
  // ⚠️ 长期库里可能混着历史上开启性格时的手（它们会按当时的快照分组），所以这里
  // 的开关只决定**是否展示类型行**，不影响分组本身（分组永远按每手自己的快照）。
  // ⚠️ 再叠一层 `playerStatsOpen`：这个值只被浮层内部的 `PlayerStatsTable` 消费，
  // 而聚合要遍历整个长期库（用户真实库 1000+ 手时是实打实的开销），所以**收起时不算**。
  // 只有展开的那几帧才付这份成本，收起状态下等于零成本。
  const typeStats =
    playerStatsOpen && state.botPersonalityEnabled === true ? getTypeLongStats() : undefined;
  // 「玩家数据 Player Stats」表原先挤在 AI 分析面板内部（13 列把面板撑到溢出边界，
  // 面板又被座位可用空间压到最窄，两边互相挤兑）。现在整块搬到右上角按钮的浮层里，
  // 口径统一为**所有玩家都读长期统计**（真人 + Bot 同源），不再有「自己看长期、
  // 对手看本局」的分叉。
  const handDealt = state.players.some((p) => p.hand.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 p-2 overflow-x-hidden">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-2 sm">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackToMenu}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm sm:text-base"
            >
              {translations.gameBoard.backToMenu}
            </button>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
              {/* 引擎轴：GTO / 启发式。全局配置的同步交给上面的 effect，这里只改 UI 状态。 */}
              <button
                onClick={() => setGtoEnabled(!gtoEnabled)}
                className={`px-2 py-1 text-xs rounded font-bold ${
                  gtoEnabled
                    ? 'bg-green-700/60 text-green-300 hover:bg-green-600/70'
                    : 'bg-gray-800/40 text-white/50 hover:text-white/70'
                }`}
              >
                {translations.gtoStrategy.toggle} {gtoEnabled ? translations.gtoStrategy.on : translations.gtoStrategy.off}
              </button>
              {/* 赛制轴：现金局 / 锦标赛。与引擎轴正交，两个开关互不影响。 */}
              <button
                onClick={() => setScenario(scenario === 'cash' ? 'tournament' : 'cash')}
                className={`px-2 py-1 text-xs rounded font-bold ${
                  scenario === 'tournament'
                    ? 'bg-amber-700/60 text-amber-200 hover:bg-amber-600/70'
                    : 'bg-gray-800/40 text-white/50 hover:text-white/70'
                }`}
              >
                {translations.scenario.toggle} {scenario === 'tournament' ? translations.scenario.tournament : translations.scenario.cash}
              </button>
              <div className="text-white/60 text-xs sm:text-sm whitespace-nowrap">
                {translations.gameBoard.realPlayers}: {playerConfig.realPlayers} |{' '}
                {translations.gameBoard.botPlayers}: {playerConfig.botPlayers}
              </div>
            </div>

            {/* 玩家数据 Player Stats：默认收起，只显示按钮；展开的表格是**绝对定位浮层**，
                不参与文档流，所以展开/收起都不会把牌桌往下推。z-[90] 高于座位（z-[70]）
                与筹码汇总（z-[50]）。发牌前（还没开局）不显示 —— 那时没有任何数据。 */}
            {handDealt && (
              <div className="relative">
                <button
                  onClick={() => setPlayerStatsOpen((v) => !v)}
                  aria-expanded={playerStatsOpen}
                  className="px-2 py-1 text-xs rounded font-bold bg-gray-800/60 text-white/70 hover:bg-gray-700/70 hover:text-white"
                >
                  {translations.playerStats.title} {playerStatsOpen ? '▾' : '▸'}
                </button>
                {playerStatsOpen && (
                  <div className="absolute right-0 top-full mt-1 z-[90] max-w-[calc(100vw-1rem)] overflow-x-auto bg-black/85 backdrop-blur-sm rounded-lg p-2 border border-white/20">
                    <PlayerStatsTable
                      longStats={longStats}
                      botLongStats={botLongStats}
                      typeStats={typeStats}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2">
          {roundSettled && (
            <div className="text-left">
              <div className="flex flex-wrap gap-2 sm:gap-3 mb-2">
                <button
                  onClick={handleResetRound}
                  className="px-4 py-1.5 sm:px-6 sm:py-2 text-sm sm:text-base bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold"
                >
                  {translations.gameBoard.nextRound}
                </button>
                <button
                  onClick={() => setAdminRevealAll((v) => !v)}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg font-bold ${
                    adminRevealAll
                      ? 'bg-orange-500 hover:bg-orange-600 text-white'
                      : 'bg-gray-600 hover:bg-gray-700 text-white'
                  }`}
                >
                  {adminRevealAll
                    ? translations.gameBoard.adminOff
                    : translations.gameBoard.adminOn}
                </button>
              </div>

              <div className="text-lg sm:text-3xl font-bold text-yellow-400 mb-1">
                {state.winner !== null
                  ? translations.gameBoard.playerWins(
                      getPlayerDisplayName(
                        state.players[state.winner - 1],
                        state.winner - 1,
                      ),
                    )
                  : translations.gameBoard.splitPot}
              </div>
              {state.phase === 'showdown' && (
                <div className="text-white/80 text-sm sm:text-base">
                  {state.players.map((p, idx) => {
                    if (p.folded) return null;
                    return (
                      <div key={p.id}>
                        {getPlayerDisplayName(p, idx)}:{' '}
                        {
                          HAND_RANK_NAMES[
                            evaluateHand(p.hand, state.communityCards).rank
                          ]
                        }
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!roundSettled && bettingRoundComplete && state.phase !== 'showdown' && (
            <button
              onClick={handleNextPhase}
              className="px-5 py-2 sm:px-8 sm:py-3 bg-yellow-500 hover:bg-yellow-600 text-black text-sm sm:text-xl font-bold rounded-xl"
            >
              {getNextPhaseLabel()}
            </button>
          )}
        </div>

        {state.phase === 'preflop' && state.players[0].hand.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="text-4xl font-bold text-white mb-8">
              {translations.startPage.title}
            </h1>
            <button
              onClick={() => {
                resetOpponentStats();
                // 新盘边界：换 sessionId 并清掉残留手牌身份（方案 §8.2），
                // 否则上一盘的手序会接着算下去。
                beginSession();
                handIdRef.current = '';
                // 与初始化 effect 同一份新盘配置：性格沿用 App 已分配的那份，
                // 本组件**不重抽**（方案 §5 / §6.3）。
                startGame(
                  playerConfig.realPlayers,
                  playerConfig.botPlayers,
                  playerConfig.smallBlind,
                  undefined,
                  undefined,
                  botPersonalityEnabled,
                  botTypes,
                );
              }}
              className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-xl transition-all hover:scale-105"
            >
              {translations.gameBoard.startGame}
            </button>
          </div>
        ) : (
          <>
            <div
              ref={containerRef}
              className="relative z-[40] mx-auto"
              style={{
                width: `${1100 * gameScale}px`,
                height: `${700 * gameScale}px`,
                marginTop: `${Math.max(10, 125 * gameScale)}px`,
                marginBottom: `${20 * gameScale}px`,
              }}
            >
              <div
                className="relative"
                style={{
                  width: '1100px',
                  height: '700px',
                  transform: `scale(${gameScale})`,
                  transformOrigin: 'top left',
                }}
              >
              <div
                className="absolute"
                style={{
                  left: '150px',
                  top: '110px',
                  width: '800px',
                  height: '480px',
                }}
              >
                <PokerTable>
                  <div className="flex flex-col items-center gap-4">
                    <PotDisplay
                      mainPot={state.mainPot}
                      sidePots={state.sidePots}
                      phase={state.phase}
                    />
                    <CommunityCards
                      cards={currentPhaseCards}
                      phase={state.phase}
                    />
                  </div>
                </PokerTable>
              </div>

              {(() => {
                const positions = calculatePlayerPositions(
                  state.players.length,
                );
                return state.players.map((player, idx) => {
                  const pos = positions[idx];
                  const isCurrentRealPlayer =
                    state.currentPlayer === player.id &&
                    player.isRealPlayer &&
                    !player.folded &&
                    !roundSettled;
                  const showActionButtons =
                    isCurrentRealPlayer &&
                    !player.folded &&
                    !player.allIn &&
                    // 回合已结束时不再给真人亮按钮：最后一个行动者若还能点，
                    // 会因为回合已结束而被忽略，反而让人以为卡住了。
                    !bettingRoundComplete;

                  // 底池 / 跟注额 / 跟注赔率统一口径（见 utils/potOdds.ts）
                  const potOddsInfo = computePotOddsFor(state, player);

                  return (
                    <div
                      key={player.id}
                      className={`absolute ${player.isRealPlayer ? 'z-[70]' : 'z-[60]'}`}
                      style={{
                        left: pos.x,
                        top: pos.y,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <PlayerArea
                        player={player}
                        displayName={getPlayerDisplayName(player, idx)}
                        isCurrentPlayer={state.currentPlayer === player.id}
                        isWinner={state.winner === player.id}
                        handRank={
                          state.phase === 'showdown' &&
                          (!player.folded || adminRevealAll)
                            ? evaluateHand(player.hand, state.communityCards)
                                .rank
                            : undefined
                        }
                        positionLabel={getPositionLabel(
                          idx,
                          state.dealer,
                          state.players.length,
                        )}
                        phase={state.phase}
                        lastAction={player.lastAction}
                        chipChange={
                          roundSettled && state.chipsAtRoundStart.length > 0
                            ? player.chips - state.chipsAtRoundStart[idx]
                            : undefined
                        }
                        communityCards={state.communityCards}
                        numActiveOpponents={
                          state.players.filter(
                            (p) => !p.folded && p.id !== player.id,
                          ).length
                        }
                        opponentProfile={
                          player.isRealPlayer
                            ? calculateOpponentProfile(state.players, player.id)
                            : undefined
                        }
                        smallBlind={state.smallBlind}
                        adminRevealAll={adminRevealAll}
                        gameState={state}
                        scenario={scenario}
                        currentPot={potOddsInfo.totalPot}
                        betToCall={potOddsInfo.toCall}
                        potOdds={potOddsInfo.callPotOdds}
                        spr={(() => {
                          const totalPot = potOddsInfo.totalPot;
                          if (totalPot <= 0) return undefined;
                          // 与机器人同口径：有效筹码（自己与未弃牌对手的 min）/ 底池。
                          return sprFromState(player, state.players, totalPot);
                        })()}
                        playerRaiseAmount={playerRaiseAmounts[player.id] ?? null}
                        gtoRecommendation={(() => {
                          if (
                            state.phase !== 'preflop' ||
                            !player.isRealPlayer ||
                            player.hand.length < 2
                          )
                            return undefined;
                          const pos =
                            (player.id -
                              state.dealer +
                              state.players.length) %
                            state.players.length;
                          // 位置标志与机器人 `ctx` 共用 `computePositionFlags`
                          // （决策 41）：面板不再自己维护第二份公式。
                          const {
                            isButton,
                            isCutoff,
                            isHijack,
                            isMiddlePosition,
                            isEarlyPosition,
                            isBlind,
                          } = computePositionFlags(pos, state.players.length);
                          const ctxForGto = {
                            position: pos,
                            totalPlayers: state.players.length,
                            isButton,
                            isCutoff,
                            isHijack,
                            isMiddlePosition,
                            isEarlyPosition,
                            isBlind,
                          };
                          const rfiPos =
                            getRfiPositionForDisplay(ctxForGto);
                          const defenderPos =
                            getDefenderPositionForDisplay(ctxForGto);
                          // 场景判定与机器人 decidePreflopGTO 共用
                          // detectPreflopScenario，面板不再自己近似一遍
                          // （原先的 facing_3bet 漏了 `player.bet === lastRaiseBet`）。
                          // 注意变量名带 `preflop` 前缀：外层的 `scenario` 是
                          // 赛制（现金/锦标赛），别把两者搞混。
                          const preflopScenario = detectPreflopScenario(
                            state,
                            player,
                          );
                          const openerPos =
                            preflopScenario !== 'rfi'
                              ? getOpenerPosition(state, player) ??
                                undefined
                              : undefined;
                          return getGtoPreflopRecommendation({
                            hand: player.hand,
                            rfiPosition: rfiPos,
                            spot: preflopScenario,
                            openerPosition: openerPos,
                            smallBlind: state.smallBlind,
                            defenderPosition: defenderPos,
                            currentBet: state.lastBet,
                            stackContext: {
                              chips: player.chips,
                              toCall: potOddsInfo.toCall,
                              totalPot: potOddsInfo.totalPot,
                              bet: player.bet,
                            },
                            // 赛制由渲染层传（不读全局）：见
                            // getGtoPreflopRecommendation 的注释。
                            gameScenario: scenario,
                          });
                        })()}
                        actionButtons={
                          showActionButtons ? (
                            <ActionButtons
                              key={`${player.id}-${state.lastBet}-${player.bet}-${canPlayerAct(player.id, 'raise')}`}
                              onAction={handleAction}
                              canCheck={canPlayerAct(player.id, 'check')}
                              canCall={canPlayerAct(player.id, 'call')}
                              canRaise={canPlayerAct(player.id, 'raise')}
                              canFold={canPlayerAct(player.id, 'fold')}
                              canAllIn={canPlayerAct(player.id, 'allin')}
                              lastBet={state.lastBet}
                              playerBet={player.bet}
                              playerChips={player.chips}
                              lastRaiseBet={state.lastRaiseBet}
                              raiseRightsOpened={state.raiseRightsOpened}
                              disabled={
                                player.folded ||
                                player.allIn ||
                                !player.isRealPlayer
                              }
                              isBot={!player.isRealPlayer}
                              onRaiseAmountChange={(amount) => handleRaiseAmountChange(player.id, amount)}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  );
                });
              })()}

              </div>
            </div>

            {roundSettled && state.chipsAtRoundStart.length > 0 && state.chipsBeforeSettlement.length > 0 && (
              <>
              <button
                onClick={() => setChipSummaryOpen((v) => !v)}
                className="fixed bottom-4 left-4 z-[50] bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-yellow-400 text-sm font-bold shadow-lg border border-white/20 min-[1400px]:hidden"
              >
                {chipSummaryOpen ? '✕' : '📊'}
              </button>

              <div className={`fixed bottom-14 left-2 right-2 sm:left-4 sm:right-auto z-[50] max-h-[60vh] sm:max-h-[80vh] overflow-y-auto overflow-x-auto transition-all ${
                chipSummaryOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              } min-[1400px]:opacity-100 min-[1400px]:pointer-events-auto min-[1400px]:bottom-4`}>
                <div className="bg-black/60 rounded-lg p-3 text-left backdrop-blur-sm min-w-0">
                  <div className="text-sm font-bold text-white mb-2">
                    {translations.chipSummary.title}
                  </div>
                  <table className="text-xs text-white">
                    <thead>
                      <tr className="text-white/60">
                        <th className="px-2 py-1 text-left">{translations.chipSummary.player}</th>
                        <th className="px-2 py-1 text-right">{translations.chipSummary.roundStart}</th>
                        <th className="px-2 py-1 text-right">{translations.chipSummary.beforeSettlement}</th>
                        <th className="px-2 py-1 text-right">{translations.chipSummary.winnings}</th>
                        <th className="px-2 py-1 text-right">{translations.chipSummary.change}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.players.map((p, idx) => {
                        const roundStart = state.chipsAtRoundStart[idx] ?? p.chips;
                        const beforeSettlement = state.chipsBeforeSettlement[idx] ?? p.chips;
                        const winnings = p.chips - beforeSettlement;
                        const change = p.chips - roundStart;
                        return (
                          <tr key={p.id} className={p.folded ? 'opacity-50' : ''}>
                            <td className="px-2 py-1">
                              {getPlayerDisplayName(p, idx)}
                              {p.folded && ` (${translations.chipSummary.folded})`}
                            </td>
                            <td className="px-2 py-1 text-right">${roundStart}</td>
                            <td className="px-2 py-1 text-right">${beforeSettlement}</td>
                            <td className="px-2 py-1 text-right">
                              {winnings > 0 ? (
                                <span className="text-green-400">+${winnings}</span>
                              ) : (
                                <span className="text-white/60">$0</span>
                              )}
                            </td>
                            <td className={`px-2 py-1 text-right font-bold ${change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-white/60'}`}>
                              {change > 0 ? `+$${change}` : change < 0 ? `-$${Math.abs(change)}` : '$0'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {state.potDistribution.length > 0 && (
                  <div className="mt-2 bg-black/60 rounded-lg p-3 text-left backdrop-blur-sm">
                    <div className="text-sm font-bold text-white mb-2">
                      {translations.potDistribution.title}
                    </div>
                    <table className="text-xs text-white">
                      <thead>
                        <tr className="text-white/60">
                          <th className="px-2 py-1 text-left">{translations.potDistribution.player}</th>
                          {state.potDistribution.map((pot, potIdx) => (
                            <th key={potIdx} className="px-2 py-1 text-right">
                              {potIdx === 0
                                ? translations.potDistribution.mainPot
                                : translations.potDistribution.sidePot(potIdx)}{' '}
                              <span className="text-yellow-400">${pot.amount}</span>
                            </th>
                          ))}
                          <th className="px-2 py-1 text-right">
                            {translations.potDistribution.total}{' '}
                            <span className="text-yellow-400">
                              ${state.potDistribution.reduce((sum, pot) => sum + pot.amount, 0)}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.players.map((p, idx) => {
                          const totalContrib = state.potDistribution.reduce(
                            (sum, pot) => sum + (pot.contributions[idx] ?? 0), 0,
                          );
                          return (
                            <tr key={p.id}>
                              <td className="px-2 py-1">{getPlayerDisplayName(p, idx)}</td>
                              {state.potDistribution.map((pot, potIdx) => {
                                const contrib = pot.contributions[idx] ?? 0;
                                return (
                                  <td key={potIdx} className={`px-2 py-1 text-right ${contrib > 0 ? 'text-white' : 'text-white/60'}`}>
                                    ${contrib}
                                  </td>
                                );
                              })}
                              <td className={`px-2 py-1 text-right font-bold ${totalContrib > 0 ? 'text-white' : 'text-white/60'}`}>
                                ${totalContrib}
                              </td>
                            </tr>
                          );
                        })}

                      </tbody>
                    </table>
                  </div>
                )}

              </div>
              </>
            )}


          </>
        )}
        <HandRankingGuide />
      </div>
    </div>
  );
};
