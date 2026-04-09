import React, { useEffect, useRef } from 'react';
import { useGameState } from '../hooks/useGameState';
import { PlayerArea } from './PlayerArea';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { ActionButtons } from './ActionButtons';
import { PokerTable } from './PokerTable';
import { HandRankingGuide } from './HandRankingGuide';
import { calculatePlayerPositions } from '../utils/tablePositions';
import { getBotAction, getBotName } from '../utils/botAI';
import { evaluateHand } from '../utils/handEvaluator';
import { HAND_RANK_NAMES, type Action } from '../types/poker';
import { translations } from '../utils/translations';

interface PlayerConfig {
  realPlayers: number;
  botPlayers: number;
}

interface GameBoardProps {
  playerConfig: PlayerConfig;
  onBackToMenu: () => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({ playerConfig, onBackToMenu }) => {
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

  useEffect(() => {
    if (!gameInitialized.current && state.phase === 'preflop' && state.players[0].hand.length === 0) {
      gameInitialized.current = true;
      startGame(playerConfig.realPlayers, playerConfig.botPlayers);
    }
  }, [state.phase, state.players, startGame, playerConfig]);

  const currentPlayer = state.players[state.currentPlayer - 1];
  const roundSettled = state.winner !== null || (state.phase === 'showdown' && state.pot === 0);

  useEffect(() => {
    const allFolded = state.players.filter(p => !p.folded).length <= 1;
    if (allFolded && state.winner && state.pot > 0) {
      collectPot(state.winner);
    }
  }, [state.players, state.winner, state.pot, collectPot]);

  useEffect(() => {
    if (!currentPlayer || currentPlayer.folded || roundSettled) return;
    if (currentPlayer.isRealPlayer) return;

    const decision = getBotAction(currentPlayer, state);
    const delay = decision.action === 'check' ? 2800 : 3800;

    const timer = setTimeout(() => {
      playerAction(currentPlayer.id, decision.action, decision.amount);
    }, delay);

    return () => clearTimeout(timer);
  }, [currentPlayer, roundSettled, state, playerAction]);

  const handleAction = (action: Action, amount?: number) => {
    playerAction(state.currentPlayer, action, amount);
  };

  const handleNextPhase = () => {
    state.players.forEach(p => revealHand(p.id));
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

    const activePlayers = state.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
    const isBettingComplete = (() => {
      if (activePlayers.length === 0) return true;
      if (activePlayers.length === 1 && activePlayers[0].hasActed) return true;
      const allActed = activePlayers.every(p => p.hasActed);
      const activeBets = activePlayers.map(p => p.bet);
      const allBetsEqual = activeBets.length > 0 && activeBets.every(bet => bet === activeBets[0]);
      return allActed && allBetsEqual;
    })();

    if (isBettingComplete && !wasBettingCompleteRef.current) {
      wasBettingCompleteRef.current = true;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
      }
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        wasBettingCompleteRef.current = false;
        handleNextPhase();
      }, 1800);
    } else if (!isBettingComplete) {
      wasBettingCompleteRef.current = false;
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    }
  }, [state.phase, state.players, roundSettled, state.lastBet, revealHand, nextStreet]); // eslint-disable-line react-hooks/exhaustive-deps

  const canContinue = () => {
    const activePlayers = state.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
    if (activePlayers.length === 0) return true;
    if (activePlayers.length === 1 && activePlayers[0].hasActed) return true;
    const allActed = activePlayers.every(p => p.hasActed);
    const activeBets = activePlayers.map(p => p.bet);
    const allBetsEqual = activeBets.length > 0 && activeBets.every(bet => bet === activeBets[0]);
    return allActed && allBetsEqual;
  };

  const currentPhaseCards =
    state.phase === 'preflop' ? [] :
    state.phase === 'flop' ? state.communityCards.slice(0, 3) :
    state.phase === 'turn' ? state.communityCards.slice(0, 4) :
    state.communityCards;

  const getPlayerDisplayName = (player: typeof state.players[0], index: number): string => {
    if (player.isRealPlayer) {
      return translations.gameBoard.player(index + 1);
    }
    const botIndex = index - playerConfig.realPlayers;
    return getBotName(botIndex >= 0 ? botIndex : index);
  };

  const getNextPhaseLabel = () => {
    switch (state.phase) {
      case 'preflop': return translations.gameBoard.dealFlop;
      case 'flop': return translations.gameBoard.dealTurn;
      case 'turn': return translations.gameBoard.dealRiver;
      default: return translations.gameBoard.showCards;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 p-4 overflow-hidden">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={onBackToMenu}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold"
          >
            {translations.gameBoard.backToMenu}
          </button>
          <div className="text-white/60">
            {translations.gameBoard.realPlayers}: {playerConfig.realPlayers} | {translations.gameBoard.botPlayers}: {playerConfig.botPlayers}
          </div>
        </div>

        {state.phase === 'preflop' && state.players[0].hand.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="text-4xl font-bold text-white mb-8">{translations.startPage.title}</h1>
            <button
              onClick={() => startGame(playerConfig.realPlayers, playerConfig.botPlayers)}
              className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-xl transition-all hover:scale-105"
            >
              {translations.gameBoard.startGame}
            </button>
          </div>
        ) : (
          <>
            <div className="relative mx-auto" style={{ width: '1100px', height: '700px', marginTop: '150px' }}>
              <div className="absolute" style={{ left: '150px', top: '110px', width: '800px', height: '480px' }}>
                <PokerTable>
                  <div className="flex flex-col items-center gap-4">
                    <PotDisplay pot={state.pot} phase={state.phase} />
                    <CommunityCards
                      cards={currentPhaseCards}
                      phase={state.phase}
                    />
                  </div>
                </PokerTable>
              </div>
              
              {(() => {
                const positions = calculatePlayerPositions(state.players.length);
                return state.players.map((player, idx) => {
                  const pos = positions[idx];
                  const isCurrentRealPlayer = state.currentPlayer === player.id && player.isRealPlayer && !player.folded && !roundSettled;
                  const showActionButtons = isCurrentRealPlayer && !player.folded && !player.allIn;

                  return (
                    <div
                      key={player.id}
                      className="absolute"
                      style={{
                        left: pos.x,
                        top: pos.y,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <PlayerArea
                        player={player}
                        displayName={getPlayerDisplayName(player, idx)}
                        isCurrentPlayer={state.currentPlayer === player.id}
                        isDealer={state.dealer === player.id}
                        isWinner={state.winner === player.id}
                        handRank={
                          state.phase === "showdown" && !player.folded
                            ? evaluateHand(player.hand, state.communityCards)
                                .rank
                            : undefined
                        }
                        blind={
                          idx === (state.dealer - 1 + 1) % state.players.length
                            ? "小盲"
                            : idx ===
                                (state.dealer - 1 + 2) % state.players.length
                              ? "大盲"
                              : undefined
                        }
                        phase={state.phase}
                        lastAction={player.lastAction}
                        actionButtons={
                          showActionButtons ? (
                            <ActionButtons
                              onAction={handleAction}
                              canCheck={canPlayerAct(player.id, "check")}
                              canCall={canPlayerAct(player.id, "call")}
                              canRaise={canPlayerAct(player.id, "raise")}
                              canFold={canPlayerAct(player.id, "fold")}
                              canAllIn={canPlayerAct(player.id, "allin")}
                              lastBet={state.lastBet}
                              playerBet={player.bet}
                              playerChips={player.chips}
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

            <div className="fixed top-20 right-30 z-50 flex flex-col items-end gap-3">
              {roundSettled && (
                <div className="text-right">
                  <div className="text-3xl font-bold text-yellow-400 mb-2">
                    {state.winner !== null
                      ? translations.gameBoard.playerWins(getPlayerDisplayName(state.players[state.winner - 1], state.winner - 1))
                      : translations.gameBoard.splitPot}
                  </div>
                  {state.phase === 'showdown' && (
                    <div className="text-white/80">
                      {state.players.map((p, idx) => {
                        if (p.folded) return null;
                        return (
                          <div key={p.id}>
                            {getPlayerDisplayName(p, idx)}: {HAND_RANK_NAMES[evaluateHand(p.hand, state.communityCards).rank]}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      resetRound();
                    }}
                    className="mt-4 px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold"
                  >
                    {translations.gameBoard.nextRound}
                  </button>
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