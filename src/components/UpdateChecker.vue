<script setup lang="ts">
// 应用启动时按偏好间隔自动检查更新。无 UI，仅负责在挂载后触发一次检查。
// 放在 NDialogProvider / NMessageProvider 内部，所以组件内可正常使用 dialog 与 toast。
import { onMounted } from 'vue'
import { useUpdateChecker } from '@/composables/useUpdateChecker'

const { runCheck } = useUpdateChecker()

onMounted(() => {
  void runCheck(false)
})
</script>

<template>
  <!-- 仅做启动检查，不渲染可见内容 -->
  <div v-if="false" />
</template>
