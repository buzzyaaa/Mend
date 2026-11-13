# 10 · 发布、应用更新与 OTA（0.4.0 / Native Shell）

> 0.4.0 已移除 Tauri，发布与更新改为 Native Shell 的 `nsh package`、`nsh publish`、`nsh update-manifest`。
> 应用更新（整包替换）与 OTA（TSX 签名包）共用 `nsh.json` 的 `"updater"` 配置与同一份 `latest.json`。

## 1. 更新模型

- **应用更新**：检查并下载平台压缩包（Windows zip、Linux/macOS tar.gz），替换应用并重启。`checkForUpdate` / `downloadUpdate` / `installAndRestart`。
- **OTA 更新**：只下发签名包（`.nshpkg`，内容为 TSX + 资源），应用下次启动时运行。`checkForPackage` / `downloadPackage` / `restartToPackage`。
- 发布清单时可以同时包含两者：应用先检查包，再检查整包。界面在设置里按顺序检查并显示可用更新。
- 校验：清单签名、应用 id、版本只升不降、HTTPS、压缩包大小与 SHA-256、包签名与根证书、构建号（回滚保护）。

## 2. 一次性密钥配置

```sh
nsh keygen keys/root      # 根密钥，离线保管 root.secret
nsh keygen keys/release   # 发布密钥，CI 持有 release.secret
nsh keygen keys/update    # 清单密钥，CI 持有 update.secret
nsh certify --root keys/root.secret --key keys/release.pub \
  --apps com.mend.app -o keys/release.cert
```

- 仓库只提交 `keys/root.pub`、`keys/release.pub`、`keys/release.cert`、`keys/update.pub`。
- 私钥在 `keys/*.secret`（被 `.gitignore` 忽略）或 GitHub Actions secrets 中，不入库。
- 根密钥私钥离线保管；泄露即等于所有已装应用信任该根。

`nsh.json` 写入更新来源与信任根：

```json
{
  "id": "com.mend.app",
  "version": "0.4.0",
  "build": 1,
  "updater": {
    "github": "buzzyaaa/Mend",
    "publicKey": "<keys/update.pub 的内容>",
    "packages": { "roots": ["<keys/root.pub 的内容>"] }
  }
}
```

## 3. GitHub Actions 密钥

在仓库 Settings → Secrets and variables → Actions 添加：

- `NSH_RELEASE_KEY`：`keys/release.secret` 的内容
- `NSH_RELEASE_CERT`：`keys/release.cert` 的内容（也可只提交 cert，工作流直接使用仓库文件）
- `NSH_UPDATE_KEY`：`keys/update.secret` 的内容

## 4. CI（`ci.yml`）

- `core-test`：`cargo test --manifest-path core/Cargo.toml`。
- `native-check`：`cargo check --manifest-path native/Cargo.toml`。
- `app-check`：安装 nsh，`nsh check .` 与 `nsh test .`。

## 5. 发布流程（`release.yml`）

打 `v*` tag 或手动触发：

1. **package**：矩阵构建 Windows / Linux / macOS 平台压缩包，上传 artifact。
   - Windows：VS Build Tools + Rust（默认目标即可）。
   - Linux：安装 `libgtk-4-dev clang libwebkitgtk-6.0-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev`。
   - macOS：`rustup target add aarch64-apple-darwin x86_64-apple-darwin`。
2. **ot-package**：在 Windows 上运行 `nsh publish`，用 `NSH_RELEASE_KEY` / `NSH_RELEASE_CERT` 签名，产出 `dist/com.mend.app-<build>.nshpkg`。
3. **manifest**：下载全部产物，用 `NSH_UPDATE_KEY` 运行 `nsh update-manifest`，生成带签名的 `dist/latest.json` 与 `latest.json.sig`。
4. **publish**：用 `softprops/action-gh-release` 把平台包、OTA 包、`latest.json`、`latest.json.sig` 上传到该 tag 的 GitHub Release。

版本与构建号：`nsh package` / `nsh publish` 使用 tag 版本（去掉前缀 `v`）和 `github.run_number` 作为构建号；同一发布的整包与 OTA 包使用相同构建号。

## 6. 手动发布（本地）

```powershell
nsh package . --target windows --app-version 0.4.1 --build 2 -o dist\windows
nsh publish . --key local\keys\release.secret --cert keys\release.cert \
  --app-version 0.4.1 --build 2 --source-map file -o dist\com.mend.app-2.nshpkg
nsh update-manifest dist\windows\*.zip \
  --package dist\com.mend.app-2.nshpkg --notes CHANGELOG.md \
  --key local\keys\update.secret -o dist
```

## 7. 应用内界面

设置页“更新”区块：显示当前外壳版本/构建号/运行时，点击“检查更新”；发现 OTA 包时显示版本、构建号与说明，点击“下载并应用代码包”；否则发现整包更新时显示版本与说明，点击“立即更新”。下载进度用进度条展示；失败显示错误。

## 8. 注意事项

- 每次发布都要提高构建号；旧构建号的包会被拒绝（回滚保护）。
- GitHub 上 draft 或 prerelease 的 Release 不会被应用更新器读取。
- OTA 包受 `minRuntime` 限制：较旧运行时会拒绝需要新运行时的包。默认 `minRuntime` 为发布所用 nsh 版本；当前使用 0.5.0。
- 证书默认 365 天，到期前需重新 `nsh certify` 并更新 `NSH_RELEASE_CERT`。
- 若发布密钥泄露，用 `nsh revoke` 签发吊销列表并重新发布。
