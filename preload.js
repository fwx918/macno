'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content, expectedContent) => ipcRenderer.invoke('write-file', { filePath, content, expectedContent }),
  saveDialog: (defaultPath, type) => ipcRenderer.invoke('save-dialog', { defaultPath, type }),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  createMarkdown: (rootPath, directoryPath, name) => ipcRenderer.invoke('create-markdown', { rootPath, directoryPath, name }),
  createFolder: (rootPath, directoryPath, name) => ipcRenderer.invoke('create-folder', { rootPath, directoryPath, name }),
  renameEntry: (rootPath, targetPath, newName) => ipcRenderer.invoke('rename-entry', { rootPath, targetPath, newName }),
  duplicateEntry: (rootPath, targetPath) => ipcRenderer.invoke('duplicate-entry', { rootPath, targetPath }),
  trashEntry: (rootPath, targetPath) => ipcRenderer.invoke('trash-entry', { rootPath, targetPath }),
  copyPath: (rootPath, targetPath, relative) => ipcRenderer.invoke('copy-path', { rootPath, targetPath, relative }),

  // Directory
  getDirTree: (dirPath) => ipcRenderer.invoke('get-dir-tree', dirPath),
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),

  // Recent files
  getRecent: () => ipcRenderer.invoke('get-recent'),
  addRecent: (filePath) => ipcRenderer.invoke('add-recent', filePath),

  // Window state
  setActiveDocument: (filePath, modified, type) => ipcRenderer.invoke('set-active-document', { filePath, modified, type }),
  editorReady: () => ipcRenderer.invoke('editor-ready'),
  finishClose: () => ipcRenderer.invoke('finish-close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Dialogs
  confirmDiscard: (fileName) => ipcRenderer.invoke('confirm-discard', fileName),
  confirmCopy: (fileName) => ipcRenderer.invoke('confirm-copy', fileName),
  showError: (title, message) => ipcRenderer.invoke('show-error', { title, message }),

  // Welcome page (first launch)
  getWelcome: () => ipcRenderer.invoke('get-welcome'),

  // Filesystem path of a dropped File object (File.path was removed in Electron 32+)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Export
  exportPDF: (defaultName, preview) => ipcRenderer.invoke('export-pdf', { defaultName, preview }),
  exportHTML: (html, defaultName) => ipcRenderer.invoke('export-html', { html, defaultName }),

  // Shell
  showInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  createHtmlPreview: (previousUrl, filePath, source) => ipcRenderer.invoke('create-html-preview', { previousUrl, filePath, source }),
  releaseHtmlPreview: (url) => ipcRenderer.invoke('release-html-preview', url),

  // Events from main process
  on: (channel, callback) => {
    const validChannels = ['menu-action', 'open-file', 'open-folder'];
    if (validChannels.includes(channel)) {
      const handler = (_, ...args) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  once: (channel, callback) => {
    ipcRenderer.once(channel, (_, ...args) => callback(...args));
  },
});
