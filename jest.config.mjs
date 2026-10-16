export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom', './src/setupTests.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testMatch: [
    '**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)',
    '**/e2eTests/**/*.(test|spec).(ts|tsx|js|jsx)',
  ],
  // ts-jest 29 起不再支持 `globals['ts-jest']`（v30 会移除），配置一律写在 transform 里。
  // 这条等价于原先的 `preset: 'ts-jest/presets/js-with-ts'` + `globals.tsconfig`：
  // 同一个 key、同样的 tsconfig，preset 只贡献这一个键，所以一并去掉。
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {tsconfig: './tsconfig.test.json'}],
  },
};
