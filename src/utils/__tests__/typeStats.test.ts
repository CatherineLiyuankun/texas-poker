/**
 * 按分配类型聚合（P7）的聚焦测试 —— 方案 §8.1 / §8.3 / §9.1，
 * 对应 §10.2 验收矩阵「类型聚合」那一行（**硬门**）：
 * 「同手同类两个 Bot、同 pid 换类/换角色、legacy、缺统计证据；
 * 不平均比率、不串成员、已知组不混旧 Unknown；UI 分配/实测并列清晰」。
 *
 * 锁住这几件事：
 *   1. **不平均比率**：池化的是原始计数，不是比率。构造 3-bet 一手 `1/1`、
 *      另一手 `0/3` 的不对称样本 —— 池化得 `1/4 = 25%`，若误按比率平均会得 50%。
 *   2. **不串成员**：同手两个同类型 Bot 是**两份 player-hand**，分母 +2；
 *      一手的动作不会算到另一组的头上。
 *   3. **已知组不混旧 Unknown**：带快照的手只进对应类型组，无快照的旧手只进
 *      Unknown 组，两边互不稀释。
 *   4. **同 pid 换类 / 换角色**：座位不是身份 —— 同一个座位先 TAG 后 LAG，
 *      样本按**每手各自的快照**分到两组；同一个座位从 bot 换成真人后，
 *      那一手不再进任何类型组。
 *   5. **真人绝不进类型组**（§8.3 决策 38）：`playerRoles[pid] === 'human'` 时返回 null。
 *   6. **分配身份与实测身份并列**（§8.1）：`groupType` 是分配、`observedPlayerType`
 *      是实测；分配 TAG 但实测像 Fish 的样本**仍留在 TAG 组**（那是 P9 校准信号）。
 *   7. **缺统计证据**：某指标无机会时该组该指标是 `null`，而不是被伪造成 0%；
 *      且不影响同组其它指标（§9.1「各指标单独证据分母」）。
 *   8. **只输出有样本的组**：关闭性格时不会凭空多出六行全 `--` 的类型行。
 */
import { computeTypeStats, typeRowKey, type BotTypeGroup } from '../typeStats';
import type { SnapshotHandRecord } from '../typeStats';
import { computePlayerStatsFromEvents } from '../opponentModelUtil';
import type { ActionEvent, PlayerRole } from '../../types/stats';
import type { BotPersonality, BotTypeMap } from '../botPersonality';
import type { Action, GamePhase, PlayerId } from '../../types/poker';

const P1: PlayerId = 1;
const P2: PlayerId = 2;
const P3: PlayerId = 3;
const P4: PlayerId = 4;

function ev(
  handId: string,
  playerId: PlayerId,
  phase: GamePhase,
  action: Action,
  timestamp: number,
  extra: { amount?: number; toCall?: number } = {},
): ActionEvent {
  const toCall = extra.toCall ?? 0;
  return {
    handId,
    playerId,
    phase,
    action,
    amount: extra.amount,
    toCall,
    currentBet: toCall,
    potSize: 0,
    position: 0,
    isFacingRaise: toCall > 0,
    timestamp,
  };
}

/** 构造一手带开手快照的记录。 */
function hand(
  handId: string,
  players: PlayerId[],
  events: ActionEvent[],
  snapshot: {
    playerTypes?: BotTypeMap;
    playerRoles?: Partial<Record<PlayerId, PlayerRole>>;
  } = {},
): SnapshotHandRecord {
  const base: SnapshotHandRecord = { handId, players, events };
  // ⚠️ 刻意区分「传空对象」与「不传字段」：前者是新记录 + 关闭性格，
  // 后者是旧记录（P5 之前写入）。§8.3 要求两者归宿相同（都进 Unknown），
  // 但必须分别构造用例去证明，不能只测其中一种。
  if (snapshot.playerTypes !== undefined) base.playerTypes = snapshot.playerTypes;
  if (snapshot.playerRoles !== undefined) base.playerRoles = snapshot.playerRoles;
  return base;
}

