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
    rollupOptions: {
      output: {
        // 按依赖生态拆 chunk，消除主包超 500 kB 警告。
        // naive-ui 体积最大（整体成块仍 >500 kB），再按 es/components 与其余内部实现拆两块。
        manualChunks(id: string) {
          const norm = id.replace(/\\/g, '/')
          if (!norm.includes('node_modules')) return undefined
          if (norm.includes('naive-ui')) {
            // naive-ui 的组件与共享基础设施（样式/内部件/语言包，占大头）各成一块
            return /naive-ui\/es\/(components|_utils|_styles|_internal|locales)\//.test(norm)
              ? 'vendor-naive-base'
              : 'vendor-naive-ui'
          }
          if (norm.includes('@tauri-apps')) return 'vendor-tauri'
          if (/node_modules\/(vue|@vue\/|vue-router\/|vue-i18n\/|pinia\/|@intlify\/)/.test(norm)) {
            return 'vendor-vue'
          }
          return undefined
        },
      },
    },
  },
})
