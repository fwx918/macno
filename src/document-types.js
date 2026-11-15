'use strict';

// Shared by Electron's main process and the document UI.
const documentTypes = (() => {
  const types = {
    markdown: { label: 'Markdown', extensions: ['md', 'markdown'] },
    text: { label: 'Plain text', extensions: ['txt'] },
    html: { label: 'HTML', extensions: ['html', 'htm'] },
  };
  function typeOf(name) {
    const extension = /\.([^./\\]+)$/.exec(name || '')?.[1].toLowerCase();
    return Object.keys(types).find(type => types[type].extensions.includes(extension));
  }
  function decodeSource(raw) {
    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
    const original = raw.slice(bom.length);
    const endings = original.match(/\r\n|\r|\n/g) || [];
    const counts = new Map();
    for (const ending of endings) counts.set(ending, (counts.get(ending) || 0) + 1);
    const newline = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))[0] || '\n';
    return { bom, newline, text: original.replace(/\r\n?/g, '\n') };
  }
  return { types, typeOf, decodeSource };
})();

if (typeof module !== 'undefined') module.exports = documentTypes;
