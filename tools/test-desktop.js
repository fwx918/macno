'use strict';

const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, clipboard, dialog, shell } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(check, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(75);
  }
  throw new Error('Timed out: ' + description);
}

async function run() {
  const folder = fsSync.mkdtempSync(path.join(os.tmpdir(), 'macno-desktop-'));
  const userData = path.join(folder, 'user-data');
  const documents = path.join(folder, '文档 Folder');
  const assets = path.join(documents, 'assets');
  fsSync.mkdirSync(assets, { recursive: true });
  const htmlPath = path.join(documents, '页面 Test.HTM');
  const markdownPath = path.join(documents, 'Notes.md');
  const textPath = path.join(documents, 'Plain.TXT');
  const html = '\uFEFF<!doctype html>\r\n<link rel="stylesheet" href="assets/style.css">\r\n' +
    '<h1 id="heading">Hello &amp; 中文</h1><img src="assets/tiny.svg">\r\n' +
    '<script>document.title = "active script"</script><a href="#heading">Jump</a>\r\n';
  fsSync.writeFileSync(htmlPath, html);
  fsSync.writeFileSync(markdownPath, '# Markdown\n\nBody\n');
  fsSync.writeFileSync(textPath, '# plain *literal*\r\n');
  fsSync.writeFileSync(path.join(assets, 'style.css'), 'h1 { background: rgb(12, 34, 56); }');
  fsSync.writeFileSync(path.join(assets, 'tiny.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#f10da3"/></svg>');
  const queuedChoices = [];
  const prompts = [];
  const errors = [];
  let selectedInExplorer;
  dialog.showErrorBox = (title, message) => errors.push({ title, message });
  dialog.showMessageBox = async (_window, options) => {
    prompts.push(options.title);
    return { response: queuedChoices.length ? queuedChoices.shift() : options.cancelId };
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [textPath] });
  shell.showItemInFolder = file => { selectedInExplorer = file; };
  app.commandLine.appendSwitch('user-data-dir', userData);
  process.argv.push(htmlPath);
  require('../main');
  await app.whenReady();
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 'app window');
  const wc = win.webContents;
  const runJS = source => wc.executeJavaScript(source, true);
  const js = (fn, ...args) => runJS('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const readActive = () => js(() => state.currentFile?.path);
  const clickMenuItem = label => js(name => {
    const button = [...document.querySelectorAll('#file-context-menu button')].find(button =>
      button.querySelector(':scope > span:nth-child(2)')?.textContent === name);
    if (!button || button.disabled) throw new Error('Menu item unavailable: ' + name);
    button.click();
  }, label);
  const rightClickTree = file => js(target => {
    const row = [...document.querySelectorAll('.tree-item')].find(el => el.dataset.path === target);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 4, clientY: innerHeight - 4 }));
  }, file);

  await waitFor(async () => (await readActive()) === htmlPath, 'HTML opened from startup arguments');
  assert.deepEqual(await fs.readFile(htmlPath), Buffer.from(html));
  await waitFor(() => wc.mainFrame.frames.find(frame =>
    frame.url.startsWith('macno-preview:')), 'isolated preview frame');
  await waitFor(async () => {
    const image = await wc.capturePage().catch(() => null);
    if (!image) return false;
    const bitmap = image.toBitmap();
    return bitmap.includes(Buffer.from([56, 34, 12, 255, 56, 34, 12, 255])) &&
      bitmap.includes(Buffer.from([163, 13, 241, 255, 163, 13, 241, 255]));
  }, 'relative CSS and SVG rendered in the preview');
  assert.equal(await js(() => state.currentFile.preview.contentDocument === null), true);

  await js(() => document.querySelector('[data-html-mode="source"]').click());
  const source = await js(() => state.currentFile.source.value);
  await js(() => {
    const doc = state.currentFile;
    doc.source.setSelectionRange(0, 0);
    if (!document.execCommand('insertText', false, '<!-- Edited -->\n')) throw new Error('Cannot edit source');
    doc.source.setSelectionRange(17, 22);
  });
  await js(folder => openFolder(folder), documents);
  await rightClickTree(markdownPath);
  assert.ok(await js(() => {
    const menu = document.querySelector('#file-context-menu').getBoundingClientRect();
    return menu.right <= innerWidth && menu.bottom <= innerHeight;
  }));
  await clickMenuItem('Open in New Tab');
  await waitFor(async () => (await readActive()) === markdownPath, 'Markdown opened in second tab');
  assert.match(await js(() => documentContent()), /# Markdown/);
  await js(() => doMenuOpen());
  assert.equal(await readActive(), textPath);
  assert.equal(await js(() => documentContent()), '# plain *literal*\n');
  assert.deepEqual(await js(() => [...document.querySelectorAll('#document-tabs .file-type-icon')]
    .map(e => e.dataset.type)), ['html', 'markdown', 'text']);

  await rightClickTree(htmlPath);
  await clickMenuItem('Copy Path');
  await clickMenuItem('Full Path');
  assert.equal(clipboard.readText(), htmlPath);
  await rightClickTree(htmlPath);
  await clickMenuItem('Copy Path');
  await clickMenuItem('Relative Path');
  assert.equal(clipboard.readText(), path.basename(htmlPath));
  await rightClickTree(htmlPath);
  await clickMenuItem('Show in File Explorer');
  assert.equal(selectedInExplorer, htmlPath);
  assert.equal(await readActive(), textPath);
  await rightClickTree(htmlPath);
  queuedChoices.push(1);
  await clickMenuItem('Create Copy');
  const copy = path.join(documents, '页面 Test copy.HTM');
  await waitFor(async () => fs.stat(copy).catch(() => false), 'HTML copy on disk');
  assert.deepEqual(await fs.readFile(copy), Buffer.from(html));

  await js(async target => { await openPath(target.toUpperCase()); }, htmlPath);
  assert.equal(await js(() => state.documents.length), 3);
  assert.equal(await js(() => state.currentFile.htmlMode), 'source');
  assert.deepEqual(await js(() => [state.currentFile.source.selectionStart, state.currentFile.source.selectionEnd]), [17, 22]);
  assert.equal(await js(() => {
    state.currentFile.source.focus();
    state.currentFile.source.setSelectionRange(0, 0);
    return document.execCommand('undo');
  }), true);
  assert.equal(await js(() => documentContent()), source);
  assert.equal(await js(() => document.execCommand('redo')), true);
  assert.equal(await js(() => saveFile()), true);
  const edited = html.replace('\uFEFF', '\uFEFF<!-- Edited -->\r\n');
  assert.deepEqual(await fs.readFile(htmlPath), Buffer.from(edited));

  await rightClickTree(htmlPath);
  await clickMenuItem('Rename');
  await js(() => {
    document.querySelector('#rename-name').value = 'Renamed';
    document.querySelector('#rename-dialog button[value="rename"]').click();
  });
  const renamed = path.join(documents, 'Renamed.HTM');
  await waitFor(async () => (await readActive()) === renamed, 'rename updates active path');
  assert.deepEqual(await fs.readFile(renamed), Buffer.from(edited));
  const editAfterRename = await js(() => {
    state.currentFile.source.focus();
    state.currentFile.source.setSelectionRange(0, 0);
    return {
      edited: document.execCommand('insertText', false, ' unsaved'),
      active: document.activeElement?.outerHTML.slice(0, 160),
      htmlMode: state.currentFile.htmlMode,
      modal: document.querySelector('#rename-dialog').open,
    };
  });
  assert.equal(editAfterRename.edited, true, JSON.stringify(editAfterRename));
  assert.equal(await js(() => state.currentFile.modified), true);
  queuedChoices.push(2);
  await js(() => closeDocument(state.currentFile));
  assert.equal(await readActive(), renamed);
  assert.equal(await js(() => state.currentFile.modified), true);
  queuedChoices.push(2);
  win.close();
  await waitFor(() => prompts.filter(title => title === 'Save changes?').length === 2, 'window close checks dirty tabs');
  assert.equal(win.isDestroyed(), false);
  assert.deepEqual(errors, []);
  // Fixture cleanup happens after releasing Chromium's profile handles.
  win.destroy();
  console.log('Desktop checks passed: HTML preview, source save, tabs, undo, menu targets, clipboard, rename, and cancel close.');
}

const timeout = setTimeout(() => {
  console.error('Desktop checks exceeded 65 seconds.');
  app.exit(1);
}, 65000);
run().then(() => {
  clearTimeout(timeout);
  app.exit(0);
}, err => {
  clearTimeout(timeout);
  console.error(err.stack || err);
  app.exit(1);
});
