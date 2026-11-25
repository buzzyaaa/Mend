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
   - Windows：VS Build Tools + Rust（默认目标即可）。`nsh package --target windows` 除 zip 外还会生成 Inno Setup 脚本 `Mend.iss`，并在检测到 `ISCC.exe` 时编译出 `Mend-setup.exe`。CI 先探测 Inno Setup 6，缺失则用 `choco install innosetup` 兜底；随后用 `scripts/patch-installer.mjs` 给 `Mend.iss` 打补丁（输出名改为 **`Mend-<version>-setup.exe`**，加入 `[Languages]` 的 `en` / `zh` 与 `ShowLanguageDialog=yes`、`LanguageDetectionMethod=uilanguage`、`UsePreviousLanguage=yes`），再用 ISCC 重编译。最终安装器为当前用户级、双击原地覆盖升级，保留 `%APPDATA%\com.mend.app` 的数据，并作为独立 artifact 上传。
   - Linux：安装 `libgtk-4-dev clang libwebkitgtk-6.0-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev`。
   - macOS：`rustup target add aarch64-apple-darwin x86_64-apple-darwin`。
2. **ot-package**：在 Windows 上运行 `nsh publish`，用 `NSH_RELEASE_KEY` / `NSH_RELEASE_CERT` 签名，产出 `dist/com.mend.app-<build>.nshpkg`。
3. **manifest**：下载全部产物，用 `NSH_UPDATE_KEY` 运行 `nsh update-manifest`，生成带签名的 `dist/latest.json` 与 `latest.json.sig`。归档 glob 只收 `*.zip` / `*.tar.gz`，`Mend-<version>-setup.exe` 不进清单——`latest.json` 的 Windows 平台资产仍指向 zip（nsh updater 只接受 zip/tar.gz）。
4. **publish**：用 `softprops/action-gh-release` 把平台包、安装器（`Mend-<version>-setup.exe`）、OTA 包、`latest.json`、`latest.json.sig` 上传到该 tag 的 GitHub Release；`cnb-sync` 同步同一份列表到 CNB。

版本与构建号：`nsh package` / `nsh publish` 使用 tag 版本（去掉前缀 `v`）和 `github.run_number` 作为构建号；同一发布的整包与 OTA 包使用相同构建号。

**安装器与自动更新是两条独立通道**：zip/清单服务于应用内自动更新；`Mend-<version>-setup.exe` 只是给「想装成正式应用（开始菜单、已安装应用条目）」的用户一个额外下载选项，双击即可原地升级旧安装。安装器未做 Authenticode 签名，Windows SmartScreen 会提示「未知发布者」，属已知限制。

**安装/卸载语言**：安装第一步是「选择安装语言 / Select Language」（English、简体中文），默认按 Windows 系统界面语言预选；升级安装沿用上次所选语言。卸载向导使用安装时记录的语言，与应用内语言偏好无关。便携 zip 里的 `Mend.exe` 保持固定文件名，避免自动更新与快捷方式失效；带版本号的是安装器文件名。

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

OTA 代码包运行时，版本卡如实分两行显示「外壳版本」与「正在运行代码包」（标题栏显示后者，即用户真正运行的代码版本）。当检测到代码包构建号高于外壳（外壳落后）时：版本卡加提示说明部分新功能暂不可用；「检查更新」跳过 OTA 包直接查整包，引导用户装完整包把外壳升上来；依赖新原生层的开关（如开机自启）在旧外壳上禁用并说明原因。原生能力探测用 `native.autoStartAvailable()`（`typeof Vault.autoStartEnabled === 'function'`），避免旧外壳缺方法时抛错。

## 8. 注意事项

