<div align="center">

<img src="assets/icon.png" width="112" alt="macno logo" />

# macno

**A clean, distraction‑free Markdown editor for Windows — inspired by Typora.**

*Write clearly. Stay in flow. Keep every note yours.*

[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](#download)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[**Download for Windows**](../../releases) · [Explore features](#features) · [Build from source](#build-from-source)

<br />

<img src="assets/macno-hero.png" width="100%" alt="macno Markdown editor in a calm, Apple-inspired product presentation" />

</div>

---

## Write Markdown without thinking about Markdown

macno turns plain `.md` files into a calm, document-like writing experience. There is no split preview, no proprietary format, and no workspace lock-in — just open a file and start writing.

| | |
|---|---|
| **✍️ Seamless WYSIWYG**<br>Formatting appears as you type, directly in the document. Write naturally while macno keeps the underlying Markdown clean. | **🎯 Focus & Typewriter modes**<br>Dim everything except the current paragraph or keep your active line centered when you need deeper concentration. |
| **🗂️ Files that stay yours**<br>Open local Markdown files and folders, browse the outline and recent documents, and rename files from the document title. | **🧩 Markdown, fully equipped**<br>Use tables, task lists, syntax-highlighted code, KaTeX formulas, Mermaid diagrams, and rich inline formatting. |
| **🎨 Made for every light**<br>Switch between Light, Dark, GitHub, and Solarized themes to match your environment and writing rhythm. | **📤 Ready to share**<br>Find and replace quickly, track live word counts, then export the finished document to PDF or HTML. |

> **Built for writers, developers, students, and anyone who wants the polish of a modern editor without giving up plain-text ownership.**

## What's in a name?

**macno** = **ma**rkdown + **no**te, read as one word — a place to *write notes in Markdown*.

It's also a small joke: **mac‑no** → *no Mac required*. The most-loved seamless Markdown
editors tend to live on macOS; macno brings that same calm, what‑you‑see‑is‑what‑you‑get
writing experience to **Windows**.

## Screenshot

<div align="center">
<img src="assets/screenshot.png" width="860" alt="macno editor" />
</div>

## Features

- **Seamless WYSIWYG editing** — type Markdown and see it render instantly, in place (powered by [vditor](https://github.com/Vanessa219/vditor)'s IR mode). No split preview pane, no clutter.
- **Inline file title** — the filename appears naturally above the document and can be edited to rename the file without changing its Markdown content.
- **Sidebar** — document outline, recent files, and a folder file‑tree with right-click create, copy, rename, reveal, and Recycle Bin actions.
- **Focus Mode** (`F8`) — dim everything except the paragraph you're writing.
- **Typewriter Mode** (`F9`) — keep the current line centered on screen.
- **Themes** — Light, Dark, GitHub, and Solarized.
- **Rich content** — tables, task lists, code blocks with syntax highlighting, [KaTeX](https://katex.org/) math, and [Mermaid](https://mermaid.js.org/) diagrams.
- **Find & replace**, word/character count, and live document stats.
- **Export** to PDF and HTML from the File menu.
- **Local‑first** — your `.md` files stay plain Markdown on disk. Open with `Ctrl+O` or drag a file onto the window.

## Download

Grab the latest build from the [**Releases**](../../releases) page:

| File | Description |
|------|-------------|
| `macno-x.y.z-win-x64.exe` | Installer. Defaults to `C:\Program Files\macno` (you can choose another folder), creates Start‑menu + desktop shortcuts. |
| `macno-x.y.z-portable.exe` | Portable build — no installation, just run it. |

> The installer is **unsigned**, so Windows SmartScreen or Chinese security suites
> (360 / 电脑管家) may warn on first run — choose *Run anyway* / *Trust*.

## Build from source

Requires [Node.js](https://nodejs.org/) 18+.

```powershell
npm install
npm start          # run in development
npm run build:win  # produce the Windows installer + portable build in release/
```

App icons are generated from `assets/icon.svg` with `npm run make-icons`.
See [BUILD.md](BUILD.md) for full packaging details.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [vditor](https://github.com/Vanessa219/vditor) — the Markdown editing engine (instant‑rendering mode)
- Vanilla JS / CSS — no front‑end framework

## Roadmap

- [x] Windows installer + portable build
- [ ] Image paste & local image management
- [ ] Custom theme support
- [ ] Linux (AppImage / deb)

## License

[MIT](LICENSE) © macno

---

<div align="center">
<sub>made for people who just want to write — on Windows.</sub>
</div>
