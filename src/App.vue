<script setup lang="ts">
import { RouterView } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useAutoLock } from '@/composables/useAutoLock'

// 空闲自动锁定（设置页可配，0 = 关闭）
useAutoLock()
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
