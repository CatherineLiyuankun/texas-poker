import { translations } from './translations';

export interface PlayerPosition {
  angle: number;
  x: number;
  y: number;
}

export const calculatePlayerPositions = (playerCount: number): PlayerPosition[] => {
  const positions: PlayerPosition[] = [];
  const centerX = 550;
  const centerY = 350;
  
  const radiusX = 410;
  const radiusY = 310;
  
  const startAngle = -90;
  const angleStep = 360 / playerCount;
  
  for (let i = 0; i < playerCount; i++) {
    const angle = startAngle + i * angleStep;
    const radian = (angle * Math.PI) / 180;
    
    const x = centerX + radiusX * Math.cos(radian);
    const y = centerY + radiusY * Math.sin(radian);
    
    positions.push({ angle, x, y });
  }
  
  return positions;
};

export function getPositionLabel(
  playerIdx: number,
  dealerId: number,
  totalPlayers: number,
): string {
  const { position: pos } = translations;
  const dealerIdx = dealerId - 1;
  const offset = (playerIdx - dealerIdx + totalPlayers) % totalPlayers;

  if (totalPlayers <= 1) return '';

  if (totalPlayers === 2) {
    return offset === 0 ? pos.btnSb : pos.BB;
  }

  if (offset === 0) return pos.BTN;
  if (offset === 1) return pos.SB;
  if (offset === 2) return pos.BB;
  if (offset === totalPlayers - 1) return pos.CO;
  if (offset === totalPlayers - 2) return pos.HJ;

  const middleStart = 3;
  const middleEnd = totalPlayers - 3;
  const middleCount = middleEnd - middleStart + 1;

  const earlyCount = Math.ceil(middleCount / 2);
  const mpCount = middleCount - earlyCount;

  if (offset - middleStart < earlyCount) {
    const idx = offset - middleStart;
    return earlyCount === 1 ? pos.UTG : pos.utgPlus(idx);
  }

  const idx = offset - middleStart - earlyCount;
  if (mpCount <= 1) return pos.MP;
  return pos.mpN(idx + 1);
}