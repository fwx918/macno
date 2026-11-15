param(
  [Parameter(Mandatory)][string]$Version,
  [string]$PackageDirectory = 'release',
  [string]$UpgradeInstaller,
  [switch]$PortableOnly
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$installer = Join-Path $packageRoot "macno-$Version-win-x64.exe"
$portable = Join-Path $packageRoot "macno-$Version-portable.exe"
foreach ($file in @($installer, $portable)) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing package $file" }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('macno-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
function Test-App($executable, $name) {
  node "$PSScriptRoot/smoke-package.js" $executable (Join-Path $fixture $name)
  if ($LASTEXITCODE -ne 0) { throw "Smoke test failed for $name" }
}
function Install-App($executable, $directory) {
  $process = Start-Process -FilePath $executable -ArgumentList "/S /D=$directory" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)" }
}
function Uninstall-App($directory) {
  $uninstaller = Get-ChildItem -LiteralPath $directory -Filter 'Uninstall*.exe' | Select-Object -First 1
  if (!$uninstaller) { throw 'The installation did not include an uninstaller.' }
  $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstaller failed with exit code $($process.ExitCode)" }
}

Test-App $portable 'portable'
if (!$PortableOnly) {
  $installDir = Join-Path $fixture 'installed'
  Install-App $installer $installDir
  Test-App (Join-Path $installDir 'macno.exe') 'installed-profile'
  if ($UpgradeInstaller) {
    Uninstall-App $installDir
    $upgradeDir = Join-Path $fixture 'upgraded'
    Install-App (Resolve-Path -LiteralPath $UpgradeInstaller).Path $upgradeDir
    Install-App $installer $upgradeDir
    Test-App (Join-Path $upgradeDir 'macno.exe') 'upgraded-profile'
  }
}
@($installer, $portable) | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $(Split-Path -Leaf $_)"
} | Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt') -Encoding ascii
