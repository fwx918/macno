# macno launcher
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronExe = Join-Path $dir "node_modules\electron\dist\electron.exe"
Start-Process -FilePath $electronExe -ArgumentList $dir -WorkingDirectory $dir
