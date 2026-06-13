// Unit test for the outline-navigation fix. Loads the REAL renderer.js into a
// vm sandbox with DOM stubs (init never runs — it's gated on DOMContentLoaded)
// and exercises extractHeadings + jumpToHeading against the cases that were
// broken before: duplicate heading titles, inline-formatted headings, and a
// rendered/outline count mismatch (fallback path).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

let editor = null; // getEditorEl() resolves document.querySelector('.vditor-ir') to this

function makeH(text) {
  return {
    _t: text, style: {}, dataset: {}, _scrolled: false,
    get textContent() { return this._t; },
    set textContent(v) { this._t = v; },
    scrollIntoView() { this._scrolled = true; },
  };
}
function makeGeneric() {
  return {
    style: {}, dataset: {}, _html: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    appendChild() {}, addEventListener() {}, setAttribute() {},
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
  };
}

const documentStub = {
  querySelector(sel) {
    if (typeof sel === 'string' && sel.indexOf('vditor') !== -1) return editor;
    return makeGeneric();
  },
  querySelectorAll() { return []; },
  addEventListener() {},           // swallow DOMContentLoaded -> init never runs
  createElement() { return makeGeneric(); },
  body: makeGeneric(),
  documentElement: makeGeneric(),
};

const sandbox = {
  document: documentStub,
  window: { addEventListener() {}, api: {} },
  navigator: { platform: 'Win32' },
  console, setTimeout, clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(
  code + '\n;globalThis.__test = { state, jumpToHeading, extractHeadings, normalizeHeading, stripInlineMd };',
  sandbox
);
const T = sandbox.__test;

// ---- assertions ----
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}
function targetedIndex(els) {
  // jumpToHeading marks exactly one element (background + scroll)
  const hit = els.filter(e => e._scrolled || (e.style && e.style.background));
  return hit.length === 1 ? els.indexOf(hit[0]) : -2;
}
function reset(els) { els.forEach(e => { e._scrolled = false; e.style = {}; }); }

const MD = [
  '# Intro', '',
  '## Notes', '', 'Some text', '',
  '## Details', '',
  '### Notes', '', 'text', '',
  '## Heading with **bold** and `code`', '',
  '## Notes', '',
].join('\n');

console.log('extractHeadings:');
const hs = T.extractHeadings(MD);
check('finds 6 headings', hs.length === 6, 'got ' + hs.length);
check('levels correct', JSON.stringify(hs.map(h => h.level)) === JSON.stringify([1, 2, 2, 3, 2, 2]));
check('formatting stripped from label', hs[4] && hs[4].text === 'Heading with bold and code', hs[4] && hs[4].text);

console.log('jumpToHeading — index path (counts match):');
T.state.outlineHeadings = hs;
// Rendered IR headings: deliberately give them marker-laden textContent to prove
// navigation does NOT depend on text when counts line up.
let els = ['## Intro', '## Notes', '## Details', '### Notes', '## Heading with bold and code', '## Notes'].map(makeH);
editor = { querySelectorAll: () => els };

reset(els); T.jumpToHeading(5, 'Notes');
check('last "Notes" (idx 5) -> 6th heading, not 1st', targetedIndex(els) === 5, 'targeted ' + targetedIndex(els));
reset(els); T.jumpToHeading(3, 'Notes');
check('middle "Notes" (idx 3) -> 4th heading', targetedIndex(els) === 3, 'targeted ' + targetedIndex(els));
reset(els); T.jumpToHeading(1, 'Notes');
check('first "Notes" (idx 1) -> 2nd heading', targetedIndex(els) === 1, 'targeted ' + targetedIndex(els));
reset(els); T.jumpToHeading(4, 'Heading with bold and code');
check('formatted heading (idx 4) navigates', targetedIndex(els) === 4, 'targeted ' + targetedIndex(els));

console.log('jumpToHeading — fallback path (count mismatch):');
// Rendered DOM has 7 headings (one extra at top) but outline has 6 -> index
// path is skipped; fallback must match by normalized text + duplicate occurrence.
let els2 = ['# Extra', '# Intro', '## Notes', '## Details', '### Notes', '## Heading with bold and code', '## Notes'].map(makeH);
editor = { querySelectorAll: () => els2 };
reset(els2); T.jumpToHeading(5, 'Notes');
check('3rd outline "Notes" -> 3rd rendered "Notes" (DOM idx 6)', targetedIndex(els2) === 6, 'targeted ' + targetedIndex(els2));
reset(els2); T.jumpToHeading(1, 'Notes');
check('1st outline "Notes" -> 1st rendered "Notes" (DOM idx 2)', targetedIndex(els2) === 2, 'targeted ' + targetedIndex(els2));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
