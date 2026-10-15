import React from 'react';
import { translations } from '../utils/translations';
import type { PlayerLongStats } from '../utils/longOpponentModel';
import type { TypeStats } from '../utils/typeStats';
import { MIN_HANDS_FOR_CLASSIFICATION } from '../utils/opponentModelUtil';

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
    case 'Fish': return 'text-cyan-400';
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
  /**
   * 按**分配类型**聚合的长期统计（方案 §8.1，P7）。
   *
   * 只在**当前盘开启性格**时由 `GameBoard` 传入 —— 关闭时传 `undefined`，表格就退回
   * 「按座位展示实测类型」的旧形态（§8.3 决策 29「不伪装分配」），一行都不会多出来。
   */
  typeStats?: TypeStats[];
}

/** 一行需要的指标字段（座位行与类型行**共用同一套单元格**，不写两遍）。 */
interface MetricValues {
  handsDealt: number;
  vpip: number;
  pfr: number;
  threeBet: number | null;
  af: number | null;
  afq: number | null;
  cbet: number | null;
  foldToCbet: number | null;
  turnCbet: number | null;
  checkRaise: number | null;
  wtsd: number | null;
  wsd: number | null;
}

/** 翻前三列（VPIP / PFR / 3-Bet）。`handsDealt === 0` 时显示占位符而不是 0%。 */
const PreflopCells: React.FC<{ m: MetricValues }> = ({ m }) => (
  <>
    <td className={`text-right ${m.handsDealt > 0 ? getVpipColor(m.vpip * 100) : ''}`}>
      {m.handsDealt > 0 ? `${(m.vpip * 100).toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.handsDealt > 0 ? getPfrColor(m.pfr * 100) : ''}`}>
      {m.handsDealt > 0 ? `${(m.pfr * 100).toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.threeBet !== null ? get3BetColor(m.threeBet) : ''}`}>
      {m.threeBet !== null ? `${m.threeBet.toFixed(0)}%` : '—'}
    </td>
  </>
);

/**
 * 「类型」列。
 *
 * ⚠️ 这一列的语义**因行的种类而不同**，所以由调用方决定传什么：
 * - 座位行（真人 / 按座位的 Bot）传**实测**分类 —— 座位没有「分配」可言；
 * - 类型组行传 `observedPlayerType`（实测），而**分配**身份写在「名字」列。
 *   两者并列正是 §8.1 的要求：分配 TAG 但实测像 Nit，两列就分别显示 TAG 与 Nit，
 *   这个偏差是 P9 校准的信号，不能互相覆盖。
 *
 * 样本不足（`handsDealt < MIN_HANDS_FOR_CLASSIFICATION`）时显示占位符 ——
 * 类型组的**组标签**仍照常显示在名字列（§8.1「组标签总可显示」）。
 */
const TypeCell: React.FC<{ playerType: string; handsDealt: number }> = ({
  playerType,
  handsDealt,
}) => {
  const typeLabel = translations.playerStats.types[playerType] || playerType;
  return (
    // 类型列**不折行**：档位标签是中英双语的（`Nit 紧弱` / `TAG 紧凶` /
    // `CS 站桩` / `Maniac 疯子`），中间那个空格就是断行点 —— 列一窄就变成
    // `Nit` / `紧弱` 两行，行高翻倍。nowrap 之后该列按内容取宽，表格整体
    // 相应变宽（浮层是收缩包裹的，跟着一起变宽）。
    // 其余数据列不加 nowrap：它们都是 `24%` / `2.2` 这类没有断行点的值，
    // 加了也不会变，只是徒增一处要维护的类名。
    <td
      className={`text-right whitespace-nowrap font-medium border-r border-white/10 ${getPlayerTypeColor(playerType)}`}
    >
      {playerType === 'Unknown' && handsDealt < MIN_HANDS_FOR_CLASSIFICATION
        ? translations.playerStats.insufficientData
        : typeLabel}
    </td>
  );
};

/** 翻后六列 + 摊牌两列。 */
const PostflopCells: React.FC<{ m: MetricValues }> = ({ m }) => (
  <>
    <td className={`text-right ${m.af !== null ? getAfColor(m.af) : ''}`}>
      {m.af !== null ? m.af.toFixed(1) : '—'}
    </td>
    <td className={`text-right ${m.afq !== null ? getAFqColor(m.afq) : ''}`}>
      {m.afq !== null ? `${m.afq.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.cbet !== null ? getCbetColor(m.cbet) : ''}`}>
      {m.cbet !== null ? `${m.cbet.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.foldToCbet !== null ? getFoldToCbetColor(m.foldToCbet) : ''}`}>
      {m.foldToCbet !== null ? `${m.foldToCbet.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.turnCbet !== null ? getTurnCbetColor(m.turnCbet) : ''}`}>
      {m.turnCbet !== null ? `${m.turnCbet.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right border-r border-white/10 ${m.checkRaise !== null ? getCrColor(m.checkRaise) : ''}`}>
      {m.checkRaise !== null ? `${m.checkRaise.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.wtsd !== null ? getWtsdColor(m.wtsd) : ''}`}>
      {m.wtsd !== null ? `${m.wtsd.toFixed(0)}%` : '—'}
    </td>
    <td className={`text-right ${m.wsd !== null ? getWsdColor(m.wsd) : ''}`}>
      {m.wsd !== null ? `${m.wsd.toFixed(0)}%` : '—'}
    </td>
  </>
);

