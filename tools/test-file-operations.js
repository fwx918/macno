'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ops = require('../file-operations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'macno-file-ops-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'macno-outside-'));
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (error) {
    console.error('  FAIL  ' + name + ' -> ' + error.message);
    process.exitCode = 1;
  }
}

function rejects(fn, pattern) {
  assert.throws(fn, pattern);
}

try {
  console.log('file operations:');
  test('creates Markdown and appends .md', () => {
    const created = ops.createMarkdown(root, root, 'First note');
    assert.strictEqual(path.basename(created), 'First note.md');
    assert.strictEqual(fs.readFileSync(created, 'utf8'), '');
  });
  test('does not duplicate an existing .md extension', () => {
    const created = ops.createMarkdown(root, root, 'Second.md');
    assert.strictEqual(path.basename(created), 'Second.md');
  });
  test('creates a folder', () => {
    const created = ops.createDirectory(root, root, 'Research');
    assert.ok(fs.statSync(created).isDirectory());
  });
  test('duplicates files with incrementing names', () => {
    const source = path.join(root, 'First note.md');
    fs.writeFileSync(source, 'content');
    assert.strictEqual(path.basename(ops.duplicateFile(root, source)), 'First note copy.md');
    assert.strictEqual(path.basename(ops.duplicateFile(root, source)), 'First note copy 2.md');
  });
  test('renames without overwriting', () => {
    const oldPath = path.join(root, 'Second.md');
    const newPath = ops.renameEntry(root, oldPath, 'Renamed.md');
    assert.strictEqual(path.basename(newPath), 'Renamed.md');
    rejects(() => ops.renameEntry(root, newPath, 'First note.md'), /already exists/i);
  });
  test('rejects invalid and reserved Windows names', () => {
    rejects(() => ops.createMarkdown(root, root, 'bad:name'), /characters/i);
    rejects(() => ops.createDirectory(root, root, 'CON'), /reserved/i);
    rejects(() => ops.createDirectory(root, root, 'trailing.'), /end/i);
  });
  test('rejects destinations outside the open folder', () => {
    rejects(() => ops.createMarkdown(root, outside, 'Escape'), /inside/i);
  });
  test('protects the open folder root from rename or trash validation', () => {
    rejects(() => ops.assertMutableTarget(root, root), /itself/i);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

if (!process.exitCode) console.log(`\n${passed} passed, 0 failed`);
