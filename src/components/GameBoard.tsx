import React, { useEffect } from 'react';
import { useGameState, SMALL_BLIND, BIG_BLIND } from '../hooks/useGameState';
import { PlayerArea } from './PlayerArea';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { ActionButtons } from './ActionButtons';

import { evaluateHand } from '../utils/handEvaluator';
import { HAND_RANK_NAMES } from '../types/poker';

export const GameBoard: React.FC = () => {
  const { 
    state, 
    startGame, 
    playerAction, 
    revealHand, 
    nextStreet, 
    collectPot, 
    resetRound,
    canPlayerAct
  } = useGameState();

  const currentPlayer = state.players[state.currentPlayer - 1];
  const roundSettled = state.winner !== null || (state.phase === 'showdown' && state.pot === 0);

  // Removed TurnTransition/handoff logic from here on

  const p0Folded = state.players[0].folded;
  const p1Folded = state.players[1].folded;

  useEffect(() => {
    if (p0Folded) {
      collectPot(2);
    } else if (p1Folded) {
      collectPot(1);
    }
  }, [p0Folded, p1Folded, collectPot]);

  const handleAction = (action: 'check' | 'call' | 'raise' | 'fold', amount?: number) => {
    playerAction(state.currentPlayer, action, amount);
  };

  // Removed handleStartGame, handleTransition, requestTransition, and related handoff logic
  // Start game now just calls startGame()
  const handleStartGame = () => {
    startGame();
  };

  const handleNextPhase = () => {
    nextStreet();
  };

  const canContinue = () => {
    const [p1, p2] = state.players;
    return p1.hasActed && p2.hasActed && p1.bet === p2.bet && p1.bet === state.lastBet;
  };

  const currentPhaseCards = state.phase === 'preflop' ? [] : 
                            state.phase === 'flop' ? state.communityCards.slice(0, 3) :
                            state.phase === 'turn' ? state.communityCards.slice(0, 4) :
                            state.communityCards;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 p-4">
      {/* Removed TurnTransition overlay and handoff logic */}

      <div className="max-w-2xl mx-auto">
        <PotDisplay pot={state.pot} phase={state.phase} />

        {state.phase === 'preflop' && state.players[0].hand.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="text-4xl font-bold text-white mb-8">德州扑克</h1>
            <button
              onClick={handleStartGame}
              className="px-12 py-4 bg-yellow-500 hover:bg-yellow-600 text-black text-2xl font-bold rounded-xl transition-all hover:scale-105"
            >
              开始游戏
            </button>
            <div className="mt-8 text-white/60 text-center">
              <p>小盲: ${SMALL_BLIND} | 大盲: ${BIG_BLIND}</p>
              <p>每人初始筹码: $1000</p>
            </div>
          </div>
        ) : (
          <>
             <div className="mb-6">
               <PlayerArea 
                player={state.players[1]} 
                isCurrentPlayer={state.currentPlayer === state.players[1].id}
                isDealer={state.dealer === state.players[1].id}
                isWinner={state.winner === state.players[1].id}
                handRank={state.phase === 'showdown' ? evaluateHand(state.players[1].hand, state.communityCards).rank : undefined}
                blind={state.players[1].bet === SMALL_BLIND ? '小盲' : state.players[1].bet === BIG_BLIND ? '大盲' : undefined}
              />
            </div>

            <div className="mb-6">
              <CommunityCards 
                cards={currentPhaseCards} 
                phase={state.phase}
              />
            </div>

             <div className="mb-6">
               <PlayerArea 
                player={state.players[0]} 
                isCurrentPlayer={state.currentPlayer === state.players[0].id}
                isDealer={state.dealer === state.players[0].id}
                isWinner={state.winner === state.players[0].id}
                handRank={state.phase === 'showdown' ? evaluateHand(state.players[0].hand, state.communityCards).rank : undefined}
                blind={state.players[0].bet === SMALL_BLIND ? '小盲' : state.players[0].bet === BIG_BLIND ? '大盲' : undefined}
              />
            </div>

            {roundSettled && (
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-yellow-400 mb-2">
                  {state.winner !== null ? `玩家 ${state.winner} 获胜！` : '平局，平分底池'}
                </div>
                {(() => {
                  if (state.phase === 'showdown') {
                    const p1Rank = evaluateHand(state.players[0].hand, state.communityCards).rank;
                    const p2Rank = evaluateHand(state.players[1].hand, state.communityCards).rank;
                    return (
                      <div className="text-white/80">
                        玩家1: {HAND_RANK_NAMES[p1Rank]} | 玩家2: {HAND_RANK_NAMES[p2Rank]}
                      </div>
                    );
                  }
                  return null;
                })()}
                <button
                  onClick={() => {
                    resetRound();
                  }}
                  className="mt-4 px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold"
                >
                  下一局
                </button>
              </div>
            )}

            {!roundSettled && canContinue() && state.phase !== 'showdown' && (
              <div className="text-center mb-4">
                <button
                  onClick={() => {
                    // Show both hands and enter showdown
                    if (state.phase === 'river') {
                      revealHand(1);
                      revealHand(2);
                    }
                    handleNextPhase();
                  }}
                  className="px-8 py-3 bg-yellow-500 hover:bg-yellow-600 text-black text-xl font-bold rounded-xl"
                >
                  {state.phase === 'preflop' ? '发翻牌' : 
                   state.phase === 'flop' ? '发转牌' : 
                   state.phase === 'turn' ? '发河牌' : '摊牌'}
                </button>
              </div>
            )}

            {/* No more switch player button; removed all handoff overlays */}

            {!roundSettled && (
              <ActionButtons
                onAction={handleAction}
                canCheck={canPlayerAct(state.currentPlayer, 'check')}
                canCall={canPlayerAct(state.currentPlayer, 'call')}
                canRaise={canPlayerAct(state.currentPlayer, 'raise')}
                canFold={canPlayerAct(state.currentPlayer, 'fold')}
                lastBet={state.lastBet}
                playerBet={currentPlayer.bet}
                disabled={currentPlayer.folded}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
