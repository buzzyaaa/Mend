// Native (nsh) icon component.
//
// Icons are plain 24x24 SVGs imported as `ImageAsset`s and drawn with
// `<Image>`, so `tintColor` recolors them for the current theme. The map is
// typed `Record<IconName, ImageAsset>`: adding a name to `IconName` without an
// asset is a type error.
import { Image } from 'nsh'
import type { ImageAsset } from 'nsh'

import alertTriangle from '../assets/icons/alert-triangle.svg'
import archive from '../assets/icons/archive.svg'
import arrowDown from '../assets/icons/arrow-down.svg'
import arrowUp from '../assets/icons/arrow-up.svg'
import check from '../assets/icons/check.svg'
import chevronDown from '../assets/icons/chevron-down.svg'
import chevronLeft from '../assets/icons/chevron-left.svg'
import chevronRight from '../assets/icons/chevron-right.svg'
import close from '../assets/icons/close.svg'
import copy from '../assets/icons/copy.svg'
import download from '../assets/icons/download.svg'
import edit from '../assets/icons/edit.svg'
import eye from '../assets/icons/eye.svg'
import eyeOff from '../assets/icons/eye-off.svg'
import filter from '../assets/icons/filter.svg'
import folder from '../assets/icons/folder.svg'
import globe from '../assets/icons/globe.svg'
import grid from '../assets/icons/grid.svg'
import info from '../assets/icons/info.svg'
import key from '../assets/icons/key.svg'
import list from '../assets/icons/list.svg'
import lock from '../assets/icons/lock.svg'
import logOut from '../assets/icons/log-out.svg'
import mail from '../assets/icons/mail.svg'
import menu from '../assets/icons/menu.svg'
import moreHorizontal from '../assets/icons/more-horizontal.svg'
import phone from '../assets/icons/phone.svg'
import plus from '../assets/icons/plus.svg'
import refresh from '../assets/icons/refresh.svg'
import restore from '../assets/icons/restore.svg'
import search from '../assets/icons/search.svg'
import settings from '../assets/icons/settings.svg'
import shield from '../assets/icons/shield.svg'
import sort from '../assets/icons/sort.svg'
import sparkles from '../assets/icons/sparkles.svg'
import star from '../assets/icons/star.svg'
import starFilled from '../assets/icons/star-filled.svg'
import trash from '../assets/icons/trash.svg'
import unlock from '../assets/icons/unlock.svg'
import upload from '../assets/icons/upload.svg'
import user from '../assets/icons/user.svg'

/** Every icon in `assets/icons/`, named by its kebab-case file name. */
export type IconName =
  | 'alert-triangle'
  | 'archive'
  | 'arrow-down'
  | 'arrow-up'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'download'
  | 'edit'
  | 'eye'
  | 'eye-off'
  | 'filter'
  | 'folder'
  | 'globe'
  | 'grid'
  | 'info'
  | 'key'
  | 'list'
  | 'lock'
  | 'log-out'
  | 'mail'
  | 'menu'
  | 'more-horizontal'
  | 'phone'
  | 'plus'
  | 'refresh'
  | 'restore'
  | 'search'
  | 'settings'
  | 'shield'
  | 'sort'
  | 'sparkles'
  | 'star'
  | 'star-filled'
  | 'trash'
  | 'unlock'
  | 'upload'
  | 'user'

/** The SVG asset behind each icon. */
const ICON_ASSETS: Record<IconName, ImageAsset> = {
  'alert-triangle': alertTriangle,
  archive,
  'arrow-down': arrowDown,
  'arrow-up': arrowUp,
  check,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  close,
  copy,
  download,
  edit,
  eye,
  'eye-off': eyeOff,
  filter,
  folder,
  globe,
  grid,
  info,
  key,
  list,
  lock,
  'log-out': logOut,
  mail,
  menu,
  'more-horizontal': moreHorizontal,
  phone,
  plus,
  refresh,
  restore,
  search,
  settings,
  shield,
  sort,
  sparkles,
  star,
  'star-filled': starFilled,
  trash,
  unlock,
  upload,
  user,
}

export interface IconProps {
  name: IconName
  /** Both width and height in points (default 16). */
  size?: number
  /** The `tintColor` the SVG is recolored with (a CSS color). */
  color?: string
  /** Extra classes, e.g. layout spacing. */
  class?: string
  /** Read by screen readers; omit for decorative icons. */
  accessibilityLabel?: string
}

/** A tinted 24x24 native icon scaled to `size` (default 16). */
export function Icon(props: IconProps) {
  const size = props.size ?? 16
  return (
    <Image
      src={ICON_ASSETS[props.name]}
      class={props.class}
      style={{ width: size, height: size, tintColor: props.color }}
      accessibilityLabel={props.accessibilityLabel}
    />
  )
}
