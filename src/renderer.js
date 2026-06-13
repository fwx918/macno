'use strict';

// ===== State =====
const state = {
  vditor: null,
  currentFile: null,       // { path, content }
  currentFolder: null,
  modified: false,
  sidebarVisible: true,
  sidebarPanel: 'outline', // outline | recent | files
  focusMode: false,
  typewriterMode: false,
  editorMode: 'ir',        // ir | sv
  theme: 'light',
  findMatches: [],
  findIndex: 0,
  settings: {},
  suppressInput: false,    // prevent onEditorInput during programmatic setValue
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

  await initVditor();
  await loadRecent();

  setupSidebar();
  setupResizeHandle();
  setupStatusBar();
  setupFindBar();
  setupDragDrop();
  setupKeyboardShortcuts();
  setupMenuActions();

  // Check if a file was opened from main
  const current = await window.api.getCurrentFile();
  if (current && current.path) {
    await openFile(current.path, await window.api.readFile(current.path));
  } else {
    setNewFile();
  }
}

// ===== vditor =====
function makeVditorOptions(mode, content, onReady) {
  const isDark = state.theme === 'dark';
  const statusH = 28;
  return {
    mode,
    minHeight: Math.max(400, window.innerHeight - statusH),
    cdn: '../node_modules/vditor',
    toolbar: [],
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
    input: () => onEditorInput(),
    focus: () => {},
    blur: () => {},
    keydown: (e) => handleEditorKeydown(e),
  };
}

function initVditor() {
  return new Promise((resolve) => {
    state.vditor = new Vditor('editor', makeVditorOptions('ir', '', resolve));
  });
}

function getEditorEl() {
  return document.querySelector('.vditor-ir') || document.querySelector('.vditor-sv');
}

// ===== Editor events =====
function onEditorInput() {
  if (state.suppressInput) return;
  if (!state.modified) {
    state.modified = true;
    window.api.setModified(true);
  }
  scheduleOutlineUpdate();
  updateWordCount();
}

let outlineTimer = null;
function scheduleOutlineUpdate() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(updateOutline, 400);
}

function handleEditorKeydown(e) {
  if (state.typewriterMode) {
    requestAnimationFrame(scrollToCursor);
  }
}

// ===== File operations =====
function setNewFile() {
  state.currentFile = null;
  state.modified = false;
  state.suppressInput = true;
  state.vditor.setValue('');
  state.suppressInput = false;
  window.api.setModified(false);
  window.api.setCurrentPath(null);
  updateStatusFile(null);
  updateOutline();
  updateWordCount();
}

async function openFile(filePath, content) {
  state.currentFile = { path: filePath, content };
  state.modified = false;
  state.suppressInput = true;
  state.vditor.setValue(content || '');
  state.suppressInput = false;
  window.api.setModified(false);
  updateStatusFile(filePath);
  scheduleOutlineUpdate();
  updateWordCount();
  // Highlight active item in file tree
  $$('.tree-item.active').forEach(el => el.classList.remove('active'));
  const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
  if (treeItem) treeItem.classList.add('active');
}

async function saveFile() {
  const content = state.vditor.getValue();
  if (state.currentFile && state.currentFile.path) {
    await window.api.writeFile(state.currentFile.path, content);
    state.modified = false;
    window.api.setModified(false);
    state.currentFile.content = content;
  } else {
    await saveFileAs();
  }
}

async function saveFileAs() {
  const content = state.vditor.getValue();
  const defaultPath = state.currentFile ? state.currentFile.path : null;
  const filePath = await window.api.saveDialog(defaultPath);
  if (!filePath) return;
  await window.api.writeFile(filePath, content);
  state.currentFile = { path: filePath, content };
  state.modified = false;
  window.api.setModified(false);
  window.api.setCurrentPath(filePath);
  updateStatusFile(filePath);
}

// ===== Outline =====
function updateOutline() {
  const content = state.vditor.getValue();
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
  const text = state.vditor.getValue();
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
      window.api.showInFolder(state.currentFile.path);
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
    el.innerHTML = `<div class="recent-name">${escHtml(name)}</div><div class="recent-path">${escHtml(dir)}</div>`;
    el.addEventListener('click', async () => {
      try {
        const content = await window.api.readFile(filePath);
        await openFile(filePath, content);
      } catch (e) {
        alert(`Cannot open: ${filePath}`);
      }
    });
    dom.recentList.appendChild(el);
  });
}

