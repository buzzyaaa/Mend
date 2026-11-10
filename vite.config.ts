import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Tauri 建议：固定端口、禁用自动清除，便于桌面 WebView 接入
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tauri Rust 侧变更不由 Vite 监听
      ignored: ['**/src-tauri/**'],
    },
  },
  // 生产构建路径遵循 Tauri 约定
  build: {
    target: 'es2021',
    minify: 'esbuild',
  },
})
