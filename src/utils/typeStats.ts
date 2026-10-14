/**
 * 按**分配类型**聚合长期统计（方案 §8.1 / §8.3 / §9.1，P7）。
 *
 * ## 为什么要有这一层
 *
 * 既有统计一律按**座位**（playerId）聚合。可座位不是稳定身份：同一个座位在不同盘里
 * 可能是 TAG、也可能是真人，把它们的样本混在一起得到的比率没有意义。P5 已经在每手
 * 开手时冻结了分配快照（`HandRecord.playerTypes`）与角色快照（`playerRoles`），
 * 本模块就是那份快照的**第一个消费者** —— 按「开手时被分配成什么」分组。
 *
 * ## 两种身份不可混淆（§8.1）
 *
 * - `groupType`：**分配**身份，来自开手快照，决定这一手样本进哪个组；
 * - `observedPlayerType`：**实测**分类，由池化后的计数过分类树得出。
 *
 * 分配 TAG 但实测像 Fish 的样本**仍留在 TAG 组** —— 这个偏差正是 P9 校准要看的信号，
 * 搬到 Fish 组会把它掩盖掉。
 *
 * ## 不平均比率（§9.1 / §10.2 硬门）
 *
 * 池化的是**原始计数**（分子/分母），不是比率：`1/1` 与 `0/9` 合并成 `1/10 = 10%`，
 * 而不是两者比率的均值 `50%`。实现上就是把每个 player-hand 的 `StatCounts` 用
 * `sumCounts` 累加，最后 `statsFromCounts` 只除一次 —— 与单座位聚合共用同一个内核，
 * 所以两条路径不可能给出不同口径（§9.3）。
 *
 * ## 纯函数
 *
 * 不读 localStorage、不碰 React。手牌记录由调用方（`longOpponentModel`）传入。
 */
import type { PlayerId } from '../types/poker';
import type { BotPersonality, BotTypeMap } from './botPersonality';
import { BOT_PERSONALITY_TYPES, isValidBotPersonality } from './botPersonality';
import type { PlayerRole } from '../types/stats';
import type { HandRecordLike } from './opponentModelUtil';
import {
  EMPTY_STAT_COUNTS,
  type GroupStats,
  type PlayerType,
  type StatCounts,
  computePlayerHandCounts,
  statsFromCounts,
  sumCounts,
} from './opponentModelUtil';

/** 带开手快照的手牌记录（`HandRecord` 可直接赋给它）。 */
export interface SnapshotHandRecord extends HandRecordLike {
  /** 开手时的分配快照（座位 → 性格）；关闭性格时为空对象，旧记录缺失。 */
  playerTypes?: BotTypeMap;
  /** 开手时的角色快照；旧记录缺失。 */
  playerRoles?: Partial<Record<PlayerId, PlayerRole>>;
}

/** 分配组：六类性格，外加「无有效分配」的 Unknown 组。 */
export type BotTypeGroup = BotPersonality | 'Unknown';

/** 组的稳定显示顺序：六类按 `BOT_PERSONALITY_TYPES`，Unknown 永远最后。 */
const GROUP_ORDER: readonly BotTypeGroup[] = [...BOT_PERSONALITY_TYPES, 'Unknown'];

/** §8.1 的行 key：`bot-type:TAG`（真人行保持座位 key，不走这里）。 */
export function typeRowKey(group: BotTypeGroup): string {
  return `bot-type:${group}`;
}

/**
 * 一组（一个分配类型）的聚合结果。
 *
 * 刻意**不带 `playerId`** —— 组不是玩家，虚构一个合成 id 会让消费者误以为它能当座位用
 * （§8.1「不把类型字符串塞入 PlayerId，也不虚构合成玩家」）。
 */
export interface TypeStats extends Omit<GroupStats, 'playerType'> {
  /** 行 key（`bot-type:TAG`）。 */
  rowKey: string;
  /** 分配组。`Unknown` = 关闭性格 / 旧记录无有效分配。 */
  groupType: BotTypeGroup;
  /** 实测分类（池化计数过分类树）。与 `groupType` 是两种身份，不可混淆。 */
  observedPlayerType: PlayerType;
  /**
   * 原始计数（分子/分母/机会数）。UI 与诊断需要它来回答「这个比率有多少样本支撑」，
   * 也是 §9.1「无法重建的指标提供覆盖数/缺失数」的落点。
   */
  counts: StatCounts;
}