// ===== File tree =====
async function openFolder(folderPath) {
  state.currentFolder = folderPath;
  const parts = folderPath.split(/[/\\]/);
  dom.folderName.textContent = parts[parts.length - 1] || folderPath;
  const tree = await window.api.getDirTree(folderPath);
  dom.fileTree.innerHTML = '';
  renderTree(dom.fileTree, tree, 0);
  switchPanel('files');
}

function renderTree(container, nodes, depth) {
  nodes.forEach(node => {
    const item = document.createElement('div');
    item.className = `tree-item${node.isDir ? ' is-dir' : ''}`;
    item.dataset.path = node.path;
    item.style.paddingLeft = `${8 + depth * 14}px`;

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    if (!node.isDir) {
      icon.innerHTML = getFileIcon(node.name);
    }

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    if (node.isDir && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      renderTree(childContainer, node.children, depth + 1);
      container.appendChild(childContainer);

      item.addEventListener('click', () => {
        item.classList.toggle('open');
        childContainer.classList.toggle('open');
      });
    } else {
      item.addEventListener('click', async () => {
        if (!isMarkdown(node.name)) return;
        $$('.tree-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        const content = await window.api.readFile(node.path);
        await openFile(node.path, content);
      });
    }
  });
}

function getFileIcon(name) {
  if (isMarkdown(name)) return '📄';
  if (name.endsWith('.txt')) return '📝';
  if (name.endsWith('.json')) return '📋';
  if (name.endsWith('.js') || name.endsWith('.ts')) return '⚡';
  if (name.endsWith('.css') || name.endsWith('.scss')) return '🎨';
  return '📄';
}

function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name);
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
    setNewFile();
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
    const mdFile = files.find(f => /\.(md|markdown|txt)$/i.test(f.name));
    if (mdFile) {
      const content = await mdFile.text();
      await openFile(mdFile.path || mdFile.name, content);
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
  dom.findBar.classList.remove('hidden');
  dom.replaceInput.classList.toggle('hidden', !replace);
  dom.replaceOne.classList.toggle('hidden', !replace);
  dom.replaceAll.classList.toggle('hidden', !replace);
  dom.findInput.focus();
  dom.findInput.select();
}

function hideFindBar() {
  dom.findBar.classList.add('hidden');
  dom.findInput.value = '';
  dom.findCount.textContent = '';
}

function doFind() {
  // Simple in-content search — vditor doesn't expose a native search API
  const q = dom.findInput.value;
  if (!q) { dom.findCount.textContent = ''; return; }
  const content = state.vditor.getValue();
  const matches = [];
  let idx = 0;
  const lower = content.toLowerCase();
  const qLower = q.toLowerCase();
  while ((idx = lower.indexOf(qLower, idx)) !== -1) {
    matches.push(idx);
    idx += q.length;
  }
  state.findMatches = matches;
  state.findIndex = 0;
  dom.findCount.textContent = matches.length ? `1 / ${matches.length}` : 'Not found';
}

function findNavigate(dir) {
  if (!state.findMatches.length) return;
  state.findIndex = (state.findIndex + dir + state.findMatches.length) % state.findMatches.length;
  dom.findCount.textContent = `${state.findIndex + 1} / ${state.findMatches.length}`;
}

function doReplaceOne() {
  const q = dom.findInput.value;
  const r = dom.replaceInput.value;
  if (!q) return;
  const content = state.vditor.getValue();
  const newContent = content.replace(q, r);
  state.vditor.setValue(newContent);
  onEditorInput();
  doFind();
}

function doReplaceAll() {
  const q = dom.findInput.value;
  const r = dom.replaceInput.value;
  if (!q) return;
  const content = state.vditor.getValue();
  const re = new RegExp(escRegex(q), 'g');
  const newContent = content.replace(re, r);
  state.vditor.setValue(newContent);
  onEditorInput();
  doFind();
}

