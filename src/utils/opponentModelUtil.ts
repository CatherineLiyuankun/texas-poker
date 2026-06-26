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

export interface PostflopStats {
  bets: number;
  raises: number;
  calls: number;
  cbetOpportunities: number;
  cbetCount: number;
  flopsSeen: number;
  showdownsReached: number;
  checkRaiseOpportunities: number;
  checkRaises: number;
}

export function createPostflopStats(): PostflopStats {
  return {
    bets: 0,
    raises: 0,
    calls: 0,
    cbetOpportunities: 0,
    cbetCount: 0,
    flopsSeen: 0,
    showdownsReached: 0,
    checkRaiseOpportunities: 0,
    checkRaises: 0,
  };
}

export function recordPostflopAction(stats: PostflopStats, action: Action): void {
  switch (action) {
    case 'raise':
      stats.raises++;
      break;
    case 'call':
      stats.calls++;
      break;
    case 'allin':
      stats.raises++;
      break;
    case 'check':
    case 'fold':
      break;
  }
}

export function calculateAF(stats: PostflopStats): number | null {
  if (stats.calls === 0) return null;
  return (stats.bets + stats.raises) / stats.calls;
}

export function getAFLabel(af: number | null): string {
  if (af === null) return '—';
  if (af > 3) return '激进 Agg';
  if (af >= 1) return '平衡 Bal';
  return '被动 Pas';
}

export function calculateCBet(stats: PostflopStats): number | null {
  if (stats.cbetOpportunities === 0) return null;
  return (stats.cbetCount / stats.cbetOpportunities) * 100;
}

export function calculateWTSD(stats: PostflopStats): number | null {
  if (stats.flopsSeen === 0) return null;
  return (stats.showdownsReached / stats.flopsSeen) * 100;
}

export function calculateCheckRaise(stats: PostflopStats): number | null {
  if (stats.checkRaiseOpportunities === 0) return null;
  return (stats.checkRaises / stats.checkRaiseOpportunities) * 100;
}

let currentPreflopAggressor: PlayerId | null = null;
let flopFirstActionRecorded = false;

export function setPreflopAggressor(playerId: PlayerId): void {
  currentPreflopAggressor = playerId;
  flopFirstActionRecorded = false;
}

export function getPreflopAggressor(): PlayerId | null {
  return currentPreflopAggressor;
}

export function clearPreflopAggressor(): void {
  currentPreflopAggressor = null;
  flopFirstActionRecorded = false;
}

export function isFlopFirstActionRecorded(): boolean {
  return flopFirstActionRecorded;
}

export function markFlopFirstActionRecorded(): void {
  flopFirstActionRecorded = true;
}

const checkedPlayers = new Set<PlayerId>();
let currentStreet: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended' | null = null;

export function recordPlayerCheck(playerId: PlayerId, street: 'flop' | 'turn' | 'river'): void {
  if (currentStreet !== street) {
    checkedPlayers.clear();
    currentStreet = street;
  }
  checkedPlayers.add(playerId);
}

export function getCheckedPlayers(): Set<PlayerId> {
  return checkedPlayers;
}

export function clearCheckedPlayers(): void {
  checkedPlayers.clear();
  currentStreet = null;
}

export function isPlayerChecked(playerId: PlayerId): boolean {
  return checkedPlayers.has(playerId);
}
