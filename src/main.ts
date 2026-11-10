import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n, setI18nLocale } from './i18n'
import { usePreferencesStore } from './stores/preferences'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)

// 初始化文档语言与主题（主题跟随偏好，system 模式监听系统变化）
const preferences = usePreferencesStore()
setI18nLocale(preferences.locale)
preferences.initTheme()

app.mount('#app')
