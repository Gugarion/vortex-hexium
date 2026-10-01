# Copies the Hexium extension into Vortex's plugins folder. Restart Vortex afterwards.
$src = $PSScriptRoot
$dst = Join-Path $env:APPDATA 'Vortex\plugins\Hexium'
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src 'index.js'), (Join-Path $src 'info.json') $dst -Force
Write-Output "Installed to $dst - restart Vortex to load it."
