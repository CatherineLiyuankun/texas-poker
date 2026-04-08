export const translations = {
  startPage: {
    title: "德州扑克 Texas Hold'em",
    realPlayers: "真人玩家数量 Real Players",
    botPlayers: "电脑玩家数量 Bot Players",
    totalPlayers: "总玩家数 Total Players",
    startGame: "开始游戏 Start Game",
    smallBlind: "小盲: $10 | 大盲: $20",
    initialChips: "每人初始筹码: $1000",
  },
  actionButtons: {
    botThinking: "电脑玩家思考中... Bot Thinking...",
    check: "看牌 Check",
    call: "跟注 Call",
    raise: "加注 Raise",
    bet: "下注 Bet",
    fold: "弃牌 Fold",
    confirm: "确认 Confirm",
    cancel: "取消 Cancel",
    raisePlaceholder: (toCall: number, minTargetExtra: number, min: number) => `最低${min}=call: ${toCall}+${minTargetExtra}`,
    allin: "全押 All In",
  },
  playerArea: {
    folded: "已弃牌 Folded",
    showingHand: "已看牌 Showed",
    viewingHand: "查看底牌", // View Hole Cards
    waiting: "Waiting", // 等待中
    viewCards: "Show", // 查看手牌
    hideCards: "Hide", // 隐藏手牌
    bot: "Bot", // 电脑
    dealer: "庄 Dealer",
    allIn: "All In", // 全押
    thisRoundBet: "Bet:", // 此轮下注:
    totalBet: "All bet:", // 本局下注:
  },
  potDisplay: {
    pot: "奖池 Pot",
    phase: "阶段 Phase",
  },
  communityCards: {
    preflop: "翻牌前 Pre-Flop",
    flop: "翻牌 Flop",
    turn: "转牌 Turn",
    river: "河牌 River",
    showdown: "摊牌 Showdown",
  },
  gameBoard: {
    backToMenu: "返回菜单 Back",
    realPlayers: "真人",
    botPlayers: "电脑",
    startGame: "Start Game",
    playerWins: (name: string) => `${name} 获胜！ Wins!`,
    splitPot: "平局，平分底池 Split Pot",
    nextRound: "下一局 Next Round",
    dealFlop: "发翻牌 Deal Flop",
    dealTurn: "发转牌 Deal Turn",
    dealRiver: "发河牌 Deal River",
    showCards: "摊牌 Showdown",
    player: (num: number) => `玩家${num}`, // Player${num}
  },
  blind: {
    smallBlind: "小盲 SB",
    bigBlind: "大盲 BB",
  },
};