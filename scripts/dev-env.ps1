# 开发环境初始化：每个新 PowerShell 会话在仓库根目录先执行：
#   .\scripts\dev-env.ps1
#
# 作用：把 Rust/cargo、MinGW-w64 (gcc/ld/dlltool)、git、gh 加入当前会话 PATH。
# 这些工具默认不在系统 PATH，不修改系统环境变量。

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$mingwBin = Join-Path $env:USERPROFILE "tools\msys64\mingw64\bin"
$gitBin = "C:\Program Files\Git\cmd"
$gitUsrBin = "C:\Program Files\Git\usr\bin"
$ghBin = "C:\Program Files\GitHub CLI"
$nshBin = Join-Path $PSScriptRoot "..\.tools\nsh\bin"

$env:PATH = "$cargoBin;$mingwBin;$gitBin;$gitUsrBin;$ghBin;$env:PATH"
if (Test-Path $nshBin) { $env:PATH = "$nshBin;$env:PATH" }

Write-Host "[dev-env] PATH initialized"
rustc --version
cargo --version
gcc --version | Select-Object -First 1
git --version
