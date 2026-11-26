#!/usr/bin/env node
/**
 * 给 `nsh package --target windows` 生成的 Inno Setup 脚本打补丁。
 *
 * nsh 只会写一份固定脚本：输出名是 `Mend-setup.exe`，且没有 [Languages] 段，
 * 于是安装/卸载界面永远只有英文。这里在重新编译前改两处：
 *   1. OutputBaseFilename=Mend-<version>-setup —— 发布资产带版本号；
 *      CNB 变体（第三参 cnb）输出 Mend-cnb-<version>-setup，两种安装器并存；
 *   2. [Languages] 加入英文 + 简体中文，ShowLanguageDialog=yes —— 第一步选语言；
 *      LanguageDetectionMethod=uilanguage 按系统 UI 语言预选；
 *      UsePreviousLanguage=yes 让升级安装沿用上次语言，卸载界面也用安装时选的语言。
 *   3. 把仓库内的 installer/ChineseSimplified.isl 拷到 .iss 同目录，按相对路径引用。
 *      GitHub runner 自带的 Inno Setup 没有这份非官方翻译，放在仓库里最稳。
 *
 * 用法：node scripts/patch-installer.mjs <Mend.iss> [version] [cnb]
 * 版本省略时读仓库根 nsh.json 的 version。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , issArg, versionArg, variantArg] = process.argv
if (variantArg && variantArg !== 'cnb') {
  console.error('variant must be "cnb" when provided')
  process.exit(2)
}
if (!issArg) {
  console.error('usage: node scripts/patch-installer.mjs <Mend.iss> [version]')
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'nsh.json'), 'utf8'))
const version = versionArg ?? config.version
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`invalid version: ${version}`)
  process.exit(2)
}

const issPath = path.resolve(issArg)
const islSource = path.join(root, 'installer', 'ChineseSimplified.isl')
if (!fs.existsSync(islSource)) {
  console.error(`missing ${islSource}`)
  process.exit(1)
}
// Inno Setup 从脚本所在目录解析相对路径，语言文件必须跟 .iss 放在一起。
fs.copyFileSync(islSource, path.join(path.dirname(issPath), 'ChineseSimplified.isl'))

const source = fs.readFileSync(issPath, 'utf8')
const lines = source
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((line) =>
    line.replace(/compiler:Languages\\ChineseSimplified\.isl/g, 'ChineseSimplified.isl'),
  )

const setupAt = lines.findIndex((line) => /^\[Setup\]\s*$/i.test(line))
if (setupAt < 0) {
  console.error(`${issPath}: missing [Setup] section (not an nsh-generated script?)`)
  process.exit(1)
}

const outputName = variantArg === 'cnb' ? `Mend-cnb-${version}-setup` : `Mend-${version}-setup`
const outputAt = lines.findIndex((line) => /^OutputBaseFilename=/i.test(line))
if (outputAt >= 0) {
  lines[outputAt] = `OutputBaseFilename=${outputName}`
} else {
  lines.splice(setupAt + 1, 0, `OutputBaseFilename=${outputName}`)
}
for (const directive of [
  'ShowLanguageDialog=yes',
  'LanguageDetectionMethod=uilanguage',
  'UsePreviousLanguage=yes',
]) {
  const key = directive.split('=')[0]
  if (!lines.some((line) => new RegExp(`^${key}=`, 'i').test(line))) {
    lines.splice(setupAt + 1, 0, directive)
  }
}

if (!lines.some((line) => /^\[Languages\]/i.test(line))) {
  const tasksAt = lines.findIndex((line) => /^\[Tasks\]/i.test(line))
  const insertAt = tasksAt >= 0 ? tasksAt : lines.length
  lines.splice(
    insertAt,
    0,
    ...[
      '',
      '[Languages]',
      'Name: "en"; MessagesFile: "compiler:Default.isl"',
      'Name: "zh"; MessagesFile: "ChineseSimplified.isl"',
      '',
    ],
  )
}

fs.writeFileSync(issPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`patched ${issPath}: OutputBaseFilename=${outputName}, Setup Language (en / zh)`)
