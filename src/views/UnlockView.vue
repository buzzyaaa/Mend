<script setup lang="ts">
// 解锁页：首次使用进入"设置主密码"，之后为普通解锁。独立于主外壳，不带导航栏。
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { KeyRound, ShieldCheck } from 'lucide-vue-next'
import { NAlert, NButton, NCard, NIcon, NInput, NTag, NText } from 'naive-ui'
import { useVaultStore } from '@/stores/vault'
import { isTauri } from '@/lib/ipc'

const { t } = useI18n()
const router = useRouter()
const vault = useVaultStore()

const password = ref('')
const confirmPassword = ref('')
const error = ref('')

/** 未初始化时进入"设置主密码"流程，否则是普通解锁。 */
const setupMode = computed(() => !vault.status.initialized)
const preview = !isTauri()

onMounted(async () => {
  try {
    await vault.refresh()
  } catch (err) {
    error.value = messageOf(err)
  }
})

/** 仅作提示，真实强度由主密码长度/字符集粗略判断，不阻断提交。 */
const strength = computed<'weak' | 'medium' | 'strong' | null>(() => {
  if (!setupMode.value || !password.value) return null
  const value = password.value
  let score = 0
  if (value.length >= 8) score += 1
  if (value.length >= 12) score += 1
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1
  if (score <= 1) return 'weak'
  if (score <= 3) return 'medium'
  return 'strong'
})

const strengthType = computed(() => {
  if (strength.value === 'weak') return 'error' as const
  if (strength.value === 'medium') return 'warning' as const
  return 'success' as const
})

async function submit() {
  error.value = ''
  if (!password.value) {
    error.value = t('unlock.errors.empty')
    return
  }
  if (setupMode.value) {
    if (password.value.length < 4) {
      error.value = t('unlock.errors.tooShort')
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = t('unlock.errors.mismatch')
      return
    }
  }

  try {
    if (setupMode.value) {
      await vault.setup(password.value)
    } else {
      await vault.unlock(password.value)
    }
    password.value = ''
    confirmPassword.value = ''
    await router.replace({ name: 'main' })
  } catch (err) {
    error.value = messageOf(err)
  }
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('主密码错误')) return t('unlock.errors.wrongPassword')
  if (raw.includes('浏览器预览')) return t('unlock.errors.preview')
  return raw
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm">
      <NCard :bordered="true" size="large" class="shadow-sm">
        <div class="mb-5 text-center">
          <div
            class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
          >
            <NIcon :component="ShieldCheck" :size="24" />
          </div>
          <NText strong class="block text-xl">{{ t('app.name') }}</NText>
          <NText :depth="3" class="mt-1 block text-sm">
            {{ setupMode ? t('unlock.setupSubtitle') : t('unlock.subtitle') }}
          </NText>
        </div>

        <form class="grid gap-3" @submit.prevent="submit">
          <div>
            <NText :depth="2" class="mb-1 block text-xs">{{ t('unlock.password') }}</NText>
            <NInput
              v-model:value="password"
              type="password"
              show-password-on="click"
              autocomplete="off"
              :placeholder="t('unlock.password')"
              :status="error ? 'error' : undefined"
              @keydown.enter.prevent="submit"
            >
              <template #prefix><NIcon :component="KeyRound" :size="16" /></template>
            </NInput>
          </div>

          <template v-if="setupMode">
            <div>
              <NText :depth="2" class="mb-1 block text-xs">{{ t('unlock.confirm') }}</NText>
              <NInput
                v-model:value="confirmPassword"
                type="password"
                show-password-on="click"
                autocomplete="off"
                :placeholder="t('unlock.confirm')"
                :status="error ? 'error' : undefined"
                @keydown.enter.prevent="submit"
              />
            </div>
            <div v-if="strength" class="flex items-center gap-2">
              <NText :depth="3" class="text-xs">{{ t('unlock.strengthLabel') }}</NText>
              <NTag size="small" :bordered="false" round :type="strengthType">
                {{ t(`unlock.strength.${strength}`) }}
              </NTag>
            </div>
          </template>

          <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>

          <NButton
            type="primary"
            block
            attr-type="submit"
            :loading="vault.busy"
            class="mt-1"
          >
            {{ setupMode ? t('unlock.create') : t('unlock.unlock') }}
          </NButton>
        </form>

        <NAlert v-if="preview" type="info" :show-icon="false" class="mt-4">
          {{ t('unlock.errors.preview') }}
        </NAlert>
        <NText :depth="3" class="mt-4 block text-center text-xs">
          {{ t('unlock.cannotRecover') }}
        </NText>
      </NCard>
    </div>
  </div>
</template>
