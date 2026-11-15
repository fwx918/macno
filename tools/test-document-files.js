'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { decodeSource, typeOf } = require('../src/document-types');
const { readDocument, writeDocument } = require('../document-files');
const { createPreview, releasePreview, servePreview } = require('../html-preview');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'macno-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('formats, UTF-8 BOM, and CRLF survive editing without parsing the saved source', t => {
  const file = path.join(fixture(t), '目录 报告.HTM');
  const source = '\uFEFF<!DOCTYPE html>\r\n<!-- note -->\r\n<p>中文 &amp; 🌱</p>';
  assert.equal(typeOf(file), 'html');
  assert.equal(typeOf('file.Markdown'), 'markdown');
  assert.equal(typeOf('file.TXT'), 'text');
  assert.equal(typeOf('file.html.txt'), 'text');
  assert.equal(typeOf('file.html.exe'), undefined);
  fs.writeFileSync(file, source);
  assert.equal(readDocument(file), source);
  const { bom, newline, text } = decodeSource(source);
  const edited = bom + text.replace('中文', '保留').replace(/\n/g, newline);
  writeDocument(file, edited, source);
  assert.deepEqual(fs.readFileSync(file), Buffer.from(source.replace('中文', '保留')));
});

test('unreadable encodings and changes on disk preserve original files', t => {
  const directory = fixture(t);
  const file = path.join(directory, 'index.html');
  const invalid = Buffer.from([255, 254, 65, 0]);
  fs.writeFileSync(file, invalid);
  assert.throws(() => readDocument(file), /not UTF-8/);
  assert.deepEqual(fs.readFileSync(file), invalid);
  fs.writeFileSync(file, '<meta charset="gbk"><p>Hi</p>');
  assert.throws(() => readDocument(file), /not UTF-8/);
  fs.writeFileSync(file, '<p>External change</p>');
  assert.throws(() => writeDocument(file, '<p>Current edits</p>', '<p>Old</p>'), /changed on disk/);
  assert.equal(readDocument(file), '<p>External change</p>');
  assert.throws(() => writeDocument(directory, 'wrong target'));
  assert.deepEqual(fs.readdirSync(directory), ['index.html']);
});

test('preview serves static source and only whitelisted local assets', async t => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(path.join(directory, 'assets', 'style.css'), 'p { color: red }');
  const raw = '<!DOCTYPE html><meta http-equiv="refresh" content="10"><base href="/">' +
    '<script>throw new Error()</script><iframe src="other.html"></iframe>' +
    '<link rel="stylesheet" href="assets/style.css"><p onclick="ignored()">中文 &amp;</p>' +
    '<a href="https://example.com/">External</a><a href="#chapter">Chapter</a>';
  const entry = createPreview(null, path.join(directory, 'source.htm'), raw);
  t.after(() => releasePreview(entry));
  const response = await servePreview(new Request(entry));
  const html = await response.text();
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(html, /<p>中文 &amp;<\/p>/);
  assert.match(html, /href="https:\/\/example\.com\/" target="_blank"/);
  assert.match(html, /href="#chapter"/);
  assert.doesNotMatch(html, /<script|<iframe|<base|onclick|http-equiv/);
  const asset = await servePreview(new Request(new URL('./assets/style.css', entry)));
  assert.equal(asset.headers.get('content-type'), 'text/css');
  assert.equal(await asset.text(), 'p { color: red }');
  for (const href of ['./other.html', './assets%5c..%5cstyle.css']) {
    assert.equal((await servePreview(new Request(new URL(href, entry)))).status, 404);
  }
});
