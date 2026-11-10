<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const toast = useToast()
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
    <button
      v-for="item in toast.items.value"
      :key="item.id"
      type="button"
      class="pointer-events-auto max-w-sm rounded-md px-3 py-2 text-sm shadow-md transition-opacity"
      :class="
        item.kind === 'error'
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-foreground text-background'
      "
      @click="toast.dismiss(item.id)"
    >
      {{ item.text }}
    </button>
  </div>
</template>
