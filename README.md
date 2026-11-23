# Mend

> **Mend the gaps of your memory.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform: Windows / macOS / Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Version](https://img.shields.io/badge/Version-0.6.2-green.svg)](./CHANGELOG.md)

English | [简体中文](./README.zh-CN.md)

Mend is a local-first, offline, encrypted personal password manager. It is built on **Native Shell (nsh 0.5.0)**: a TSX native view layer over a Rust core (SQLite + Argon2id + XChaCha20-Poly1305), with no WebView, no HTML/CSS pages and no frontend bundler. All storage and cryptography happen in Rust; desktop and mobile share the same adaptive UI from a single codebase.

## Features

- **Encrypted local vault** — a SQLite database where account names, passwords, emails, phone numbers, notes and preset values are encrypted before they touch the disk.
- **Entry management** — title, username, password, URL, Markdown notes, tags and favorites.
- **Organization** — color and emoji categories, archive, trash and preset values.
- **Everyday tools** — strong password generator, search, sorting (recently updated / name / favorite / manual), copy-to-clipboard and open-in-browser.
- **Comfort** — auto-lock, light / dark / system themes, English and Chinese interfaces.
- **Backup** — encrypted `.mendbak` export and restore.
- **Updates** — in-app updates with signed OTA packages (releases are published on GitHub Releases).
- **Adaptive layout** — desktop master-detail (sidebar + list + detail) and single-column mobile from the same code.

## Download

- [GitHub Releases](https://github.com/buzzyaaa/Mend/releases/latest) — primary source; in-app updates and OTA also use GitHub.
- [CNB mirror](https://cnb.cool/smybxg/Mend/-/releases) — 国内下载镜像，产物与 GitHub Release 一致，推荐中国大陆用户使用。

## Code signing

Windows releases are signed with a project key. We plan to move to a publicly trusted code signing certificate as the project grows; until then, Windows SmartScreen may show a publisher warning on first download.

## Important

This software is provided "as is", without warranty of any kind. Back up your vault regularly. If you lose the master password, the data cannot be recovered.

## Getting started

Install the Native Shell CLI and a Rust toolchain before developing.

**1. Install nsh CLI (0.5.0)**

```powershell
# Windows
irm https://nsh.dev/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://nsh.dev/install.sh | sh
```

Verify with `nsh --version`.

**2. Install Rust**

Use [rustup](https://rustup.rs). On Windows, both MinGW-w64 and MSVC work (match your Rust target). `rusqlite` builds SQLite from bundled sources, so a working C compiler is required.

**3. Open the repository root and start developing.**

## Development

From the repository root:

```powershell
npm run dev        # clean start: stop old host/dev sessions, then nsh dev .
npm run dev:raw    # plain `nsh dev .` (no cleanup)
```

`nsh dev` runs the official native host with TSX hot reload; it compiles the Rust module on first run, and later changes take effect immediately.

**Why `npm run dev` by default:** `nsh dev` takes over the previous dev session by port (recorded in `%LOCALAPPDATA%\nsh\dev-sessions`). If an old host window is still open — or an old packaged `Mend.exe` is running on the desktop (it reads a bundle baked in at build time) — new code looks like it "didn't take effect". `scripts/dev.mjs` first stops `target\debug\nsh-app-*-windows-host.exe`, `.nsh\out\Mend\Mend.exe` and leftover dev servers, then clears the session records and starts a fresh host. Use `--dry-run` to see what would be cleaned up.

The repository's `.cargo/config.toml` pins Cargo build-script temp files to `.cargo/tmp` inside the repo, so Windows cc-rs temp-directory errors no longer block `nsh dev` — no extra setup is needed. That directory ships via `.cargo/tmp/.gitkeep`; if it is accidentally deleted, run `New-Item -ItemType Directory -Force .cargo/tmp` or the script below.

Optional, for faster builds and a consistent session PATH (installs nothing, changes no system settings):

```powershell
. .\scripts\dev-env.ps1   # point CARGO_HOME at the in-repo cache, prefer official nsh on PATH
```

`nsh run .` is no longer the main development entry; use it only for `--target web` / `--target tui` previews.

## Checks and tests

```powershell
nsh check .        # official type check
npm run typecheck  # equivalent TypeScript check (fallback)

nsh test .         # native cargo test + TSX headless tests
cargo test --manifest-path core\Cargo.toml   # crypto / SQLite / backup core tests
```

## Build and package

```powershell
nsh build .                    # output: .nsh/out
nsh package . --target windows # artifacts: Mend/Mend.exe, Mend.zip, Mend-<version>-windows-x86_64.zip, Mend.iss
```

With Inno Setup 6 installed, `nsh package` also produces a `setup.exe` installer (otherwise it only writes `Mend.iss`, which is normal). Packaging needs no signing key. To publish an official release, push a `v*` tag and `.github/workflows/release.yml` builds and publishes a GitHub Release automatically.

Equivalent npm scripts are available in `package.json`: `dev` / `build` / `package` / `test` / `check` / `typecheck`.

**VS Code**: the repo includes `.vscode/tasks.json` covering development, checks, tests, packaging and formatting — pick one from `Terminal → Run Task`.

## Project structure

- `App.tsx`: app entry (boot → setup / unlock → main).
- `screens/`: UnlockScreen, MainScreen and other screens.
- `components/`: native UI components (list, detail, editor, settings, etc.).
- `lib/`: native wrappers, state, errors, formatting, preferences.
- `native/`: nsh native module (`mend/native`), wrapping core and file operations.
- `core/`: `mend-core`, GUI-free Rust core (SQLite + Argon2id + XChaCha20-Poly1305).
- `locales/`: English and Chinese strings (`en.json`, `zh-CN.json`).

Also `nsh.json` (app metadata and `rust: native` declaration), `theme.json` (design tokens) and `assets/`.

## Data and backup

- Data directory: `%APPDATA%\com.mend.app` on Windows (`~/Library/Application Support/com.mend.app` on macOS, `$XDG_DATA_HOME/com.mend.app` on Linux); viewable in the app's Settings.
- The vault is a single file, `mend.db`; sensitive fields are encrypted in Rust before being written to SQLite.
- Backups are encrypted `mend-backup-*.mendbak` files: export writes into the data directory, restore reads through the system file picker.
- Fully compatible with the old Tauri version: app id, vault name, schema, crypto parameters and backup format are unchanged, so old vaults and backups open directly with no migration.

## Documentation

- [`AGENTS.md`](./AGENTS.md): rules and hard constraints for agents / developers.
- [`docs/11-native-shell.md`](./docs/11-native-shell.md): source of truth for the current architecture after the 0.4.0 rewrite.
- `docs/01`–`10`: historical design records; their Tauri / Vue / WebView sections are obsolete — treat `docs/11` and `AGENTS.md` as authoritative.

## License

[MIT](./LICENSE)
