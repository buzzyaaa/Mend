// 生成「预着色」图标变体：把主题色直接烘进 SVG 的 currentColor，
// 让 <Image> 不再走 tintColor（Windows 上每次绘制都要过一遍 D2D 颜色矩阵特效，
// 密码列表拖动列宽时上百个行内图标逐帧重绘，是卡顿的主因）。
//
// 用法：node scripts/gen-tinted-icons.mjs
// 主题色改动（theme.json）或行内图标集合变化后重跑；产物提交进仓库：
//   assets/icons-tinted/{name}-{rrggbb}.svg
//   components/tinted-icons.ts（按 `name|rrggbb` 索引的资产表）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(readFileSync(join(root, 'theme.json'), 'utf8'))

// 列表行内按钮/复选框用到的图标（EntryCells / EntryCheckbox）。
const ICONS = [
  'archive',
  'arrow-down',
  'arrow-up',
  'check',
  'copy',
  'edit',
  'eye',
  'eye-off',
  'restore',
  'star',
  'star-filled',
  'trash',
]

// 行内图标实际取色的 token（token() 的返回值即这些十六进制值）。
const TOKENS = [
  'foreground',
  'muted-foreground',
  'primary',
  'primary-foreground',
  'destructive',
  'warning',
]

const hexes = new Set()
for (const scheme of ['light', 'dark']) {
  for (const token of TOKENS) {
    const value = theme.cssVars[scheme][token]
    if (/^#[0-9a-f]{6}$/i.test(value)) hexes.add(value.toLowerCase())
  }
}

const outDir = join(root, 'assets', 'icons-tinted')
mkdirSync(outDir, { recursive: true })
for (const file of readdirSync(outDir)) {
  if (file.endsWith('.svg')) unlinkSync(join(outDir, file))
}

const entries = []
for (const name of ICONS) {
  const svg = readFileSync(join(root, 'assets', 'icons', `${name}.svg`), 'utf8')
  if (!svg.includes('currentColor')) {
    throw new Error(`icon ${name} has no currentColor; baking would be a no-op`)
  }
  for (const hex of [...hexes].sort()) {
    const rgb = hex.slice(1)
    const file = `${name}-${rgb}.svg`
    writeFileSync(join(outDir, file), svg.replaceAll('currentColor', hex))
    entries.push({ name, rgb, file })
  }
}

const lines = [
  '// 由 scripts/gen-tinted-icons.mjs 生成：主题色已烘进 SVG，绘制时不需要 tintColor。',
  '// 不要手改；重跑脚本再生成。',
  "import type { ImageAsset } from 'nsh'",
  '',
  ...entries.map(
    (e) => `import ${e.name.replaceAll('-', '_')}_${e.rgb} from '../assets/icons-tinted/${e.file}'`,
  ),
  '',
  'export const TINTED_ICONS: Record<string, ImageAsset> = {',
  ...entries.map((e) => `  '${e.name}|${e.rgb}': ${e.name.replaceAll('-', '_')}_${e.rgb},`),
  '}',
  '',
]

// 品牌图标（EntryIcon）：tint 色由 brandTint(hex) 决定，与主题无关，每品牌烘一个色。
// brandTint 必须与 components/EntryIcon.tsx 的实现逐字一致，烘焙结果才和原 tint 等价。
function brandTint(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 0.2 ? '#a1a1aa' : hex
}

const siteSrc = readFileSync(join(root, 'lib', 'site-icons.ts'), 'utf8')
const fileOf = new Map()
for (const m of siteSrc.matchAll(/import (\w+) from '\.\.\/assets\/site-icons\/([^']+)'/g)) {
  fileOf.set(m[1], m[2])
}
const siteOutDir = join(root, 'assets', 'site-icons-tinted')
mkdirSync(siteOutDir, { recursive: true })
for (const file of readdirSync(siteOutDir)) {
  if (file.endsWith('.svg')) unlinkSync(join(siteOutDir, file))
}
const siteEntries = []
const entryRe = /name:\s*'([^']+)'[\s\S]*?asset:\s*(\w+),\s*hex:\s*'(#[0-9A-Fa-f]{6})'/g
for (const m of siteSrc.matchAll(entryRe)) {
  const [, name, varName, hex] = m
  const file = fileOf.get(varName)
  if (!file) throw new Error(`site icon ${name}: unknown asset variable ${varName}`)
  const tint = brandTint(hex).toLowerCase()
  const svg = readFileSync(join(root, 'assets', 'site-icons', file), 'utf8')
  if (!svg.includes('currentColor')) {
    throw new Error(`site icon ${name} has no currentColor; baking would be a no-op`)
  }
  const out = `${file.replace(/\.svg$/, '')}-${tint.slice(1)}.svg`
  writeFileSync(join(siteOutDir, out), svg.replaceAll('currentColor', tint))
  siteEntries.push({ name, rgb: tint.slice(1), out, ident: `site_${varName}_${tint.slice(1)}` })
}
if (siteEntries.length !== fileOf.size) {
  throw new Error(`parsed ${siteEntries.length} site icons but ${fileOf.size} imports exist`)
}
lines.push(
  ...siteEntries.map((e) => `import ${e.ident} from '../assets/site-icons-tinted/${e.out}'`),
  '',
  'export const TINTED_SITE_ICONS: Record<string, ImageAsset> = {',
  ...siteEntries.map((e) => {
    const key = `${e.name}|${e.rgb}`
    // Prettier 偏好单引号；键里含撇号时才用双引号（与 prettier 的取舍一致）。
    const quoted = key.includes("'") ? JSON.stringify(key) : `'${key}'`
    return `  ${quoted}: ${e.ident},`
  }),
  '}',
  '',
)

writeFileSync(join(root, 'components', 'tinted-icons.ts'), lines.join('\n'))
console.log(
  `generated ${entries.length} tinted icons (${ICONS.length} icons x ${hexes.size} colors) + ${siteEntries.length} tinted site icons`,
)
