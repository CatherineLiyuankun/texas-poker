import type { PlayerId } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';
import {
  type VpipPfrStats,
  computeVPIPFromEvents,
  computePFRFromEvents,
  computeAFFromEvents,
  computeCBetFromEvents,
  computeWTSDFromEvents,
  computeCheckRaiseFromEvents,
  classifyPlayerType,
} from './opponentModelUtil';

export type { PlayerType, VpipPfrStats } from './opponentModelUtil';

export interface PlayerLongStats extends VpipPfrStats {
  af: number | null;
  cbet: number | null;
  wtsd: number | null;
  checkRaise: number | null;
}

interface PersistentData {
  version: number;
  hands: HandRecord[];
}

const STORAGE_KEY = 'texas-poker-long-stats';

let persistentData: PersistentData = {
  version: 2,
  hands: [],
};

let initialized = false;

function loadFromStorage(): void {
  if (initialized) return;
  initialized = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.version === 2 && Array.isArray(data.hands)) {
        persistentData = data;
        return;
      }
    }
  } catch {
    // ignore
  }

  // No data found, use default
  persistentData = { version: 2, hands: [] };
}

function saveToStorage(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentData));
}

export function recordAction(event: ActionEvent): void {
  loadFromStorage();

  // Find or create the hand record
  let handRecord = persistentData.hands.find(h => h.handId === event.handId);
  if (!handRecord) {
    handRecord = {
      handId: event.handId,
      timestamp: event.timestamp,
      events: [],
      players: [],
    };
    persistentData.hands.push(handRecord);
  }

  // Add the event
  handRecord.events.push(event);

  // Track players in this hand
  if (!handRecord.players.includes(event.playerId)) {
    handRecord.players.push(event.playerId);
  }

  saveToStorage();
}

export function saveHand(hand: HandRecord): void {
  loadFromStorage();

  // Check if hand already exists
  const existingIndex = persistentData.hands.findIndex(h => h.handId === hand.handId);
  if (existingIndex >= 0) {
    // Update existing hand
    persistentData.hands[existingIndex] = hand;
  } else {
    // Add new hand
    persistentData.hands.push(hand);
  }

  saveToStorage();
}

export function endCurrentHand(winner: PlayerId | null, potAmount: number): void {
  loadFromStorage();

  // Find the most recent hand (last one added)
  if (persistentData.hands.length === 0) return;

  const lastHand = persistentData.hands[persistentData.hands.length - 1];
  lastHand.result = { winner, potAmount };

  saveToStorage();
}

export function getPlayerLongStats(playerId: PlayerId): PlayerLongStats {
  loadFromStorage();

  // Get all hands where this player participated
  const playerHands = persistentData.hands.filter(h => h.players.includes(playerId));
  const handsDealt = playerHands.length;

  if (handsDealt === 0) {
    return {
      playerId,
      handsDealt: 0,
      vpip: 0,
      pfr: 0,
      gap: 0,
      playerType: 'Unknown',
      af: null,
      cbet: null,
      wtsd: null,
      checkRaise: null,
    };
  }

  // Collect all events for this player
  const allEvents: ActionEvent[] = [];
  for (const hand of playerHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }

  // Compute statistics from events
  const vpip = computeVPIPFromEvents(allEvents, handsDealt);
  const pfr = computePFRFromEvents(allEvents, handsDealt);
  const af = computeAFFromEvents(allEvents);
  const cbet = computeCBetFromEvents(allEvents, playerHands);
  const wtsd = computeWTSDFromEvents(allEvents, playerHands);
  const checkRaise = computeCheckRaiseFromEvents(allEvents);

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
    af,
    cbet,
    wtsd,
    checkRaise,
  };
}

export function getAllRealPlayerStats(realPlayerIds: PlayerId[]): PlayerLongStats[] {
  return realPlayerIds.map(id => getPlayerLongStats(id));
}

export function resetLongTermStats(): void {
  persistentData = { version: 2, hands: [] };
  localStorage.removeItem(STORAGE_KEY);
  initialized = false;
}

export function exportStats(): void {
  loadFromStorage();

  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    hands: persistentData.hands,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'player-stats.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importStats(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Only handle v2 format
    if (data.version === 2 && Array.isArray(data.hands)) {
      loadFromStorage();

      // Merge hands (avoid duplicates by handId)
      const existingHandIds = new Set(persistentData.hands.map(h => h.handId));
      for (const hand of data.hands) {
        if (!existingHandIds.has(hand.handId)) {
          persistentData.hands.push(hand);
        }
      }

      saveToStorage();
      return true;
    }

    return false;
  } catch {
    return false;
  }
}


