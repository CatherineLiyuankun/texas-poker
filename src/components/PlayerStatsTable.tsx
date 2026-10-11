import React from 'react';
import { translations } from '../utils/translations';
import type { PlayerLongStats } from '../utils/longOpponentModel';

/**
 * 「玩家数据 Player Stats」表。
 *
 * 从 `HandAnalysis` 里抽出来的**纯展示组件** —— 表格原先挤在 AI 面板内部，
 * 13 列宽度把面板撑到超出边界，而面板本身又被座位可用空间压到最窄，两边互相
 * 挤兑。现在由 `GameBoard` 放在页面右上角（「真人 n | Bot n」下方）的按钮浮层里，
 * 面板不再背这张表。
 *
 * **口径：所有玩家（真人 + Bot）都读长期（跨会话）统计** —— 两行数据同源同口径，
 * 不再有「自己看长期、对手看本局」的分叉。长期库 `persistentData.hands` 存的是
 * 整手记录（含所有玩家的动作），本局的手牌同样在里面，所以这一口径不丢信息。
 */

function getPlayerTypeColor(playerType: string): string {
  switch (playerType) {
    case 'TAG': return 'text-green-400';
    case 'LAG': return 'text-orange-400';
    case 'Nit': return 'text-blue-400';
    case 'Calling Station': return 'text-red-400';
    case 'Maniac': return 'text-purple-400';
    case 'Others': return 'text-white';
    default: return 'text-white/50';
  }
}

function getVpipColor(v: number): string {
  if (v <= 20) return 'text-red-400';
  if (v <= 28) return 'text-orange-400';
  if (v <= 35) return 'text-green-400';
  return 'text-blue-400';
}

function getPfrColor(v: number): string {
  if (v <= 17) return 'text-blue-400';
  if (v <= 25) return 'text-green-400';
  if (v <= 30) return 'text-orange-400';
  return 'text-purple-400';
}

function getAfColor(v: number): string {
  if (v < 1) return 'text-blue-400';
  if (v <= 1.5) return 'text-green-400';
  if (v <= 2.5) return 'text-orange-400';
  if (v <= 3) return 'text-red-400';
  return 'text-purple-400';
}

function getCbetColor(v: number): string {
  if (v < 30) return 'text-blue-400';
  if (v <= 55) return 'text-green-400';
  if (v <= 77) return 'text-yellow-400';
  return 'text-red-400';
}

function getWtsdColor(v: number): string {
  if (v < 24) return 'text-red-400';
  if (v <= 26) return 'text-orange-400';
  if (v <= 32) return 'text-green-400';
  if (v <= 38) return 'text-blue-400';
  return 'text-purple-400';
}

function getCrColor(v: number): string {
  if (v <= 4) return 'text-blue-400';
  if (v <= 9) return 'text-green-400';
  if (v <= 11) return 'text-orange-400';
  if (v <= 18) return 'text-orange-400';
  return 'text-red-400';
}

function getWsdColor(v: number): string {
  if (v < 46) return 'text-red-400';
  if (v < 48) return 'text-orange-400';
  if (v <= 54) return 'text-green-400';
  return 'text-blue-400';
}

function get3BetColor(v: number): string {
  if (v < 5) return 'text-blue-400';
  if (v <= 10) return 'text-green-400';
  if (v <= 12) return 'text-orange-400';
  return 'text-red-400';
}

function getFoldToCbetColor(v: number): string {
  if (v < 40) return 'text-red-400';
  if (v <= 60) return 'text-green-400';
  return 'text-blue-400';
}

function getAFqColor(v: number): string {
  if (v < 35) return 'text-blue-400';
  if (v <= 55) return 'text-green-400';
  return 'text-red-400';
}

function getTurnCbetColor(v: number): string {
  if (v < 40) return 'text-blue-400';
  if (v <= 65) return 'text-green-400';
  return 'text-red-400';
}

interface PlayerStatsTableProps {
  /** 真人玩家的长期（跨会话）统计 */
  longStats?: PlayerLongStats[];
  /** Bot 玩家的长期（跨会话）统计，与 `longStats` 同口径 */
  botLongStats?: PlayerLongStats[];
}

