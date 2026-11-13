// Category icon and color helpers for the Native Shell (nsh) UI.
//
// The database keeps the historical Material icon names (`work`,
// `credit-card`, `favorite-border`, ...) in `categories.icon`. Those values are
// **not** renamed: this file only maps them to an emoji for display, so old
// rows and new code keep the same stable keys. New categories can also store
// one of the ids below; both key sets resolve through `categoryEmoji`.

export interface CategoryIconOption {
  id: string
  emoji: string
}

/** Emoji shown for the folder category and for unknown icon names. */
export const DEFAULT_CATEGORY_EMOJI = '📁'

/**
 * The choices offered by the category editor. `id` is what gets stored in
 * `categories.icon`; `emoji` is what the UI draws.
 */
export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
  { id: 'folder', emoji: '📁' },
  { id: 'briefcase', emoji: '💼' },
  { id: 'home', emoji: '🏠' },
  { id: 'card', emoji: '💳' },
  { id: 'bank', emoji: '🏦' },
  { id: 'globe', emoji: '🌐' },
  { id: 'mail', emoji: '✉️' },
  { id: 'phone', emoji: '📱' },
  { id: 'user', emoji: '👤' },
  { id: 'lock', emoji: '🔒' },
  { id: 'unlock', emoji: '🔓' },
  { id: 'key', emoji: '🔑' },
  { id: 'shield', emoji: '🛡️' },
  { id: 'star', emoji: '⭐' },
  { id: 'heart', emoji: '❤️' },
  { id: 'gamepad', emoji: '🎮' },
  { id: 'music', emoji: '🎵' },
  { id: 'book', emoji: '📚' },
  { id: 'graduation', emoji: '🎓' },
  { id: 'bulb', emoji: '💡' },
  { id: 'code', emoji: '💻' },
  { id: 'cloud', emoji: '☁️' },
  { id: 'palette', emoji: '🎨' },
  { id: 'camera', emoji: '📷' },
  { id: 'plane', emoji: '✈️' },
  { id: 'cart', emoji: '🛒' },
  { id: 'package', emoji: '📦' },
  { id: 'gift', emoji: '🎁' },
  { id: 'food', emoji: '🍽️' },
  { id: 'coffee', emoji: '☕' },
  { id: 'pet', emoji: '🐾' },
  { id: 'car', emoji: '🚗' },
  { id: 'health', emoji: '🩺' },
  { id: 'wrench', emoji: '🔧' },
  { id: 'gear', emoji: '⚙️' },
  { id: 'receipt', emoji: '🧾' },
  { id: 'archive', emoji: '🗄️' },
  { id: 'label', emoji: '🏷️' },
  { id: 'bookmark', emoji: '🔖' },
]

/** The 38 Material icon names written by the old web UI, with their emoji. */
const LEGACY_ICON_EMOJI: Record<string, string> = {
  work: '💼',
  home: '🏠',
  'shopping-cart': '🛒',
  'credit-card': '💳',
  'local-atm': '🏦',
  lock: '🔒',
  'lock-open': '🔓',
  key: '🔑',
  'vpn-key': '🗝️',
  language: '🌐',
  translate: '🔤',
  'travel-explore': '✈️',
  restaurant: '🍽️',
  'local-dining': '🍴',
  'local-shipping': '📦',
  storefront: '🏪',
  'health-and-safety': '🩺',
  'fitness-center': '🏋️',
  school: '🎓',
  code: '💻',
  palette: '🎨',
  cloud: '☁️',
  mail: '✉️',
  'phone-iphone': '📱',
  'phone-android': '📱',
  favorite: '❤️',
  'favorite-border': '🤍',
  star: '⭐',
  label: '🏷️',
  category: '🗂️',
  bookmark: '🔖',
  pets: '🐾',
  'music-note': '🎵',
  'directions-car': '🚗',
  apps: '🧩',
  'grid-view': '🔳',
  widgets: '🧱',
  'account-circle': '👤',
}

/** Option ids (new categories) by emoji. */
const OPTION_EMOJI: Record<string, string> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((option) => [option.id, option.emoji]),
)

/**
 * The emoji for a stored category icon name: a current option id, a legacy
 * Material name, or the folder fallback when the name is empty/unknown.
 */
export function categoryEmoji(icon: string | null | undefined): string {
  if (!icon) return DEFAULT_CATEGORY_EMOJI
  return OPTION_EMOJI[icon] ?? LEGACY_ICON_EMOJI[icon] ?? DEFAULT_CATEGORY_EMOJI
}

/**
 * Colors offered by the category editor: muted, mid-tone values that keep
 * their contrast against both the light and the dark monochrome surfaces.
 */
export const CATEGORY_COLORS: string[] = [
  '#71717a', // zinc
  '#dc2626', // red
  '#ea580c', // orange
  '#ca8a04', // amber
  '#16a34a', // green
  '#0d9488', // teal
  '#0284c7', // sky
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
]
