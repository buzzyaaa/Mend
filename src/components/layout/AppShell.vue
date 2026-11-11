<script setup lang="ts">
// 解锁后的全局外壳：最左侧图标导航栏 + 页面内容。
import NavRail from '@/components/layout/NavRail.vue'
import { NLayout, NLayoutSider } from 'naive-ui'
import { useAutoLock } from '@/composables/useAutoLock'

// 空闲自动锁定（设置页可配，0 = 关闭）。
// 必须在 NMessageProvider / NDialogProvider 的子组件里调用：useToast → useMessage 依赖 inject。
useAutoLock()

const collapsed = defineModel<boolean>('collapsed', { default: false })
</script>

<template>
  <NLayout has-sider class="h-screen">
    <NLayoutSider
      v-model:collapsed="collapsed"
      bordered
      :collapsed-width="64"
      :width="216"
      show-trigger
      collapse-mode="width"
      :native-scrollbar="false"
    >
      <NavRail v-model:collapsed="collapsed" />
    </NLayoutSider>
    <NLayout class="min-w-0" style="height: 100%" :native-scrollbar="false">
      <RouterView />
    </NLayout>
  </NLayout>
</template>
