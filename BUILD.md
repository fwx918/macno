# Building macno installers

macno is an Electron app, packaged with [electron-builder](https://www.electron.build/).

## Quick reference

| Platform | Command | Output (in `release/`) | Where it can be built |
|----------|---------|------------------------|-----------------------|
| Windows  | `npm run build:win`   | `macno-1.0.0-win-x64.exe` (installer), `macno-1.0.0-portable.exe` | Windows |
| macOS    | `npm run build:mac`   | `macno-1.0.0-mac-x64.dmg`, `-arm64.dmg`, `.zip` | **macOS only** |
| Linux    | `npm run build:linux` | `.AppImage`, `.deb` | Linux (or macOS) |

> **Important platform rule:** an installer can only be built on (or for) its
> own OS family. A macOS `.dmg` requires macOS tooling (`hdiutil`, code-signing)
> that does not exist on Windows — you **cannot** build the Mac version on a
> Windows PC. Use one of the two Mac options below.

## Windows (on this PC)

```powershell
npm run build:win
```

Because the Electron binary on this machine was installed manually from the
China mirror, electron-builder also downloads its helper binaries. Point it at
the mirror first (only needed on networks where GitHub is slow/blocked):

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build:win
```

The `electronDownload.mirror` setting in `package.json` already handles the
Electron download; the env var above covers electron-builder's own tools (NSIS,
winCodeSign).

Output appears in `release/`. The `.exe` installer lets the user choose the
install location and creates Start-menu + desktop shortcuts. The portable
`.exe` runs without installing.

## macOS — option A: build on a Mac

Copy the project to a Mac (or `git clone` it), then:

```bash
npm install
npm run build:mac
```

This produces `macno-1.0.0-mac-x64.dmg` (Intel), `macno-1.0.0-mac-arm64.dmg`
(Apple Silicon), and matching `.zip` files in `release/`. The builds are
**unsigned** — on first launch the user right-clicks the app → *Open* to bypass
Gatekeeper, or runs `xattr -dr com.apple.quarantine /Applications/macno.app`.
For a notarized, double-click-to-open build you need an Apple Developer
certificate.

## macOS — option B: build in the cloud (GitHub Actions)

No Mac required. `.github/workflows/build.yml` builds **both** Windows and macOS
on GitHub's runners and uploads the installers as downloadable artifacts.

1. Create a GitHub repo and push this project:
   ```powershell
   git init
   git add .
   git commit -m "macno"
   git branch -M main
   git remote add origin https://github.com/<you>/macno.git
   git push -u origin main
   ```
2. Go to the repo's **Actions** tab → **Build macno** → **Run workflow**
   (or push a tag: `git tag v1.0.0 && git push --tags`).
3. When the run finishes, download `macno-windows` and `macno-macos` from the
   run's **Artifacts** section.

## Icons

App icons are generated from `assets/icon.svg`:

```powershell
npm run make-icons
```

This writes `assets/icon.ico` (Windows), `assets/icon.icns` (macOS) and
`assets/icon.png` (Linux). Edit `assets/icon.svg` and re-run to change the icon.
