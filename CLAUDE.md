# CLAUDE.md

macno —— 一款高度还原 Typora 的 Windows Markdown 编辑器。本文件供 Claude Code 在每次新会话时自动加载,快速恢复项目上下文。

## 项目概览

- **定位**:纯 Windows 平台的所见即所得(WYSIWYG)Markdown 编辑器,仿 Typora 体验。
- **名称含义**:macno = **ma**rkdown + **no**te 连读;同时是 "mac-no"(不需要 Mac)的谐音梗。
- **仓库**:https://github.com/fwx918/macno (公开,MIT 许可证)
- **当前版本**:见 `package.json` 的 `version` 字段。

## 技术栈

- **Electron 42** —— 桌面外壳。⚠️ 二进制是手动从 npmmirror 下载放到 `node_modules/electron/dist/electron.exe` 的,**不是 `npm install` 装的**。
- **vditor 3.11.x** —— Markdown 编辑引擎,用 IR(即时渲染)模式。
- **原生 JS / CSS** —— 无前端框架。

## 关键文件

| 文件 | 作用 |
|------|------|
| `main.js` | Electron 主进程(文件操作、IPC、菜单) |
| `preload.js` | contextBridge API |
| `src/index.html` | UI 布局 |
| `src/renderer.js` | 编辑器逻辑、vditor 初始化、侧边栏、快捷键 |
| `src/style.css` | Typora 风格样式(4 个主题:light/dark/github/solarized) |
| `assets/welcome.md` | 首次启动显示的欢迎页 |
| `assets/icon.svg` | 图标源文件(蓝紫渐变圆角方块 + 白色 M) |

## 本地运行

```powershell
# 开发模式直接跑源码(改完重启生效)
.\node_modules\electron\dist\electron.exe .
# 或
npm start
```

`webSecurity: false` 是必须的,否则 vditor 的资源无法通过 file:// 加载。

## 构建 Windows 安装包

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # 不签名
npm run build:win
```

产物在 `release/`:`macno-<版本>-win-x64.exe`(NSIS 安装版,装到 C:\Program Files\macno,可选目录)+ `macno-<版本>-portable.exe`(免安装)。

### 构建/安装的坑

- **iCloud 占位符**:仓库在 iCloud Drive 里,构建出的 `.exe` 是云占位符,**直接从 `release/` 运行安装包会毫无反应**。必须先 `Copy-Item` 到本地普通路径(如 `D:\Downloads`)再运行。
- **winCodeSign 符号链接报错**:Windows 未开开发者模式时,解压 `winCodeSign-2.6.0.7z` 会因 darwin 的 .dylib 符号链接失败。解决:用 `node_modules/7zip-bin/win/x64/7za.exe x ... '-x!darwin'` 预解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`。本机已处理过。
- **静默安装**:`Start-Process "...Setup.exe" -ArgumentList "/S" -Verb RunAs` 可静默覆盖安装到默认目录(会弹 UAC,需用户点"是")。

## 发布新版本(标准流程)

1. 改 `package.json` 的 `version`(如 `1.0.2`)
2. 提交:`git add package.json && git commit -m "chore: bump version to v1.0.2" && git push`
3. 打 tag 触发云端构建:`git tag v1.0.2 && git push origin v1.0.2`
4. GitHub Actions(`.github/workflows/build.yml`,纯 Windows runner)自动构建并把 `.exe` 发布到 Releases 页

版本号规则:补丁 `x.y.Z`(bug 修复)/ 次版本 `x.Y.0`(新功能)/ 主版本 `X.0.0`(大改)。

## 平台范围

**仅 Windows。** Mac/Linux 的构建配置、icon.icns、相关文档已全部移除。CI 也只跑 windows-latest。不要再引入 Mac/Linux 相关内容。

## 已知的 CSS 陷阱(src/style.css)

- **编辑器"卡片"边框**:vditor 的可编辑区本身是 `<pre class="vditor-reset">`,代码块规则 `.vditor-ir pre {...}` 会把整篇文档包成代码块卡片。已用 `:not(.vditor-reset)` 排除。
- **正文居中**:vditor 自带的居中 padding 在内层 `<pre>` 上。**不要再在外层 `.vditor-ir` 叠百分比 padding**,两层百分比 padding 会形成宽度反馈循环,窗口最大化时正文塌成单字竖列。现用 `.vditor-ir > .vditor-reset` 等的 `max-width:1300px + margin:auto`(确定性居中,无反馈)。
- **单滚动条**:`#editor-wrapper` 是唯一滚动容器,vditor 内部各层都设 `overflow:visible; height:auto`。

## 调试工具(tools/)

- `tools/inspect-editor.js` —— 无头加载 index.html,dump 编辑器各层计算样式 + 截图到 %TEMP%。
- `tools/test-outline.js` —— 大纲导航单元测试(`node tools/test-outline.js`)。
- `tools/make-icons.js` —— 从 icon.svg 生成 icon.ico + icon.png(`npm run make-icons`)。
- `tools/shot.js` —— 生成 README 用的编辑器截图。
