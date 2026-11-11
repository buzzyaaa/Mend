// 全局主题装配：naive-ui 与 Tailwind 共用 src/assets/main.css 的一套 CSS 变量。
// 注意：naive-ui 内部用 seemly/rgba 解析颜色来派生 hover / 阴影，它只接受具体色值，
// 不接受 `hsl(var(--x))` 这类嵌套变量。因此这里读取 CSS 变量的真实值，
// 转成 `hsl(h, s%, l%)` 逗号语法后再注入 themeOverrides。
import type { GlobalThemeOverrides } from 'naive-ui'

/** 浮层统一挂到配置提供器内部，保证 teleport 出去的弹窗/消息继承主题变量。 */
export const OVERLAY_TARGET = '#mend-overlays'

/** 读取当前主题下的 CSS 变量并转成 seemly 可解析的具体颜色。 */
function token(name: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim()
  const parts = raw.split(/\s+/)
  // 变量存的是 "220 24% 98%"；seemly 只认 "hsl(220, 24%, 98%)"
  return parts.length === 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : raw
}

/**
 * 每次主题切换重新求值：App.vue 用依赖 preferences.isDark 的 computed 调用本函数，
 * 此时 `<html class="dark">` 已由 applyTheme 切换完毕。
 */
export function createThemeOverrides(): GlobalThemeOverrides {
  return {
    common: {
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      fontFamilyMono: "ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: '14px',
      borderRadius: '10px',
      borderRadiusSmall: '7px',
      primaryColor: token('primary'),
      primaryColorHover: token('primary-hover'),
      primaryColorPressed: token('primary-pressed'),
      primaryColorSuppl: token('primary'),
      infoColor: token('info'),
      successColor: token('success'),
      warningColor: token('warning'),
      errorColor: token('error'),
      bodyColor: token('background'),
      cardColor: token('card'),
      modalColor: token('card'),
      popoverColor: token('card'),
      tableColor: token('card'),
      tableHeaderColor: token('muted'),
      tableColorHover: token('accent'),
      inputColor: token('card'),
      inputColorDisabled: token('muted'),
      actionColor: token('card'),
      tabColor: token('muted'),
      tagColor: token('muted'),
      codeColor: token('muted'),
      hoverColor: token('accent'),
      pressedColor: token('accent'),
      borderColor: token('border'),
      dividerColor: token('border'),
      textColorBase: token('foreground'),
      textColor1: token('text-1'),
      textColor2: token('text-2'),
      textColor3: token('text-3'),
      textColorDisabled: token('text-3'),
      placeholderColor: token('text-3'),
      placeholderColorDisabled: token('text-3'),
      iconColor: token('text-3'),
      iconColorHover: token('text-1'),
      iconColorPressed: token('text-1'),
      scrollbarColor: token('border'),
      scrollbarColorHover: token('text-3'),
      boxShadow1: '0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 20px rgba(15, 23, 42, 0.07)',
      boxShadow2: '0 2px 6px rgba(15, 23, 42, 0.08), 0 16px 48px rgba(15, 23, 42, 0.18)',
    },
    Button: {
      colorPrimary: token('primary'),
      colorHoverPrimary: token('primary-hover'),
      colorPressedPrimary: token('primary-pressed'),
      colorFocusPrimary: token('primary-hover'),
      textColorPrimary: token('primary-foreground'),
      textColorHoverPrimary: token('primary-foreground'),
      textColorPressedPrimary: token('primary-foreground'),
      textColorFocusPrimary: token('primary-foreground'),
      textColorTextPrimary: token('primary'),
      textColorTextHoverPrimary: token('primary-hover'),
      textColorTextPressedPrimary: token('primary-pressed'),
      textColorGhostPrimary: token('primary'),
      textColorGhostHoverPrimary: token('primary-hover'),
      textColorGhostPressedPrimary: token('primary-pressed'),
      borderPrimary: token('primary'),
      borderHoverPrimary: token('primary-hover'),
      borderPressedPrimary: token('primary-pressed'),
    },
    Card: {
      borderColor: token('border'),
      color: token('card'),
    },
    Input: {
      borderColor: token('input'),
      color: token('card'),
    },
    Layout: {
      color: token('background'),
      colorEmbedded: token('background'),
      siderColor: token('surface'),
      siderBorderColor: token('border'),
      headerColor: token('card'),
      headerBorderColor: token('border'),
      siderToggleButtonColor: token('card'),
      siderToggleBarColor: token('border'),
      siderToggleBarColorHover: token('text-3'),
    },
    Menu: {
      color: token('surface'),
      borderRadius: '8px',
      itemColorHover: token('accent'),
      itemColorActive: token('accent'),
      itemColorActiveHover: token('accent'),
      itemColorActiveCollapsed: token('accent'),
      itemTextColor: token('text-2'),
      itemTextColorHover: token('text-1'),
      itemTextColorActive: token('primary'),
      itemTextColorActiveHover: token('primary'),
      itemIconColor: token('text-3'),
      itemIconColorHover: token('text-1'),
      itemIconColorActive: token('primary'),
      itemIconColorActiveHover: token('primary'),
      dividerColor: token('border'),
      groupTextColor: token('text-3'),
    },
  }
}
