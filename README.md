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

## 🚀 Usage

1. **首次启动**：输入主密码（最短 4 位）创建密码库；主密码不落盘，忘记后无法恢复。
2. **日常使用**：顶部标题栏右侧依次是语言 / 预设值 / 设置 / 锁定四个图标按钮（设置、预设值、语言都是弹窗）；中间分类（全部 / 未分类 / 回收站），右侧条目卡片；每个字段可单独复制，密码可显示/隐藏或现场生成。
3. **删除条目**：先进入回收站，可"恢复"或"彻底删除"；彻底删除不可撤销。
4. **备份**：标题栏「设置」弹窗 → 备份与恢复 → 输入主密码 → 选择保存位置，导出 `.mendbak`（整库密文）。
5. **恢复**：标题栏「设置」弹窗 → 备份与恢复 → 选择备份文件 + 该备份的主密码，确认后覆盖当前库（旧库自动改名留底），随后需重新解锁。
6. **手动迁移**：锁定或退出后，把数据目录里的库文件拷到 U 盘 / 另一台机器；用同一主密码解锁即可。数据目录见设置弹窗。
7. **安全习惯**：设置弹窗可配置空闲自动锁定、检查更新频率与深浅色主题；语言用标题栏右侧的语言按钮切换。

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