// ===== Theme =====
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  // Update vditor theme if already initialized
  if (state.vditor) {
    const isDark = theme === 'dark';
    // vditor.setTheme(theme, contentTheme, codeTheme)
    state.vditor.setTheme(
      isDark ? 'dark' : 'classic',
      isDark ? 'dark' : 'light',
      isDark ? 'github-dark' : 'github'
    );
  }
  // Persist
  state.settings.theme = theme;
  window.api.saveSettings(state.settings);
}

// ===== Focus / Typewriter mode =====
function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  const irEl = document.querySelector('.vditor-ir');
  if (irEl) irEl.classList.toggle('focus-mode', state.focusMode);
}

function toggleTypewriterMode() {
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
  const newMode = state.editorMode === 'ir' ? 'sv' : 'ir';
  const content = state.vditor.getValue();
  state.editorMode = newMode;

  // Destroy and reinit vditor with new mode
  state.vditor.destroy();
  document.getElementById('editor').innerHTML = '';
  await reinitVditor(newMode, content);
  dom.statusMode.textContent = newMode === 'sv' ? 'SOURCE' : 'WYSIWYG';
}

function reinitVditor(mode, content) {
  return new Promise((resolve) => {
    state.vditor = new Vditor('editor', {
      mode,
      height: '100%',
      cdn: '../node_modules/vditor',
      toolbar: [],
      toolbarConfig: { hide: true },
      outline: { enable: false },
      counter: { enable: false },
      resize: { enable: false },
      tab: '\t',
      theme: state.theme === 'dark' ? 'dark' : 'classic',
      preview: {
        theme: { current: state.theme === 'dark' ? 'dark' : 'light' },
        math: { engine: 'KaTeX', inlineDigit: true },
        mermaid: { zoom: 1 },
        hljs: { style: state.theme === 'dark' ? 'github-dark' : 'github', lineNumber: false },
      },
      cache: { enable: false },
      value: content,
      after: () => resolve(),
      input: () => onEditorInput(),
      keydown: (e) => handleEditorKeydown(e),
    });
  });
}

// ===== Keyboard shortcuts =====
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); return; }
    if (ctrl && e.key === 'S') { e.preventDefault(); saveFileAs(); return; }
    if (ctrl && e.key === 'o' && !e.shiftKey) { e.preventDefault(); doMenuOpen(); return; }
    if (ctrl && e.key === 'n' && !e.shiftKey) { e.preventDefault(); setNewFile(); return; }
    if (ctrl && e.key === '/') { e.preventDefault(); toggleSourceMode(); return; }
    if (ctrl && e.key === 'f' && !e.shiftKey) { e.preventDefault(); showFindBar(false); return; }
    if (ctrl && e.key === 'h') { e.preventDefault(); showFindBar(true); return; }
    if (ctrl && e.shiftKey && e.key === 'L') { e.preventDefault(); toggleSidebar(); return; }
    if (ctrl && e.shiftKey && e.key === '1') { e.preventDefault(); switchPanel('outline'); return; }
    if (ctrl && e.shiftKey && e.key === '2') { e.preventDefault(); switchPanel('recent'); return; }
    if (ctrl && e.shiftKey && e.key === '3') { e.preventDefault(); switchPanel('files'); return; }
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
  window.api.on('open-file', ({ path, content }) => openFile(path, content));
  window.api.on('open-folder', (folder) => openFolder(folder));
}

async function doMenuOpen() {
  const result = await window.api.openFileDialog();
  if (result) {
    await openFile(result.path, result.content);
    await loadRecent();
  }
}

async function handleMenuAction(action) {
  switch (action) {
    case 'new': setNewFile(); break;
    case 'save': await saveFile(); break;
    case 'save-as': await saveFileAs(); break;
    case 'save-then-close':
      await saveFile();
      window.close();
      break;
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
  const name = state.currentFile
    ? state.currentFile.path.split(/[/\\]/).pop().replace(/\.\w+$/, '.pdf')
    : 'document.pdf';
  await window.api.exportPDF(name);
}

async function exportHTML() {
  const html = state.vditor.getHTML();
  const name = state.currentFile
    ? state.currentFile.path.split(/[/\\]/).pop().replace(/\.\w+$/, '.html')
    : 'document.html';
  const fullHtml = buildExportHTML(html, name.replace('.html', ''));
  await window.api.exportHTML(fullHtml, name);
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Bootstrap =====
document.addEventListener('DOMContentLoaded', init);
