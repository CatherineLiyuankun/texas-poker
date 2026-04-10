import type { Player, SidePot, PlayerId } from '../types/poker';

export interface PotCalculation {
  mainPot: number;
  sidePots: SidePot[];
}

export function calculatePots(
  players: Player[],
  currentPot: number,
): PotCalculation {
  const playersWithBet = players.filter((p) => p.bet > 0);

  if (playersWithBet.length === 0) {
    return { mainPot: currentPot, sidePots: [] };
  }

  const activePlayers = players.filter((p) => !p.folded && p.bet > 0);

  if (activePlayers.length === 0) {
    return { mainPot: currentPot, sidePots: [] };
  }

  const mainThreshold = Math.min(...activePlayers.map((p) => p.bet));

  let mainPot = currentPot;
  playersWithBet.forEach((p) => {
    mainPot += Math.min(p.bet, mainThreshold);
  });

  const thresholds = [...new Set(playersWithBet.map((p) => p.bet))]
    .filter((bet) => bet > mainThreshold)
    .sort((a, b) => a - b);

  const sidePots: SidePot[] = [];

  let prevThreshold = mainThreshold;

  for (let i = 0; i < thresholds.length; i++) {
    const threshold = thresholds[i];
    const levelBet = threshold - prevThreshold;

    const eligiblePlayers = activePlayers
      .filter((p) => p.bet >= threshold)
      .map((p) => p.id);

    const contributions: Partial<Record<PlayerId, number>> = {};
    activePlayers
      .filter((p) => p.bet >= threshold)
      .forEach((p) => {
        contributions[p.id] = levelBet;
      });

    const amount = levelBet * eligiblePlayers.length;

    sidePots.push({
      id: i + 1,
      amount,
      contributions,
      eligiblePlayers,
      level: i + 1,
      threshold,
    });

    prevThreshold = threshold;
  }

  return { mainPot, sidePots };
}

export function validateTotalPots(
  players: Player[],
  pots: PotCalculation,
  currentPot: number,
): boolean {
  const totalBet = players.reduce((sum, p) => sum + p.bet, 0);
  const totalPots =
    pots.mainPot + pots.sidePots.reduce((sum, sp) => sum + sp.amount, 0);

  return totalPots === totalBet + currentPot;
}