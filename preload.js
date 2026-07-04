'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', { filePath, content }),
  saveDialog: (defaultPath) => ipcRenderer.invoke('save-dialog', defaultPath),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),

  // Directory
  getDirTree: (dirPath) => ipcRenderer.invoke('get-dir-tree', dirPath),
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),

  // Recent files
  getRecent: () => ipcRenderer.invoke('get-recent'),
  addRecent: (filePath) => ipcRenderer.invoke('add-recent', filePath),

  // Window state
  setModified: (modified) => ipcRenderer.invoke('set-modified', modified),
  setCurrentPath: (filePath) => ipcRenderer.invoke('set-current-path', filePath),
  getCurrentFile: () => ipcRenderer.invoke('get-current-file'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Dialogs
  confirmDiscard: (fileName) => ipcRenderer.invoke('confirm-discard', fileName),
  showError: (title, message) => ipcRenderer.invoke('show-error', { title, message }),

  // Welcome page (first launch)
  getWelcome: () => ipcRenderer.invoke('get-welcome'),

  // Filesystem path of a dropped File object (File.path was removed in Electron 32+)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Export
  exportPDF: (defaultName) => ipcRenderer.invoke('export-pdf', { defaultName }),
  exportHTML: (html, defaultName) => ipcRenderer.invoke('export-html', { html, defaultName }),

  // Shell
  showInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

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
