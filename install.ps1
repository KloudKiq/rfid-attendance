# RFID Attendance - Windows Installer
# Run as Administrator: Right-click -> "Run with PowerShell"
# Or: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$InstallDir = "$env:USERPROFILE\rfid-attendance",
    [string]$AdminUser  = "admin",
    [string]$AdminPass  = "admin123",
    [int]$Port          = 3000
)

$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Red; exit 1 }

Clear-Host
Write-Host "================================================" -ForegroundColor Blue
Write-Host "   RFID Attendance System - Windows Installer   " -ForegroundColor Blue
Write-Host "================================================" -ForegroundColor Blue

# ── 1. Elevation check ──────────────────────────────────────────────────────
Write-Step "Checking administrator privileges"
if (-not ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(`
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "`n  Re-launching as Administrator..." -ForegroundColor Yellow
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}
Write-OK "Running as Administrator"

# ── 2. Node.js ───────────────────────────────────────────────────────────────
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVer = (node --version)
    Write-OK "Node.js $nodeVer already installed"
} else {
    Write-Host "    Installing Node.js via winget..." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    } else {
        # Fallback: download LTS installer
        $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        $nodeMsi = "$env:TEMP\node-installer.msi"
        Write-Host "    Downloading Node.js LTS..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn" -Wait
        Remove-Item $nodeMsi -Force
    }
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Fail "Node.js install failed. Install manually from https://nodejs.org then re-run." }
    Write-OK "Node.js $(node --version) installed"
}

# ── 3. Git (optional, for clone) ─────────────────────────────────────────────
Write-Step "Checking Git"
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "    Installing Git via winget..." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH","User")
    } else {
        Write-Host "    Git not found and winget unavailable." -ForegroundColor Yellow
        Write-Host "    Download Git from https://git-scm.com/download/win" -ForegroundColor Yellow
    }
}
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Write-OK "Git $(git --version)" } else { Write-OK "Git not available — will use ZIP download" }

# ── 4. Download / update app ─────────────────────────────────────────────────
Write-Step "Installing app to $InstallDir"

if (Test-Path "$InstallDir\.git") {
    Write-Host "    Existing install found — pulling latest..." -ForegroundColor Yellow
    Push-Location $InstallDir
    git pull --quiet
    Pop-Location
    Write-OK "Updated"
} elseif ($git) {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    git clone https://github.com/KloudKiq/rfid-attendance.git $InstallDir --quiet
    Write-OK "Cloned from GitHub"
} else {
    # Fallback: download ZIP
    $zipUrl = "https://github.com/KloudKiq/rfid-attendance/archive/refs/heads/main.zip"
    $zipFile = "$env:TEMP\rfid-attendance.zip"
    Write-Host "    Downloading ZIP from GitHub..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Expand-Archive -Path $zipFile -DestinationPath "$env:TEMP\rfid-extract" -Force
    Move-Item "$env:TEMP\rfid-extract\rfid-attendance-main" $InstallDir
    Remove-Item $zipFile, "$env:TEMP\rfid-extract" -Recurse -Force
    Write-OK "Downloaded and extracted"
}

# ── 5. npm install ────────────────────────────────────────────────────────────
Write-Step "Installing dependencies"
Push-Location $InstallDir
npm install --omit=dev --silent
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed" }
Pop-Location
Write-OK "Dependencies installed"

# ── 6. Write .env ─────────────────────────────────────────────────────────────
Write-Step "Writing configuration"
$sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
@"
ADMIN_USER=$AdminUser
ADMIN_PASS=$AdminPass
PORT=$Port
SESSION_SECRET=$sessionSecret
"@ | Set-Content "$InstallDir\.env" -Encoding UTF8
Write-OK ".env written (admin: $AdminUser / $AdminPass)"