export const PlayerStatsTable: React.FC<PlayerStatsTableProps> = ({
  longStats,
  botLongStats,
}) => {
  const botStats = botLongStats ?? [];
  const realStats = longStats ?? [];
  if (botStats.length === 0 && realStats.length === 0) return null;

  // Bot 行在前、真人行在后（与原先一致）。两行的单元格口径完全相同，
  // 只有名字不同 —— 合并成一张列表，避免同一套 13 列写两遍。
  const rows = [
    ...botStats.map((stat) => ({
      key: `bot-${stat.playerId}`,
      name: `${translations.playerArea.bot}${stat.playerId}`,
      stat,
    })),
    ...realStats.map((stat) => ({
      key: `real-${stat.playerId}`,
      name: `P${stat.playerId}`,
      stat,
    })),
  ];

  return (
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-white/30 text-[10px]">
          <th className="text-left" />
          <th colSpan={4} className="text-center border-b border-white/10">{translations.playerStats.preflop}</th>
          <th colSpan={6} className="text-center border-b border-white/10">{translations.playerStats.postflop}</th>
          <th colSpan={2} className="text-center border-b border-white/10">{translations.playerStats.showdown}</th>
        </tr>
        <tr className="text-white/50 text-[8px]">
          <th className="text-left">{translations.playerStats.name}</th>
          <th className="text-right">{translations.playerStats.vpip}</th>
          <th className="text-right">{translations.playerStats.pfr}</th>
          <th className="text-right">{translations.playerStats.threeBet}</th>
          <th className="text-right border-r border-white/10">{translations.playerStats.type}</th>
          <th className="text-right">{translations.playerStats.af}</th>
          <th className="text-right">{translations.playerStats.afq}</th>
          <th className="text-right">{translations.playerStats.cbet}</th>
          <th className="text-right">{translations.playerStats.foldToCbet}</th>
          <th className="text-right">{translations.playerStats.turnCbet}</th>
          <th className="text-right border-r border-white/10">{translations.playerStats.checkRaise}</th>
          <th className="text-right">{translations.playerStats.wtsd}</th>
          <th className="text-right">{translations.playerStats.wsd}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, name, stat }) => {
          const typeLabel =
            translations.playerStats.types[stat.playerType] || stat.playerType;
          const typeColor = getPlayerTypeColor(stat.playerType);
          return (
            <tr key={key} className="text-white">
              <td className="text-left">{name}</td>
              <td className={`text-right ${stat.handsDealt > 0 ? getVpipColor(stat.vpip * 100) : ''}`}>
                {stat.handsDealt > 0 ? `${(stat.vpip * 100).toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.handsDealt > 0 ? getPfrColor(stat.pfr * 100) : ''}`}>
                {stat.handsDealt > 0 ? `${(stat.pfr * 100).toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.threeBet !== null ? get3BetColor(stat.threeBet) : ''}`}>
                {stat.threeBet !== null ? `${stat.threeBet.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right font-medium border-r border-white/10 ${typeColor}`}>
                {stat.playerType === 'Unknown' && stat.handsDealt < 10
                  ? translations.playerStats.insufficientData
                  : typeLabel}
              </td>
              <td className={`text-right ${stat.af !== null ? getAfColor(stat.af) : ''}`}>
                {stat.af !== null ? stat.af.toFixed(1) : '—'}
              </td>
              <td className={`text-right ${stat.afq !== null ? getAFqColor(stat.afq) : ''}`}>
                {stat.afq !== null ? `${stat.afq.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.cbet !== null ? getCbetColor(stat.cbet) : ''}`}>
                {stat.cbet !== null ? `${stat.cbet.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.foldToCbet !== null ? getFoldToCbetColor(stat.foldToCbet) : ''}`}>
                {stat.foldToCbet !== null ? `${stat.foldToCbet.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.turnCbet !== null ? getTurnCbetColor(stat.turnCbet) : ''}`}>
                {stat.turnCbet !== null ? `${stat.turnCbet.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right border-r border-white/10 ${stat.checkRaise !== null ? getCrColor(stat.checkRaise) : ''}`}>
                {stat.checkRaise !== null ? `${stat.checkRaise.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.wtsd !== null ? getWtsdColor(stat.wtsd) : ''}`}>
                {stat.wtsd !== null ? `${stat.wtsd.toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right ${stat.wsd !== null ? getWsdColor(stat.wsd) : ''}`}>
                {stat.wsd !== null ? `${stat.wsd.toFixed(0)}%` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
