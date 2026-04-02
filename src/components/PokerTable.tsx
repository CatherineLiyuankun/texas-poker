import React from 'react';

interface PokerTableProps {
  children?: React.ReactNode;
}

export const PokerTable: React.FC<PokerTableProps> = ({ children }) => {
  return (
    <div className="relative w-[800px] h-[480px] mx-auto">
      <div className="absolute inset-0 rounded-[240px] bg-gradient-to-b from-[#1a5a2a] via-[#2d7a3d] to-[#1a5a2a] border-[16px] border-[#5c3a21] shadow-[0_0_30px_rgba(0,0,0,0.5),inset_0_0_60px_rgba(0,0,0,0.3)]">
        <div className="absolute inset-[12px] rounded-[215px] bg-gradient-to-b from-[#2d7a3d] via-[#3d8a4d] to-[#2d7a3d] border-[6px] border-[#4a6a32]">
          <div className="absolute inset-0 rounded-[200px] border-[3px] border-dashed border-[#4a6a32]/40" />
        </div>
      </div>
      
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {children}
      </div>
    </div>
  );
};