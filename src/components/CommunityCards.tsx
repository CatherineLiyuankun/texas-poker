import React from 'react';
import type { Card as CardType } from '../types/poker';
import { Card } from './Card';
import { translations } from '../utils/translations';

interface CommunityCardsProps {
  cards: CardType[];
  phase: string;
}

const PHASE_LABELS: Record<string, string> = {
  preflop: translations.communityCards.preflop,
  flop: translations.communityCards.flop,
  turn: translations.communityCards.turn,
  river: translations.communityCards.river,
  showdown: translations.communityCards.showdown,
};

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, phase }) => {
  const totalCards = 5;
  const visibleCards = phase === 'preflop' ? 0 : phase === 'flop' ? 3 : phase === 'turn' ? 4 : 5;
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-white/70 text-sm font-medium tracking-wider">
        {PHASE_LABELS[phase] || phase}
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