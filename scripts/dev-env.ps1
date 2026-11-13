# 开发环境初始化：每个新 PowerShell 会话在仓库根目录先执行：
#   .\scripts\dev-env.ps1
#
# 作用：把 Rust/cargo、MinGW-w64 (gcc/ld/dlltool)、git、gh 加入当前会话 PATH，
# 并把 Cargo 缓存指向仓库内的 .tools/cargo-home。不修改系统环境变量。

# 约定在仓库根目录执行（见 AGENTS.md），VS Code 任务也会先 Set-Location 到工作区根目录。
$repoRoot = $PWD.Path

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$mingwBin = Join-Path $env:USERPROFILE "tools\msys64\mingw64\bin"
$gitBin = "C:\Program Files\Git\cmd"
$gitUsrBin = "C:\Program Files\Git\usr\bin"
$ghBin = "C:\Program Files\GitHub CLI"

$env:PATH = "$cargoBin;$mingwBin;$gitBin;$gitUsrBin;$ghBin;$env:PATH"

if ($repoRoot) {
  $nshBin = Join-Path $repoRoot ".tools\nsh\bin"
  if (Test-Path $nshBin) { $env:PATH = "$nshBin;$env:PATH" }
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

Write-Host "[dev-env] PATH initialized (CARGO_HOME=$env:CARGO_HOME)"
rustc --version
cargo --version
gcc --version | Select-Object -First 1
git --version
