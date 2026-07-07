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
    BTN: '庄BTN',
    SB: 'SB',
    BB: 'BB',
    CO: 'CO',
    HJ: 'HJ',
    UTG: 'UTG',
    MP: 'MP',
    btnSb: 'BTN/SB',
    utgPlus: (n: number) => `UTG+${n}`,
    mpN: (n: number) => `MP${n}`,
  },
  handAnalysis: {
    title: 'AI Analysis',
    preflop: '手牌强度Chen Formula', // 翻牌前preflopStrength Chen Formula 
    winRate: '胜率 Win Rate', //  Win Rate
    potOdds: '赔率 Pot Odds',
    gto: 'GTO preflop', // GTO建议
    spr: 'SPR',
    sprShallow: '浅 Shallow',
    sprMedium: '中等 Medium',
    sprDeep: '深 Deep',
    drawEq: '听牌补偿 Draw Eq',
    suggest: '胜率/赔率建议',
    currentHand: 'Current Hand',
    tier: 'Tier',
    tierNames: {
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
      raise: 'Raise 加注',
      callRaise: 'Call/Raise',
      call: 'Call 跟注',
      check: 'Check 过牌',
      fold: 'Fold 弃牌',
      callCheap: 'Call 跟注 (cheap)',
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
    vbRatio: 'V:B价值:诈唬:',
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