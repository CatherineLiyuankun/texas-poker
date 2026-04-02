export interface PlayerPosition {
  angle: number;
  x: number;
  y: number;
}

export const calculatePlayerPositions = (playerCount: number): PlayerPosition[] => {
  const positions: PlayerPosition[] = [];
  const centerX = 550;
  const centerY = 350;
  
  const radiusX = 500;
  const radiusY = 320;
  
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