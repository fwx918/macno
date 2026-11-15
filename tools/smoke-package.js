'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await delay(150);
  }
  throw new Error('Timed out: ' + label);
}

async function main() {
  const [executable, fixture, profileMode] = process.argv.slice(2);
  const document = path.resolve(fixture, '验证 文档.HTM');
  const recent = path.resolve(fixture, 'Existing.txt');
  const profile = path.resolve(fixture, 'profile');
  const sample = '<!doctype html>\r\n<h1>Windows package smoke</h1>\r\n';
  if (profileMode !== 'existing') {
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ theme: 'solarized' }));
    await fs.writeFile(path.join(profile, 'recent.json'), JSON.stringify([recent]));
  }
  await fs.writeFile(document, sample);
  await fs.writeFile(recent, 'Existing document');
  await fs.rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  const app = spawn(executable, ['--remote-debugging-port=0', '--user-data-dir=' + profile, document], {
    windowsHide: true, stdio: 'ignore',
  });
  let socket;
  try {
    const port = await waitFor(async () => (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\s+/)[0], 'debugging endpoint');
    const main = await waitFor(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
      .find(item => item.url.endsWith('/src/index.html')), 'main window');
    socket = new WebSocket(main.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    function evaluate(expression) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
          socket.removeEventListener('message', listener);
          reject(new Error('DevTools evaluation timed out'));
        }, 5000);
        function listener(event) {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          clearTimeout(deadline);
          socket.removeEventListener('message', listener);
          if (message.error || message.result.exceptionDetails) reject(new Error(message.error?.message ||
            message.result.exceptionDetails.exception?.description));
          else resolve(message.result.result.value);
        }
        socket.addEventListener('message', listener);
        socket.send(JSON.stringify({
          id, method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
        }));
      });
    }
    await waitFor(() => evaluate("typeof state !== 'undefined' && state.currentFile?.preview?.src.startsWith('macno-preview:')"),
      'startup HTML preview');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'solarized');
    assert.equal(await evaluate(`window.api.getRecent().then(files => files.includes(${JSON.stringify(recent)}))`), true);
    assert.equal(await evaluate(`(async () => {
      document.querySelector('[data-html-mode="source"]').click();
      state.currentFile.source.setSelectionRange(0, 0);
      document.execCommand('insertText', false, '<!-- packaged edit -->\\n');
      return await saveFile();
    })()`), true);
    assert.equal(await fs.readFile(document, 'utf8'), '<!-- packaged edit -->\r\n' + sample);
    await evaluate('setTimeout(() => window.close(), 20); true');
    await waitFor(async () => {
      try { await fetch('http://127.0.0.1:' + port + '/json/version'); return false; }
      catch { return true; }
    }, 'app close');
    console.log('Verified ' + executable);
  } catch (error) {
    app.kill();
    throw error;
  } finally {
    socket?.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
