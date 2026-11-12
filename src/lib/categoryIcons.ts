// 分类图标与颜色工具。
// 图标来自 @vicons/material（Material Design 图标生态），通过**显式注册表**把
// 数据库 categories.icon 列存储的图标名映射到组件；未设置时回退 lucide Folder。
// 颜色统一用 rgba 换算实现 10% 透明（见 categoryTint）。

import {
  AccountCircleOutlined,
  AppsOutlined,
  BookmarkOutlined,
  CategoryOutlined,
  CloudOutlined,
  CodeOutlined,
  CreditCardOutlined,
  DirectionsCarOutlined,
  FavoriteBorderOutlined,
  FavoriteOutlined,
  FitnessCenterOutlined,
  GridViewOutlined,
  HealthAndSafetyOutlined,
  HomeOutlined,
  KeyOutlined,
  LabelOutlined,
  LanguageOutlined,
  LocalAtmOutlined,
  LocalDiningOutlined,
  LocalShippingOutlined,
  LockOpenOutlined,
  LockOutlined,
  MailOutlined,
  MusicNoteOutlined,
  PaletteOutlined,
  PetsOutlined,
  PhoneAndroidOutlined,
  PhoneIphoneOutlined,
  RestaurantOutlined,
  SchoolOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  StorefrontOutlined,
  TranslateOutlined,
  TravelExploreOutlined,
  VpnKeyOutlined,
  WidgetsOutlined,
  WorkOutlined,
} from '@vicons/material'
import { Folder } from 'lucide-vue-next'
import type { Component } from 'vue'

/** 注册表：图标名（存于 `categories.icon`）→ 图标组件。新增图标请追加于此。 */
export const CATEGORY_ICON_REGISTRY: Record<string, Component> = {
  work: WorkOutlined,
  home: HomeOutlined,
  'shopping-cart': ShoppingCartOutlined,
  'credit-card': CreditCardOutlined,
  'local-atm': LocalAtmOutlined,
  lock: LockOutlined,
  'lock-open': LockOpenOutlined,
  key: KeyOutlined,
  'vpn-key': VpnKeyOutlined,
  language: LanguageOutlined,
  translate: TranslateOutlined,
  'travel-explore': TravelExploreOutlined,
  restaurant: RestaurantOutlined,
  'local-dining': LocalDiningOutlined,
  'local-shipping': LocalShippingOutlined,
  storefront: StorefrontOutlined,
  'health-and-safety': HealthAndSafetyOutlined,
  'fitness-center': FitnessCenterOutlined,
  school: SchoolOutlined,
  code: CodeOutlined,
  palette: PaletteOutlined,
  cloud: CloudOutlined,
  mail: MailOutlined,
  'phone-iphone': PhoneIphoneOutlined,
  'phone-android': PhoneAndroidOutlined,
  favorite: FavoriteOutlined,
  'favorite-border': FavoriteBorderOutlined,
  star: StarOutlined,
  label: LabelOutlined,
  category: CategoryOutlined,
  bookmark: BookmarkOutlined,
  pets: PetsOutlined,
  'music-note': MusicNoteOutlined,
  'directions-car': DirectionsCarOutlined,
  apps: AppsOutlined,
  'grid-view': GridViewOutlined,
  widgets: WidgetsOutlined,
  'account-circle': AccountCircleOutlined,
}

export interface CategoryIconOption {
  name: string
  component: Component
}

/** 图标选择网格用的扁平列表（保持注册表声明顺序）。 */
export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = Object.entries(
  CATEGORY_ICON_REGISTRY,
).map(([name, component]) => ({ name, component }))

/** 解析分类图标：命中注册表则用对应组件，否则回退默认文件夹图标。 */
export function resolveCategoryIcon(name?: string | null): Component {
  if (name && Object.prototype.hasOwnProperty.call(CATEGORY_ICON_REGISTRY, name)) {
    return CATEGORY_ICON_REGISTRY[name]
  }
  return Folder
}

/**
 * 十六进制 `#RRGGBB` → 指定 alpha 的 rgba 字符串（纯函数）。
 * 颜色为空或格式非法时返回全透明，调用方据此呈现"无背景"。
 */
export function categoryTint(color?: string | null, alpha = 0.1): string {
  const hex = (color ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 'rgba(0, 0, 0, 0)'
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
