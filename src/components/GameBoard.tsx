import React, { useEffect, useRef, useState } from 'react';
import { useGameState } from '../hooks/useGameState';
import { PlayerArea } from './PlayerArea';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { ActionButtons } from './ActionButtons';
import { PokerTable } from './PokerTable';
import { HandRankingGuide } from './HandRankingGuide';
import { calculatePlayerPositions, getPositionLabel } from '../utils/tablePositions';
import { getBotAction, setGtoStrategy } from '../utils/botAI';
import {
  getGtoPreflopRecommendation,
  getRfiPositionForDisplay,
  getDefenderPositionForDisplay,
  getOpenerPosition,
} from '../utils/gtoPreflop';
import { getGtoPostflopRecommendation, analyzeBoard } from '../utils/gtoPostflop';
import { detectDraws } from '../utils/drawDetector';
import { calculateEquity } from '../utils/equityCalculator';
import { evaluateHand } from '../utils/handEvaluator';
import { calculateOpponentProfile, resetOpponentStats, startNewHand, recordAction, getCurrentHand, getRealPlayerSessionStats, setCurrentHandShowdownPlayers } from '../utils/opponentModel';
import {
  saveHand,
  getAllRealPlayerStats,
  resetLongTermStats,
  exportStats,
  importStats,
} from '../utils/longOpponentModel';
import { saveGameProgress } from '../utils/gamePersistence';
import { HAND_RANK_NAMES, type Action, type GamePhase } from '../types/poker';
import type { ActionEvent } from '../types/stats';
import { translations } from '../utils/translations';

interface PlayerConfig {
  realPlayers: number;
  botPlayers: number;
  smallBlind: number;
}

