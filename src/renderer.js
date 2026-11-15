'use strict';

// ===== State =====
const state = {
  documents: [],
  currentFile: null,
  get vditor() { return this.currentFile?.editor; },
  currentFolder: null,
  sidebarVisible: true,
  sidebarPanel: 'outline', // outline | recent | files
  focusMode: false,
  typewriterMode: false,
  theme: 'light',
  findMatches: [],
  findIndex: 0,
  settings: {},
  expandedFolders: new Set(),
  selectedTreePath: null,
  titleOriginal: 'Untitled',
  cancelTitleRename: false,
};

// ===== DOM refs =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const dom = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  resizeHandle: $('#resize-handle'),
  sidebarContent: $('#sidebar-content'),
  tabBtns: $$('.tab-btn'),
  panels: $$('.panel'),
  outlineTree: $('#outline-tree'),
  recentList: $('#recent-list'),
  fileTree: $('#file-tree'),
  folderName: $('#folder-name'),
  btnOpenFolder: $('#btn-open-folder'),
  btnNewFile: $('#btn-new-file'),
  editorWrapper: $('#editor-wrapper'),
  documentTitle: $('#document-title'),
  fileContextMenu: $('#file-context-menu'),
  statusFile: $('#status-file'),
  statusWords: $('#status-words'),
  statusChars: $('#status-chars'),
  statusMode: $('#status-mode'),
  findBar: $('#find-bar'),
  findInput: $('#find-input'),
  replaceInput: $('#replace-input'),
  findCount: $('#find-count'),
  replaceOne: $('#replace-one'),
  replaceAll: $('#replace-all'),
};

// ===== Init =====
async function init() {
  state.settings = await window.api.getSettings();
  state.theme = state.settings.theme || 'light';
  applyTheme(state.theme);

  await loadRecent();

  setupSidebar();
  setupResizeHandle();
  setupStatusBar();
  setupFindBar();
  setupDragDrop();
  setupKeyboardShortcuts();
  setupMenuActions();
  setupDocumentTitle();
  setupFileContextMenu();
  setupDocumentTabs();
  const paths = await window.api.editorReady();
  for (const filePath of paths) await openPath(filePath);
  if (!state.currentFile) await createDocument(null, await window.api.getWelcome(), 'markdown', true);
}

// ===== vditor =====
function makeVditorOptions(doc, content, onReady) {
  const isDark = state.theme === 'dark';
  const statusH = 28;
  // The title consumes 71px and vditor adds 26px around its configured
  // minimum, so subtract the combined footprint to avoid an empty-page scroll.
  const titleFootprint = 97;
  return {
    mode: doc.mode,
    minHeight: Math.max(400, window.innerHeight - statusH - titleFootprint),
    cdn: '../node_modules/vditor',
    toolbar: ['edit-mode'],
    toolbarConfig: { hide: true },
    outline: { enable: false },
    counter: { enable: false },
    resize: { enable: false },
    upload: { max: 0 },  // Disable upload
    tab: '    ',
    theme: isDark ? 'dark' : 'classic',
    preview: {
      theme: { current: isDark ? 'dark' : 'light' },
      math: { engine: 'KaTeX', inlineDigit: true },
      mermaid: { zoom: 1 },
      hljs: {
        style: isDark ? 'github-dark' : 'github',
        lineNumber: false,
        enable: true,
      },
    },
    link: { isOpen: false }, // Don't auto-open links
    cache: { enable: false },
    value: content || '',
    after: onReady,
    input: () => onEditorInput(doc),
    focus: () => {},
    blur: () => {},
    keydown: (e) => handleEditorKeydown(e),
  };
}

function initVditor(doc, content) {
  return new Promise((resolve) => {
    doc.editor = new Vditor(doc.panel, makeVditorOptions(doc, content, resolve));
  });
}

function getEditorEl() {
  return state.currentFile?.panel.querySelector(`.vditor-${state.currentFile.mode}`);
}

// ===== Editor events =====
function onEditorInput(doc = state.currentFile) {
  if (doc.initializing) return;
  doc.revision++;
  if (!doc.modified) {
    doc.modified = true;
    syncDocumentState();
  }
  if (state.currentFile === doc) scheduleDocUpdate();
}

// Outline + word count both call vditor.getValue() (a full serialize), so they
// share one debounce instead of running on every keystroke.
let docUpdateTimer = null;
function scheduleDocUpdate() {
  clearTimeout(docUpdateTimer);
  docUpdateTimer = setTimeout(() => {
    updateOutline();
    updateWordCount();
  }, 400);
}

function handleEditorKeydown(e) {
  if (state.typewriterMode) {
    requestAnimationFrame(scrollToCursor);
  }
}

// ===== Documents and tabs =====
let nextDocumentId = 0;
let opening = Promise.resolve();

function findOpenDocument(filePath) {
  return state.documents.find(doc => doc.path && normalizedPath(doc.path) === normalizedPath(filePath));
}

function documentName(doc) {
  return doc.path ? pathBasename(doc.path) : 'Untitled';
}

function documentContent(doc = state.currentFile) {
  return doc.editor ? doc.editor.getValue() : doc.source.value;
}

function setDocumentContent(content) {
  const doc = state.currentFile;
  if (doc.editor) doc.editor.setValue(content);
  else {
    // A single native editing command keeps replace undoable.
    doc.source.focus();
    doc.source.select();
    if (document.execCommand('insertText', false, content)) return;
    doc.source.value = content;
  }
  onEditorInput(doc);
}

async function createDocument(filePath, rawContent, type, placeholder = false) {
  const raw = rawContent || '';
  const decoded = documentTypes.decodeSource(raw);
  const panel = document.createElement('div');
  const doc = {
    path: filePath, raw, type, panel, placeholder, modified: false,
    revision: 0, initializing: true, scrollTop: 0, mode: 'ir', htmlMode: 'preview',
    bom: decoded.bom, newline: decoded.newline,
  };
  panel.id = 'document-' + ++nextDocumentId;
  panel.className = 'document-editor hidden';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', panel.id + '-tab');
  $('#document-editors').appendChild(panel);
  if (type === 'markdown') {
    await initVditor(doc, decoded.text);
  } else {
    doc.source = document.createElement('textarea');
    doc.source.className = 'document-source';
    doc.source.spellcheck = false;
    doc.source.setAttribute('aria-label', type === 'html' ? 'HTML source' : 'Plain text');
    doc.source.value = decoded.text;
    doc.source.addEventListener('input', () => onEditorInput(doc));
    if (type === 'html') {
      doc.source.wrap = 'off';
      doc.preview = document.createElement('iframe');
      doc.preview.className = 'html-preview';
      doc.preview.title = 'HTML preview';
      doc.preview.setAttribute('sandbox', 'allow-popups');
      panel.appendChild(doc.preview);
    }
    panel.appendChild(doc.source);
  }
  doc.initializing = false;
  state.documents.push(doc);
  activateDocument(doc);
  return doc;
}

