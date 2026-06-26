import type { PlayerId, Action } from '../types/poker';

export type PlayerType =
  | 'Nit'
  | 'TAG'
  | 'LAG'
  | 'Calling Station'
  | 'Maniac'
  | 'Others'
  | 'Unknown';

export interface VpipPfrStats {
  playerId: PlayerId;
  handsDealt: number;
  vpip: number;
  pfr: number;
  gap: number;
  playerType: PlayerType;
}

export interface HandStats {
  handsDealt: number;
  vpipCount: number;
  pfrCount: number;
  preflopActed: boolean;
}

const MIN_HANDS_FOR_CLASSIFICATION = 10;

export function createHandStats(): HandStats {
  return {
    handsDealt: 0,
    vpipCount: 0,
    pfrCount: 0,
    preflopActed: false,
  };
}

export function incrementHandCount(stats: HandStats): void {
  stats.handsDealt++;
  stats.preflopActed = false;
}

export function applyPreflopAction(
  stats: HandStats,
  action: Action,
  allInAmount?: number,
  currentBet?: number,
): void {
  if (stats.preflopActed) return;
  stats.preflopActed = true;

  let isVpip = false;
  let isPfr = false;

  switch (action) {
    case 'raise':
      isVpip = true;
      isPfr = true;
      break;
    case 'call':
      isVpip = true;
      break;
    case 'allin':
      isVpip = true;
      if (
        allInAmount !== undefined &&
        currentBet !== undefined &&
        allInAmount > currentBet
      ) {
        isPfr = true;
      }
      break;
    case 'check':
    case 'fold':
      break;
  }

  if (isVpip) stats.vpipCount++;
  if (isPfr) stats.pfrCount++;
}

export function classifyPlayerType(
  vpip: number,
  pfr: number,
  sampleSize: number,
): PlayerType {
  if (sampleSize < MIN_HANDS_FOR_CLASSIFICATION) return 'Unknown';

  const gap = vpip - pfr;

  if (vpip >= 0.45 && pfr >= 0.35) return 'Maniac';
  if (vpip > 0.35 && pfr < 0.15 && gap > 0.20) return 'Calling Station';
  if (vpip <= 0.20 && pfr < 0.12 && gap > 0.08) return 'Nit';
  if (vpip <= 0.28 && vpip >= 0.20 && pfr >= 0.16 && pfr <= 0.32 && gap <= 0.08) return 'TAG';
  if (vpip <= 0.38 && pfr >= 0.20 && pfr <= 0.32 && gap <= 0.08) return 'LAG';

  return 'Others';
}

export function computeVpipPfr(
  playerId: PlayerId,
  stats: HandStats,
): VpipPfrStats {
  const handsDealt = stats.handsDealt;
  const vpip = handsDealt > 0 ? stats.vpipCount / handsDealt : 0;
  const pfr = handsDealt > 0 ? stats.pfrCount / handsDealt : 0;

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
  };
}
