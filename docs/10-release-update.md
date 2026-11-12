# 10 · 自动发布与自动更新

> 本文件沉淀 GitHub 自动发布（CI 出包）+ 软件自动更新（Tauri updater）的规则与操作流程。
> 与 `08-roadmap.md` 的"CI / 自动更新"条目对应，实现于 2026-11-12。

## 1. 目标

- **自动发布**：打版本 tag 后自动构建 Windows NSIS 安装包并发布到 GitHub Release（含 `latest.json` 与签名）。
- **自动更新**：应用按用户设定的间隔（每周 / 每月 / 每年）在启动时检查 GitHub 是否有新版本，有则弹窗提醒，可一键下载安装。

## 2. 自动发布（GitHub Actions）

### 2.1 工作流

- `.github/workflows/ci.yml`：PR / push 时跑 **核心测试**（Ubuntu + `cargo test --manifest-path src-tauri/core/Cargo.toml`）与 **前端类型检查 + 构建**（Ubuntu）。本机只做验证，不打包。
- `.github/workflows/release.yml`：推送 `v*` tag（或手动 `workflow_dispatch`）时，在 `windows-latest` 上用 `tauri-apps/tauri-action` 构建 NSIS 安装包并发布 Release。
  - 仅在 Windows 构建：NSIS 目标在 Linux/macOS 上不可用，所以打包与发布都在 Windows runner 完成。
  - `releaseDraft: false`：直接发布（非草稿），否则 updater 的 `releases/latest/download/latest.json` 无法访问到。如需先人工复核，可临时改 `true`，复核后再在 GitHub 上发布。

### 2.2 一次性前置（已配置）

- **签名私钥**：`local/mend-updater.key`（已被 `.gitignore` 忽略，**切勿提交**）。
- **公钥**：已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- **密钥轮换**：若丢失私钥需重新生成（`node node_modules/@tauri-apps/cli/tauri.js signer generate -w local/mend-updater.key --ci`），并把公钥更新到 `tauri.conf.json`、私钥重新设为仓库 Secret。注意：换私钥后，已安装旧版的用户将无法验证新签名，需手动重装。

### 2.3 发版步骤（每次发版照做）

1. 本地把版本号在三处改成同一值（如 `0.3.0`）：
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `version`
2. 提交并推送 `main`：`git commit -am "chore: release v0.3.0" && git push origin main`
3. 打 tag 并推送：`git tag v0.3.0 && git push origin v0.3.0`
4. 在 GitHub Actions 观察 `Release` 工作流；成功后到 Releases 页确认安装包、`*.sig`、`latest.json` 已发布。
5. 在已安装旧版的应用里验证：启动 → 若到了检查间隔会提示更新；或在设置弹窗"立即检查更新"。

> tag 名必须与版本号对应（`v` + 版本号），`release.yml` 的 `tagName` 直接使用 `github.ref_name`。

## 3. 自动更新（Tauri updater）

### 3.1 数据源（当前：GitHub Releases）

- `tauri.conf.json` 的 `plugins.updater.endpoints` 指向
  `https://github.com/buzzyaaa/Mend/releases/latest/download/latest.json`。
- `bundle.createUpdaterArtifacts: true`：构建时生成 updater 用的安装包与 `.sig`。
- `plugins.updater.windows.installMode: "passive"`：更新时显示进度条、无需用户交互；安装完应用自动退出并重启。
- 签名校验强制开启（Tauri 不可关闭），由 `pubkey` + 构建期私钥保证。

### 3.2 检查节奏（用户可配）

- 偏好 `updateCheckIntervalDays`：7（每周）/ 30（每月）/ 365（每年），默认 7，存 `localStorage`。
- 偏好 `lastUpdateCheckTs`：上次检查时间戳，用于按间隔节流提醒（不论有无更新都刷新，避免频繁打扰）。
- 自动检查：应用启动（`src/components/UpdateChecker.vue`）调用 `useUpdateChecker`，按间隔到期才查。
- 手动检查：设置弹窗"立即检查更新"按钮（`SettingsDialog`）。

### 3.3 抽象层与"未来替换接口"

- 所有更新逻辑收敛在 **`src/lib/update.ts`** 的 `UpdateProvider` 接口之后：
  - `check(): Promise<AppUpdate | null>` 与 `install()`。
  - 当前实现 `GithubUpdateProvider` 基于 `@tauri-apps/plugin-updater`。
- **替换数据源的两种方式**（按需求选）：
  1. 仅换地址（仍沿用 GitHub `latest.json` 格式）：直接改 `tauri.conf.json` 的 `endpoints`，无需动代码。
  2. 换成完全不同的协议（自建服务器 / 内网分发）：实现一个新的 `UpdateProvider`（用 `fetch` 拉版本信息并下载安装包），只改 `getUpdateProvider()` 一行，UI 与调度逻辑（`useUpdateChecker`）完全不用改。
- 这样满足"目前用 GitHub，预留接口方便未来替换"。

### 3.4 已知限制与约定

- **未做代码签名**：当前安装包没有 Authenticode 签名，Windows SmartScreen 会报"未知发布者"警告，用户需手动允许。这是已知的可用性问题，不影响更新逻辑；后续若有代码签名证书，把 `TAURI_SIGNING_PRIVATE_KEY` 与证书相关步骤接入即可。
- **离线优先原则**：更新检查是用户显式开启/可调的网络行为，不违反"默认零网络请求"——未到检查间隔或用户关闭/未安装时不会发起请求；且检查只读取公开的 `latest.json`，不上传任何数据。
- **回退**：用户可在设置弹窗把检查频率设为"每年"以降低打扰；也可始终手动检查。
