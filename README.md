# 🗝️ Mend
> Mend the gaps of your memory.

A local, offline encrypted password manager.
All data stays on your device, no cloud, no remote server.

一款本地离线加密密码管理器，修补你的记忆缺口。
所有数据仅保存在本机，不上传云端、无远程服务。

## ⚠️ Important Warning
This software is provided "as is", without warranty of any kind.
Please back up your vault file regularly. All risks of use shall be borne by the user.

本软件按现状提供，不附带任何形式担保。
请定期自行备份密码库文件，一切使用风险由使用者自行承担。

## 🛠 Development

> 接手开发前先读 [`AGENTS.md`](./AGENTS.md) 与 [`docs/`](./docs/README.md)。

前置：Node 22+、Rust stable + Windows C 编译器（GNU 目标 + MinGW-w64，见 `docs/09-env-setup.md`）。

每个新 PowerShell 会话先初始化 PATH：

```powershell
.\scripts\dev-env.ps1
```

```bash
npm install        # 安装前端依赖
npm run dev        # 仅前端浏览器预览（Vite, :1420）
npm run build      # 类型检查 + 生产构建到 dist/
npm run tauri dev  # Tauri 桌面开发模式（需 Rust 工具链）
```

技术栈：Tauri 2 + Vue 3 + TypeScript + TailwindCSS + SQLite；详见 `docs/02-tech-decision-ui.md`。

## 📜 License
[MIT License](./LICENSE)
