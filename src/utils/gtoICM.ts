import type { Card, GameState } from '../types/poker';

export type TournamentStage = 'early' | 'middle' | 'bubble' | 'final_table';
export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export interface ICMConfig {
  tournamentStage: TournamentStage;
  payoutStructure: number[];
  playerStacks: number[];
  heroStack: number;
  blinds: number;
  ante: number;
  numPlayers: number;
  averageStack: number;
}

export interface ICMRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold' | 'check';
  sizing?: number;
  riskPremium: number;
  bubbleFactor: number;
  icmAdjustment: number;
  reasoning: string;
}

function getPositionAdjustment(position: Position): number {
  const adjustments: Record<Position, number> = {
    UTG: 1.2,
    MP: 1.1,
    CO: 1.0,
    BTN: 0.9,
    SB: 1.1,
    BB: 1.0,
  };
  return adjustments[position] || 1.0;
}

export function calculateICMEquity(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const equity = new Array(n).fill(0);
  const totalChips = stacks.reduce((a, b) => a + b, 0);

  if (totalChips === 0) return equity;

  function calculatePositionProbs(
    remainingIndices: number[],
    remainingPayouts: number[],
    probSoFar: number,
    position: number,
  ) {
    if (remainingPayouts.length === 0 || remainingIndices.length === 0) return;

    const activeIndices = remainingIndices.filter(idx => stacks[idx] > 0);
    if (activeIndices.length === 0) return;

    const totalRemaining = activeIndices.reduce((sum, idx) => sum + stacks[idx], 0);
    if (totalRemaining === 0) return;

    for (let i = 0; i < activeIndices.length; i++) {
      const playerIdx = activeIndices[i];
      const winProb = (stacks[playerIdx] / totalRemaining) * probSoFar;

      if (position < payouts.length) {
        equity[playerIdx] += winProb * payouts[position];
      }

      const newRemaining = activeIndices.filter((_, idx) => idx !== i);
      calculatePositionProbs(newRemaining, remainingPayouts.slice(1), winProb, position + 1);
    }
  }

  const allIndices = Array.from({ length: n }, (_, i) => i);
  calculatePositionProbs(allIndices, payouts, 1, 0);

  return equity;
}

export function calculateBubbleFactor(
  heroStack: number,
  villainStack: number,
  totalChips: number,
  payoutStructure: number[],
  numPlayers: number,
): number {
  if (heroStack === 0 || villainStack === 0) return 1.0;

  const currentStacks: number[] = [];
  const avgStack = totalChips / numPlayers;

  for (let i = 0; i < numPlayers; i++) {
    currentStacks.push(avgStack);
  }
  currentStacks[0] = heroStack;

  const currentEquity = calculateICMEquity(currentStacks, payoutStructure);
  const heroCurrentEquity = currentEquity[0];

  const winStacks = [...currentStacks];
  winStacks[0] += villainStack;
  const winEquity = calculateICMEquity(winStacks, payoutStructure);
  const heroWinEquity = winEquity[0];

  const loseStacks = [...currentStacks];
  loseStacks[0] = 0;
  const loseEquity = calculateICMEquity(loseStacks, payoutStructure);
  const heroLoseEquity = loseEquity[0];

  const evGained = heroWinEquity - heroCurrentEquity;
  const evLost = heroCurrentEquity - heroLoseEquity;

  if (evGained <= 0) return 1.0;
  return Math.abs(evLost) / evGained;
}

export function calculateRiskPremium(bubbleFactor: number): number {
  if (bubbleFactor <= 0) return 0;
  return bubbleFactor / (bubbleFactor + 1) - 0.5;
}

export function getTournamentStage(
  numPlayersRemaining: number,
  numPlayersPaid: number,
): TournamentStage {
  if (numPlayersPaid <= 0) return 'early';

  const percentRemaining = numPlayersRemaining / numPlayersPaid;

  if (percentRemaining > 0.35) return 'early';
  if (percentRemaining > 0.20) return 'middle';
  if (percentRemaining > 0.10) return 'bubble';
  return 'final_table';
}

function getStageAdjustment(stage: TournamentStage): number {
  const adjustments: Record<TournamentStage, number> = {
    early: 1.0,
    middle: 1.1,
    bubble: 1.3,
    final_table: 1.2,
  };
  return adjustments[stage];
}

