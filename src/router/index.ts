import { createRouter, createWebHistory } from 'vue-router'
import { useVaultStore } from '@/stores/vault'
import { isTauri } from '@/lib/ipc'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/components/layout/AppShell.vue'),
      children: [
        { path: '', redirect: { name: 'main' } },
        {
          path: 'main',
          name: 'main',
          component: () => import('@/views/MainView.vue'),
        },
        {
          path: 'presets',
          name: 'presets',
          component: () => import('@/views/PresetsView.vue'),
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
        },
      ],
    },
    {
      path: '/unlock',
      name: 'unlock',
      component: () => import('@/views/UnlockView.vue'),
    },
  ],
})

// 路由守卫：未解锁只能停在解锁页；已解锁不再停留在解锁页。
// 浏览器预览（非 Tauri）下保持骨架可浏览，不做跳转。
router.beforeEach(async (to) => {
  if (!isTauri()) return true

  const vault = useVaultStore()
  try {
    await vault.refresh()
  } catch {
    // 状态读取失败时不阻断路由，交由页面自行提示
    return true
  }

  if (!vault.status.unlocked) {
    return to.name === 'unlock' ? true : { name: 'unlock' }
  }
  if (to.name === 'unlock') return { name: 'main' }
  return true
})

export default router
