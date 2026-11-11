<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from 'naive-ui'

const message = useMessage()

export function useToast() {
  return {
    items: ref([]),
    success: (text: string) => message.success(text),
    error: (text: string) => message.error(text),
    warning: (text: string) => message.warning(text),
    info: (text: string) => message.info(text),
    dismiss: (id: number) => {
      // naive ui message 不提供直接关闭方法，只能等待自动关闭
      // 这里不做操作，依赖自动关闭
    },
  }
}
</script>

<template>
  <!-- 占位，避免 Vue 警告 -->
  <div />
</template>
