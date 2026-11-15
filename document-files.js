'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { typeOf } = require('./src/document-types');

function readDocument(filePath) {
  const data = fs.readFileSync(filePath);
  if (!['html', 'text'].includes(typeOf(filePath))) return data.toString('utf8');
  try {
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    if (content.includes('\0')) throw new Error('Unexpected null character');
    if (typeOf(filePath) === 'html') {
      // Preserve the source, including any charset declaration. Reject legacy
      // declarations when a future edit could make the file decode incorrectly.
      const { parse } = require('parse5');
      const encoding = declaredEncoding(parse(content));
      if (encoding && !/^utf-?8$/i.test(encoding) && !content.startsWith('\uFEFF')) {
        throw new Error('Unsupported charset declaration');
      }
    }
    return content;
  } catch {
    throw new Error('This document is not UTF-8. Convert it to UTF-8 before editing it in macno.');
  }
}

function declaredEncoding(node) {
  if (node.tagName === 'meta' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
    const attr = name => node.attrs.find(item => item.name === name)?.value.trim();
    const direct = attr('charset');
    if (direct) return direct;
    if (attr('http-equiv')?.toLowerCase() === 'content-type') {
      return /charset\s*=\s*["']?([^;\s"']+)/i.exec(attr('content') || '')?.[1];
    }
  }
  for (const child of node.childNodes || []) {
    const encoding = declaredEncoding(child);
    if (encoding) return encoding;
  }
}

function writeDocument(filePath, content, expectedContent) {
  // Edit the target of an existing symlink without replacing the link itself.
  let destination = filePath;
  try { destination = fs.realpathSync(filePath); }
  catch (error) { if (error.code !== 'ENOENT' || expectedContent !== undefined) throw error; }
  if (expectedContent !== undefined && readDocument(destination) !== expectedContent) {
    throw new Error('The file changed on disk. Use Save As to keep your edits.');
  }
  const temporary = path.join(path.dirname(destination), `.macno-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.unlinkSync(temporary); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

module.exports = { readDocument, writeDocument };
