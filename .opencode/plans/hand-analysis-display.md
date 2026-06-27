# Hand Analysis Display Plan / 手牌分析显示计划

## Summary / 概要
Show AI analysis info on the RIGHT side of the real player's hand cards when they click "Show". Hidden when cards are face-down. All text in bilingual Chinese/English.

真人玩家点击"Show"查看手牌时，在手牌**右侧**显示 AI 分析信息。手牌隐藏时不显示。所有文字中英双语。

## Layout / 布局
```
  [A♠] [K♥]  │  胜率 Win Rate   55%  ███░
             │  赔率 Pot Odds   18%
             │  同花听牌 Flush    9 outs
             │  两端顺子 OESD     8 outs
             │  建议 Suggest: Call
```

Cards on the left, analysis panel on the right, horizontal flex-row layout.
手牌在左，分析面板在右，水平排列。

## Files to Change / 需要修改的文件

### 1. NEW: `src/components/HandAnalysis.tsx`
Props: `holeCards`, `communityCards`, `phase`, `numOpponents`, `potOdds`

Display content (bilingual / 中英双语):
- **翻前强度 Preflop Strength**: 0-100% with colored bar
- **胜率 Win Rate**: Monte Carlo equity (async)
- **赔率 Pot Odds**: toCall / (pot + toCall)
- **听牌 Draws**: All detected draws with outs
  - 同花听牌 Flush Draw
  - 两端顺子听牌 OESD
  - 卡顺听牌 Gutshot
- **听牌补偿 Draw Equity Bonus**: combined outs → equity bonus
- **建议 Suggest**: action recommendation based on equity vs pot odds

Implementation:
- `useMemo` for instant calcs (preflop strength, draw detection)
- `useEffect` + `setTimeout` for Monte Carlo (non-blocking, 200 iterations)
- Width: `w-48` (fixed, avoids squeezing cards)

### 2. MODIFY: `src/components/PlayerArea.tsx`
- Add props: `communityCards?: Card[]`, `numActiveOpponents?: number`, `potOdds?: number`
- Change card row from `<div className="relative flex gap-2 justify-center mb-3">` to horizontal layout:
  ```tsx
  <div className="flex items-start gap-2 mb-3">
    <div className="flex gap-2">
      {cards...}
    </div>
    {canShowHand && player.isRealPlayer && !isShowdown && (
      <HandAnalysis ... />
    )}
  </div>
  ```

### 3. MODIFY: `src/components/GameBoard.tsx`
- Pass new props to `<PlayerArea>`:
  - `communityCards={state.communityCards}`
  - `numActiveOpponents={state.players.filter(p => !p.folded && p.id !== player.id).length}`
  - `potOdds={toCall / (totalPot + toCall)}`

## Verification / 验证
- `npm run lint` — 0 errors
- `npx tsc --noEmit` — 0 errors
- `npm test` — all pass
