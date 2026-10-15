#!/usr/bin/env node
/**
 * 闭环校准 runner 的**启动器**（`npm run calibrate`）。
 *
 * 为什么不直接 `node scripts/calibrationRunner.ts`：本仓库没有 `tsx` / `ts-node`，
 * 而 runner 必须 import `src/` 下的 TS 模块（生产 reducer / botAI / 统计内核）。
 * 所以用仓库已有的 `esbuild`（vite 的传递依赖）先把 runner 打成单文件 CJS，
 * 再用 `node` 跑 —— 产物落在 `scripts/.out/`（已 gitignore），不进源码树。
 *
 * 用法：
 *   npm run calibrate                                   # 默认配置（六人 R1/B5、5 seed）
 *   npm run calibrate -- --handsPerSeed=200 --equityIterations=40
 *   npm run calibrate -- --handsPerSeed=600 --out=scripts/reports/p9-4.md
 *
 * `--out=<path>` 是本启动器自己的参数（把报告同时写一份文件），不传给 runner。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '.out', 'calibrationRunner.cjs');

await build({
  entryPoints: [resolve(here, 'calibrationRunner.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  logLevel: 'warning',
  // react 只是 `useGameState` 的 import 依赖（runner 不调用任何 hook）。
  define: { 'process.env.NODE_ENV': '"production"' },
});

const argv = process.argv.slice(2);
let outPath = null;
const outFlag = argv.findIndex((a) => a === '--out' || a.startsWith('--out='));
if (outFlag >= 0) {
  const raw = argv[outFlag];
  if (raw.includes('=')) {
    outPath = raw.slice(raw.indexOf('=') + 1);
    argv.splice(outFlag, 1);
  } else {
    outPath = argv[outFlag + 1];
    argv.splice(outFlag, 2);
  }
  if (!outPath) throw new Error('--out 需要一个路径');
}

const result = spawnSync(process.execPath, [outfile, ...argv], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, CALIBRATION_RUNNER_MAIN: '1' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const stdout = result.stdout ?? '';
process.stdout.write(stdout);

if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), stdout, 'utf8');
  process.stderr.write(`报告已写入 ${outPath}\n`);
}

process.exit(result.status ?? 1);
