# Mend

> Mend the gaps of your memory.

A local, offline, encrypted password manager built with **Native Shell (nsh)** — native views on every platform, a Rust core for storage and cryptography, no WebView.

一款本地离线、存盘加密的个人密码管理器，基于 **Native Shell**：TSX 原生界面 + Rust 核心（SQLite / Argon2id / XChaCha20-Poly1305），不使用 WebView。

## ⚠️ Important / 重要提示

This software is provided "as is", without warranty of any kind. Back up your vault regularly. If you lose the master password, the data cannot be recovered.

本软件按现状提供，不附带任何形式的担保。请定期备份密码库；主密码丢失后数据无法恢复。

## ✨ Features / 功能

- Local SQLite vault; sensitive fields encrypted before they reach disk.
- Entries with title, username, password, email, phone, URL, Markdown notes, tags, favorites.
- Categories with color and emoji icon; archive and trash; presets; password generator.
- Search, sorting (updated / title / favorite / manual), copy to clipboard, open URLs.
- Auto-lock, light/dark/system theme, Chinese/English UI.
- Encrypted `.mendbak` backup and restore.
- App updates (GitHub Releases) and OTA signed-package updates for TSX code.
- Desktop master-detail layout and a compact phone layout from the same code.
- Existing Tauri-era vaults (`%APPDATA%\com.mend.app\mend.db`) open as-is.

## 🚀 Usage / 使用

1. First run: set a master password (minimum 4 characters). It is never stored.
2. Create entries from the header; use the sidebar to switch bucket/category.
3. Use the row menu for edit/star/archive/delete; trash rows can be restored or purged.
4. Settings → Backup & restore: enter the master password, export (written to the data folder shown there) or restore a `.mendbak`.
5. Lock from the header; idle lock is configurable in Settings.
6. Language and theme are in Settings; preferences are stored outside the vault ciphertext.

## 🛠 Development / 开发

Read [`AGENTS.md`](./AGENTS.md) and [`docs/11-native-shell.md`](./docs/11-native-shell.md) first.

Prerequisites: the `nsh` CLI (0.5.0), a Rust toolchain, and a C toolchain for SQLite (`rusqlite` bundled). On Windows, MinGW-w64 or MSVC works with the matching Rust target.

```powershell
. .\scripts\dev-env.ps1      # cargo / MinGW / nsh(.tools) for this session
nsh run .                    # native window with hot reload
nsh test .                   # headless native + TSX tests
nsh build .                  # bundle into .nsh/out
nsh package . --target windows

cargo test --manifest-path core\Cargo.toml   # encryption / SQLite / backup tests
npm run typecheck                            # TypeScript check (nsh check fallback)
```

Project layout: `App.tsx` / `screens/` / `components/` / `lib/` (TSX), `native/` (nsh native module), `core/` (GUI-free Rust core), `locales/`, `assets/`.

**VS Code**：打开仓库后按 `Ctrl+Shift+B` 可跑默认构建；`Terminal → Run Task` 里有开发窗口、Web 预览、nsh check/test、打包、运行已打包 exe、格式化、清理与一键验证等任务（`.vscode/tasks.json`）。

## 📐 Design notes / 设计说明

- System title bar; the in-app header holds search, add, presets, settings, lock.
- Desktop: sidebar + list + detail. Phone: one column, detail page, categories sheet.
- Manual ordering uses “move up/down” menu actions instead of web drag-and-drop.
- Category icons are stored as stable text names and rendered as emoji.
- Backup export writes into the app data directory (mobile has no save dialog); restore uses the system file picker.

## 📄 License / 许可

[MIT License](./LICENSE)
