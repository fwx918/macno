# Building macno

macno is an Electron app, packaged with [electron-builder](https://www.electron.build/).

## Quick build (Windows)

```powershell
npm install
npm run build:win
```

Output appears in `release/`:
- `macno-x.y.z-win-x64.exe` — NSIS installer (defaults to `C:\Program Files\macno`, user can choose folder)
- `macno-x.y.z-portable.exe` — portable, no installation needed

## If electron-builder download is slow (China network)

Set mirrors before building:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build:win
```

The `electronDownload.mirror` in `package.json` already handles the Electron binary;
the env vars above cover electron-builder's own tools (NSIS, winCodeSign).

### winCodeSign symlink issue

On Windows without Developer Mode enabled, extracting `winCodeSign-2.6.0.7z` may
fail with "Cannot create symbolic link" errors. Fix: pre-extract it yourself,
skipping the macOS-only `darwin/` folder:

```powershell
$z   = "node_modules\7zip-bin\win\x64\7za.exe"
$arc = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0.7z"
$out = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
& $z x $arc "-o$out" -y '-x!darwin'
```

Then re-run `npm run build:win`.

### Running the installer

The built `.exe` is in `release/`. **Do not run it directly from an iCloud Drive
folder** — iCloud may leave it as a placeholder (reparse point) that silently
fails. Copy it to a plain local path first:

```powershell
Copy-Item "release\macno-*.exe" "$env:USERPROFILE\Downloads\"
```

Then run from `Downloads`.

## Icons

Icons are generated from `assets/icon.svg`:

```powershell
npm run make-icons
```

This writes `assets/icon.ico` (Windows) and `assets/icon.png`. Edit
`assets/icon.svg` and re-run to update the icon.

## GitHub Actions (automated cloud build)

Pushing a version tag triggers an automated Windows build and publishes the
`.exe` files to GitHub Releases:

```powershell
git tag v1.1.0
git push origin v1.1.0
```

See `.github/workflows/build.yml`.
