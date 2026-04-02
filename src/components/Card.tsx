import React, { useState, useEffect } from 'react';
import type { Card as CardType } from '../types/poker';

interface CardProps {
  card: CardType | null;
  hidden?: boolean;
  small?: boolean;
  delay?: number;
}

export const Card: React.FC<CardProps> = ({ card, hidden = false, small = false, delay = 0 }) => {
  const [isFlipped, setIsFlipped] = useState(hidden);

  useEffect(() => {
    setIsFlipped(hidden);
  }, [hidden]);

  const handleClick = () => {
    if (hidden && !isFlipped) {
      setIsFlipped(true);
    }
  };

  const isRed = card?.suit === '♥' || card?.suit === '♦';
  
  if (hidden && !isFlipped) {
    return (
      <div 
        className={`card-back ${small ? 'w-12 h-16' : 'w-20 h-28'} flex items-center justify-center transition-transform hover:scale-105 cursor-pointer`}
        onClick={handleClick}
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="w-full h-full rounded-lg border-2 border-amber-400 bg-gradient-to-br from-blue-800 to-blue-600 flex items-center justify-center">
          <div className="w-3/4 h-5/6 rounded border border-amber-300/50 flex items-center justify-center">
            <span className="text-amber-300/30 text-xl">🃏</span>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className={`bg-white/10 rounded-lg border-2 border-white/20 ${small ? 'w-12 h-16' : 'w-20 h-28'}`} />
    );
  }

  return (
    <div 
      className={`card-front ${small ? 'w-12 h-16 text-[8px]' : 'w-20 h-28'} flex flex-col items-center justify-between p-0.5 select-none`}
      style={{ 
        animation: 'slideUp 0.3s ease-out',
        animationDelay: `${delay}ms`,
        animationFillMode: 'both'
      }}
    >
      <div className={`${isRed ? 'text-red-600' : 'text-black'} font-bold leading-none`}>
        {card.rank}
      </div>
      <div className={`text-xl ${isRed ? 'text-red-600' : 'text-black'}`}>
        {card.suit}
      </div>
      <div className={`${isRed ? 'text-red-600' : 'text-black'} font-bold leading-none rotate-180`}>
        {card.rank}
      </div>
    </div>
  );
};
