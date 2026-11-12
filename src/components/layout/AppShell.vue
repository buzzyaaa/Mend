<script setup lang="ts">
// 解锁后的全局外壳：只提供内容区（路由出口）。
// 图标导航栏已移除：导航（预设值 / 设置）+ 语言 / 锁定都收进顶部标题栏，
// 主界面本身即「分类侧栏 + 密码列表」的左右两列布局。
import { RouterView } from 'vue-router'
import { useAutoLock } from '@/composables/useAutoLock'

// 空闲自动锁定（设置页可配，0 = 关闭）。
// 必须在 NMessageProvider / NDialogProvider 的子组件里调用：useToast → useMessage 依赖 inject。
useAutoLock()
</script>

<template>
  <div class="h-full min-h-0">
    <RouterView />
  </div>
</template>