# ── 7. Create Windows Service via NSSM ────────────────────────────────────────
Write-Step "Setting up Windows Service"
$nssmPath = "$InstallDir\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Host "    Downloading NSSM service manager..." -ForegroundColor Yellow
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $nssmZip = "$env:TEMP\nssm.zip"
    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing -TimeoutSec 15
        Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm-extract" -Force
        $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" |
                   Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
        if (-not $nssmExe) {
            $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" | Select-Object -First 1
        }
        Copy-Item $nssmExe.FullName $nssmPath
        Remove-Item $nssmZip, "$env:TEMP\nssm-extract" -Recurse -Force
    } catch {
        Write-Host "    NSSM download failed — will create startup shortcut instead" -ForegroundColor Yellow
        $nssmPath = $null
    }
}

$serviceName = "RFIDAttendance"
if ($nssmPath -and (Test-Path $nssmPath)) {
    # Remove existing service if present
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existing) {
        & $nssmPath stop $serviceName confirm 2>$null
        & $nssmPath remove $serviceName confirm 2>$null
    }
    $nodePath = (Get-Command node).Source
    & $nssmPath install $serviceName $nodePath "server.js"
    & $nssmPath set $serviceName AppDirectory $InstallDir
    & $nssmPath set $serviceName AppEnvironmentExtra "ADMIN_USER=$AdminUser" "ADMIN_PASS=$AdminPass" "PORT=$Port" "SESSION_SECRET=$sessionSecret"
    & $nssmPath set $serviceName Start SERVICE_AUTO_START
    & $nssmPath set $serviceName AppStdout "$InstallDir\logs\service.log"
    & $nssmPath set $serviceName AppStderr "$InstallDir\logs\service-error.log"
    New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null
    Start-Service -Name $serviceName
    Write-OK "Windows Service '$serviceName' installed and started (auto-start on boot)"
} else {
    # Fallback: startup shortcut
    $startupFolder = [System.Environment]::GetFolderPath("Startup")
    $shortcutPath  = "$startupFolder\RFID Attendance.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $sc  = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath       = (Get-Command node).Source
    $sc.Arguments        = "`"$InstallDir\server.js`""
    $sc.WorkingDirectory = $InstallDir
    $sc.WindowStyle      = 7   # minimized
    $sc.Save()
    Write-OK "Startup shortcut created (runs on login)"
    # Start now
    Start-Process node -ArgumentList "`"$InstallDir\server.js`"" -WorkingDirectory $InstallDir -WindowStyle Hidden
    Write-OK "Server started"
}

# ── 8. Firewall rule ──────────────────────────────────────────────────────────
Write-Step "Adding firewall rule"
$ruleName = "RFID Attendance HTTP"
netsh advfirewall firewall delete rule name="$ruleName" 2>$null | Out-Null
netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$Port | Out-Null
Write-OK "Firewall rule added for port $Port"

# ── 9. Desktop shortcut ───────────────────────────────────────────────────────
Write-Step "Creating desktop shortcuts"
$wsh     = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath("CommonDesktopDirectory")

foreach ($page in @(
    @{ Name="RFID Attendance - Kiosk";  URL="http://localhost:$Port/" },
    @{ Name="RFID Attendance - Admin";  URL="http://localhost:$Port/admin.html" }
)) {
    $sc = $wsh.CreateShortcut("$desktop\$($page.Name).url")
    $sc.TargetPath = $page.URL
    $sc.Save()
}
Write-OK "Desktop shortcuts created"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "   Installation Complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Kiosk  ->  http://localhost:$Port/"           -ForegroundColor White
Write-Host "  Admin  ->  http://localhost:$Port/admin.html" -ForegroundColor White
Write-Host "  Login  ->  $AdminUser / $AdminPass"           -ForegroundColor White
Write-Host ""
Write-Host "  Change password after first login!" -ForegroundColor Yellow
Write-Host ""

# Open browser
Start-Process "http://localhost:$Port/"
Read-Host "Press Enter to close"
