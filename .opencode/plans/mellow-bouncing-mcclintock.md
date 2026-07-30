# 添加 e2eTests 脚本命令

## Context

`package.json` 当前只有 `test` 命令运行全部测试。需要添加独立的 `e2eTests` 命令，专门运行 `src/e2eTests/` 下的集成测试。

## 修改

**文件**: `package.json` 第 11 行后

```json
"test": "jest",
"e2eTests": "jest src/e2eTests"
```

## 验证

`npm run e2eTests` — 应运行 `src/e2eTests/useGameState.integration.test.ts`
