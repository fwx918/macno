// Headless inspector: loads the real index.html, stubs IPC, waits for vditor,
// then dumps computed box styling of the editor element chain so we can find
// what draws the bordered "card" and the surrounding whitespace.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// Stub every channel the renderer invokes during init.
const handlers = {
  'get-settings': {}, 'get-recent': [], 'get-current-file': null,
  'set-modified': true, 'set-current-path': true, 'add-recent': true,
  'read-file': '', 'read-dir': [], 'get-dir-tree': null,
};
for (const ch of Object.keys(handlers)) ipcMain.handle(ch, () => handlers[ch]);
// catch-all for anything else
for (const ch of ['write-file','save-dialog','open-file-dialog','open-folder-dialog',
  'save-settings','export-pdf','export-html','show-item-in-folder','open-external']) {
  ipcMain.handle(ch, () => null);
}

function log(...a){ process.stdout.write(a.join(' ') + '\n'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1600, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false },
  });
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));

  // wait for vditor instance ready
  for (let i = 0; i < 80; i++) {
    const ok = await win.webContents.executeJavaScript(
      `(typeof state!=='undefined') && !!(state && state.vditor) && !!document.querySelector('.vditor-ir')`
    ).catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  await sleep(300);

  // Load real content (incl. a code block) so we can confirm the editable area
  // is seamless while real code blocks keep their box.
  // Retry setValue until it sticks, then poll until the IR DOM has actually rendered.
  let loaded = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const got = await win.webContents.executeJavaScript(`(() => {
      let md = '# Welcome to macno\\n\\n';
      for (let i = 0; i < 40; i++) md += '## Section ' + i + '\\n\\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Long paragraph to force scrolling.\\n\\n';
      try { state.vditor.setValue(md); } catch(e) { return -1; }
      return state.vditor.getValue().length;
    })()`).catch(() => -1);
    await sleep(300);
    loaded = await win.webContents.executeJavaScript(
      `(() => { const e = document.querySelector('.vditor-ir'); return e ? (e.innerText||'').length : 0; })()`
    ).catch(() => 0);
    if (loaded > 800) break;
  }
  log('rendered innerText length: ' + loaded);
  await sleep(600);

  const report = await win.webContents.executeJavaScript(`(() => {
    const sels = ['#editor-wrapper','#editor','.vditor','.vditor-content','.vditor-ir','.vditor-reset'];
    const out = { winInner: innerWidth + 'x' + innerHeight, chain: {}, suspects: [] };
    sels.forEach(s => {
      const el = document.querySelector(s);
      if (!el) { out.chain[s] = null; return; }
      const cs = getComputedStyle(el);
      const scrolls = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      out.chain[s] = {
        overflowY: cs.overflowY,
        scroll: el.scrollHeight + '/' + el.clientHeight,
        SCROLLBAR: scrolls ? 'YES' : 'no',
        bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
      };
    });
    // dump ALL sized descendants of .vditor with their box styling
    const vd = document.querySelector('.vditor');
    if (vd) vd.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const cs = getComputedStyle(el);
      out.suspects.push({
        tag: el.tagName, cls: (el.className||'').toString().slice(0,50),
        rect: Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height),
        bg: cs.backgroundColor, border: cs.borderTopWidth+' '+cs.borderTopColor, radius: cs.borderTopLeftRadius,
        pad: cs.paddingTop+'/'+cs.paddingLeft, margin: cs.marginTop+'/'+cs.marginLeft,
      });
    });
    return out;
  })()`);

  log(JSON.stringify(report, null, 2));

  const shot = path.join(os.tmpdir(), 'macno_editor_shot.png');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(shot, img.toPNG());
  log('SHOT ' + shot);

  win.destroy();
  app.quit();
}).catch(e => { log('ERR', e && e.stack || e); app.exit(1); });
