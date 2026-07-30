# 修复 GameBoard 组件测试 matchMedia 失败

## Context

3 个组件测试文件共 10 个测试全部因 `TypeError: window.matchMedia is not a function` 失败。
`GameBoard.tsx:90` 调用了 `window.matchMedia('(orientation: portrait)')`，但 jsdom 环境未实现该 API。

## 修复方案（2 个文件）

### 1. 新建 `src/setupTests.ts`

添加 `window.matchMedia` mock：

```ts
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
```

### 2. 更新 `jest.config.mjs`

在 `setupFilesAfterEnv` 中添加 `./src/setupTests.ts`：

```js
setupFilesAfterEnv: ['@testing-library/jest-dom', './src/setupTests.ts'],
```

## 验证

`npm test` — 10 个之前失败的测试应全部通过
