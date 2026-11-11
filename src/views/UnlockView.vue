<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
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
  <div class="flex h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
      <div class="mb-1 text-center text-xl font-semibold">{{ t('app.name') }}</div>
      <p class="mb-6 text-center text-sm text-muted-foreground">
        {{ setupMode ? t('unlock.setupSubtitle') : t('unlock.subtitle') }}
      </p>

      <form @submit.prevent="submit">
        <label class="mb-1 block text-sm text-muted-foreground">{{ t('unlock.password') }}</label>
        <input
          v-model="password"
          type="password"
          autocomplete="off"
          class="mb-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          :placeholder="t('unlock.password')"
        />

        <template v-if="setupMode">
          <label class="mb-1 block text-sm text-muted-foreground">{{ t('unlock.confirm') }}</label>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="off"
            class="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('unlock.confirm')"
          />
          <p
            v-if="strength"
            class="mb-4 text-xs"
            :class="{
              'text-destructive': strength === 'weak',
              'text-muted-foreground': strength !== 'weak',
            }"
          >
            {{ t('unlock.strengthLabel') }}: {{ t(`unlock.strength.${strength}`) }}
          </p>
        </template>

        <p v-if="error" class="mb-3 text-xs text-destructive">{{ error }}</p>

        <button
          type="submit"
          :disabled="vault.busy"
          class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {{ setupMode ? t('unlock.create') : t('unlock.unlock') }}
        </button>
      </form>

      <p v-if="preview" class="mt-4 text-center text-xs text-muted-foreground">
        {{ t('unlock.errors.preview') }}
      </p>
      <p class="mt-4 text-center text-xs text-muted-foreground">{{ t('unlock.cannotRecover') }}</p>
    </div>
  </div>
</template>