/**
 * 该 player-hand 属于哪个分配组；真人返回 `null`（**绝不**进任何类型组，§8.3）。
 *
 * 判定顺序即 §8.3 的历史兼容政策：
 * 1. 角色快照明确是 `human` → 不进组（真人始终按 playerId 聚合）；
 * 2. 分配快照里有**合法**类型 → 进该类型组（旧记录若有合法 type，同样视为已分配证据）；
 * 3. 其余一律 → `Unknown`。这一支同时覆盖三种情况，且它们的归宿按决策 38 本就相同：
 *    - 新记录 + 关闭性格（`playerTypes` 是空对象）；
 *    - 角色是 bot 但无分配；
 *    - **同时无 roles 与 type 的旧记录**（决策 38：全部归 Bot Unknown，
 *      UI 注明「旧数据身份未标注」，**不设 Legacy Unknown 行**）。
 *
 * ⚠️ 第 3 支的后果要点明：旧记录若连角色快照都没有，那一手的真人座位也会落进
 * Unknown 组（无从分辨）。这是决策 38 明确接受的取舍，不是本模块的漏洞 ——
 * 新记录一定带 `playerRoles`，真人恒被第 1 支排除。
 */
function groupOf(hand: SnapshotHandRecord, playerId: PlayerId): BotTypeGroup | null {
  if (hand.playerRoles?.[playerId] === 'human') return null;
  const assigned = hand.playerTypes?.[playerId];
  return isValidBotPersonality(assigned) ? assigned : 'Unknown';
}

/**
 * 该手所有**参与者**的座位（去重、顺序确定）。
 *
 * 与 `computePlayerHandCounts` 的参与判定同一口径：在 `players` 名单里，或留下过动作。
 * 只遍历事件会漏掉「拿到牌但一个动作都没做」的座位（例如翻前 all-in 后被 runout 的玩家），
 * 只遍历 `players` 则会在旧记录缺该字段时漏掉所有人 —— 所以两者取并集。
 */
function participantsOf(hand: SnapshotHandRecord): PlayerId[] {
  const ids: PlayerId[] = [...(hand.players ?? [])];
  const seen = new Set<PlayerId>(ids);
  for (const e of hand.events) {
    if (!seen.has(e.playerId)) {
      seen.add(e.playerId);
      ids.push(e.playerId);
    }
  }
  return ids;
}

/**
 * 按分配类型聚合。
 *
 * **入参必须是完整手牌记录**（每手 `events` 含所有玩家的动作）—— c-bet / 3-bet /
 * fold-to-c-bet / check-raise / turn-c-bet 都要看到对手的动作，理由与
 * `computePlayerStatsFromEvents` 完全相同。
 *
 * 只输出**有样本**的组（`handsDealt > 0`），按 `GROUP_ORDER` 稳定排序。
 * 空组不产出空行：关闭性格时会凭空多出六行全 `--` 的类型行，既吵又会让人误以为
 * 「这盘分配过这六种性格」。组的标签本身**总是可显示**的（§8.1），
 * 样本不足时由 UI 按 `MIN_HANDS_FOR_CLASSIFICATION` 显示占位符。
 *
 * 同手两个同类型 Bot = **两份 player-hand**，分母 +2（§9.1）；
 * 同一手重复导入不会 +2 —— 去重发生在 `importStats`（按 `handId`），不在这里。
 */
export function computeTypeStats(hands: readonly SnapshotHandRecord[]): TypeStats[] {
  const pooled = new Map<BotTypeGroup, StatCounts>();

  for (const hand of hands) {
    for (const playerId of participantsOf(hand)) {
      const group = groupOf(hand, playerId);
      if (group === null) continue; // 真人：绝不进类型组

      const counts = computePlayerHandCounts(playerId, hand);
      if (!counts) continue; // 理论上不会发生（participantsOf 与它同口径），防御性跳过

      pooled.set(group, sumCounts(pooled.get(group) ?? EMPTY_STAT_COUNTS, counts));
    }
  }

  const rows: TypeStats[] = [];
  for (const group of GROUP_ORDER) {
    const counts = pooled.get(group);
    if (!counts || counts.handsDealt === 0) continue;
    // `playerType` 是**实测**分类；这里把它显式改名为 `observedPlayerType` 并
    // **不**再展开原字段 —— 否则一行上会同时有 `playerType` 与 `observedPlayerType`
    // 两个同义字段，正是 §8.1 要防的「分配身份与实测身份混淆」。
    const { playerType: observedPlayerType, ...metrics } = statsFromCounts(counts);
    rows.push({
      rowKey: typeRowKey(group),
      groupType: group,
      observedPlayerType,
      ...metrics,
      counts,
    });
  }
  return rows;
}
