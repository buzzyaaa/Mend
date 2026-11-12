<script setup lang="ts">
// 自定义标题栏（deepseek harness 风格）：
// - 任意空白处按下即拖拽窗口（mousedown → startDragging，必须在鼠标按下事件内同步调用）
// - 右侧窗口控制：最小化 / 最大化(可还原) / 关闭，仅在 Tauri 运行时有效
// - 语言 / 预设值 / 设置 三个图标按钮，各自弹出窗口（不再走路由）
// - 锁定按钮；顶栏右键弹出 Windows 风格菜单（由全局 contextmenu 监听触发）
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  KeyRound,
  Languages,
  ListChecks,
  Lock,
  Minus,
  Settings as SettingsIcon,
  Copy,
  Square,
  X,
} from 'lucide-vue-next'
import { NButton, NIcon, NTooltip } from 'naive-ui'
import { isTauri } from '@/lib/ipc'
import { OVERLAY_TARGET } from '@/lib/theme'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import {
  closeWindow,
  isMaximized,
  maximizeWindow,
  minimizeWindow,
  onWindowResized,
  startWindowDrag,
  unmaximizeWindow,
} from '@/lib/window'
import { getAppVersion } from '@/lib/update'

const { t } = useI18n()
const router = useRouter()
const ui = useUiStore()
const vault = useVaultStore()

const version = ref('')
const isMax = ref(false)
let unlistenResize: (() => void) | null = null

// 预设值与设置依赖解锁态的会话密钥，未解锁时禁用对应按钮
const canUseVault = computed(() => vault.status.unlocked)

onMounted(async () => {
  getAppVersion()
    .then((v) => {
      version.value = v
    })
    .catch(() => {
      // 预览环境无版本信息，隐藏徽标即可
    })
  if (isTauri()) {
    isMax.value = await isMaximized()
    unlistenResize = await onWindowResized(async () => {
      isMax.value = await isMaximized()
    })
  }
})

onBeforeUnmount(() => unlistenResize?.())

// —— 拖拽：标题栏任意空白处的 mousedown 都启动系统级拖拽；交互元素用 @mousedown.stop 拦截 ——
async function onDragMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  await startWindowDrag().catch(() => {})
}

// —— 窗口控制 ——
function onMinimize() {
  minimizeWindow().catch(() => {})
}

/** 以窗口真实状态为准，避免乐观切换在 IPC 失败后与实际不符。 */
async function syncMaximized() {
  isMax.value = await isMaximized()
}

async function onToggleMaximize() {
  try {
    if (isMax.value) await unmaximizeWindow()
    else await maximizeWindow()
    await syncMaximized()
  } catch {
    await syncMaximized()
  }
}

function onClose() {
  closeWindow().catch(() => {})
}

async function onLock() {
  try {
    await vault.lock()
  } finally {
    await router.replace({ name: 'unlock' })
  }
}
</script>

<template>
  <header
    data-titlebar
    class="relative flex h-10 shrink-0 select-none items-center border-b border-border bg-surface"
    @mousedown="onDragMouseDown"
  >
    <!-- 品牌区（可拖拽） -->
    <div class="flex h-full min-w-0 flex-1 items-center gap-2 px-3">
      <div
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
      >
        <KeyRound :size="14" :stroke-width="2.25" />
      </div>
      <span class="truncate text-sm font-semibold tracking-tight text-foreground">
        {{ t('app.name') }}
      </span>
      <span
        v-if="version"
        class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-none text-muted-foreground"
      >
        v{{ version }}
      </span>
    </div>

    <!-- 顶栏操作：语言 / 预设值 / 设置 / 锁定（都不触发拖拽） -->
    <div class="flex h-full items-center gap-0.5 pr-1">
      <NTooltip :show-arrow="false" :to="OVERLAY_TARGET">
        <template #trigger>
          <NButton
            quaternary
            circle
            size="small"
            :aria-label="t('header.language')"
            @mousedown.stop
            @click="ui.openLanguage()"
          >
            <template #icon><NIcon :component="Languages" :size="17" /></template>
          </NButton>
        </template>
        {{ t('header.language') }}
      </NTooltip>

      <NTooltip :show-arrow="false" :to="OVERLAY_TARGET">
        <template #trigger>
          <NButton
            quaternary
            circle
            size="small"
            :disabled="!canUseVault"
            :aria-label="t('nav.presets')"
            @mousedown.stop
            @click="ui.openPresets()"
          >
            <template #icon><NIcon :component="ListChecks" :size="17" /></template>
          </NButton>
        </template>
        {{ t('nav.presets') }}
      </NTooltip>

      <NTooltip :show-arrow="false" :to="OVERLAY_TARGET">
        <template #trigger>
          <NButton
            quaternary
            circle
            size="small"
            :disabled="!canUseVault"
            :aria-label="t('nav.settings')"
            @mousedown.stop
            @click="ui.openSettings()"
          >
            <template #icon><NIcon :component="SettingsIcon" :size="17" /></template>
          </NButton>
        </template>
        {{ t('nav.settings') }}
      </NTooltip>

      <NTooltip :show-arrow="false" :to="OVERLAY_TARGET">
        <template #trigger>
          <NButton
            quaternary
            circle
            size="small"
            :aria-label="t('header.lock')"
            @mousedown.stop
            @click="onLock"
          >
            <template #icon><NIcon :component="Lock" :size="17" /></template>
          </NButton>
        </template>
        {{ t('header.lock') }}
      </NTooltip>
    </div>

    <!-- 窗口控制 -->
    <div class="flex h-full items-center">
      <button
        type="button"
        class="tb-btn"
        :aria-label="t('titlebar.minimize')"
        @mousedown.stop
        @click="onMinimize"
      >
        <Minus :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :aria-label="t('titlebar.maximize')"
        @mousedown.stop
        @click="onToggleMaximize"
      >
        <component :is="isMax ? Copy : Square" :size="13" />
      </button>
      <button
        type="button"
        class="tb-btn tb-btn--close"
        :aria-label="t('titlebar.close')"
        @mousedown.stop
        @click="onClose"
      >
        <X :size="15" />
      </button>
    </div>
  </header>
</template>