/** 全 bot 的角色快照（真人显式标出来）。 */
function roles(
  humans: PlayerId[] = [],
  all: PlayerId[] = [],
): Partial<Record<PlayerId, PlayerRole>> {
  const out: Partial<Record<PlayerId, PlayerRole>> = {};
  for (const id of all) out[id] = humans.includes(id) ? 'human' : 'bot';
  return out;
}

/** 取某一组；没有则返回 undefined。 */
function groupOf(rows: ReturnType<typeof computeTypeStats>, g: BotTypeGroup) {
  return rows.find((r) => r.groupType === g);
}

// ---------------------------------------------------------------------------
// 1. 不平均比率（§9.1 / §10.2 硬门）
// ---------------------------------------------------------------------------

describe('类型聚合：池化原始计数，不平均比率', () => {
  it('3-bet 一手 1/1 + 另一手 0/3 ⇒ 池化 25%，不是比率平均的 50%', () => {
    // h1：P2 面对一个 open 并 3-bet ⇒ 机会 1、命中 1。
    const h1 = hand(
      'agg-ratio-1',
      [P1, P2],
      [
        ev('agg-ratio-1', P1, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
        ev('agg-ratio-1', P2, 'preflop', 'raise', 2, { amount: 60, toCall: 20 }),
        ev('agg-ratio-1', P1, 'preflop', 'fold', 3),
      ],
      { playerTypes: { 2: 'TAG' }, playerRoles: roles([], [P1, P2]) },
    );

    // h2/h3/h4：P2 面对一个 open 但只是跟注 ⇒ 每手机会 1、命中 0（合计 0/3）。
    const callHands = ['agg-ratio-2', 'agg-ratio-3', 'agg-ratio-4'].map((id) =>
      hand(
        id,
        [P1, P2],
        [
          ev(id, P1, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
          ev(id, P2, 'preflop', 'call', 2, { toCall: 20 }),
          ev(id, P1, 'preflop', 'check', 3),
        ],
        { playerTypes: { 2: 'TAG' }, playerRoles: roles([], [P1, P2]) },
      ),
    );

    const tag = groupOf(computeTypeStats([h1, ...callHands]), 'TAG');
    expect(tag).toBeDefined();
    // 原始计数必须可见（§9.1「提供覆盖数」）：机会 4、命中 1
    expect(tag!.counts.threeBet).toEqual({ num: 1, den: 4 });
    expect(tag!.threeBet).toBe(25);
    // 反证：若误按「每手比率求平均」会得到 (100 + 0 + 0 + 0)/4 = 25 ——
    // 这个例子平均值恰好也是 25，所以再用**权重不同**的构造把两者分开：
    // 一手 1/1（100%）与一手 0/1（0%），若再加两手无机会（null，不该被当 0 计入），
    // 池化 = 1/2 = 50%；错误的「把 null 当 0 平均」会得 25%。
    const withNulls = computeTypeStats([
      h1,
      callHands[0],
      hand(
        'agg-ratio-noop1',
        [P1, P2],
        // P2 从未面对 open（自己是进攻者）⇒ 无 3-bet 机会，不该进分母
        [
          ev('agg-ratio-noop1', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
          ev('agg-ratio-noop1', P1, 'preflop', 'fold', 2),
        ],
        { playerTypes: { 2: 'TAG' }, playerRoles: roles([], [P1, P2]) },
      ),
    ]);
    const tag2 = groupOf(withNulls, 'TAG')!;
    expect(tag2.counts.threeBet).toEqual({ num: 1, den: 2 }); // 无机会那手不进分母
    expect(tag2.threeBet).toBe(50);
  });

  it('VPIP 池化：分子/分母分别相加，handsDealt 是 player-hand 数', () => {
    const hands = [
      hand(
        'agg-vpip-1',
        [P1, P2],
        [ev('agg-vpip-1', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([], [P1, P2]) },
      ),
      hand(
        'agg-vpip-2',
        [P1, P2],
        [ev('agg-vpip-2', P2, 'preflop', 'fold', 1)],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([], [P1, P2]) },
      ),
      hand(
        'agg-vpip-3',
        [P1, P2],
        [ev('agg-vpip-3', P2, 'preflop', 'fold', 1)],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([], [P1, P2]) },
      ),
    ];
    const lag = groupOf(computeTypeStats(hands), 'LAG')!;
    expect(lag.handsDealt).toBe(3);
    expect(lag.counts.vpip).toEqual({ num: 1, den: 3 });
    expect(lag.vpip).toBeCloseTo(1 / 3, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. 不串成员：同手两个同类 Bot 是两份 player-hand
// ---------------------------------------------------------------------------

describe('类型聚合：同手两个同类 Bot 是两份 player-hand（分母 +2）', () => {
  it('两个 TAG 座位同手都参与 ⇒ TAG 组 handsDealt = 2，且各自的样本不互相污染', () => {
    // P2 与 P3 都被分配 TAG；P2 翻前加注（VPIP+PFR），P3 弃牌（都没有）。
    const h = hand(
      'agg-two-bots',
      [P1, P2, P3],
      [
        ev('agg-two-bots', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
        ev('agg-two-bots', P3, 'preflop', 'fold', 2),
        ev('agg-two-bots', P1, 'preflop', 'fold', 3),
      ],
      {
        playerTypes: { 2: 'TAG', 3: 'TAG' },
        playerRoles: roles([], [P1, P2, P3]),
      },
    );

    const rows = computeTypeStats([h]);
    const tag = groupOf(rows, 'TAG')!;
    expect(tag.handsDealt).toBe(2); // 两份 player-hand
    expect(tag.counts.vpip).toEqual({ num: 1, den: 2 }); // 只有 P2 自愿投入
    expect(tag.counts.pfr).toEqual({ num: 1, den: 2 });
    // P1 是 bot 但**没有**分配（playerTypes 里没有 1）⇒ 进 Unknown，不混进 TAG
    expect(groupOf(rows, 'Unknown')!.handsDealt).toBe(1);
  });

  it('一手里不同类型分进不同组，成员不串', () => {
    const h = hand(
      'agg-mixed-types',
      [P1, P2, P3],
      [
        ev('agg-mixed-types', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
        ev('agg-mixed-types', P3, 'preflop', 'call', 2, { toCall: 20 }),
        ev('agg-mixed-types', P1, 'preflop', 'fold', 3),
      ],
      {
        playerTypes: { 2: 'TAG', 3: 'Maniac' },
        playerRoles: roles([P1], [P1, P2, P3]), // P1 是真人
      },
    );
    const rows = computeTypeStats([h]);
    expect(groupOf(rows, 'TAG')!.handsDealt).toBe(1);
    expect(groupOf(rows, 'Maniac')!.handsDealt).toBe(1);
    expect(groupOf(rows, 'TAG')!.counts.vpip).toEqual({ num: 1, den: 1 });
    expect(groupOf(rows, 'Maniac')!.counts.vpip).toEqual({ num: 1, den: 1 }); // 跟注也是自愿投入
    expect(groupOf(rows, 'Unknown')).toBeUndefined(); // 真人不进任何组
  });
});

// ---------------------------------------------------------------------------
// 3. 已知组不混旧 Unknown（§8.3 历史兼容）
// ---------------------------------------------------------------------------

describe('类型聚合：历史兼容（§8.3 / 决策 38）', () => {
  it('带快照的手进类型组、无快照的旧手进 Unknown，两边互不稀释', () => {
    const rows = computeTypeStats([
      // 新记录：P1 真人、P2 被分配 TAG 并自愿加注
      hand(
        'agg-known',
        [P1, P2],
        [ev('agg-known', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'TAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
      // 旧记录：完全没有 playerTypes / playerRoles 两个字段，单座位便于核对分母
      hand('agg-legacy', [P2], [ev('agg-legacy', P2, 'preflop', 'fold', 1)]),
    ]);
    const tag = groupOf(rows, 'TAG')!;
    const unknown = groupOf(rows, 'Unknown')!;
    expect(tag.handsDealt).toBe(1); // 只数有快照的那手 ⇒ 旧记录没稀释已知组
    expect(unknown.handsDealt).toBe(1); // 只数旧记录 ⇒ 已知组没漏进 Unknown
    expect(tag.counts.vpip).toEqual({ num: 1, den: 1 });
    expect(unknown.counts.vpip).toEqual({ num: 0, den: 1 });
  });

  it('新记录 + 关闭性格（playerTypes 是空对象）⇒ 进 Unknown，不是「无组」', () => {
    // 与「旧记录缺字段」归宿相同，但必须**分别**证明（两者是不同的数据形态）。
    const rows = computeTypeStats([
      hand(
        'agg-disabled',
        [P1, P2],
        [ev('agg-disabled', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: {}, playerRoles: roles([], [P1, P2]) },
      ),
    ]);
    expect(groupOf(rows, 'Unknown')!.handsDealt).toBe(2); // 两个 bot 座位都进 Unknown
    expect(groupOf(rows, 'TAG')).toBeUndefined();
  });

  it('分配了**非法**类型的座位也进 Unknown（不猜、不崩）', () => {
    const rows = computeTypeStats([
      hand(
        'agg-invalid',
        [P1, P2],
        [ev('agg-invalid', P2, 'preflop', 'fold', 1)],
        {
          // JSON 里可能存着不在六类里的历史值（决策 4：`Others` 保留历史枚举，
          // 但常规有效域不产出）⇒ 必须被当作「无有效分配」，不能崩、也不能猜。
          playerTypes: { 2: 'Others' as unknown as BotPersonality },
          playerRoles: roles([], [P1, P2]),
        },
      ),
    ]);
    expect(groupOf(rows, 'Unknown')!.handsDealt).toBe(2);
  });

  it('旧记录连角色快照都没有时，真人座位也会落进 Unknown（决策 38 明确接受的取舍）', () => {
    // 这不是缺陷而是**已知边界**：无从分辨旧记录里谁是真人。新记录一定带
    // `playerRoles`，真人恒被排除（下一条用例）。把它写成用例，是为了让这条
    // 取舍可见、不会被后人当 bug「顺手修」成「旧记录全部丢弃」。
    const rows = computeTypeStats([
      hand('agg-legacy-noroles', [P1, P2], [
        ev('agg-legacy-noroles', P1, 'preflop', 'fold', 1),
      ]),
    ]);
    expect(groupOf(rows, 'Unknown')!.handsDealt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. 真人绝不进类型组
// ---------------------------------------------------------------------------

describe('类型聚合：真人按 playerId 聚合，绝不进类型组（§8.3）', () => {
  it('角色快照是 human 的座位即使有 playerTypes 也不进组', () => {
    const rows = computeTypeStats([
      hand(
        'agg-human',
        [P1, P2],
        [
          ev('agg-human', P1, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
          ev('agg-human', P2, 'preflop', 'fold', 2),
        ],
        {
          // 防御：真人座位本不该出现在分配 map 里，但万一出现了也必须以角色为准
          playerTypes: { 1: 'TAG', 2: 'TAG' },
          playerRoles: { 1: 'human', 2: 'bot' },
        },
      ),
    ]);
    const tag = groupOf(rows, 'TAG')!;
    expect(tag.handsDealt).toBe(1); // 只有 P2
    expect(tag.counts.vpip).toEqual({ num: 0, den: 1 }); // P2 弃牌
  });

  it('同座位跨手从 bot 换成真人 ⇒ 那一手不再进类型组', () => {
    const rows = computeTypeStats([
      hand(
        'agg-switch-1',
        [P1, P2],
        [ev('agg-switch-1', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'Fish' }, playerRoles: { 1: 'human', 2: 'bot' } },
      ),
      hand(
        'agg-switch-2',
        [P1, P2],
        [ev('agg-switch-2', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        // 同一座位现在是真人：不进任何组（按 playerId 聚合，不在此模块）
        { playerTypes: { 2: 'Fish' }, playerRoles: { 1: 'human', 2: 'human' } },
      ),
    ]);
    expect(groupOf(rows, 'Fish')!.handsDealt).toBe(1);
  });

  it('同座位跨手换分配类型 ⇒ 样本按每手各自的快照分到两组（座位不是身份）', () => {
    const rows = computeTypeStats([
      hand(
        'agg-retype-1',
        [P1, P2],
        [ev('agg-retype-1', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'TAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
      hand(
        'agg-retype-2',
        [P1, P2],
        [ev('agg-retype-2', P2, 'preflop', 'fold', 1)],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ]);
    expect(groupOf(rows, 'TAG')!.handsDealt).toBe(1);
    expect(groupOf(rows, 'LAG')!.handsDealt).toBe(1);
    expect(groupOf(rows, 'TAG')!.counts.vpip).toEqual({ num: 1, den: 1 });
    expect(groupOf(rows, 'LAG')!.counts.vpip).toEqual({ num: 0, den: 1 });
  });
});

// ---------------------------------------------------------------------------
// 5. 分配身份与实测身份并列（§8.1）
// ---------------------------------------------------------------------------

describe('类型聚合：groupType（分配）与 observedPlayerType（实测）并列', () => {
  it('分配 TAG 但实测像 Nit 的样本仍留在 TAG 组（偏差是 P9 校准信号）', () => {
    // 造 12 手「分配 TAG、但几乎从不进池」的样本 ⇒ 实测被分类树判成 Nit
    // （VPIP 1/12 ≈ 8.3% < 14 ⇒ §3.1 规则 1 短路）。组仍是 TAG、实测列显示 Nit ——
    // 两者并列且不互相覆盖，这个偏差正是 P9 校准要看的信号（§8.1）。
    const hands: SnapshotHandRecord[] = [];
    for (let i = 0; i < 12; i += 1) {
      const id = `agg-mismatch-${i}`;
      const entered = i === 0; // 只有第一手自愿跟注，其余全弃牌
      hands.push(
        hand(
          id,
          [P1, P2],
          entered
            ? [ev(id, P2, 'preflop', 'call', 1, { toCall: 10 })]
            : [ev(id, P2, 'preflop', 'fold', 1)],
          { playerTypes: { 2: 'TAG' }, playerRoles: roles([P1], [P1, P2]) },
        ),
      );
    }
    const tag = groupOf(computeTypeStats(hands), 'TAG')!;
    expect(tag.groupType).toBe('TAG');
    expect(tag.handsDealt).toBe(12); // 样本足够（≥ MIN_HANDS_FOR_CLASSIFICATION = 10）
    expect(tag.counts.vpip).toEqual({ num: 1, den: 12 });
    expect(tag.vpip).toBeCloseTo(1 / 12, 10);
    expect(tag.observedPlayerType).toBe('Nit');
    expect(tag.observedPlayerType).not.toBe(tag.groupType); // 两种身份确实不同
  });

  it('样本不足时 observedPlayerType 是 Unknown，但 groupType 仍可显示（§8.1）', () => {
    const rows = computeTypeStats([
      hand(
        'agg-thin',
        [P1, P2],
        [ev('agg-thin', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'Maniac' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ]);
    const maniac = groupOf(rows, 'Maniac')!;
    expect(maniac.groupType).toBe('Maniac'); // 组标签总可显示
    expect(maniac.observedPlayerType).toBe('Unknown'); // 实测样本不足
    expect(maniac.handsDealt).toBe(1);
  });

  it('TypeStats 上不存在 playerType 字段（避免与 observedPlayerType 同义混淆）', () => {
    const rows = computeTypeStats([
      hand(
        'agg-noplayerfield',
        [P1, P2],
        [ev('agg-noplayerfield', P2, 'preflop', 'fold', 1)],
        { playerTypes: { 2: 'Nit' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ]);
    const row = groupOf(rows, 'Nit')!;
    expect('playerType' in row).toBe(false);
    expect('playerId' in row).toBe(false); // 组不是玩家，不虚构合成 id
  });
});

// ---------------------------------------------------------------------------
// 6. 缺统计证据 / 行 key / 输出形态
// ---------------------------------------------------------------------------

describe('类型聚合：缺失证据、行 key 与输出形态', () => {
  it('某指标无机会 ⇒ null（不伪造 0%），且不影响同组其它指标', () => {
    const rows = computeTypeStats([
      hand(
        'agg-missing',
        [P1, P2],
        // 只打翻前：没有任何翻后动作 ⇒ AF/AFq/CBet/WTSD/WSD/C-R/F-to-CBet/TurnCB 全无机会
        [ev('agg-missing', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        { playerTypes: { 2: 'TAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ]);
    const tag = groupOf(rows, 'TAG')!;
    expect(tag.cbet).toBeNull();
    expect(tag.wtsd).toBeNull();
    expect(tag.wsd).toBeNull();
    expect(tag.checkRaise).toBeNull();
    expect(tag.foldToCbet).toBeNull();
    expect(tag.turnCbet).toBeNull();
    expect(tag.afq).toBeNull();
    expect(tag.af).toBeNull();
    expect(tag.afState).toBe('no-actions');
    // 但 VPIP/PFR 有证据，照常给出（各指标单独证据分母，§9.1）
    expect(tag.vpip).toBe(1);
    expect(tag.pfr).toBe(1);
    expect(tag.handsDealt).toBe(1);
  });

  it('拿到牌但零动作的座位也计入 handsDealt（用 players 名单而非只看事件）', () => {
    // 翻前 all-in 后被 runout 的玩家可能一个动作事件都没有，但确实参与了这手。
    const rows = computeTypeStats([
      hand(
        'agg-noevents',
        [P1, P2, P3],
        // P3 在 players 名单里但没有任何事件
        [ev('agg-noevents', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 })],
        {
          playerTypes: { 2: 'TAG', 3: 'TAG' },
          playerRoles: roles([P1], [P1, P2, P3]),
        },
      ),
    ]);
    const tag = groupOf(rows, 'TAG')!;
    expect(tag.handsDealt).toBe(2);
    expect(tag.counts.vpip).toEqual({ num: 1, den: 2 }); // P3 进了分母、没进分子
  });

  it('行 key 形如 bot-type:TAG（§8.1），与座位 key 不冲突', () => {
    expect(typeRowKey('TAG')).toBe('bot-type:TAG');
    expect(typeRowKey('Calling Station')).toBe('bot-type:Calling Station');
    expect(typeRowKey('Unknown')).toBe('bot-type:Unknown');
    const rows = computeTypeStats([
      hand(
        'agg-rowkey',
        [P1, P2],
        [ev('agg-rowkey', P2, 'preflop', 'fold', 1)],
        { playerTypes: { 2: 'Fish' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ]);
    expect(groupOf(rows, 'Fish')!.rowKey).toBe('bot-type:Fish');
  });

  it('只输出有样本的组：关闭性格时不会凭空多出六行空行', () => {
    expect(computeTypeStats([])).toEqual([]);
    // 只有真人参与 ⇒ 一个组都没有
    expect(
      computeTypeStats([
        hand('agg-onlyhuman', [P1], [ev('agg-onlyhuman', P1, 'preflop', 'fold', 1)], {
          playerTypes: {},
          playerRoles: { 1: 'human' },
        }),
      ]),
    ).toEqual([]);
  });

  it('输出按稳定顺序（六类顺序 + Unknown 最后），与输入手的顺序无关', () => {
    const mk = (id: string, seat: PlayerId, type: BotTypeGroup) =>
      hand(
        id,
        [P1, seat],
        [ev(id, seat, 'preflop', 'fold', 1)],
        {
          playerTypes: type === 'Unknown' ? {} : { [seat]: type },
          playerRoles: roles([P1], [P1, seat]),
        },
      );
    // 故意逆序喂入
    const rows = computeTypeStats([
      mk('agg-order-1', P2, 'Unknown'),
      mk('agg-order-2', P3, 'Maniac'),
      mk('agg-order-3', P4, 'Nit'),
      mk('agg-order-4', P2, 'TAG'),
    ]);
    expect(rows.map((r) => r.groupType)).toEqual(['TAG', 'Nit', 'Maniac', 'Unknown']);
    // 行 key 唯一（同一座位跨手进不同组也不会撞 key）
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(rows.length);
  });
});

// ---------------------------------------------------------------------------
// 7. 与单座位聚合口径一致（§9.3 共享内核）
// ---------------------------------------------------------------------------

describe('类型聚合：与单座位聚合共用内核 ⇒ 口径一致', () => {
  it('单一 Bot 独占一组时，组指标 === 该座位的单座位统计', () => {
    // 这是 §9.3「共享计数内核让单座位与类型聚合一致」的直接验证：
    // 组里只有一个座位的样本时，两条路径必须给出**逐字段相同**的指标。
    const hands = [
      hand(
        'agg-parity-1',
        [P1, P2],
        [
          ev('agg-parity-1', P1, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
          ev('agg-parity-1', P2, 'preflop', 'raise', 2, { amount: 60, toCall: 20 }),
          ev('agg-parity-1', P1, 'flop', 'raise', 3, { amount: 40 }),
          ev('agg-parity-1', P2, 'flop', 'call', 4, { toCall: 40 }),
        ],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
      hand(
        'agg-parity-2',
        [P1, P2],
        [
          ev('agg-parity-2', P2, 'preflop', 'call', 1, { toCall: 10 }),
          ev('agg-parity-2', P1, 'preflop', 'check', 2),
          ev('agg-parity-2', P2, 'flop', 'check', 3),
          ev('agg-parity-2', P1, 'flop', 'raise', 4, { amount: 30 }),
          ev('agg-parity-2', P2, 'flop', 'fold', 5),
        ],
        { playerTypes: { 2: 'LAG' }, playerRoles: roles([P1], [P1, P2]) },
      ),
    ];
    const seat = computePlayerStatsFromEvents(P2, hands);
    const group = groupOf(computeTypeStats(hands), 'LAG')!;

    expect(group.handsDealt).toBe(seat.handsDealt);
    expect(group.vpip).toBe(seat.vpip);
    expect(group.pfr).toBe(seat.pfr);
    expect(group.gap).toBe(seat.gap);
    expect(group.af).toBe(seat.af);
    expect(group.afState).toBe(seat.afState);
    expect(group.afq).toBe(seat.afq);
    expect(group.wtsd).toBe(seat.wtsd);
    expect(group.wsd).toBe(seat.wsd);
    expect(group.cbet).toBe(seat.cbet);
    expect(group.turnCbet).toBe(seat.turnCbet);
    expect(group.checkRaise).toBe(seat.checkRaise);
    expect(group.threeBet).toBe(seat.threeBet);
    expect(group.foldToCbet).toBe(seat.foldToCbet);
    expect(group.observedPlayerType).toBe(seat.playerType);
    // 防空断言：这组样本确实算出了非平凡的值（否则上面全是 null === null 也算通过）
    expect(seat.handsDealt).toBe(2);
    expect(seat.vpip).toBeGreaterThan(0);
    expect(seat.threeBet).not.toBeNull();
  });
});
