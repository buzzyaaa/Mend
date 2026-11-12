<script setup lang="ts">
// 语言选择弹窗：顶栏语言图标点击弹出，两项即时切换（选中即生效并关闭）。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NModal, NRadio, NRadioGroup, NText } from 'naive-ui'
import { OVERLAY_TARGET } from '@/lib/theme'
import { setI18nLocale } from '@/i18n'
import { usePreferencesStore } from '@/stores/preferences'
import type { Locale } from '@/types'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const preferences = usePreferencesStore()

const options = computed(() => [
  { value: 'zh-CN' as Locale, label: t('header.langZh') },
  { value: 'en' as Locale, label: t('header.langEn') },
])

function choose(locale: Locale) {
  preferences.setLocale(locale)
  setI18nLocale(locale)
  emit('close')
}
</script>

<template>
  <NModal
    :show="open"
    :to="OVERLAY_TARGET"
    :mask-closable="false"
    @update:show="
      (show: boolean) => {
        if (!show) emit('close')
      }
    "
  >
    <NCard
      :title="t('header.language')"
      :bordered="false"
      closable
      size="large"
      style="width: min(340px, calc(100vw - 32px))"
      @close="emit('close')"
    >
      <NRadioGroup
        :value="preferences.locale"
        size="large"
        @update:value="(value: Locale) => choose(value)"
      >
        <NRadio v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </NRadio>
      </NRadioGroup>

      <NText :depth="3" class="mt-3 block text-xs">{{ t('header.languageHint') }}</NText>
    </NCard>
  </NModal>
</template>
