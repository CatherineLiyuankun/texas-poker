import React from 'react';
import type { Card as CardType } from '../types/poker';
import { Card } from './Card';

interface CommunityCardsProps {
  cards: CardType[];
  phase: string;
}

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, phase }) => {
  const totalCards = 5;
  const visibleCards = phase === 'preflop' ? 0 : phase === 'flop' ? 3 : phase === 'turn' ? 4 : 5;
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-white/70 text-sm font-medium tracking-wider">
        {phase === 'preflop' ? '翻牌前' : phase === 'flop' ? '翻牌' : phase === 'turn' ? '转牌' : phase === 'river' ? '河牌' : '摊牌'}
      </div>
      <div className="flex gap-2 justify-center">
        {Array.from({ length: totalCards }).map((_, index) => (
          <Card 
            key={index} 
            card={index < visibleCards ? cards[index] : null} 
            delay={index * 150}
          />
        ))}
      </div>
    </div>
  );
};
