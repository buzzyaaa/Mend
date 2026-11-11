<script setup lang="ts">
// 解锁后的全局外壳：最左侧图标导航栏 + 页面内容。
import NavRail from '@/components/layout/NavRail.vue'
import { NLayout, NLayoutSider } from 'naive-ui'

const collapsed = defineModel<boolean>('collapsed', { default: false })
</script>

<template>
  <NLayout has-sider class="h-screen">
    <NLayoutSider
      bordered
      :collapsed="collapsed"
      :collapsed-width="64"
      :width="240"
      show-trigger
      collapse-mode="width"
      :native-scrollbar="false"
    >
      <NavRail />
    </NLayoutSider>
    <NLayout class="min-w-0">
      <RouterView />
    </NLayout>
  </NLayout>
</template>
