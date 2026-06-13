// Renders the editor with the real welcome.md content and saves a screenshot
// to assets/screenshot.png for the README. Run: electron tools/shot.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const welcome = fs.readFileSync(path.join(ROOT, 'assets', 'welcome.md'), 'utf8');

for (const ch of ['get-settings']) ipcMain.handle(ch, () => ({ theme: 'light' }));
for (const ch of ['get-recent', 'read-dir']) ipcMain.handle(ch, () => []);
for (const ch of ['get-current-file', 'get-dir-tree']) ipcMain.handle(ch, () => null);
for (const ch of ['set-modified', 'set-current-path', 'add-recent', 'write-file',
  'save-dialog', 'open-file-dialog', 'open-folder-dialog', 'save-settings',
  'export-pdf', 'export-html', 'show-item-in-folder', 'open-external', 'read-file']) {
  ipcMain.handle(ch, () => null);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1360, height: 880,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false },
  });
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));

  for (let i = 0; i < 80; i++) {
    const ok = await win.webContents.executeJavaScript(
      `(typeof state!=='undefined') && !!(state && state.vditor) && !!document.querySelector('.vditor-ir')`
    ).catch(() => false);
    if (ok) break;
    await sleep(200);
  }

  let loaded = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await win.webContents.executeJavaScript(
      `(()=>{ try { state.vditor.setValue(${JSON.stringify(welcome)}); } catch(e){ return -1 } return 1 })()`
    ).catch(() => -1);
    await sleep(300);
    loaded = await win.webContents.executeJavaScript(
      `(() => { const e = document.querySelector('.vditor-ir'); return e ? (e.innerText||'').length : 0; })()`
    ).catch(() => 0);
    if (loaded > 300) break;
  }
  // Cancel the pending outline refresh setValue scheduled, so our DOM-based
  // injection below isn't clobbered (vditor.getValue() lags after headless setValue).
  await win.webContents.executeJavaScript(`(()=>{ try { if (typeof outlineTimer !== 'undefined') clearTimeout(outlineTimer); } catch(e){} })()`).catch(() => {});
  await win.webContents.executeJavaScript(`(()=>{ try {
    const ed = document.querySelector('.vditor-ir');
    const hs = [...ed.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const tree = document.querySelector('#outline-tree');
    tree.innerHTML = '';
    hs.forEach(h => {
      const lvl = +h.tagName[1];
      const d = document.createElement('div');
      d.className = 'outline-item'; d.dataset.level = lvl;
      d.textContent = (h.textContent || '').replace(/^H[1-6]\\s*/, '').replace(/^#+\\s*/, '').trim();
      tree.appendChild(d);
    });
    const words = (ed.innerText || '').trim();
    const cjk = (words.match(/[\\u4e00-\\u9fff]/g) || []).length;
    const latin = (words.replace(/[\\u4e00-\\u9fff]/g, '').match(/\\S+/g) || []).length;
    document.querySelector('#status-words').textContent = (cjk + latin) + ' words';
    document.querySelector('#status-chars').textContent = words.length + ' chars';
  } catch(e){} })()`).catch(() => {});
  await sleep(200);

  const img = await win.webContents.capturePage();
  const out = path.join(ROOT, 'assets', 'screenshot.png');
  fs.writeFileSync(out, img.toPNG());
  process.stdout.write('wrote ' + out + ' (innerText ' + loaded + ' chars)\n');

  win.destroy();
  app.quit();
}).catch(e => { process.stdout.write('ERR ' + (e && e.stack || e) + '\n'); app.exit(1); });
