# 开发环境初始化（可选）：仓库根目录直接 `nsh dev .` 即可开发；本脚本只在需要
# 仓库内 CARGO_HOME 缓存加速、或统一会话 PATH（官方 nsh 优先）时执行：
#   . .\scripts\dev-env.ps1
#
# 作用：把 Rust/cargo、MinGW-w64 (gcc/ld/dlltool)、git、gh，以及官方安装的 nsh
# （%LOCALAPPDATA%\nsh\bin）加入当前会话 PATH，并把 Cargo 缓存指向仓库内的
# .tools/cargo-home。不修改系统环境变量。
#
# 重要：nsh 必须来自官方安装路径（%LOCALAPPDATA%\nsh\bin），不要把仓库内的
# nsh 拷贝放进 PATH（哪怕版本相同）：nsh 以可执行文件自身位置定位 dev session
# 目录，仓库内路径会让 `nsh dev` 必然报
#   create development session directory: 拒绝访问。 (os error 5)
# 官方路径 + 相同环境则一切正常。仓库内的 .tools/nsh 拷贝已删除，本脚本会顺手
# 把当前会话 PATH 里残留的 .tools\nsh\bin 条目清掉（幂等，可安全重复执行）。
#
# 另外把 TMP/TEMP 指到仓库内 .cargo/tmp，并设置 RUSTC_STAGE=1，绕开 Windows 上
# cc-rs 的临时目录权限报错与 proc-macro2 的 probe 清理报错。
# 注意：仓库根 .cargo/config.toml 的 [env] 已把构建脚本 TMP/TEMP 固定到同一目录，
# 所以裸跑 nsh dev 也可以；这里只是让当前会话里的其他工具同样受益。

# 编码约定：本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 对无 BOM 的
# .ps1 按系统 ANSI(GBK) 解码，中文注释会被错切成非法语法（表现为「表达式或语句中
# 包含意外的标记 }」），脚本整体不执行，PATH 也就不会被注入。

# 幂等：同一会话重复 dot-source 时跳过，不重复注入 PATH、不重复打印版本。
if ($env:MEND_DEV_ENV -eq '1') {
  Write-Host '[dev-env] already initialized (skip)'
  return
}

# 约定在仓库根目录执行（见 AGENTS.md），VS Code 任务也会先 Set-Location 到工作区根目录。
# $PWD / $PSScriptRoot 在 dot-source 或 -Command 下可能为空，逐级回退保证路径可用。
$repoRoot = $null
if ($PWD -and $PWD.Path) { $repoRoot = $PWD.Path }
if (-not $repoRoot -and $PSScriptRoot) { $repoRoot = Split-Path -Parent $PSScriptRoot }
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }

# nsh 官方安装路径优先注入（安装方式见 docs/09-env-setup.md），排在最前，
# 保证 `nsh` 一定解析到官方安装而不是其他同名命令。
$nshBin = Join-Path $env:LOCALAPPDATA "nsh\bin"
$nshPathEntry = $null
if (Test-Path $nshBin) { $nshPathEntry = $nshBin }

# 清掉旧会话可能残留的仓库内 nsh 拷贝路径，保证 `nsh` 一定解析到官方安装。
$scrubbed = ($env:PATH -split ';' |
  Where-Object { $_ -and ($_.TrimEnd('\') -notmatch '\.tools[\\/]nsh[\\/]bin$') }) -join ';'
if ($scrubbed -ne $env:PATH) { $env:PATH = $scrubbed }

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$mingwBin = Join-Path $env:USERPROFILE "tools\msys64\mingw64\bin"
$gitBin = "C:\Program Files\Git\cmd"
$gitUsrBin = "C:\Program Files\Git\usr\bin"
$ghBin = "C:\Program Files\GitHub CLI"

if ($nshPathEntry) {
  $env:PATH = "$nshPathEntry;$cargoBin;$mingwBin;$gitBin;$gitUsrBin;$ghBin;$env:PATH"
} else {
  $env:PATH = "$cargoBin;$mingwBin;$gitBin;$gitUsrBin;$ghBin;$env:PATH"
}

# Cargo 缓存与镜像配置固定在仓库内 .tools/cargo-home：
#  1) 这里已缓存 .nsh/rust 所需的全部 crate，避免每次重新下载；
#  2) 绕开本机用户目录 .cargo 写入被拒（os error 5）的问题。
# VS Code 任务已在 options.env 显式设置 CARGO_HOME，此处只做普通终端兜底。
# 可执行文件仍取自 %USERPROFILE%\.cargo\bin，CARGO_HOME 不改变 rustup 位置。
if (-not $env:CARGO_HOME -and $repoRoot) {
  $cargoHome = Join-Path $repoRoot ".tools\cargo-home"
  if (-not (Test-Path $cargoHome)) { New-Item -ItemType Directory -Force $cargoHome | Out-Null }
  $env:CARGO_HOME = [IO.Path]::GetFullPath($cargoHome)
}

# 临时目录固定在仓库内 .cargo/tmp：cc-rs（ring、rusqlite 等）在 %LOCALAPPDATA%\Temp
# 建临时文件偶被拒绝（Cannot create temporary file ... Permission denied，gcc 退出码 3）。
if ($repoRoot) {
  $tmpDir = Join-Path $repoRoot ".cargo\tmp"
  if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Force $tmpDir | Out-Null }
  $env:TMP = [IO.Path]::GetFullPath($tmpDir)
  $env:TEMP = $env:TMP
}

# proc-macro2 的 build script 会在 OUT_DIR\probe 里跑一次 rustc 探测、随后删除该目录，
# Windows 上常报「目录不是空的。(os error 145)」并直接中止整次编译。
# proc-macro2 自带 RUSTC_STAGE 分支：变量存在即跳过探测并视为成功，设上即可稳定编译。
# （仅影响 proc-macro2 的探测结果，不影响 rustc 版本判断与产物。）
$env:RUSTC_STAGE = '1'

$env:MEND_DEV_ENV = '1'

Write-Host "[dev-env] PATH initialized (nsh=$(if ($nshPathEntry) { $nshPathEntry } else { '<not installed>' }), CARGO_HOME=$env:CARGO_HOME, TMP=$env:TMP)"
rustc --version
cargo --version
nsh --version
gcc --version | Select-Object -First 1
git --version
