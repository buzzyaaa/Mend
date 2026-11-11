<script setup lang="ts">
// 解锁后的全局外壳：最左侧图标导航栏 + 页面内容。
import NavRail from '@/components/layout/NavRail.vue'
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <NavRail />
    <div class="flex min-w-0 flex-1">
      <router-view />
    </div>
  </div>
</template>
