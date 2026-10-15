import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 依赖预构建缓存默认落在 `<root>/node_modules/.vite`。本仓库常在多个 git worktree
  // 并行开发，而 worktree 里的 `node_modules` 是**指向主仓库的符号链接**，于是那个
  // 路径既落在工作区之外、又被所有 worktree 共享，带来两个问题：
  //   1. 工作区外的路径会被文件系统策略拒绝原子重命名
  //      （`renameSync(deps_temp_x, deps)` → "Brokered rename refused by resolved path
  //      policy"），`deps/` 永远生成不出来 → 页面白屏并报 `504 (Outdated Optimize Dep)`；
  //   2. 共享缓存会因各 worktree 的 root 不同而 `configHash` 反复变化 → 依赖反复重建。
  // 放到各 worktree 自己的根目录下，一次解决这两点。
  cacheDir: '.vite-cache',
})
