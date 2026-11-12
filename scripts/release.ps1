# =============================================================
# scripts/release.ps1 — Mend 发版脚本（同步三处版本号，可一键提交/打 tag/推送）
#
# 用法：
#   .\scripts\release.ps1 -Version '0.4.0'          # 只改三处 version 字段并打印确认，不动 git
#   .\scripts\release.ps1 -Version '0.4.0' -Tag     # 改完后 git commit -am + git tag v0.4.0
#                                                    # + git push origin main + 推送 tag
#
# 说明：
#   - 版本号必须匹配 ^\d+\.\d+\.\d+$（如 0.4.0）。
#   - 三处版本号（package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml）
#     用正则精确替换各自的 version 行（每个文件只替换第一处匹配），不引入 JSON 库依赖。
#   - 默认不加 -Tag：只改文件并打印后续手动命令，便于先本地验证再提交。
#   - 打完 tag 推送后由 .github/workflows/release.yml 自动构建并发布 GitHub Release。
#   - 详细流程见 docs/10-release-update.md §2.3。
#   - 本文件请保持 UTF-8 with BOM 保存（Windows PowerShell 5.1 按 ANSI 解码无 BOM 文件会乱码）。
# =============================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$Tag
)

$ErrorActionPreference = 'Stop'

# --- 1. 校验版本号格式 ---
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "版本号格式非法：'$Version'（要求 X.Y.Z，如 0.4.0）" -ForegroundColor Red
    exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    # --- 2. 三处 version 字段的正则替换（只替换文件中第一处 version 行） ---
    # 模式用双引号构造（[regex]::Escape 保护字面量部分），避免嵌套引号让编辑器误判语法
    $dq = [char]34 # 双引号字符
    $patJson  = '(?m)^(\s*' + $dq + 'version' + $dq + '\s*:\s*)' + $dq + '[^"' + $dq + ']*' + $dq
    $patToml  = '(?m)^(version\s*=\s*)' + $dq + '[^"' + $dq + ']*' + $dq
    $replJson = '${1}' + $dq + $Version + $dq
    $replToml = '${1}' + $dq + $Version + $dq

    $targets = @(
        @{ Path = 'package.json'; Pattern = $patJson; Repl = $replJson },
        @{ Path = 'src-tauri/tauri.conf.json'; Pattern = $patJson; Repl = $replJson },
        @{ Path = 'src-tauri/Cargo.toml'; Pattern = $patToml; Repl = $replToml }
    )

    foreach ($t in $targets) {
        $file = Join-Path $repoRoot ($t.Path.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path $file)) {
            Write-Host "找不到文件：$($t.Path)" -ForegroundColor Red
            exit 1
        }
        $text = Get-Content -Raw -Encoding UTF8 $file
        if ($text -notmatch $t.Pattern) {
            Write-Host "在 $($t.Path) 中未找到 version 行，未做任何修改。" -ForegroundColor Red
            exit 1
        }
        # 只替换第一处匹配（package 级 version；Cargo.toml 依赖区的 version = 不受影响）
        $rx = [regex]$t.Pattern
        $newText = $rx.Replace($text, $t.Repl, 1)
        # 保持 UTF-8 无 BOM（与现有文件一致）
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($file, $newText, $utf8NoBom)
    }

    # --- 3. 打印三处当前值供确认 ---
    Write-Host "`n已把版本号同步为 $Version，当前三处值：" -ForegroundColor Green
    foreach ($t in $targets) {
        $file = Join-Path $repoRoot ($t.Path.Replace('/', [IO.Path]::DirectorySeparatorChar))
        $line = (Get-Content -Encoding UTF8 $file | Select-String -Pattern 'version' -SimpleMatch | Select-Object -First 1).Line.Trim()
        Write-Host ("  {0,-28} {1}" -f $t.Path, $line)
    }

    # --- 4. git 操作（仅 -Tag 时执行；默认只改文件） ---
    # 注意：PowerShell 变量名不区分大小写，局部名不能叫 $tag（会与 [switch]$Tag 冲突）
    $tagName = "v$Version"
    if ($Tag) {
        git commit -am "chore: release $tagName"
        if ($LASTEXITCODE -ne 0) { throw "git commit 失败" }
        git tag $tagName
        if ($LASTEXITCODE -ne 0) { throw "git tag 失败" }
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push origin main 失败" }
        git push origin $tagName
        if ($LASTEXITCODE -ne 0) { throw "git push origin $tagName 失败" }
        Write-Host "`n已提交并推送 $tagName；到 GitHub Actions 观察 Release 工作流即可。" -ForegroundColor Green
    }
    else {
        Write-Host "`n（未加 -Tag）本次只同步了文件版本号。确认无误后手动执行：" -ForegroundColor Yellow
        Write-Host "  git commit -am `"chore: release $tagName`""
        Write-Host "  git tag $tagName"
        Write-Host "  git push origin main"
        Write-Host "  git push origin $tagName"
        Write-Host "或直接重跑本脚本并加 -Tag。" -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}
