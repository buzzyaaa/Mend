import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
  {
    ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', 'local/**', 'skills/**'],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    rules: {
      // 自用布局组件（Sidebar/TopBar）保留单词名，避免无意义改名
      'vue/multi-word-component-names': 'off',
    },
  },
)
