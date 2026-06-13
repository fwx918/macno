'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Set userData outside of iCloud to avoid sync/cache issues
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'macno'));

let mainWindow;
let currentFile = { path: null, modified: false };
const recentFilesPath = path.join(app.getPath('userData'), 'recent.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// ---------- Settings ----------
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { theme: 'light', fontFamily: 'inherit', fontSize: 16, lineHeight: 1.75, focusMode: false, typewrtierMode: false }; }
}
function saveSettings(s) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

// ---------- Recent files ----------
function loadRecent() {
  try { return JSON.parse(fs.readFileSync(recentFilesPath, 'utf8')); }
  catch { return []; }
}
function saveRecent(list) {
  fs.writeFileSync(recentFilesPath, JSON.stringify(list));
}
function addRecent(filePath) {
  let list = loadRecent().filter(p => p !== filePath);
  list.unshift(filePath);
  if (list.length > 20) list = list.slice(0, 20);
  saveRecent(list);
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
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('menu-action', 'bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => mainWindow.webContents.send('menu-action', 'italic') },
        { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-action', 'strikethrough') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+Shift+`', click: () => mainWindow.webContents.send('menu-action', 'inline-code') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: () => mainWindow.webContents.send('menu-action', 'h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: () => mainWindow.webContents.send('menu-action', 'h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: () => mainWindow.webContents.send('menu-action', 'h3') },
        { label: 'Heading 4', accelerator: 'CmdOrCtrl+4', click: () => mainWindow.webContents.send('menu-action', 'h4') },
        { label: 'Paragraph', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.send('menu-action', 'paragraph') },
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
          detail: 'A beautiful Markdown editor for Windows.\nVersion 1.0.0\n\nBuilt with Electron + vditor',
          buttons: ['OK'],
        })},
        { label: 'Open on GitHub', click: () => shell.openExternal('https://github.com') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- File operations ----------
async function menuOpenFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
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
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    currentFile = { path: filePath, modified: false };
    addRecent(filePath);
    setTitle(filePath, false);
    mainWindow.webContents.send('open-file', { path: filePath, content });
  } catch (err) {
    dialog.showErrorBox('Cannot open file', err.message);
  }
}

// ---------- IPC handlers ----------
ipcMain.handle('read-file', async (_, filePath) => {
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('write-file', async (_, { filePath, content }) => {
  fs.writeFileSync(filePath, content, 'utf8');
  currentFile = { path: filePath, modified: false };
  addRecent(filePath);
  setTitle(filePath, false);
  return true;
});

ipcMain.handle('save-dialog', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || path.join(os.homedir(), 'Untitled.md'),
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf8');
  addRecent(filePath);
  return { path: filePath, content };
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-dir-tree', async (_, dirPath) => {
  return getDirTree(dirPath, 0);
});

ipcMain.handle('get-recent', () => loadRecent());

ipcMain.handle('add-recent', (_, filePath) => { addRecent(filePath); });

ipcMain.handle('set-modified', (_, modified) => {
  currentFile.modified = modified;
  setTitle(currentFile.path, modified);
});

ipcMain.handle('set-current-path', (_, filePath) => {
  currentFile.path = filePath;
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (_, settings) => saveSettings(settings));

ipcMain.handle('export-pdf', async (_, { defaultName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(os.homedir(), defaultName || 'document.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  const data = await mainWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });
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

ipcMain.handle('show-item-in-folder', (_, filePath) => shell.showItemInFolder(filePath));

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('get-current-file', () => currentFile);

ipcMain.handle('read-dir', async (_, dirPath) => {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name),
    }));
  } catch { return []; }
});

// Recursive directory tree (max depth 5)
function getDirTree(dirPath, depth) {
  if (depth > 5) return [];
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
app.whenReady().then(() => {
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

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTitle(null, false);
  });

  mainWindow.on('close', async (e) => {
    if (currentFile.modified) {
      e.preventDefault();
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Save changes?',
        message: `"${currentFile.path ? path.basename(currentFile.path) : 'Untitled'}" has unsaved changes.`,
      });
      if (choice.response === 0) {
        mainWindow.webContents.send('menu-action', 'save-then-close');
      } else if (choice.response === 1) {
        currentFile.modified = false;
        mainWindow.close();
      }
    }
  });

  // Handle file drop onto the window
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://') && (url.endsWith('.md') || url.endsWith('.txt'))) {
      e.preventDefault();
      openFileByPath(decodeURIComponent(url.replace('file:///', '')));
    }
  });

  // Open file passed as command-line argument, otherwise open welcome
  const argFile = process.argv.find(a => /\.(md|markdown|txt)$/i.test(a) && !a.includes('node_modules'));
  if (argFile && fs.existsSync(argFile)) {
    openFileByPath(argFile);
  } else {
    // Open welcome file on first launch (no recent files)
    const recent = loadRecent();
    if (!recent.length) {
      const welcome = path.join(__dirname, 'assets', 'welcome.md');
      if (fs.existsSync(welcome)) openFileByPath(welcome);
    }
  }

  rebuildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) app.whenReady().then(() => {});
});

// Handle file open from OS (double-click .md)
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (mainWindow) openFileByPath(filePath);
});
