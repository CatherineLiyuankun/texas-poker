export const translations = {
  startPage: {
    title: "德州扑克 Texas Hold'em",
    realPlayers: '真人玩家数量 Real Players',
    botPlayers: '电脑玩家数量 Bot Players',
    totalPlayers: '总玩家数 Total Players',
    startGame: '开始游戏 Start Game',
    smallBlindInfo: (smallBlind: number) => `小盲: $${smallBlind} | 大盲: $${smallBlind * 2}`,
    initialChipsInfo: (smallBlind: number) => `每人初始筹码: $${smallBlind * 200}`,
    smallBlindLabel: '小盲大小 Small Blind',
    // 抽水（rake）：桌面条件，与「引擎 / 赛制」两个轴无关。锦标赛恒不抽水。
    rake: {
      label: '抽水 Rake',
      modeNone: '不抽水',
      modePercent: '按百分比',
      modeBb: '固定大盲',
      valuePercent: '比例 %',
      valueBb: '大盲个数',
      valueAria: '抽水数值',
      capLabel: '封顶上限',
      capUnit: '大盲',
      capAria: '抽水封顶上限（大盲）',
      capHint: '0 = 不封顶',
      none: '不抽水，底池全额归赢家',
      percent: (p: number, capBB: number, capChips: number) =>
        capBB > 0 ? `每手抽 ${p}% · 封顶 ${capBB}BB（$${capChips}）` : `每手抽 ${p}% · 不封顶`,
      // 「固定大盲」模式下抽水本身就是固定值，再封顶只是把它变成另一个更小的固定值，
      // 所以这个模式没有封顶 —— 文案也就不带封顶参数。
      bb: (bb: number) => `每手抽 ${bb}BB`,
      tournamentNote: '锦标赛不抽水（改按 ICM 风险溢价收紧）',
    },
  },
  actionButtons: {
    botThinking: '电脑玩家思考中... Bot Thinking...',
    check: 'Check', // 看牌 
    call: 'Call', // 跟注 
    raise: 'Raise', // 加注 
    bet: 'Bet', // 下注 
    fold: 'Fold', // 弃牌
    confirm: '✓', // 确认 
    cancel: 'X', // 取消
    raisePlaceholder: (playerBet: number, toCall: number, minTargetExtra: number, min: number) => `Min${min}=已下${playerBet}+跟${toCall}+加${minTargetExtra}`,
    allin: 'All In', // 全押
  },
  playerArea: {
    folded: 'Folded', // 已弃牌 
    showingHand: 'Showed', // 已看牌 
    viewingHand: '查看', // View Hand Cards
    waiting: 'Waiting', // 等待中
    viewCards: 'Show', // 查看手牌
    hideCards: 'Hide', // 隐藏手牌
    bot: 'Bot', // 电脑
    dealer: '庄 Dealer',
    allIn: 'All In', // 全押
    thisRoundBet: 'Bet:', // 此轮下注:
    totalBet: 'All bet:', // 本局下注:
  },
  potDisplay: {
    totalPot: '总奖池 Pot',
    mainPot: '主池 Main Pot',
    sidePots: '边池 Side Pots',
    phase: '阶段 Phase',
  },
  communityCards: {
    preflop: '翻牌前 Pre-Flop',
    flop: '翻牌 Flop',
    turn: '转牌 Turn',
    river: '河牌 River',
    showdown: '摊牌 Showdown',
  },
  gameBoard: {
    backToMenu: 'Back', // 返回菜单 
    realPlayers: '真人',
    botPlayers: 'Bot', // 电脑
    startGame: 'Start Game',
    playerWins: (name: string) => `${name} 获胜！ Wins!`,
    splitPot: '平局，平分底池 Split Pot',
    nextRound: 'Next Round', // 下一局 
    dealFlop: '发翻牌 Deal Flop',
    dealTurn: '发转牌 Deal Turn',
    dealRiver: '发河牌 Deal River',
    showCards: '摊牌 Showdown',
    player: (num: number) => `玩家${num}`, // Player${num}
    adminOn: '显示所有手牌', //  (Admin On)
    adminOff: '隐藏未摊牌手牌', //  (Admin Off)
  },
  blind: {
    smallBlind: '小盲 SB',
    bigBlind: '大盲 BB',
  },
  position: {
    BTN: '庄D',
    SB: 'SB',
    BB: 'BB',
    CO: 'CO',
    HJ: 'HJ',
    UTG: 'UTG',
    MP: 'MP',
    btnSb: 'D/SB',
    utgPlus: (n: number) => `UTG+${n}`,
    mpN: (n: number) => `MP${n}`,
  },
  handAnalysis: {
    aiTitle: 'AI Analysis',
    preflop: '手牌强度', // 翻牌前preflopStrength Chen Formula 
    equity: '随机权益 Equity', //  Equity vs random hands（对随机牌）
    rangeEquity: '范围权益 Equity', //  Equity vs estimated continuing range（对推断范围）
    // 随机权益一行的口径标注。对手全部按随机牌建模 → 翻前会系统性高估
    // （真实对手的跟注范围远强于随机牌），必须显式写出来。
    // 放在独立的整行里而不是并进 equity 标签：权益区是 grid-cols-2，
    // 每列实测只有 134.8px，标签一长就换行、挤掉右侧的权益条；
    // 整行有 278px 可用（本行文本实测 146.7px，单行）。
    equityVsRandom: 'vs 随机牌（对手全部按随机牌建模）',
    // 行内短标注：翻后 Reasoning 里那串 "Equity x%" 用的是 decisionEquity，
    // 范围推断失败时它就是随机权益，必须在同一行就地说明，否则同样会被误读成真实胜率。
    equityVsRandomTag: 'vs 随机牌',
    rangeNarrowed: '翻后行动收窄', //  narrowed by the opponent's postflop action line
    rangeExploitative: '含对手激进度调整（剥削性）', //  includes opponent-aggression scaling (exploitative)
    potOdds: '赔率 Pot Odds',
    // 加注框有值时单独显示的「我方下注所需弃牌率」——与跟注赔率是两个不同的量
    betRequiredFold: '所需弃牌率 Req. Fold',
    gto: 'GTO preflop', // GTO建议
    spr: 'SPR',
    sprShallow: '浅', // Shallow
    sprMedium: '中等', // Medium
    sprDeep: '深', // Deep
    drawEq: '听牌补偿 Draw Eq',
    currentHand: 'Current Hand',
    tier: 'Tier',
    tierNames: {
      0: 'Unknown 未知',
      1: 'Premium 顶级',
      2: 'Strong 强牌',
      3: 'Playable 可玩',
      4: 'Speculative 投机',
      5: 'Marginal 边缘',
      6: 'Fold 弃牌',
    } as Record<number, string>,
    draws: {
      flushDraw: '同花听牌 Flush',
      openEndedStraight: '两端顺子 OESD',
      gutshot: '卡顺 Gutshot',
    },
    rec: {
      raise: 'Raise',
      callRaise: 'Call/Raise',
      call: 'Call',
      check: 'Check',
      fold: 'Fold',
      callCheap: 'Call (cheap)',
    },
    // 对手画像风格标签
    opponentStyle: {
      aggressive: '激进 Agg',
      passive: '被动 Pas',
      unknown: '未知',
    },
  },
  gtoStrategy: {
    toggle: 'GTO',
    on: 'ON',
    off: 'OFF',
  },
  // 赛制开关：与 GTO 开关是**正交**的两个轴（引擎 × 赛制）。
  scenario: {
    toggle: '赛制',
    cash: '现金局',
    tournament: '锦标赛',
  },
  gtoPostflop: {
    board: 'Board 牌面',
    veryDry: 'Very Dry 极干',
    dry: 'Dry 干燥',
    medium: 'Medium 中等',
    wet: 'Wet 湿润',
    veryWet: 'Very Wet 极湿',
    cbet: 'C-bet',
    action: 'Action',
    check: 'Check', // 过牌
    fold: 'Fold',
    call: 'Call', // 跟注
    raise: 'Raise', // 加注
    allIn: 'All-in',
    reasoning: 'Reasoning',
    wetness: 'Wetness',
  },
  gtoMath: {
    title: 'GTO Math',
    mdf: 'MDF防御频率:', // Minimum Defense Frequency
    callEv: 'Call EV:',
    raiseEV: 'Raise EV:',
    vbRatioFacing: '对手下注 V:B:', // 面对下注时，描述对手那一注
    vbRatioHero: '我方下注 V:B:', // 我方主动下注/加注时
    rangeCategory: '牌力分类:',
    heuristic: '启发式',
    caveat: {
      street: {
        preflop: '翻前',
        flop: '翻牌近似',
        turn: '转牌近似',
        river: '河牌严格',
        showdown: '摊牌',
        ended: '本手结束',
      },
      headsUp: '单挑口径',
      multiway: (n: number) => `多人(${n})未调整`,
      noOpponent: '无对手',
      noIcm: '未计 ICM',
      icm: '计 ICM（锦标赛）',
    },
    rangeCategories: {
      value: 'Value', // 价值牌
      bluffCatcher: 'Bluff Catcher', // 诈唬捕手
      bluff: 'Bluff', // 诈唬
      fold: 'Fold', // 弃牌
    },
  },
  nodelock: {
    title: 'Exploit对手漏洞', // 利用对手漏洞
    leak: 'Leak漏洞:', // 漏洞
    adjustment: 'Adj调整:', // 调整
    confidence: 'Conf置信度:', // 置信度
    reasoning: 'Reason:',
    leakTypes: {
      overfold: 'Overfold', // 过度弃牌
      underfold: 'Underfold', // 过度跟注
      overfold_to_bet: 'Overfold to Bet', // 面对下注过度弃牌
      underfold_to_bet: 'Underfold to Bet', // 面对下注过度跟注
      overaggressive: 'Overaggressive', // 过度激进
      passive: 'Passive', // 被动
      neutral: 'Neutral', // 无明显漏洞
    },
  },
  chipSummary: {
    title: '筹码变化 Chip Summary',
    roundStart: '开局',
    beforeSettlement: '结算前',
    winnings: '赢得',
    change: '净利润',
    folded: '已弃牌',
    player: '玩家',
  },
  potDistribution: {
    title: '奖池贡献 Pot Contribution',
    mainPot: '主池',
    sidePot: (n: number) => `边池${n}`,
    total: '总计',
    player: '玩家',
    potTotal: '池总额',
  },
  persistence: {
    continueGame: '继续上次 Continue Last Game',
    clearProgress: '清除存档 Clear Save',
    savedProgress: '上次存档 Saved Progress',
    savedAt: (time: string) => `保存于 Saved: ${time}`,
    playerChips: (name: string, chips: number) => `${name}: $${chips}`,
    confirmClear: '确认清除存档？ Clear saved game progress?',
  },
  playerStats: {
    title: '玩家数据 Player Stats',
    vpip: 'VPIP',
    pfr: 'PFR',
    af: 'AF',
    cbet: 'CBet',
    wtsd: 'WTSD',
    wsd: 'W$SD',
    checkRaise: 'C/R',
    threeBet: '3-Bet',
    foldToCbet: 'F/CB',
    afq: 'AFq',
    turnCbet: 'Turn CB',
    preflop: 'Pre-Flop',
    postflop: 'Post-Flop',
    showdown: 'Showdown',
    type: 'Type', // 类型
    name: 'Name', // 选手名称
    resetStats: '玩家数据Reset', // 重置玩家数据 Reset Stats
    exportStats: 'Export', // 导出玩家数据
    importStats: 'Import', // 导入玩家数据
    insufficientData: '--', // 数据不足
    importSuccess: 'Import Success', // 导入成功
    importSuccessWithProgress: 'Import Success (game progress restored)', // 导入成功（已恢复游戏进度）
    importFailed: 'Import Failed', // 导入失败
    types: {
      Nit: 'Nit 紧弱',
      TAG: 'TAG 紧凶',
      LAG: 'LAG 松凶',
      'Calling Station': 'CS 松弱',
      Maniac: 'Maniac 疯子',
      Others: '其他', // Others
      Unknown: '未知', // Unknown
    } as Record<string, string>,
  },
};