function activateDocument(doc) {
  const previous = state.currentFile;
  if (previous && previous !== doc) {
    previous.scrollTop = dom.editorWrapper.scrollTop;
    previous.panel.classList.add('hidden');
  }
  state.currentFile = doc;
  doc.panel.classList.remove('hidden');
  setEditorTheme(doc);
  updateDocumentMode(doc);
  dom.editorWrapper.scrollTop = doc.scrollTop;
  const editable = doc.panel.querySelector('[contenteditable="true"]');
  if (doc.selection && editable?.contains(doc.selection.startContainer) &&
      editable.contains(doc.selection.endContainer)) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(doc.selection);
  }
  syncDocumentState();
  selectTreePath(doc.path);
  updateOutline();
  updateWordCount();
  if (!dom.findBar.classList.contains('hidden')) doFind();
}

function syncDocumentState() {
  renderDocumentTabs();
  const doc = state.currentFile;
  if (!doc) return;
  if (dom.documentTitle !== document.activeElement) updateDocumentTitle(doc.path);
  updateStatusFile(doc.path);
  window.api.setActiveDocument(doc.path, doc.modified, doc.type);
}

function renderDocumentTabs() {
  const bar = $('#document-tabs');
  const focusedTabId = bar.contains(document.activeElement) ? document.activeElement.id : '';
  bar.replaceChildren();
  for (const doc of state.documents) {
    const active = doc === state.currentFile;
    const group = document.createElement('div');
    group.className = 'document-tab' + (active ? ' active' : '');
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = doc.panel.id + '-tab';
    tab.className = 'document-tab-select';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', doc.panel.id);
    tab.setAttribute('aria-selected', String(active));
    tab.title = doc.path || documentName(doc);
    const label = document.createElement('span');
    label.className = 'document-tab-name';
    label.textContent = documentName(doc);
    tab.append(createFileIcon(doc.type), label);
    if (doc.modified) {
      tab.setAttribute('aria-label', documentName(doc) + ', unsaved');
      const dot = document.createElement('span');
      dot.className = 'unsaved-dot';
      tab.append(dot);
    }
    tab.addEventListener('click', () => {
      if (!state.transitioning) activateDocument(doc);
    });
    group.addEventListener('contextmenu', event => {
      event.preventDefault();
      showFileContextMenu(event.clientX, event.clientY,
        { name: documentName(doc), path: doc.path, document: doc });
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.id = doc.panel.id + '-close';
    close.className = 'document-tab-close';
    close.title = 'Close ' + documentName(doc);
    close.setAttribute('aria-label', close.title);
    close.textContent = '×';
    close.addEventListener('click', () => closeDocument(doc));
    group.append(tab, close);
    bar.appendChild(group);
  }
  const focusTarget = document.getElementById(focusedTabId);
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  bar.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function setupDocumentTabs() {
  $$('#html-modes button').forEach(button => {
    button.addEventListener('click', () => setHtmlMode(state.currentFile, button.dataset.htmlMode));
  });
  document.addEventListener('selectionchange', () => {
    const doc = state.currentFile;
    const selection = window.getSelection();
    if (doc?.editor && selection?.rangeCount &&
        doc.panel.contains(selection.anchorNode) && doc.panel.contains(selection.focusNode)) {
      doc.selection = selection.getRangeAt(0).cloneRange();
    }
  });
}

function updateDocumentMode(doc) {
  const html = doc.type === 'html';
  $('#html-modes').classList.toggle('hidden', !html);
  dom.editorWrapper.classList.toggle('source-document', !doc.editor);
  dom.editorWrapper.classList.toggle('typewriter-mode', Boolean(doc.editor && state.typewriterMode));
  if (html) {
    doc.source.classList.toggle('hidden', doc.htmlMode !== 'source');
    doc.preview.classList.toggle('hidden', doc.htmlMode !== 'preview');
    $$('#html-modes button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.htmlMode === doc.htmlMode));
    });
    if (doc.htmlMode === 'preview') refreshHtmlPreview(doc);
  }
  dom.statusMode.textContent = html ? 'HTML' :
    doc.type === 'text' ? 'TXT' : doc.mode === 'sv' ? 'SOURCE' : 'WYSIWYG';
}

function setHtmlMode(doc, mode) {
  if (doc?.type !== 'html' || doc.htmlMode === mode) return;
  doc.htmlMode = mode;
  updateDocumentMode(doc);
  if (mode === 'source') doc.source.focus();
}

async function refreshHtmlPreview(doc) {
  const revision = doc.revision;
  const filePath = doc.path;
  if (doc.previewRevision === revision && doc.previewPath === filePath) return;
  const request = Symbol();
  doc.previewRequest = request;
  try {
    const url = await window.api.createHtmlPreview(doc.previewUrl, filePath, doc.source.value);
    if (doc.previewRequest !== request || !state.documents.includes(doc)) {
      await window.api.releaseHtmlPreview(url);
      return;
    }
    doc.previewRevision = revision;
    doc.previewPath = filePath;
    doc.previewUrl = url;
    doc.preview.src = url;
  } catch (err) {
    await window.api.showError('Cannot preview HTML', err.message);
  }
}

function openPath(filePath, { keepPlaceholder = false } = {}) {
  opening = opening.then(async () => {
    try {
      const existing = findOpenDocument(filePath);
      if (existing) {
        activateDocument(existing);
        return existing;
      }
      const type = documentTypes.typeOf(filePath);
      if (!type) throw new Error('Choose a Markdown, TXT, HTML, or HTM file.');
      const raw = await window.api.readFile(filePath);
      const placeholder = state.currentFile;
      const doc = await createDocument(filePath, raw, type);
      if (!keepPlaceholder && placeholder?.placeholder && !placeholder.modified) {
        removeDocument(placeholder);
      }
      await window.api.addRecent(filePath);
      if (state.sidebarPanel === 'recent') await loadRecent();
      return doc;
    } catch (err) {
      await window.api.showError('Cannot open file', err.message);
    }
  });
  return opening;
}

function newFile() {
  return createDocument(null, '', 'markdown');
}

function removeDocument(doc) {
  const index = state.documents.indexOf(doc);
  if (index < 0) return;
  state.documents.splice(index, 1);
  if (doc.previewUrl) window.api.releaseHtmlPreview(doc.previewUrl);
  doc.editor?.destroy();
  doc.panel.remove();
  if (state.currentFile === doc) {
    state.currentFile = null;
    const next = state.documents[Math.min(index, state.documents.length - 1)];
    if (next) activateDocument(next);
  }
  renderDocumentTabs();
}

async function ensureSaved(doc) {
  if (doc.saving && !(await doc.saving)) return false;
  if (!doc.modified) return true;
  const choice = await window.api.confirmDiscard(documentName(doc));
  if (choice === 0) return saveFile(doc);
  return choice === 1;
}

async function closeDocument(doc) {
  if (!doc || state.transitioning) return;
  state.transitioning = true;
  try {
    if (!(await ensureSaved(doc))) return;
    removeDocument(doc);
    if (!state.currentFile) await newFile();
  } finally {
    state.transitioning = false;
  }
}

async function closeWindow() {
  if (state.transitioning) return;
  state.transitioning = true;
  try {
    await opening;
    for (const doc of [...state.documents]) {
      if (!(await ensureSaved(doc))) return;
    }
    await window.api.finishClose();
  } finally {
    state.transitioning = false;
  }
}

function saveFile(doc = state.currentFile) {
  return saveDocument(doc, !doc?.path);
}

function saveFileAs(doc = state.currentFile) {
  return saveDocument(doc, true);
}

function saveDocument(doc, choosePath) {
  if (!doc) return false;
  if (doc.saving) return doc.saving;
  if (!choosePath && !doc.modified) return true;
  doc.saving = writeDocumentToDisk(doc, choosePath).finally(() => { doc.saving = null; });
  return doc.saving;
}

async function writeDocumentToDisk(doc, choosePath) {
  try {
    const filePath = choosePath ? await window.api.saveDialog(doc.path, doc.type) : doc.path;
    if (!filePath) return false;
    if (documentTypes.typeOf(filePath) !== doc.type) {
      throw new Error('Use an extension for ' + documentTypes.types[doc.type].label + '.');
    }
    const other = findOpenDocument(filePath);
    if (other && other !== doc) throw new Error('This file is already open in another tab.');
    const sameFile = doc.path && normalizedPath(doc.path) === normalizedPath(filePath);
    const revision = doc.revision;
    const raw = doc.modified || !doc.path
      ? doc.bom + documentContent(doc).replace(/\r\n?|\n/g, doc.newline)
      : doc.raw;
    await window.api.writeFile(filePath, raw, sameFile ? doc.raw : undefined);
    doc.path = filePath;
    doc.raw = raw;
    doc.modified = doc.revision !== revision;
    doc.placeholder = false;
    syncDocumentState();
    if (state.currentFile === doc) {
      selectTreePath(filePath);
      updateDocumentMode(doc);
    }
    if (state.currentFolder && pathIsInside(state.currentFolder, filePath)) {
      await refreshFileTree();
    }
    if (state.sidebarPanel === 'recent') await loadRecent();
    return true;
  } catch (err) {
    await window.api.showError('Cannot save file', err.message);
    return false;
  }
}


// ===== Outline =====
function updateOutline() {
  const content = state.vditor ? state.vditor.getValue() : '';
  const headings = extractHeadings(content);
  state.outlineHeadings = headings;
  dom.outlineTree.innerHTML = '';

  if (!headings.length) {
    dom.outlineTree.innerHTML = '<div class="outline-empty">No headings found</div>';
    return;
  }

  headings.forEach((h, i) => {
    const el = document.createElement('div');
    el.className = 'outline-item';
    el.dataset.level = h.level;
    el.dataset.index = i;
    el.textContent = h.text;
    el.title = h.text;
    el.addEventListener('click', () => {
      setActiveOutlineItem(el);
      jumpToHeading(i, h.text);
    });
    dom.outlineTree.appendChild(el);
  });
}

function setActiveOutlineItem(el) {
  dom.outlineTree.querySelectorAll('.outline-item.active').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
}

// Strip inline Markdown so outline labels match the rendered (plain-text) headings.
function stripInlineMd(s) {
  return String(s)
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // bold
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')            // italic
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')            // strikethrough
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links
    .replace(/<[^>]+>/g, '')                  // raw HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a heading for fallback matching: drop ATX markers + inline syntax.
function normalizeHeading(s) {
  return stripInlineMd(String(s).replace(/^\s*#+\s*/, '').replace(/\s*#*\s*$/, ''));
}

function extractHeadings(md) {
  const lines = md.split('\n');
  const headings = [];
  let inCode = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) headings.push({ level: m[1].length, text: stripInlineMd(m[2]) });
  }
  return headings;
}

// Jump to the heading at the given outline index. Navigating by document
// position (rather than text) is immune to duplicate titles and inline
// formatting; a normalized-text fallback covers any count mismatch.
function jumpToHeading(index, text) {
  const editorEl = getEditorEl();
  if (!editorEl) return;
  const allEls = editorEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
  const headings = state.outlineHeadings || [];
  let target = null;

  if (allEls.length === headings.length && allEls[index]) {
    target = allEls[index];
  } else {
    // Fallback: match by normalized text, honoring which occurrence this is.
    const want = normalizeHeading(text);
    let occurrence = 0;
    for (let j = 0; j < index; j++) {
      if (normalizeHeading(headings[j].text) === want) occurrence++;
    }
    let seen = 0;
    for (const el of allEls) {
      if (normalizeHeading(el.textContent) === want) {
        if (seen === occurrence) { target = el; break; }
        seen++;
      }
    }
  }

  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.style.transition = 'background 0.4s ease';
  target.style.background = 'var(--outline-active-bg)';
  setTimeout(() => { target.style.background = ''; }, 1200);
}

// ===== Word count =====
function updateWordCount() {
  const text = state.currentFile ? documentContent() : '';
  const chars = text.length;
  // Count words (handle CJK characters as individual words)
  const words = text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]*`/g, '')        // Remove inline code
    .trim();
  const cjk = (words.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const latin = (words.replace(/[一-鿿぀-ヿ가-힯]/g, '').match(/\S+/g) || []).length;
  const total = cjk + latin;
  dom.statusWords.textContent = `${total} words`;
  dom.statusChars.textContent = `${chars} chars`;
}

// ===== Document title =====
function pathBasename(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || '';
}

function pathDirname(filePath) {
  const value = String(filePath || '');
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (index === 2 && value[1] === ':') return value.slice(0, 3);
  return index > 0 ? value.slice(0, index) : value;
}

function pathExtension(filePath) {
  const name = pathBasename(filePath);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index) : '';
}

function pathStem(filePath) {
  const name = pathBasename(filePath);
  const ext = pathExtension(name);
  return ext ? name.slice(0, -ext.length) : name;
}

function normalizedPath(filePath) {
  return String(filePath || '').replace(/[/\\]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

function pathIsInside(parentPath, candidatePath) {
  const parent = normalizedPath(parentPath);
  const candidate = normalizedPath(candidatePath);
  return Boolean(parent && candidate && (candidate === parent || candidate.startsWith(parent + '\\')));
}

function rebaseClientPath(candidatePath, oldBase, newBase) {
  if (!pathIsInside(oldBase, candidatePath)) return candidatePath;
  return newBase + String(candidatePath).slice(String(oldBase).length);
}

function updateDocumentTitle(filePath) {
  const value = filePath ? pathStem(filePath) : 'Untitled';
  state.titleOriginal = value;
  dom.documentTitle.value = value;
  dom.documentTitle.readOnly = !filePath;
  dom.documentTitle.title = filePath ? 'Rename file' : 'Save the document before renaming it';
}

function setupDocumentTitle() {
  dom.documentTitle.addEventListener('focus', () => {
    state.titleOriginal = dom.documentTitle.value;
    state.cancelTitleRename = false;
    dom.documentTitle.select();
  });
  dom.documentTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.documentTitle.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.cancelTitleRename = true;
      dom.documentTitle.value = state.titleOriginal;
      dom.documentTitle.blur();
    }
  });
  dom.documentTitle.addEventListener('blur', async () => {
    if (state.cancelTitleRename || !state.currentFile?.path) return;
    const requested = dom.documentTitle.value.trim();
    if (!requested || requested === state.titleOriginal) {
      dom.documentTitle.value = state.titleOriginal;
      return;
    }
    const oldPath = state.currentFile.path;
    const rootPath = state.currentFolder && pathIsInside(state.currentFolder, oldPath)
      ? state.currentFolder
      : pathDirname(oldPath);
    try {
      const result = await window.api.renameEntry(rootPath, oldPath, requested + pathExtension(oldPath));
      await applyRenameResult(result);
    } catch (err) {
      await window.api.showError('Cannot rename file', err.message);
      dom.documentTitle.value = requested;
      setTimeout(() => { dom.documentTitle.focus(); dom.documentTitle.select(); }, 0);
    }
  });
}

// ===== Status bar =====
function updateStatusFile(filePath) {
  if (filePath) {
    const parts = filePath.split(/[/\\]/);
    dom.statusFile.textContent = parts[parts.length - 1];
    dom.statusFile.title = filePath;
  } else {
    dom.statusFile.textContent = 'Untitled';
    dom.statusFile.title = '';
  }
}

function setupStatusBar() {
  dom.statusFile.addEventListener('click', () => {
    if (state.currentFile && state.currentFile.path) {
      window.api.showInFolder(state.currentFile.path).catch(err => {
        window.api.showError('Cannot show file', err.message);
      });
    }
  });
}

// ===== Recent files =====
async function loadRecent() {
  const recent = await window.api.getRecent();
  dom.recentList.innerHTML = '';
  if (!recent.length) {
    dom.recentList.innerHTML = '<div class="outline-empty">No recent files</div>';
    return;
  }
  recent.forEach(filePath => {
    const parts = filePath.split(/[/\\]/);
    const name = parts.pop();
    const dir = parts.join('/');
    const el = document.createElement('div');
    el.className = 'recent-item';
    const title = document.createElement('div');
    title.className = 'recent-name';
    title.append(createFileIcon(documentTypes.typeOf(name)), document.createTextNode(name));
    const location = document.createElement('div');
    location.className = 'recent-path';
    location.textContent = dir;
    el.append(title, location);
    el.addEventListener('click', () => openPath(filePath));
    el.addEventListener('contextmenu', event => {
      event.preventDefault();
      showFileContextMenu(event.clientX, event.clientY, { name, path: filePath });
    });
    dom.recentList.appendChild(el);
  });
}

// ===== File tree =====
async function openFolder(folderPath) {
  if (normalizedPath(state.currentFolder) !== normalizedPath(folderPath)) {
    state.expandedFolders.clear();
    state.selectedTreePath = null;
  }
  state.currentFolder = folderPath;
  const parts = folderPath.split(/[/\\]/);
  dom.folderName.textContent = parts[parts.length - 1] || folderPath;
  await refreshFileTree();
  switchPanel('files');
}

async function refreshFileTree({ selectPath = state.selectedTreePath } = {}) {
  if (!state.currentFolder) return;
  const tree = await window.api.getDirTree(state.currentFolder);
  dom.fileTree.innerHTML = '';
  renderTree(dom.fileTree, tree, 0);
  if (selectPath) selectTreePath(selectPath);
}

function renderTree(container, nodes, depth) {
  nodes.forEach(node => {
    if (node.stub) {
      // Depth-limit marker from getDirTree — informational, not clickable
      const stub = document.createElement('div');
      stub.className = 'tree-item stub';
      stub.style.paddingLeft = `${8 + depth * 14}px`;
      stub.textContent = node.name;
      container.appendChild(stub);
      return;
    }
    const item = document.createElement('div');
    item.className = `tree-item${node.isDir ? ' is-dir' : ''}`;
    item.dataset.path = node.path;
    item.dataset.isDir = String(node.isDir);
    item.style.paddingLeft = `${8 + depth * 14}px`;
    if (normalizedPath(node.path) === normalizedPath(state.selectedTreePath)) item.classList.add('active');

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.append(createFileIcon(node.isDir ? 'folder' : documentTypes.typeOf(node.name)));

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectTreePath(node.path);
      showFileContextMenu(e.clientX, e.clientY, node);
    });

    if (node.isDir && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.dataset.parentPath = node.path;
      childContainer.dataset.depth = String(depth + 1);
      renderTree(childContainer, node.children, depth + 1);
      container.appendChild(childContainer);

      if (state.expandedFolders.has(normalizedPath(node.path))) {
        item.classList.add('open');
        childContainer.classList.add('open');
      }

      item.addEventListener('click', () => {
        const willOpen = !item.classList.contains('open');
        item.classList.toggle('open', willOpen);
        childContainer.classList.toggle('open', willOpen);
        const key = normalizedPath(node.path);
        if (willOpen) state.expandedFolders.add(key);
        else state.expandedFolders.delete(key);
        selectTreePath(node.path);
      });
    } else {
      item.addEventListener('click', () => {
        selectTreePath(node.path);
        if (documentTypes.typeOf(node.name)) openPath(node.path);
      });
    }
  });
}

function selectTreePath(filePath) {
  state.selectedTreePath = filePath || null;
  $$('.tree-item.active').forEach(el => el.classList.remove('active'));
  if (!filePath) return;
  const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
  if (treeItem) treeItem.classList.add('active');
}

const documentIcon = 'M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z M9 1.5v3h3';
const fileIcons = {
  markdown: documentIcon + ' M5.7 11V7.6l2.3 2 2.3-2V11',
  text: documentIcon + ' M6 7.5h4 M6 9.7h4 M6 11.9h2.5',
  html: documentIcon + ' M7.2 8l-1.5 1.6 1.5 1.6m1.6-3.2 1.5 1.6-1.5 1.6',
  folder: 'M1.5 12.5v-9h4.3l1.6 2h7.1v7Z',
  generic: documentIcon,
};
const menuIcons = {
  open: 'M2 3.5h12v9H2Z M5 8h6m-2-2 2 2-2 2',
  tab: 'M2 3.5h12v9H2Z M2 6h12m-8 3h4m-2-2v4',
  duplicate: 'M5.5 5h8v9h-8Z M10.5 2H2.5v9',
  copy: 'M5.5 3.5h-2v10h9v-10h-2 M6 2h4v3H6Z',
  reveal: 'M2 13V5h4l1-2h7v10Z M7 10l4-4m-4 0h4v4',
  rename: 'm2.5 13 .6-3.2 7.6-7.6 2.7 2.7-7.6 7.6Z M9.4 3.5l2.7 2.7',
  trash: 'M2.5 4.5h11m-9 0 .6 9h5.8l.6-9M6 4.5v-2h4v2m-3 2v4m2-4v4',
  add: 'M3 2h7l3 3v9H3Z M8 7v5m-2-2.5h4',
  folder: fileIcons.folder,
};

function lineIcon(path) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function createFileIcon(type) {
  const icon = document.createElement('span');
  icon.className = 'file-type-icon';
  icon.dataset.type = type || 'generic';
  icon.title = documentTypes.types[type]?.label || (type === 'folder' ? 'Folder' : 'File');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', icon.title);
  icon.append(lineIcon(fileIcons[type] || fileIcons.generic));
  return icon;
}

// ===== File context menu =====
let previousMenuFocus;
let menuParent;
let toastTimeout;

function setupFileContextMenu() {
  dom.fileTree.addEventListener('contextmenu', event => {
    if (event.target.closest('.tree-item')) return;
    event.preventDefault();
    selectTreePath(null);
    showFileContextMenu(event.clientX, event.clientY, null);
  });
  document.addEventListener('mousedown', event => {
    if (!dom.fileContextMenu.contains(event.target)) hideFileContextMenu();
  });
  document.addEventListener('scroll', event => {
    if (!dom.fileContextMenu.contains(event.target)) hideFileContextMenu();
  }, true);
  window.addEventListener('blur', () => hideFileContextMenu());
  dom.fileContextMenu.addEventListener('keydown', event => {
    const items = [...dom.fileContextMenu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') hideFileContextMenu(true);
    else if (event.key === 'ArrowLeft' && menuParent) menuParent();
    else if (event.key === 'ArrowRight' && document.activeElement?.hasAttribute('aria-haspopup')) {
      document.activeElement.click();
    } else if (event.key === 'ArrowDown' && items.length) items[(index + 1) % items.length].focus();
    else if (event.key === 'ArrowUp' && items.length) items[(index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length)].focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
}

function hideFileContextMenu(restoreFocus = false) {
  if (dom.fileContextMenu.classList.contains('hidden')) return;
  dom.fileContextMenu.classList.add('hidden');
  if (restoreFocus) previousMenuFocus?.focus({ preventScroll: true });
  previousMenuFocus = null;
  menuParent = null;
}

function showFileContextMenu(x, y, node) {
  if (!node && !state.currentFolder) return;
  if (state.transitioning) return;
  if (dom.fileContextMenu.classList.contains('hidden')) previousMenuFocus = document.activeElement;
  const groups = [];
  if (!node || node.isDir) {
    groups.push([
      { action: 'new-markdown', label: 'New Markdown File', icon: 'add' },
      { action: 'new-folder', label: 'New Folder', icon: 'folder' },
    ]);
  } else if (documentTypes.typeOf(node.name)) {
    groups.push([
      { action: 'open', label: 'Open', icon: 'open' },
      { action: 'open-tab', label: 'Open in New Tab', icon: 'tab' },
    ]);
  }

  if (node) {
    const disabled = !node.path;
    const relative = node.path && pathIsInside(state.currentFolder, node.path);
    if (!node.isDir) groups.push([{ action: 'duplicate', label: 'Create Copy', icon: 'duplicate', disabled }]);
    groups.push([
      {
        label: 'Copy Path', icon: 'copy', disabled,
        children: [
          { action: 'copy-full-path', label: 'Full Path', icon: 'copy' },
          { action: 'copy-relative-path', label: 'Relative Path', icon: 'copy', disabled: !relative },
        ],
      },
      { action: 'show-in-folder', label: 'Show in File Explorer', icon: 'reveal', disabled },
    ], [
      { action: 'rename', label: 'Rename', icon: 'rename', disabled },
      { action: 'trash', label: 'Move to Recycle Bin', icon: 'trash', disabled, danger: true },
    ]);
  }
  renderFileMenu(groups, x, y, node);
}

function renderFileMenu(groups, x, y, node, back = null) {
  menuParent = back;
  dom.fileContextMenu.replaceChildren();
  groups.forEach((group, index) => {
    if (index) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      separator.setAttribute('role', 'separator');
      dom.fileContextMenu.appendChild(separator);
    }
    for (const entry of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-menu-item' + (entry.danger ? ' danger' : '');
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(entry.disabled);
      const icon = document.createElement('span');
      icon.className = 'context-menu-icon';
      icon.append(lineIcon(menuIcons[entry.icon]));
      const label = document.createElement('span');
      label.textContent = entry.label;
      button.append(icon, label);
      if (entry.children) {
        button.setAttribute('aria-haspopup', 'menu');
        const arrow = document.createElement('span');
        arrow.className = 'context-menu-arrow';
        arrow.textContent = '›';
        button.append(arrow);
        button.addEventListener('click', () => {
          const showParent = () => renderFileMenu(groups, x, y, node);
          renderFileMenu(
            [[{ action: 'back', label: 'Back', icon: 'open' }], entry.children],
            x, y, node, showParent,
          );
        });
      } else {
        button.addEventListener('click', () => {
          if (entry.action === 'back') {
            back();
            return;
          }
          hideFileContextMenu(true);
          runFileAction(entry.action, node);
        });
      }
      dom.fileContextMenu.appendChild(button);
    }
  });
  dom.fileContextMenu.classList.remove('hidden');
  const rect = dom.fileContextMenu.getBoundingClientRect();
  dom.fileContextMenu.style.left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6)) + 'px';
  dom.fileContextMenu.style.top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 6)) + 'px';
  const firstEnabled = back ? 'button:nth-of-type(2):not(:disabled)' : 'button:not(:disabled)';
  dom.fileContextMenu.querySelector(firstEnabled)?.focus({ preventScroll: true });
}

function showFileToast(message) {
  const toast = $('#file-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 1800);
}

function contextDirectory(node) {
  if (!node) return state.currentFolder;
  return node.isDir ? node.path : pathDirname(node.path);
}

function operationRoot(filePath) {
  return pathIsInside(state.currentFolder, filePath) ? state.currentFolder : pathDirname(filePath);
}

async function runFileAction(action, node) {
  if (state.transitioning) return;
  try {
    if (action === 'open' || action === 'open-tab') {
      await openPath(node.path, { keepPlaceholder: action === 'open-tab' });
    } else if (action === 'new-markdown' || action === 'new-folder') {
      await startInlineCreate(contextDirectory(node), action === 'new-markdown' ? 'markdown' : 'folder');
    } else if (action === 'duplicate') {
      const doc = findOpenDocument(node.path);
      if (doc?.modified) {
        const choice = await window.api.confirmCopy(node.name);
        if (choice === 2 || (choice === 0 && !(await saveFile(doc)))) return;
      }
      const newPath = await window.api.duplicateEntry(operationRoot(node.path), node.path);
      await refreshFileTree({ selectPath: newPath });
      showFileToast('Copy created');
    } else if (action === 'copy-full-path' || action === 'copy-relative-path') {
      const relative = action === 'copy-relative-path';
      await window.api.copyPath(relative ? state.currentFolder : operationRoot(node.path), node.path, relative);
      showFileToast('Path copied');
    } else if (action === 'show-in-folder') {
      await window.api.showInFolder(node.path);
    } else if (action === 'rename') {
      if (node.isDir) startInlineRename(node);
      else await renameDocument(node);
    } else if (action === 'trash') {
      await trashTreeEntry(node);
    }
  } catch (err) {
    await window.api.showError('File operation failed', err.message);
  }
}

async function renameDocument(node) {
  const dialog = $('#rename-dialog');
  const input = $('#rename-name');
  dialog.returnValue = 'cancel';
  input.value = pathStem(node.name);
  const renamed = await new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'rename'), { once: true });
    dialog.showModal();
    input.select();
  });
  const requested = input.value.trim();
  if (!renamed || !requested || requested === pathStem(node.name)) return;
  const source = findOpenDocument(node.path);
  if (source?.saving) await source.saving;
  const result = await window.api.renameEntry(operationRoot(node.path), node.path, requested + pathExtension(node.name));
  await applyRenameResult(result);
}


async function startInlineCreate(directoryPath, kind) {
  if (normalizedPath(directoryPath) !== normalizedPath(state.currentFolder)) {
    state.expandedFolders.add(normalizedPath(directoryPath));
  }
  await refreshFileTree();
  const container = normalizedPath(directoryPath) === normalizedPath(state.currentFolder)
    ? dom.fileTree
    : document.querySelector(`.tree-children[data-parent-path="${CSS.escape(directoryPath)}"]`);
  if (!container) throw new Error('The destination folder is not visible.');

  const depth = Number(container.dataset.depth || 0);
  const row = document.createElement('div');
  row.className = 'tree-item editing';
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = kind === 'markdown' ? '📄' : '▸';
  const input = document.createElement('input');
  input.className = 'tree-inline-input';
  input.placeholder = kind === 'markdown' ? 'Note name' : 'Folder name';
  row.append(icon, input);
  container.prepend(row);

  let finished = false;
  const cancel = async () => {
    if (finished) return;
    finished = true;
    row.remove();
  };
  const commit = async () => {
    if (finished) return;
    const name = input.value.trim();
    if (!name) { await cancel(); return; }
    try {
      const newPath = kind === 'markdown'
        ? await window.api.createMarkdown(state.currentFolder, directoryPath, name)
        : await window.api.createFolder(state.currentFolder, directoryPath, name);
      finished = true;
      state.selectedTreePath = newPath;
      await refreshFileTree({ selectPath: newPath });
      if (kind === 'markdown') {
        await openPath(newPath);
      }
    } catch (err) {
      await window.api.showError(kind === 'markdown' ? 'Cannot create file' : 'Cannot create folder', err.message);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', () => { if (!finished) commit(); });
  input.focus();
}

function startInlineRename(node) {
  const item = document.querySelector(`.tree-item[data-path="${CSS.escape(node.path)}"]`);
  if (!item) return;
  const nameEl = item.querySelector('.tree-name');
  if (!nameEl) return;
  item.classList.add('editing');
  nameEl.classList.add('hidden');
  const input = document.createElement('input');
  input.className = 'tree-inline-input';
  input.value = node.name;
  item.appendChild(input);
  let finished = false;
  const cancel = () => {
    if (finished) return;
    finished = true;
    input.remove();
    nameEl.classList.remove('hidden');
    item.classList.remove('editing');
  };
  const commit = async () => {
    if (finished) return;
    const name = input.value.trim();
    if (!name || name === node.name) { cancel(); return; }
    try {
      const result = await window.api.renameEntry(state.currentFolder, node.path, name);
      finished = true;
      await applyRenameResult(result);
    } catch (err) {
      await window.api.showError('Cannot rename item', err.message);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', () => { if (!finished) commit(); });
  input.addEventListener('click', e => e.stopPropagation());
  input.focus();
  input.select();
}

async function applyRenameResult(result) {
  if (result.isDir) {
    state.expandedFolders = new Set([...state.expandedFolders].map(p =>
      pathIsInside(result.oldPath, p) ? normalizedPath(rebaseClientPath(p, result.oldPath, result.newPath)) : p
    ));
  }
  if (state.selectedTreePath && pathIsInside(result.oldPath, state.selectedTreePath)) {
    state.selectedTreePath = rebaseClientPath(state.selectedTreePath, result.oldPath, result.newPath);
  } else {
    state.selectedTreePath = result.newPath;
  }
  for (const doc of state.documents) {
    if (pathIsInside(result.oldPath, doc.path)) {
      doc.path = rebaseClientPath(doc.path, result.oldPath, result.newPath);
    }
  }
  syncDocumentState();
  if (state.currentFile) updateDocumentMode(state.currentFile);
  await refreshFileTree({ selectPath: state.selectedTreePath });
  if (state.sidebarPanel === 'recent') await loadRecent();
}

async function trashTreeEntry(node) {
  state.transitioning = true;
  try {
    const affected = state.documents.filter(doc => pathIsInside(node.path, doc.path));
    for (const doc of affected) {
      if (!(await ensureSaved(doc))) return;
    }
    const result = await window.api.trashEntry(operationRoot(node.path), node.path);
    if (!result.trashed) return;
    state.expandedFolders = new Set([...state.expandedFolders].filter(p => !pathIsInside(node.path, p)));
    for (const doc of affected) {
      if (pathIsInside(node.path, doc.path)) removeDocument(doc);
    }
    if (!state.currentFile) await newFile();
    if (state.selectedTreePath && pathIsInside(node.path, state.selectedTreePath)) state.selectedTreePath = null;
    await refreshFileTree();
    if (state.sidebarPanel === 'recent') await loadRecent();
  } finally {
    state.transitioning = false;
  }
}

// ===== Sidebar =====
function setupSidebar() {
  dom.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchPanel(btn.dataset.tab);
    });
  });

  dom.btnOpenFolder.addEventListener('click', async () => {
    const folder = await window.api.openFolderDialog();
    if (folder) await openFolder(folder);
  });

  dom.btnNewFile.addEventListener('click', () => {
    newFile();
  });
}

function switchPanel(panelName) {
  state.sidebarPanel = panelName;
  dom.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === panelName));
  dom.panels.forEach(panel => panel.classList.toggle('active', panel.id === `panel-${panelName}`));
  if (panelName === 'recent') loadRecent();
  if (panelName === 'outline') updateOutline();
}

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  dom.sidebar.classList.toggle('hidden', !state.sidebarVisible);
}

// ===== Resize handle =====
function setupResizeHandle() {
  let startX, startWidth;
  dom.resizeHandle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(dom.sidebar).width, 10);
    dom.resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      const newWidth = Math.max(160, Math.min(480, startWidth + (e.clientX - startX)));
      dom.sidebar.style.width = newWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
    };
    const onUp = () => {
      dom.resizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ===== Drag & drop =====
function setupDragDrop() {
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = [...e.dataTransfer.files];
    for (const file of files) {
      const type = documentTypes.typeOf(file.name);
      if (!type) continue;
      const filePath = window.api.getPathForFile(file);
      if (filePath) await openPath(filePath);
      else {
        const doc = await createDocument(null, await file.text(), type);
        onEditorInput(doc);
      }
    }
  });
}

// ===== Find / Replace =====
function setupFindBar() {
  $('#find-close').addEventListener('click', hideFindBar);
  $('#find-prev').addEventListener('click', () => findNavigate(-1));
  $('#find-next').addEventListener('click', () => findNavigate(1));
  $('#replace-one').addEventListener('click', doReplaceOne);
  $('#replace-all').addEventListener('click', doReplaceAll);

  dom.findInput.addEventListener('input', doFind);
  dom.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.shiftKey ? findNavigate(-1) : findNavigate(1); }
    if (e.key === 'Escape') hideFindBar();
  });
  dom.replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFindBar();
  });
}

function showFindBar(replace = false) {
  if (!state.currentFile) return;
  setHtmlMode(state.currentFile, 'source');
  dom.findBar.classList.remove('hidden');
  dom.replaceInput.classList.toggle('hidden', !replace);
  dom.replaceOne.classList.toggle('hidden', !replace);
  dom.replaceAll.classList.toggle('hidden', !replace);
  dom.findInput.focus();
  dom.findInput.select();
  doFind();
}

function hideFindBar() {
  dom.findBar.classList.add('hidden');
  dom.findInput.value = '';
  dom.findCount.textContent = '';
}

// Case-insensitive source-text search. Matching, navigation and replacement all
// share the same rules so the counter never disagrees with what replace does.
function doFind() {
  const q = dom.findInput.value;
  state.findMatches = [];
  state.findIndex = -1; // nothing visited yet
  if (!q || !state.currentFile) { dom.findCount.textContent = ''; return; }
  const content = documentContent();
  const lower = content.toLowerCase();
  const qLower = q.toLowerCase();
  let idx = 0;
  while ((idx = lower.indexOf(qLower, idx)) !== -1) {
    state.findMatches.push(idx);
    idx += q.length;
  }
  dom.findCount.textContent = state.findMatches.length
    ? `${state.findMatches.length} matches`
    : 'Not found';
}

function findNavigate(dir) {
  const q = dom.findInput.value;
  if (!q || !state.findMatches.length) return;
  const n = state.findMatches.length;
  if (state.findIndex === -1) state.findIndex = dir > 0 ? 0 : n - 1;
  else state.findIndex = (state.findIndex + dir + n) % n;
  dom.findCount.textContent = `${state.findIndex + 1} / ${n}`;
  if (state.currentFile.source) {
    setHtmlMode(state.currentFile, 'source');
    const offset = state.findMatches[state.findIndex];
    state.currentFile.source.focus();
    state.currentFile.source.setSelectionRange(offset, offset + q.length);
  } else {
    window.find(q, false, dir < 0, true, false, false, false);
  }
}

function doReplaceOne() {
  const q = dom.findInput.value;
  const r = dom.replaceInput.value;
  if (!q) return;
  // Re-scan first: the editor content may have changed since the last doFind
  const keep = state.findIndex;
  doFind();
  if (!state.findMatches.length) return;
  const at = keep >= 0 && keep < state.findMatches.length ? keep : 0;
  const pos = state.findMatches[at];
  const content = documentContent();
  // Positional splice: replaces exactly the current occurrence and keeps
  // `$`-patterns in the replacement string literal.
  const newContent = content.slice(0, pos) + r + content.slice(pos + q.length);
  setHtmlMode(state.currentFile, 'source');
  setDocumentContent(newContent);
  doFind();
  if (state.findMatches.length) {
    state.findIndex = Math.min(at, state.findMatches.length - 1);
    dom.findCount.textContent = `${state.findIndex + 1} / ${state.findMatches.length}`;
  }
}

function doReplaceAll() {
  const q = dom.findInput.value;
  const r = dom.replaceInput.value;
  if (!q) return;
  if (!state.currentFile) return;
  const content = documentContent();
  const lower = content.toLowerCase();
  const qLower = q.toLowerCase();
  let out = '';
  let i = 0;
  let idx;
  while ((idx = lower.indexOf(qLower, i)) !== -1) {
    out += content.slice(i, idx) + r;
    i = idx + q.length;
  }
  out += content.slice(i);
  if (out === content) return;
  setHtmlMode(state.currentFile, 'source');
  setDocumentContent(out);
  doFind();
}

// ===== Theme =====
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (state.currentFile) setEditorTheme(state.currentFile);
  // Persist
  state.settings.theme = theme;
  window.api.saveSettings(state.settings);
}

function setEditorTheme(doc) {
  if (!doc.editor || doc.theme === state.theme) return;
  doc.theme = state.theme;
  const dark = doc.theme === 'dark';
  doc.editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light',
    dark ? 'github-dark' : 'github');
}

// ===== Focus / Typewriter mode =====
function toggleFocusMode() {
  if (!state.vditor) return;
  state.focusMode = !state.focusMode;
  const el = getEditorEl();
  if (el) el.classList.toggle('focus-mode', state.focusMode);
  if (state.focusMode) {
    updateCurrentBlock();
  } else {
    $$('.current-block').forEach(b => b.classList.remove('current-block'));
  }
}

// Tag the top-level block that holds the caret with .current-block so the
// focus-mode CSS can highlight it. The editor is one contenteditable, so this
// has to be tracked from the selection — CSS alone can't tell blocks apart.
function updateCurrentBlock() {
  const editable = getEditorEl()?.querySelector(':scope > .vditor-reset');
  if (!editable) return;
  let block = null;
  const sel = window.getSelection();
  if (sel && sel.anchorNode && editable.contains(sel.anchorNode)) {
    let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    while (node && node.parentElement !== editable) node = node.parentElement;
    if (node && node !== editable) block = node;
  }
  editable.querySelectorAll(':scope > .current-block').forEach(el => {
    if (el !== block) el.classList.remove('current-block');
  });
  if (block) block.classList.add('current-block');
}

// Coalesce the bursts of selectionchange events per edit into one update.
// setTimeout (not rAF): rAF never fires while the window is hidden/minimized,
// which would leave the scheduled flag stuck and the highlight frozen.
let currentBlockScheduled = false;
document.addEventListener('selectionchange', () => {
  if (!state.focusMode || currentBlockScheduled) return;
  currentBlockScheduled = true;
  setTimeout(() => {
    currentBlockScheduled = false;
    // Re-check at run time: focus mode may have been toggled off since scheduling
    if (state.focusMode) updateCurrentBlock();
  }, 0);
});

function toggleTypewriterMode() {
  if (!state.vditor) return;
  state.typewriterMode = !state.typewriterMode;
  dom.editorWrapper.classList.toggle('typewriter-mode', state.typewriterMode);
  if (state.typewriterMode) scrollToCursor();
}

function scrollToCursor() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.height) return;
  const wrapper = dom.editorWrapper;
  const target = rect.top + wrapper.scrollTop - (wrapper.clientHeight / 2);
  wrapper.scrollTo({ top: target, behavior: 'smooth' });
}

// ===== Editor mode (ir / sv) =====
async function toggleSourceMode() {
  const doc = state.currentFile;
  if (doc?.type === 'html') {
    setHtmlMode(doc, doc.htmlMode === 'preview' ? 'source' : 'preview');
    return;
  }
  if (!doc?.editor || doc.initializing) return;
  const newMode = doc.mode === 'ir' ? 'sv' : 'ir';
  doc.mode = newMode;

  // Destroy and reinit vditor with the new mode, using the same option set as
  // the initial editor so behavior doesn't drift between modes.
  const button = doc.editor.vditor.toolbar.elements['edit-mode']
    ?.querySelector(`[data-mode="${newMode}"]`);
  if (button) button.click();
  else {
    const content = doc.editor.getValue();
    doc.initializing = true;
    doc.editor.destroy();
    await initVditor(doc, content);
    doc.initializing = false;
  }
  // Re-apply per-editor state lost when the DOM was rebuilt
  if (state.focusMode) {
    const el = getEditorEl();
    if (el) el.classList.add('focus-mode');
    updateCurrentBlock();
  }
  if (doc === state.currentFile) updateDocumentMode(doc);
}

// ===== Keyboard shortcuts =====
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); return; }
    if (ctrl && e.key === 'S') { e.preventDefault(); saveFileAs(); return; }
    if (ctrl && e.key === 'o' && !e.shiftKey) { e.preventDefault(); doMenuOpen(); return; }
    if (ctrl && e.key === 'n' && !e.shiftKey) { e.preventDefault(); newFile(); return; }
    if (ctrl && e.key === 'w' && state.currentFile) { e.preventDefault(); closeDocument(state.currentFile); return; }
    if (ctrl && e.key === '/') { e.preventDefault(); toggleSourceMode(); return; }
    if (ctrl && e.key === 'f' && !e.shiftKey) { e.preventDefault(); showFindBar(false); return; }
    if (ctrl && e.key === 'h') { e.preventDefault(); showFindBar(true); return; }
    if (ctrl && e.shiftKey && e.key === 'L') { e.preventDefault(); toggleSidebar(); return; }
    // Ctrl+Shift+1/2/3 are handled by the menu accelerators (with Shift held,
    // e.key reports '!'/'@'/'#' here, so they can't be matched reliably).
    if (e.key === 'F8') { e.preventDefault(); toggleFocusMode(); return; }
    if (e.key === 'F9') { e.preventDefault(); toggleTypewriterMode(); return; }
    if (e.key === 'Escape') {
      if (!dom.findBar.classList.contains('hidden')) { hideFindBar(); return; }
    }
  });
}

// ===== Menu actions from main =====
function setupMenuActions() {
  window.api.on('menu-action', handleMenuAction);
  window.api.on('open-file', openPath);
  window.api.on('open-folder', (folder) => openFolder(folder));
}

async function doMenuOpen() {
  const filePath = await window.api.openFileDialog();
  if (filePath) await openPath(filePath);
}

async function handleMenuAction(action) {
  switch (action) {
    case 'new': await newFile(); break;
    case 'save': await saveFile(); break;
    case 'save-as': await saveFileAs(); break;
    case 'close-tab': await closeDocument(state.currentFile); break;
    case 'close-window': await closeWindow(); break;
    case 'export-pdf': await exportPDF(); break;
    case 'export-html': await exportHTML(); break;
    case 'find': showFindBar(false); break;
    case 'find-replace': showFindBar(true); break;
    case 'toggle-sidebar': toggleSidebar(); break;
    case 'sidebar-outline': switchPanel('outline'); break;
    case 'sidebar-recent': switchPanel('recent'); break;
    case 'sidebar-files': switchPanel('files'); break;
    case 'focus-mode': toggleFocusMode(); break;
    case 'typewriter-mode': toggleTypewriterMode(); break;
    case 'source-mode': toggleSourceMode(); break;
    case 'theme-light': applyTheme('light'); break;
    case 'theme-dark': applyTheme('dark'); break;
    case 'theme-github': applyTheme('github'); break;
    case 'theme-solarized': applyTheme('solarized'); break;
    // Format actions via vditor commands
    case 'bold': state.vditor.focus(); document.execCommand('bold'); break;
    case 'italic': state.vditor.focus(); document.execCommand('italic'); break;
    case 'h1': insertHeading(1); break;
    case 'h2': insertHeading(2); break;
    case 'h3': insertHeading(3); break;
    case 'h4': insertHeading(4); break;
    case 'blockquote': state.vditor.insertValue('\n> '); break;
    case 'code-block': state.vditor.insertValue('\n```\n\n```\n'); break;
    case 'math-block': state.vditor.insertValue('\n$$\n\n$$\n'); break;
    case 'hr': state.vditor.insertValue('\n---\n'); break;
    case 'table': state.vditor.insertValue('\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n'); break;
    case 'link': state.vditor.insertValue('[Link text](url)'); break;
    case 'image': state.vditor.insertValue('![Alt text](image-url)'); break;
    case 'ordered-list': state.vditor.insertValue('\n1. Item 1\n2. Item 2\n3. Item 3\n'); break;
    case 'unordered-list': state.vditor.insertValue('\n- Item 1\n- Item 2\n- Item 3\n'); break;
    case 'task-list': state.vditor.insertValue('\n- [ ] Task 1\n- [ ] Task 2\n- [x] Done\n'); break;
    case 'strikethrough': state.vditor.insertValue('~~strikethrough~~'); break;
    case 'inline-code': state.vditor.insertValue('`code`'); break;
  }
}

function insertHeading(level) {
  const prefix = '#'.repeat(level) + ' ';
  state.vditor.insertValue('\n' + prefix);
}

// ===== Export =====
async function exportPDF() {
  const doc = state.currentFile;
  if (!doc) return;
  const name = pathStem(documentName(doc)) + '.pdf';
  try {
    const source = doc.type === 'html' ? doc.source.value :
      doc.type === 'text' ? '<pre style="white-space: pre-wrap">' + escHtml(doc.source.value) + '</pre>' : null;
    await window.api.exportPDF(name, source === null ? null : { filePath: doc.path, source });
  } catch (err) {
    window.api.showError('PDF export failed', err.message);
  }
}

async function exportHTML() {
  const doc = state.currentFile;
  if (!doc) return;
  const stem = pathStem(documentName(doc));
  const name = stem + (doc.type === 'html' ? '-export.html' : '.html');
  const body = doc.editor ? doc.editor.getHTML() : '<pre>' + escHtml(doc.source.value) + '</pre>';
  const fullHtml = doc.type === 'html' ? (doc.modified ? doc.bom + doc.source.value.replace(/\n/g, doc.newline) : doc.raw) :
    buildExportHTML(body, stem);
  try {
    await window.api.exportHTML(fullHtml, name);
  } catch (err) {
    window.api.showError('HTML export failed', err.message);
  }
}

function buildExportHTML(body, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; color: #333; line-height: 1.75; }
  h1,h2 { border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 16px; overflow-x: auto; }
  code { background: rgba(0,0,0,0.06); padding: 0.2em 0.4em; border-radius: 3px; font-size: 87.5%; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #666; }
  table { border-collapse: collapse; width: 100%; }
  th,td { border: 1px solid #ddd; padding: 8px 12px; }
  th { background: #f6f8fa; }
  a { color: #4183c4; }
  img { max-width: 100%; }
</style>
</head>
<body>${body}</body>
</html>`;
}

// ===== Utils =====
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ===== Bootstrap =====
document.addEventListener('DOMContentLoaded', init);