- 每次发布都要提高构建号；旧构建号的包会被拒绝（回滚保护）。
- GitHub 上 draft 或 prerelease 的 Release 不会被应用更新器读取。
- OTA 包受 `minRuntime` 限制：较旧运行时会拒绝需要新运行时的包。默认 `minRuntime` 为发布所用 nsh 版本；当前使用 0.5.0。
- **OTA 只换代码包，不换外壳（含 Rust 原生层）**。`minRuntime` 比的是 nsh 运行时版本，不是应用构建号；`checkForPackage` 也只比构建号与 `minRuntime`，不检查外壳版本下限。因此凡是新增/改动了 `native/` 的能力（如 0.6.3 的开机自启），只发 OTA 包会让用户停在「新代码 + 旧外壳」的组合，新方法调用直接失败。客户端侧用 `shellOutdated()`（`runningPackage().build > shellInfo().build`）识别这种状态：检查更新时跳过 OTA 包改推整包，设置页版本卡提示需装完整包，依赖新原生方法的开关禁用。**发版含原生层变更时，务必确保整包可用**，不要指望 OTA 覆盖外壳。
- 证书默认 365 天，到期前需重新 `nsh certify` 并更新 `NSH_RELEASE_CERT`。
- 若发布密钥泄露，用 `nsh revoke` 签发吊销列表并重新发布。

## 9. CNB 下载镜像

GitHub 是唯一构建源与更新源；CNB（`cnb.cool/smybxg/Mend`）只做代码与 Release 产物镜像，供国内下载。nsh updater 是单源配置（`github` 或 `url`），没有双源竞速，不做「哪个快用哪个」。

- **代码同步**：本地 `origin` 配双 pushurl（GitHub SSH + CNB HTTPS），`git push origin` 一次推两边。部分网络下 CNB SSH 22 端口不可达，统一走 HTTPS + 访问令牌。
- **产物同步**：`release.yml` 的 `cnb-sync` job 在 GitHub Release 发布后运行 `scripts/sync-cnb-release.mjs`，用 `CNB_TOKEN` secret 调 CNB Open API（`api.cnb.cool`）：按 tag 复用或创建 Release → 逐文件取上传地址 → PUT → 确认（`ttl=0` 永久、同名覆盖）。
- **附件直链**：`https://cnb.cool/smybxg/Mend/-/releases/download/<tag>/<filename>`。将来若要把 OTA/更新源切到国内，可改 `updater` 为 `"url"` 模式指向 CNB 上的 `latest.json`，并用 `nsh update-manifest --base-url` 生成指向 CNB 直链的清单（当前未启用）。
- **不在 CNB 重复构建**：CNB 官方构建节点只有 Linux Docker；Windows/macOS 需根组织自托管 Runner。三平台构建与签名全部留在 GitHub Actions。

## 10. 更新网络与代理

更新检查与下载走 nsh 引擎的 `fetch`（ureq）。ureq 的代理只认环境变量
`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（`Proxy::try_from_env`），不读 Windows
「系统代理」（WinINET 注册表）——nsh 未启用 ureq 的 `win-system-proxy` feature。
因此只开「系统代理」模式的代理软件对更新器不可见，会直连 GitHub 超时
（`timeout: connect`）。

- **系统代理注入**（Windows）：`native/src/system_proxy.rs` 在 `Vault.init` 首行、
  任何 fetch 之前读一次 `HKCU\...\Internet Settings` 的
  `ProxyEnable` / `ProxyServer` / `ProxyOverride`，翻译成上述环境变量补写进进程。
  单一 `host:port` 形式同时给 HTTP/HTTPS；分协议形式只取 `http=` / `https=`；
  `ProxyOverride` 的分号换逗号作 `NO_PROXY`。**已存在的环境变量优先，不覆盖。**
- **不支持**：PAC（`AutoConfigURL`）与纯 SOCKS 代理（ureq 未开 socks feature）；
  这两类场景用代理软件的 TUN 模式，或显式设 `HTTPS_PROXY` 环境变量。
- **国内兜底**：不走代理也可从 CNB 镜像手动下载整包（§9），库数据不受影响。
