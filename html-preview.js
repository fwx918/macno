'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parse, serialize } = require('parse5');
const { isInsideOrEqual } = require('./file-operations');

const scheme = 'macno-preview';
const previews = new Map();
const assetTypes = {
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const blockedTags = new Set([
  'base', 'script', 'noscript', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'portal', 'fencedframe', 'template',
]);

function cleanTree(node) {
  if (!node.childNodes) return;
  node.childNodes = node.childNodes.filter(child => {
    const attrs = child.attrs || [];
    const attr = name => attrs.find(item => item.name === name)?.value;
    if (blockedTags.has(child.tagName)) return false;
    if (child.tagName === 'meta' && attr('http-equiv') !== undefined) return false;
    if (child.tagName === 'link' && attr('rel')?.trim().toLowerCase() !== 'stylesheet') return false;
    if (child.attrs) {
      child.attrs = attrs.filter(item => !item.name.startsWith('on') &&
        !['target', 'download', 'ping', 'autofocus'].includes(item.name) &&
        !(item.name === 'href' && child.tagName === 'a'));
      if (child.tagName === 'a' && child.namespaceURI === 'http://www.w3.org/1999/xhtml') {
        const href = attr('href')?.trim();
        if (href?.startsWith('#')) child.attrs.push({ name: 'href', value: href });
        else if (/^https?:\/\//i.test(href || '')) {
          child.attrs.push({ name: 'href', value: href }, { name: 'target', value: '_blank' },
            { name: 'rel', value: 'noopener noreferrer' });
        }
      }
    }
    cleanTree(child);
    return true;
  });
}

function sanitizePreview(source) {
  const tree = parse(source.replace(/^\uFEFF/, ''));
  cleanTree(tree);
  return serialize(tree);
}

function createPreview(previousUrl, filePath, source) {
  const html = sanitizePreview(source);
  releasePreview(previousUrl);
  const host = randomUUID();
  previews.set(host, { html, directory: filePath ? path.dirname(filePath) : null });
  return `${scheme}://${host}/document.html`;
}

function releasePreview(url) {
  if (url) previews.delete(new URL(url).hostname);
}

function isPreviewEntry(requestUrl) {
  const url = new URL(requestUrl);
  return url.protocol === scheme + ':' && url.pathname === '/document.html' && previews.has(url.hostname);
}

async function servePreview(request) {
  const url = new URL(request.url);
  const preview = previews.get(url.hostname);
  if (!preview || request.method !== 'GET') return new Response(null, { status: 404 });
  const origin = `${scheme}://${url.hostname}`;
  const headers = {
    'Content-Security-Policy': `sandbox allow-popups; default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${origin} data:; style-src 'unsafe-inline' ${origin}; font-src ${origin}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
  if (url.pathname === '/document.html') {
    return new Response(preview.html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  try {
    const relative = decodeURIComponent(url.pathname.slice(1));
    const mime = assetTypes[path.extname(relative).toLowerCase()];
    if (!preview.directory || !mime || !relative || /[\\:\0]/.test(relative) ||
      relative.split('/').some(segment => segment === '..' || segment === '.')) {
      return new Response(null, { status: 404 });
    }
    const directory = await fs.realpath(preview.directory);
    const asset = await fs.realpath(path.resolve(directory, relative));
    if (!isInsideOrEqual(directory, asset) || !(await fs.stat(asset)).isFile()) {
      return new Response(null, { status: 404 });
    }
    return new Response(await fs.readFile(asset), { headers: { ...headers, 'Content-Type': mime } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

module.exports = { scheme, createPreview, releasePreview, servePreview, isPreviewEntry, sanitizePreview };