interface GameBoardProps {
  playerConfig: PlayerConfig;
  savedChips?: number[];
  savedBuyInCounts?: number[];
  onBackToMenu: () => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  playerConfig,
  savedChips,
  savedBuyInCounts,
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
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = React.useState<string | null>(null);
  const [gtoEnabled, setGtoEnabled] = useState(false);

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
      handId: `${handCounterRef.current}-${state.dealer}-${state.players[0]?.hand[0]?.rank}-${state.players[0]?.hand[1]?.rank}`,
      playerId: playerId as ActionEvent['playerId'],
      phase,
      action,
      amount,
      toCall,
      currentBet: state.lastBet,
      potSize: state.mainPot + (state.sidePots?.reduce((sum, pot) => sum + pot.amount, 0) || 0),
      position,
      isFacingRaise: state.lastBet > 0 && phase === 'preflop',
      timestamp: timestamp,
    };
  };

  useEffect(() => {
    if (
      !gameInitialized.current &&
      state.phase === 'preflop' &&
      state.players[0].hand.length === 0
    ) {
      gameInitialized.current = true;
      resetOpponentStats();
      startGame(
        playerConfig.realPlayers,
        playerConfig.botPlayers,
        playerConfig.smallBlind,
        savedChips,
        savedBuyInCounts,
      );
    }
  }, [state.phase, state.players, startGame, playerConfig, savedChips, savedBuyInCounts]);

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
      });
    }
  }, [roundSettled, state.players, state.smallBlind, state.dealer]);

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

  // 检测新牌局开始，记录长期统计
  useEffect(() => {
    if (state.phase === 'preflop' && state.players.length > 0 && state.players[0].hand.length > 0) {
      const currentHandKey = `${state.dealer}-${state.players[0].hand[0]?.rank}-${state.players[0].hand[1]?.rank}`;
      if (handKeyRef.current !== currentHandKey) {
        handKeyRef.current = currentHandKey;
        handCounterRef.current++;
        const handId = `${handCounterRef.current}-${state.dealer}-${state.players[0]?.hand[0]?.rank}-${state.players[0]?.hand[1]?.rank}`;
        const allPlayerIds = state.players.map((p) => p.id);
        startNewHand(handId, allPlayerIds);
      }
    }
  }, [state.phase, state.players, state.dealer]);

  useEffect(() => {
    if (roundSettled) {
      const currentHand = getCurrentHand();
      const showdownPlayers = state.phase === 'showdown'
        ? state.players.filter(p => !p.folded).map(p => p.id)
        : undefined;

      if (showdownPlayers) {
        setCurrentHandShowdownPlayers(showdownPlayers);
      }

      if (currentHand) {
        const handWithResult: typeof currentHand = {
          ...currentHand,
          showdownPlayers,
          result: {
            winner: state.winner,
            potAmount: state.players.reduce((sum, p) => sum + p.totalBet, 0),
          },
        };
        saveHand(handWithResult);
      }
    }
  }, [roundSettled, state.winner, state.players]);

  const noRealCanAct = !state.players.some(
    (p) => p.isRealPlayer && !p.folded && !p.allIn && p.chips > 0,
  );

  useEffect(() => {
    if (!currentPlayer || currentPlayer.folded || roundSettled) return;
    if (currentPlayer.isRealPlayer) return;

    const decision = getBotAction(currentPlayer, state);
    const delay = noRealCanAct
      ? (decision.action === 'check' ? 800 : 1200)
      : (decision.action === 'check' ? 2800 : 3800);

    const timer = setTimeout(() => {
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
  }, [currentPlayer, roundSettled, state, playerAction, noRealCanAct]);

  const handleAction = (action: Action, amount?: number) => {
    const playerId = state.currentPlayer;
    const currentPhase = state.phase;
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

  const canContinue = () => {
    const activePlayers = state.players.filter((p) => !p.folded);
    const canActPlayers = state.players.filter(
      (p) => !p.folded && !p.allIn && p.chips > 0,
    );

    console.groupCollapsed(
      '%c[canContinue] 检查',
      'color: blue; font-weight: bold; font-size: 12px;',
    );

    console.log('状态上下文:', {
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      lastBet: state.lastBet,
      mainPot: state.mainPot,
    });

    console.table(
      activePlayers.map((p) => ({
        ID: p.id,
        筹码: p.chips,
        下注: p.bet,
        已行动: p.hasActed ? '✓' : '✗',
        AllIn: p.allIn ? '✓' : '✗',
      })),
    );

    console.log(
      `统计: ${activePlayers.length}未弃牌 / ${canActPlayers.length}可行动`,
    );

    if (activePlayers.length === 0 || canActPlayers.length === 0) {
      console.log('✅ 可继续（无活跃玩家）');
      console.groupEnd();
      return true;
    }

    const allActed = canActPlayers.every((p) => p.hasActed);
    const allBetsValid = activePlayers.every((p) => {
      const isValid =
        (p.bet < state.lastBet && (p.chips <= 0 || p.allIn)) ||
        p.bet === state.lastBet;
      return isValid;
    });

    console.log(`allActed: ${allActed}, allBetsValid: ${allBetsValid}`);
    console.log(
      `结果: ${allActed && allBetsValid ? '✅ 可继续' : '⏸️ 不能继续'}`,
    );

    console.groupEnd();
    return allActed && allBetsValid;
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

    const isBettingComplete = canContinue();

    if (isBettingComplete && !wasBettingCompleteRef.current) {
      wasBettingCompleteRef.current = true;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
      }
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        wasBettingCompleteRef.current = false;
        handleNextPhase();
      }, noRealCanAct ? 500 : 1800);
    } else if (!isBettingComplete) {
      wasBettingCompleteRef.current = false;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    }
  }, [
    state.phase,
    state.players,
    roundSettled,
    state.lastBet,
    revealHand,
    nextStreet,
    noRealCanAct,
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

  const handleExport = () => {
    exportStats();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const success = await importStats(file);
    setImportMessage(
      success ? translations.playerStats.importSuccess : translations.playerStats.importFailed,
    );
    setTimeout(() => setImportMessage(null), 3000);
    e.target.value = '';
  };

  const realPlayerIds = state.players.filter((p) => p.isRealPlayer).map((p) => p.id);
  const longStats = realPlayerIds.length > 0 ? getAllRealPlayerStats(realPlayerIds) : undefined;
  const allRealSessionStats = realPlayerIds.length > 1
    ? getRealPlayerSessionStats(realPlayerIds)
    : undefined;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 p-2 overflow-hidden">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackToMenu}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold"
            >
              {translations.gameBoard.backToMenu}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {importMessage && (
              <span className="text-xs text-yellow-400">{importMessage}</span>
            )}
            <button
              onClick={() => {
                const next = !gtoEnabled;
                setGtoEnabled(next);
                setGtoStrategy(next);
              }}
              className={`px-2 py-1 text-xs rounded font-bold ${
                gtoEnabled
                  ? 'bg-green-700/60 text-green-300 hover:bg-green-600/70'
                  : 'bg-gray-800/40 text-white/50 hover:text-white/70'
              }`}
            >
              {translations.gtoStrategy.toggle} {gtoEnabled ? translations.gtoStrategy.on : translations.gtoStrategy.off}
            </button>
            <button
              onClick={() => {
                if (confirm(translations.playerStats.resetStats + '?')) {
                  resetLongTermStats();
                }
              }}
              className="px-2 py-1 bg-blue-900/40 hover:bg-red-700/60 text-white/70 hover:text-white text-xs rounded"
              title={translations.playerStats.resetStats}
            >
              {translations.playerStats.resetStats}
            </button>
            <button
              onClick={handleExport}
              className="px-2 py-1 bg-blue-900/40 hover:bg-blue-700/60 text-white/70 hover:text-white text-xs rounded"
              title={translations.playerStats.exportStats}
            >
              {translations.playerStats.exportStats}
            </button>
            <label
              className="px-2 py-1 bg-blue-900/40 hover:bg-green-700/60 text-white/70 hover:text-white text-xs rounded cursor-pointer"
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
            <div className="text-white/60">
              {translations.gameBoard.realPlayers}: {playerConfig.realPlayers} |{' '}
              {translations.gameBoard.botPlayers}: {playerConfig.botPlayers}
            </div>
          </div>
        </div>

        {state.phase === 'preflop' && state.players[0].hand.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="text-4xl font-bold text-white mb-8">
              {translations.startPage.title}
            </h1>
            <button
              onClick={() => {
                resetOpponentStats();
                startGame(
                  playerConfig.realPlayers,
                  playerConfig.botPlayers,
                  playerConfig.smallBlind,
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
              className="relative mx-auto"
              style={{ width: '1100px', height: '700px', marginTop: '125px' }}
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
                    isCurrentRealPlayer && !player.folded && !player.allIn;

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
                        longStats={player.isRealPlayer ? longStats : undefined}
                        viewingPlayerId={player.isRealPlayer ? player.id : undefined}
                        realPlayerSessionStats={
                          player.isRealPlayer && allRealSessionStats
                            ? allRealSessionStats.filter((s) => s.playerId !== player.id)
                            : undefined
                        }
                        smallBlind={state.smallBlind}
                        adminRevealAll={adminRevealAll}
                        currentPot={(() => {
                          return state.mainPot +
                            state.sidePots.reduce(
                              (sum, sp) => sum + sp.amount,
                              0,
                            );
                        })()}
                        betToCall={(() => {
                          const toCall = state.lastBet - player.bet;
                          return toCall > 0 ? toCall : 0;
                        })()}
                        potOdds={(() => {
                          const toCall = state.lastBet - player.bet;
                          if (toCall <= 0) return 0;
                          const totalPot =
                            state.mainPot +
                            state.sidePots.reduce(
                              (sum, sp) => sum + sp.amount,
                              0,
                            );
                          return toCall / (totalPot + toCall);
                        })()}
                        spr={(() => {
                          const totalPot =
                            state.mainPot +
                            state.sidePots.reduce(
                              (sum, sp) => sum + sp.amount,
                              0,
                            );
                          if (totalPot <= 0) return undefined;
                          const activeOpponents = state.players.filter(
                            (p) => !p.folded && p.id !== player.id,
                          );
                          const effectiveStack =
                            activeOpponents.length > 0
                              ? Math.min(
                                  player.chips,
                                  ...activeOpponents.map((p) => p.chips),
                                )
                              : player.chips;
                          return effectiveStack / totalPot;
                        })()}
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
                          const ctxForGto = {
                            position: pos,
                            totalPlayers: state.players.length,
                            isButton: pos === 0,
                            isCutoff:
                              pos === state.players.length - 1 &&
                              pos > 2,
                            isHijack:
                              pos === state.players.length - 2 &&
                              pos > 2,
                            isMiddlePosition:
                              pos >=
                                Math.floor(
                                  state.players.length * 0.3,
                                ) &&
                              pos < state.players.length - 2 &&
                              pos > 2,
                            isEarlyPosition:
                              pos > 0 &&
                              pos <
                                Math.floor(
                                  state.players.length * 0.3,
                                ),
                            isBlind: pos === 1 || pos === 2,
                          };
                          const toCall =
                            state.lastBet - player.bet;
                          const facingOpen = toCall > 0;
                          const facing3bet =
                            player.bet > state.smallBlind * 2 &&
                            state.lastBet > player.bet;
                          const cold3bet = (() => {
                            if (player.bet > 0 || !facingOpen)
                              return false;
                            const raisers = state.players.filter(
                              (p) =>
                                p.id !== player.id &&
                                !p.folded &&
                                p.bet > state.smallBlind * 2,
                            );
                            if (raisers.length < 2) return false;
                            const bets = new Set(
                              raisers.map((p) => p.bet),
                            );
                            return bets.size >= 2;
                          })();
                          const rfiPos =
                            getRfiPositionForDisplay(ctxForGto);
                          const defenderPos =
                            getDefenderPositionForDisplay(ctxForGto);
                          const scenario:
                            | 'rfi'
                            | 'facing_open'
                            | 'facing_3bet'
                            | 'cold_3bet' = facing3bet
                            ? 'facing_3bet'
                            : cold3bet
                              ? 'cold_3bet'
                              : facingOpen
                                ? 'facing_open'
                                : 'rfi';
                          const openerPos =
                            facingOpen || facing3bet || cold3bet
                              ? getOpenerPosition(state, player) ??
                                undefined
                              : undefined;
                          return getGtoPreflopRecommendation(
                            player.hand,
                            rfiPos,
                            scenario,
                            openerPos,
                            state.smallBlind,
                            defenderPos,
                            state.lastBet,
                            {
                              chips: player.chips,
                              toCall: state.lastBet - player.bet,
                              totalPot: state.mainPot +
                                state.sidePots.reduce(
                                  (sum, sp) => sum + sp.amount, 0,
                                ),
                              bet: player.bet,
                            },
                          );
                        })()}
                        gtoPostflopRecommendation={(() => {
                          if (
                            state.phase === 'preflop' ||
                            state.phase === 'showdown' ||
                            state.phase === 'ended' ||
                            !player.isRealPlayer ||
                            player.hand.length < 2 ||
                            state.communityCards.length < 3
                          )
                            return undefined;
                          const community = state.communityCards;
                          const boardTexture = analyzeBoard(community);
                          const equity = calculateEquity(
                            player.hand, community, state.players.filter(p => !p.folded && p.id !== player.id).length,
                            state.phase === 'river' ? 500 : state.phase === 'turn' ? 300 : 200,
                          );
                          const draws = detectDraws(player.hand, community,
                            state.phase === 'flop' ? 2 : state.phase === 'turn' ? 1 : 0);
                          const evaluated = evaluateHand(player.hand, community);
                          const toCall = state.lastBet - player.bet;
                          const totalPot = state.mainPot +
                            state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
                          const pos =
                            (player.id - state.dealer + state.players.length) %
                            state.players.length;
                          const spr = totalPot > 0 ? player.chips / totalPot : 999;
                          return getGtoPostflopRecommendation({
                            hand: player.hand,
                            communityCards: community,
                            phase: state.phase as 'flop' | 'turn' | 'river',
                            equity,
                            potOdds: toCall > 0 ? toCall / (totalPot + toCall) : 0,
                            spr,
                            position: pos,
                            totalPlayers: state.players.length,
                            numOpponents: state.players.filter(p => !p.folded && p.id !== player.id).length,
                            isButton: pos === 0,
                            isCutoff: pos === state.players.length - 1 && pos > 2,
                            isHijack: pos === state.players.length - 2 && pos > 2,
                            boardTexture,
                            handRank: evaluated.rank,
                            draws,
                            toCall,
                            totalPot,
                            smallBlind: state.smallBlind,
                            chips: player.chips,
                            playerBet: player.bet,
                            lastRaiseBet: state.lastRaiseBet,
                          });
                        })()}
                        actionButtons={
                          showActionButtons ? (
                            <ActionButtons
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
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  );
                });
              })()}
            </div>

            {roundSettled && state.chipsAtRoundStart.length > 0 && state.chipsBeforeSettlement.length > 0 && (
              <div className="fixed bottom-4 left-4 z-50 max-h-[80vh] overflow-y-auto">
                <div className="bg-black/60 rounded-lg p-3 text-left backdrop-blur-sm">
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
            )}

            <div className="fixed top-[60px] right-30 z-50 flex flex-col items-start gap-3">
              {roundSettled && (
                <div className="text-left">
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={handleResetRound}
                      className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold"
                    >
                      {translations.gameBoard.nextRound}
                    </button>
                    <button
                      onClick={() => setAdminRevealAll((v) => !v)}
                      className={`px-4 py-2 rounded-lg font-bold ${
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

                  <div className="text-3xl font-bold text-yellow-400 mb-2">
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
                    <div className="text-white/80">
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

              {!roundSettled && canContinue() && state.phase !== 'showdown' && (
                <button
                  onClick={handleNextPhase}
                  className="px-8 py-3 bg-yellow-500 hover:bg-yellow-600 text-black text-xl font-bold rounded-xl"
                >
                  {getNextPhaseLabel()}
                </button>
              )}
            </div>
          </>
        )}
        <HandRankingGuide />
      </div>
    </div>
  );
};