function getHandStrengthTier(hand: Card[]): number {
  const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const r1 = hand[0].rank;
  const r2 = hand[1].rank;
  const isSuited = hand[0].suit === hand[1].suit;

  const idx1 = rankOrder.indexOf(r1);
  const idx2 = rankOrder.indexOf(r2);
  const highIdx = Math.max(idx1, idx2);
  const lowIdx = Math.min(idx1, idx2);
  const isPair = r1 === r2;

  if (isPair && highIdx >= 10) return 1;
  if (isPair && highIdx >= 7) return 2;
  if (isPair) return 3;
  if (highIdx === 12 && lowIdx >= 10) return 2;
  if (highIdx === 12 && isSuited) return 3;
  if (highIdx === 12) return 4;
  if (highIdx >= 10 && lowIdx >= 8) return 3;
  if (highIdx >= 10 && isSuited) return 4;
  if (isSuited && highIdx >= 8 && lowIdx >= 6) return 5;
  return 6;
}

export function getICMRecommendation(
  config: ICMConfig,
  hand: Card[],
  position: Position,
  action: 'rfi' | 'facing_open' | 'facing_3bet' | 'facing_shove',
): ICMRecommendation {
  const stage = config.tournamentStage;
  const stageAdj = getStageAdjustment(stage);
  const positionAdj = getPositionAdjustment(position);

  const avgBubbleFactor = calculateBubbleFactor(
    config.heroStack,
    config.averageStack,
    config.averageStack * config.numPlayers,
    config.payoutStructure,
    config.numPlayers,
  );
  const riskPremium = calculateRiskPremium(avgBubbleFactor);
  const icmAdjustment = stageAdj * positionAdj;

  const handTier = getHandStrengthTier(hand);

  let adjustedAction: ICMRecommendation['action'] = 'fold';
  let adjustedSizing: number | undefined;

  if (action === 'rfi') {
    if (handTier <= 2) {
      adjustedAction = 'raise';
      adjustedSizing = 2.5;
      if (riskPremium > 0.15 && handTier === 2) {
        if (Math.random() < 0.3) {
          adjustedAction = 'call';
          adjustedSizing = undefined;
        }
      }
    } else if (handTier === 3) {
      if (riskPremium < 0.08) {
        adjustedAction = 'raise';
        adjustedSizing = 2.5;
      } else if (riskPremium < 0.12) {
        if (position === 'BTN' || position === 'CO') {
          adjustedAction = 'raise';
          adjustedSizing = 2.5;
        } else {
          adjustedAction = Math.random() < 0.5 ? 'raise' : 'fold';
          if (adjustedAction === 'raise') adjustedSizing = 2.5;
        }
      } else {
        if (position === 'BTN') {
          adjustedAction = 'raise';
          adjustedSizing = 2.5;
        } else {
          adjustedAction = 'fold';
        }
      }
    } else if (handTier === 4) {
      if (riskPremium < 0.05) {
        if (position === 'BTN' || position === 'CO') {
          adjustedAction = 'raise';
          adjustedSizing = 2.5;
        } else {
          adjustedAction = Math.random() < 0.3 ? 'raise' : 'fold';
          if (adjustedAction === 'raise') adjustedSizing = 2.5;
        }
      } else if (riskPremium < 0.10) {
        if (position === 'BTN') {
          adjustedAction = Math.random() < 0.6 ? 'raise' : 'fold';
          if (adjustedAction === 'raise') adjustedSizing = 2.5;
        } else {
          adjustedAction = 'fold';
        }
      } else {
        adjustedAction = 'fold';
      }
    } else {
      if (riskPremium < 0.03 && (position === 'BTN' || position === 'CO')) {
        adjustedAction = Math.random() < 0.2 ? 'raise' : 'fold';
        if (adjustedAction === 'raise') adjustedSizing = 2.5;
      } else {
        adjustedAction = 'fold';
      }
    }
  } else if (action === 'facing_open') {
    if (handTier <= 1) {
      if (riskPremium > 0.15) {
        adjustedAction = Math.random() < 0.6 ? 'raise' : 'call';
        adjustedSizing = 3.0;
      } else {
        adjustedAction = 'raise';
        adjustedSizing = 3.0;
      }
    } else if (handTier === 2) {
      if (riskPremium < 0.08) {
        adjustedAction = Math.random() < 0.7 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 3.0;
      } else if (riskPremium < 0.12) {
        adjustedAction = Math.random() < 0.4 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 3.0;
      } else {
        adjustedAction = Math.random() < 0.2 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 3.0;
      }
    } else if (handTier === 3) {
      if (riskPremium < 0.05) {
        adjustedAction = Math.random() < 0.3 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 3.0;
      } else if (riskPremium < 0.10) {
        adjustedAction = Math.random() < 0.1 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 3.0;
      } else {
        adjustedAction = 'fold';
      }
    } else {
      if (riskPremium < 0.03 && position === 'BB') {
        adjustedAction = Math.random() < 0.2 ? 'call' : 'fold';
      } else {
        adjustedAction = 'fold';
      }
    }
  } else if (action === 'facing_3bet') {
    if (handTier <= 1) {
      if (riskPremium > 0.12) {
        adjustedAction = Math.random() < 0.5 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 4.0;
      } else {
        adjustedAction = 'raise';
        adjustedSizing = 4.0;
      }
    } else if (handTier === 2) {
      if (riskPremium < 0.08) {
        adjustedAction = Math.random() < 0.5 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 4.0;
      } else if (riskPremium < 0.12) {
        adjustedAction = Math.random() < 0.3 ? 'raise' : 'call';
        if (adjustedAction === 'raise') adjustedSizing = 4.0;
      } else {
        adjustedAction = Math.random() < 0.15 ? 'call' : 'fold';
      }
    } else {
      if (riskPremium < 0.05) {
        adjustedAction = Math.random() < 0.2 ? 'call' : 'fold';
      } else {
        adjustedAction = 'fold';
      }
    }
  } else if (action === 'facing_shove') {
    if (handTier <= 1) {
      adjustedAction = 'call';
    } else if (handTier === 2) {
      if (riskPremium < 0.10) {
        adjustedAction = Math.random() < 0.8 ? 'call' : 'fold';
      } else if (riskPremium < 0.15) {
        adjustedAction = Math.random() < 0.5 ? 'call' : 'fold';
      } else {
        adjustedAction = Math.random() < 0.2 ? 'call' : 'fold';
      }
    } else if (handTier === 3) {
      if (riskPremium < 0.05) {
        adjustedAction = Math.random() < 0.4 ? 'call' : 'fold';
      } else if (riskPremium < 0.10) {
        adjustedAction = Math.random() < 0.2 ? 'call' : 'fold';
      } else {
        adjustedAction = 'fold';
      }
    } else {
      if (riskPremium < 0.03 && position === 'BB') {
        adjustedAction = Math.random() < 0.15 ? 'call' : 'fold';
      } else {
        adjustedAction = 'fold';
      }
    }
  }

  const reasoning = `ICM调整: ${stage}阶段, 风险溢价 ${(riskPremium * 100).toFixed(1)}%, 手牌等级 ${handTier}`;

  return {
    action: adjustedAction,
    sizing: adjustedSizing,
    riskPremium,
    bubbleFactor: avgBubbleFactor,
    icmAdjustment,
    reasoning,
  };
}

export function isTournamentBubble(state: GameState): boolean {
  const totalPlayers = state.players.length;
  const activePlayers = state.players.filter(p => !p.folded).length;

  if (totalPlayers <= 6) return false;

  const percentRemaining = activePlayers / totalPlayers;
  return percentRemaining <= 0.15 && percentRemaining > 0.05;
}

export function getICMConfig(state: GameState): ICMConfig {
  const playerStacks = state.players.map(p => p.chips);
  const totalChips = playerStacks.reduce((a, b) => a + b, 0);
  const averageStack = totalChips / state.players.length;

  return {
    tournamentStage: getTournamentStage(state.players.length, Math.floor(state.players.length * 0.15)),
    payoutStructure: [0.50, 0.30, 0.20],
    playerStacks,
    heroStack: state.players[0]?.chips || 0,
    blinds: state.smallBlind * 2,
    ante: 0,
    numPlayers: state.players.length,
    averageStack,
  };
}