/** 整表的列数（名字 + 12 个指标列），分隔行的 colSpan 用它，改列时不会漏。 */
const COLUMN_COUNT = 13;

export const PlayerStatsTable: React.FC<PlayerStatsTableProps> = ({
  longStats,
  botLongStats,
  typeStats,
}) => {
  const botStats = botLongStats ?? [];
  const realStats = longStats ?? [];
  const groups = typeStats ?? [];
  if (botStats.length === 0 && realStats.length === 0 && groups.length === 0) return null;

  // **真人行在前、Bot 行在后** —— 看表的人自己（和同场真人）是主角，Bot 是对手，
  // 放在下面。两类座位行的单元格口径完全相同，只有名字不同 —— 合并成一张列表，
  // 避免同一套 13 列写两遍。
  const rows = [
    ...realStats.map((stat) => ({
      key: `real-${stat.playerId}`,
      name: `P${stat.playerId}`,
      stat,
    })),
    ...botStats.map((stat) => ({
      key: `bot-${stat.playerId}`,
      name: `${translations.playerArea.bot}${stat.playerId}`,
      stat,
    })),
  ];

  return (
    // 表头一律 `whitespace-nowrap`：`3-Bet` / `Turn CB` / `F/CB` / `W$SD` 里都有
    // 连字符、空格或斜杠，浏览器会把它们当断行点 —— 列一窄就被折成 `3-` / `Bet`
    // 两行，表头高度翻倍且对不齐。加了 nowrap 之后，表格的 min-content 宽度由表头
    // 决定，浮层（absolute + 收缩包裹）随之变宽；实在放不下时由外层的
    // `overflow-x-auto` 兜底横向滚动，而不是把字折断。
    // 数据单元格里只有「类型」列需要同样的处理（见下面那一列的注释）。
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-white/30 text-[10px]">
          <th className="text-left whitespace-nowrap" />
          <th colSpan={4} className="text-center whitespace-nowrap border-b border-white/10">{translations.playerStats.preflop}</th>
          <th colSpan={6} className="text-center whitespace-nowrap border-b border-white/10">{translations.playerStats.postflop}</th>
          <th colSpan={2} className="text-center whitespace-nowrap border-b border-white/10">{translations.playerStats.showdown}</th>
        </tr>
        <tr className="text-white/50 text-[8px]">
          <th className="text-left whitespace-nowrap">{translations.playerStats.name}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.vpip}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.pfr}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.threeBet}</th>
          <th className="text-right whitespace-nowrap border-r border-white/10">{translations.playerStats.type}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.af}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.afq}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.cbet}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.foldToCbet}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.turnCbet}</th>
          <th className="text-right whitespace-nowrap border-r border-white/10">{translations.playerStats.checkRaise}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.wtsd}</th>
          <th className="text-right whitespace-nowrap">{translations.playerStats.wsd}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, name, stat }) => (
          <tr key={key} className="text-white">
            <td className="text-left">{name}</td>
            <PreflopCells m={stat} />
            {/* 座位行没有「分配」身份，这一列就是实测分类。 */}
            <TypeCell playerType={stat.playerType} handsDealt={stat.handsDealt} />
            <PostflopCells m={stat} />
          </tr>
        ))}
        {/*
          按分配类型聚合的行（§8.1，P7）。只在开启性格时由 GameBoard 传入；
          关闭时 `groups` 为空 ⇒ 这一段一行都不渲染，表格退回按座位的旧形态。
        */}
        {groups.length > 0 && (
          <>
            <tr>
              <td
                colSpan={COLUMN_COUNT}
                className="pt-2 text-left whitespace-nowrap text-white/40 border-t border-white/10"
              >
                {translations.playerStats.typeGroupHeader}
                <span className="ml-1 text-white/25">
                  ({translations.playerStats.assignedType} / {translations.playerStats.observedType})
                </span>
              </td>
            </tr>
            {groups.map((group) => {
              // 名字列显示**分配**身份，类型列显示**实测**分类 —— 两者并列（§8.1）。
              // `Unknown` 组是「无有效分配」（关闭性格 / 旧记录），标签换文案说明，
              // 并在有旧数据嫌疑时提示身份未标注（§8.3 决策 38，不设 Legacy 行）。
              const assignedLabel =
                group.groupType === 'Unknown'
                  ? translations.playerStats.unassignedGroup
                  : translations.playerStats.types[group.groupType] || group.groupType;
              return (
                <tr key={group.rowKey} className="text-white/90">
                  <td className="text-left whitespace-nowrap">{assignedLabel}</td>
                  <PreflopCells m={group} />
                  <TypeCell
                    playerType={group.observedPlayerType}
                    handsDealt={group.handsDealt}
                  />
                  <PostflopCells m={group} />
                </tr>
              );
            })}
            <tr>
              <td
                colSpan={COLUMN_COUNT}
                className="pb-1 text-left text-white/25 text-[8px] whitespace-nowrap"
              >
                {translations.playerStats.typeGroupHint}
                {groups.some((g) => g.groupType === 'Unknown') &&
                  ` ${translations.playerStats.legacyNote}`}
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
};
