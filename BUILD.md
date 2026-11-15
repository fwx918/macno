# Building macno

macno is an Electron app, packaged with [electron-builder](https://www.electron.build/).

## Quick build (Windows)

```powershell
npm ci
npm test
npm run test:desktop
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

Pull requests and pushes to `main` run the tests and produce Windows x64
candidate packages. Download the `macno-windows-x64` artifact from the run for
the selected commit to check the installer, portable app, and checksums.

After verifying the candidate, tag the selected commit. The tag must match the
version in both package manifests:

```powershell
git tag v1.1.0
git push origin v1.1.0
```

The tag build runs the same tests and package checks, then uploads both
executables and `SHA256SUMS.txt` to a GitHub Release draft. Download the draft
attachments, verify their checksums and launch them before publishing the draft.
See `.github/workflows/build.yml`.

To rerun the package checks on downloaded artifacts, use:

```powershell
pwsh -File tools/verify-packages.ps1 -Version 1.1.0 -PackageDirectory release
```

Run installer checks on a dedicated Windows test machine with Administrator
rights. Pass `-PortableOnly` to test the portable package without elevation.
