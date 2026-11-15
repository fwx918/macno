'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { fileURLToPath } = require('node:url');
const fileOps = require('./file-operations');
const { readDocument, writeDocument } = require('./document-files');
const { types, typeOf } = require('./src/document-types');
const preview = require('./html-preview');

// Set userData outside of iCloud to avoid sync/cache issues
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'macno'));
protocol.registerSchemesAsPrivileged([
  { scheme: preview.scheme, privileges: { standard: true, secure: true } },
]);

let mainWindow;
let editorReady = false;
let allowClose = false;
let pendingFiles = [];
let activeFormat = 'markdown';
const openFilters = [{ name: 'Documents', extensions: Object.values(types).flatMap(type => type.extensions) }];
const recentFilesPath = path.join(app.getPath('userData'), 'recent.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// ---------- Settings ----------
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { theme: 'light' }; }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2)); } catch {}
}

// ---------- Recent files ----------
function loadRecent() {
  try { return JSON.parse(fs.readFileSync(recentFilesPath, 'utf8')); }
  catch { return []; }
}
function saveRecent(list) {
  try { fs.writeFileSync(recentFilesPath, JSON.stringify(list)); } catch {}
}
function addRecent(filePath) {
  let list = loadRecent().filter(p => !samePath(p, filePath));
  list.unshift(filePath);
  if (list.length > 20) list = list.slice(0, 20);
  saveRecent(list);
  rebuildMenu();
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function pathWithin(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  return samePath(parent, candidate) || candidate.toLowerCase().startsWith((parent + path.sep).toLowerCase());
}

function rebasePath(candidatePath, oldBase, newBase) {
  if (!pathWithin(oldBase, candidatePath)) return candidatePath;
  return path.join(newBase, path.relative(oldBase, candidatePath));
}

function remapRecent(oldPath, newPath) {
  const mapped = loadRecent().map(p => rebasePath(p, oldPath, newPath));
  saveRecent([...new Set(mapped)]);
  rebuildMenu();
}

function removeRecentUnder(targetPath) {
  saveRecent(loadRecent().filter(p => !pathWithin(targetPath, p)));
  rebuildMenu();
}

// ---------- Window title ----------
function setTitle(filePath, modified) {
  if (!mainWindow) return;
  const name = filePath ? path.basename(filePath) : 'Untitled';
  mainWindow.setTitle(`${modified ? '• ' : ''}${name} — macno`);
}

// ---------- Menu ----------
function rebuildMenu() {
  const recent = loadRecent();
  const recentItems = recent.length
    ? recent.map(p => ({
        label: path.basename(p),
        sublabel: p,
        click: () => openFileByPath(p),
      }))
    : [{ label: 'No recent files', enabled: false }];

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-action', 'new') },
        { type: 'separator' },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: menuOpenFile },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: menuOpenFolder },
        { label: 'Recent Files', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-action', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-action', 'save-as') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.webContents.send('menu-action', 'close-tab') },
        { type: 'separator' },
        { label: 'Export as PDF…', click: () => mainWindow.webContents.send('menu-action', 'export-pdf') },
        { label: 'Export as HTML…', click: () => mainWindow.webContents.send('menu-action', 'export-html') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu-action', 'find') },
        { label: 'Find & Replace…', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu-action', 'find-replace') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+L', click: () => mainWindow.webContents.send('menu-action', 'toggle-sidebar') },
        { type: 'separator' },
        { label: 'Files', accelerator: 'CmdOrCtrl+Shift+3', click: () => mainWindow.webContents.send('menu-action', 'sidebar-files') },
        { label: 'Outline', accelerator: 'CmdOrCtrl+Shift+1', click: () => mainWindow.webContents.send('menu-action', 'sidebar-outline') },
        { label: 'Recent', accelerator: 'CmdOrCtrl+Shift+2', click: () => mainWindow.webContents.send('menu-action', 'sidebar-recent') },
        { type: 'separator' },
        { label: 'Focus Mode', accelerator: 'F8', click: () => mainWindow.webContents.send('menu-action', 'focus-mode') },
        { label: 'Typewriter Mode', accelerator: 'F9', click: () => mainWindow.webContents.send('menu-action', 'typewriter-mode') },
        { label: 'Source Code Mode', accelerator: 'CmdOrCtrl+/', click: () => mainWindow.webContents.send('menu-action', 'source-mode') },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Format',
      enabled: activeFormat === 'markdown',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('menu-action', 'bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => mainWindow.webContents.send('menu-action', 'italic') },
        { label: 'Strikethrough', accelerator: 'Alt+Shift+5', click: () => mainWindow.webContents.send('menu-action', 'strikethrough') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+Shift+`', click: () => mainWindow.webContents.send('menu-action', 'inline-code') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: () => mainWindow.webContents.send('menu-action', 'h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: () => mainWindow.webContents.send('menu-action', 'h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: () => mainWindow.webContents.send('menu-action', 'h3') },
        { label: 'Heading 4', accelerator: 'CmdOrCtrl+4', click: () => mainWindow.webContents.send('menu-action', 'h4') },
        { type: 'separator' },
        { label: 'Ordered List', accelerator: 'CmdOrCtrl+Shift+[', click: () => mainWindow.webContents.send('menu-action', 'ordered-list') },
        { label: 'Unordered List', accelerator: 'CmdOrCtrl+Shift+]', click: () => mainWindow.webContents.send('menu-action', 'unordered-list') },
        { label: 'Task List', click: () => mainWindow.webContents.send('menu-action', 'task-list') },
        { type: 'separator' },
        { label: 'Block Quote', accelerator: 'CmdOrCtrl+Shift+Q', click: () => mainWindow.webContents.send('menu-action', 'blockquote') },
        { label: 'Code Block', accelerator: 'CmdOrCtrl+Shift+K', click: () => mainWindow.webContents.send('menu-action', 'code-block') },
        { label: 'Math Block', click: () => mainWindow.webContents.send('menu-action', 'math-block') },
        { label: 'Horizontal Rule', click: () => mainWindow.webContents.send('menu-action', 'hr') },
        { label: 'Table', accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow.webContents.send('menu-action', 'table') },
        { label: 'Link', accelerator: 'CmdOrCtrl+K', click: () => mainWindow.webContents.send('menu-action', 'link') },
        { label: 'Image', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow.webContents.send('menu-action', 'image') },
      ],
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Default (Light)', click: () => mainWindow.webContents.send('menu-action', 'theme-light') },
        { label: 'Night (Dark)', click: () => mainWindow.webContents.send('menu-action', 'theme-dark') },
        { label: 'GitHub', click: () => mainWindow.webContents.send('menu-action', 'theme-github') },
        { label: 'Solarized', click: () => mainWindow.webContents.send('menu-action', 'theme-solarized') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About macno', click: () => dialog.showMessageBox(mainWindow, {
          title: 'About macno',
          message: 'macno',
          detail: `A beautiful Markdown editor for Windows.\nVersion ${app.getVersion()}\n\nBuilt with Electron + vditor`,
          buttons: ['OK'],
        })},
        { label: 'Open on GitHub', click: () => shell.openExternal('https://github.com/fwx918/macno') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- File operations ----------
async function menuOpenFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: openFilters,
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths[0]) openFileByPath(result.filePaths[0]);
}

async function menuOpenFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths[0]) {
    mainWindow.webContents.send('open-folder', result.filePaths[0]);
  }
}

function openFileByPath(filePath) {
  const resolved = path.resolve(filePath);
  if (editorReady) mainWindow.webContents.send('open-file', resolved);
  else pendingFiles.push(resolved);
}

// ---------- IPC handlers ----------
ipcMain.handle('editor-ready', () => {
  editorReady = true;
  const files = pendingFiles;
  pendingFiles = [];
  return files;
});

ipcMain.handle('read-file', async (_, filePath) => {
  return readDocument(filePath);
});

ipcMain.handle('write-file', async (_, { filePath, content, expectedContent }) => {
  writeDocument(filePath, content, expectedContent);
  addRecent(filePath);
  return true;
});

ipcMain.handle('save-dialog', async (_, { defaultPath, type }) => {
  const format = types[type];
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || path.join(os.homedir(), `Untitled.${format.extensions[0]}`),
    filters: [{ name: format.label, extensions: format.extensions }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: openFilters,
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('create-markdown', async (_, { rootPath, directoryPath, name }) => {
  return fileOps.createMarkdown(rootPath, directoryPath, name);
});

ipcMain.handle('create-folder', async (_, { rootPath, directoryPath, name }) => {
  return fileOps.createDirectory(rootPath, directoryPath, name);
});

ipcMain.handle('rename-entry', async (_, { rootPath, targetPath, newName }) => {
  const sourcePath = fileOps.assertMutableTarget(rootPath, targetPath);
  const wasDirectory = fs.statSync(sourcePath).isDirectory();
  const newPath = fileOps.renameEntry(rootPath, sourcePath, newName);
  remapRecent(sourcePath, newPath);
  return { oldPath: sourcePath, newPath, isDir: wasDirectory };
});

ipcMain.handle('duplicate-entry', async (_, { rootPath, targetPath }) => {
  return fileOps.duplicateFile(rootPath, targetPath);
});

ipcMain.handle('trash-entry', async (_, { rootPath, targetPath }) => {
  const safePath = fileOps.assertMutableTarget(rootPath, targetPath);
  const isDir = fs.statSync(safePath).isDirectory();
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Move to Recycle Bin', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete item?',
    message: `Move "${path.basename(safePath)}" to the Recycle Bin?`,
    detail: isDir ? 'The folder and everything inside it will be moved.' : 'The file can be restored from the Recycle Bin.',
  });
  if (response !== 0) return { trashed: false };
  await shell.trashItem(safePath);
  removeRecentUnder(safePath);
  return { trashed: true, isDir };
});

ipcMain.handle('copy-path', async (_, { rootPath, targetPath, relative }) => {
  const safePath = fileOps.assertMutableTarget(rootPath || path.dirname(targetPath), targetPath);
  clipboard.writeText(relative ? path.relative(rootPath, safePath) : safePath);
  return true;
});

ipcMain.handle('get-dir-tree', async (_, dirPath) => {
  return getDirTree(dirPath, 0);
});

ipcMain.handle('get-recent', () => loadRecent());

ipcMain.handle('add-recent', (_, filePath) => { addRecent(filePath); });

ipcMain.handle('set-active-document', (_, { filePath, modified, type }) => {
  setTitle(filePath, modified);
  if (activeFormat !== type) {
    activeFormat = type;
    rebuildMenu();
  }
});

ipcMain.handle('finish-close', () => {
  allowClose = true;
  mainWindow.close();
});

ipcMain.handle('create-html-preview', (_, { previousUrl, filePath, source }) =>
  preview.createPreview(previousUrl, filePath, source));
ipcMain.handle('release-html-preview', (_, url) => preview.releasePreview(url));

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (_, settings) => saveSettings(settings));

ipcMain.handle('export-pdf', async (_, { defaultName, preview: printPreview }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), defaultName || 'document.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  const options = {
    printBackground: true,
    pageSize: 'A4',
    // printToPDF margins are in inches
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
  };
  let data;
  if (printPreview) {
    const url = preview.createPreview(null, printPreview.filePath, printPreview.source);
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-frame-navigate', event => event.preventDefault());
    try {
      await printWindow.loadURL(url);
      data = await printWindow.webContents.printToPDF(options);
    } finally {
      printWindow.destroy();
      preview.releasePreview(url);
    }
  } else {
    data = await mainWindow.webContents.printToPDF(options);
  }
  fs.writeFileSync(result.filePath, data);
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});

ipcMain.handle('export-html', async (_, { html, defaultName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), defaultName || 'document.html'),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, html, 'utf8');
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});

ipcMain.handle('show-item-in-folder', (_, filePath) => {
  if (!fs.existsSync(filePath)) throw new Error('The file no longer exists.');
  shell.showItemInFolder(filePath);
});

ipcMain.handle('confirm-copy', async (_, fileName) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Save and Create Copy', 'Copy Saved Version', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Create a copy?',
    message: `"${fileName}" has unsaved changes.`,
  });
  return response;
});

// Ask the user what to do with unsaved changes: 0 = Save, 1 = Don't Save, 2 = Cancel
ipcMain.handle('confirm-discard', async (_, fileName) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Save changes?',
    message: `"${fileName || 'Untitled'}" has unsaved changes.`,
  });
  return response;
});

ipcMain.handle('show-error', (_, { title, message }) => {
  dialog.showErrorBox(title || 'Error', message || 'Unknown error');
});

// Welcome content for first launch. Served as raw text so the renderer can show
// it as an untitled document — the packaged welcome.md lives inside the asar and
// must never become an editable "file" (writes to it would fail).
ipcMain.handle('get-welcome', () => {
  if (loadRecent().length) return null;
  try { return fs.readFileSync(path.join(__dirname, 'assets', 'welcome.md'), 'utf8'); }
  catch { return null; }
});

ipcMain.handle('read-dir', async (_, dirPath) => {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name),
    }));
  } catch { return []; }
});

// Recursive directory tree (max depth 5). Beyond the limit, non-empty
// directories get a stub entry so deep folders don't silently look empty.
function getDirTree(dirPath, depth) {
  if (depth > 5) {
    try {
      return fs.readdirSync(dirPath).length
        ? [{ name: '… (too deep to display)', path: dirPath, isDir: false, stub: true }]
        : [];
    } catch { return []; }
  }
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => {
        const fullPath = path.join(dirPath, e.name);
        const isDir = e.isDirectory();
        const node = { name: e.name, path: fullPath, isDir };
        if (isDir) node.children = getDirTree(fullPath, depth + 1);
        return node;
      });
  } catch { return []; }
}

// ---------- App lifecycle ----------
// Single instance: opening a .md from Explorer while the app runs hands the
// file to the existing window instead of spawning a second instance (which
// would also fight over recent.json/settings.json).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_, argv) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  argv.filter(a => typeOf(a) && fs.existsSync(a)).forEach(openFileByPath);
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  protocol.handle(preview.scheme, preview.servePreview);
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const winOpts = {
    width: 1200,
    height: 800,
    minWidth: 500,
    minHeight: 400,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // needed for local vditor assets in dev
    },
    show: false,
  };
  if (fs.existsSync(iconPath)) winOpts.icon = iconPath;
  mainWindow = new BrowserWindow(winOpts);

  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-frame-navigate', event => {
    if (!event.isMainFrame && preview.isPreviewEntry(event.url)) return;
    event.preventDefault();
    if (!event.isMainFrame) return;
    try {
      const filePath = fileURLToPath(event.url);
      if (typeOf(filePath)) openFileByPath(filePath);
    } catch { /* only local documents are handled here */ }
  });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.on('will-prevent-unload', event => { if (allowClose) event.preventDefault(); });
  wc.session.on('will-download', event => event.preventDefault());
  process.argv.filter(a => typeOf(a) && fs.existsSync(a)).forEach(openFileByPath);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', event => {
    if (allowClose || !editorReady || wc.isCrashed()) return;
    event.preventDefault();
    wc.send('menu-action', 'close-window');
  });

  rebuildMenu();
});

app.on('window-all-closed', () => {
  app.quit();
});
