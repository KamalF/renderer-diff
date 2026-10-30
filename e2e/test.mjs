// Browser test for the plugin on a running Gerrit site.
// Usage: node e2e/test.mjs <gerrit-url> <screenshot-dir>
import {chromium} from 'playwright-core';

const [url, shots] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/usr/bin/chromium-browser';

// Line 1 is the title. Section s starts at line 3 + 12 * (s - 1), and its
// paragraph is on the 2 lines that follow the heading and a blank line.
// Version 2 changes the paragraph of these sections.
const CHANGED = [6, 20, 34];
function doc(version) {
  const lines = ['# Test document', ''];
  for (let s = 1; s <= 40; s++) {
    lines.push(`## Section ${s}`, '');
    lines.push(`Text of section ${s}, version ${CHANGED.includes(s) ? version : 1}.`);
    lines.push('Second line of the same paragraph.', '');
    lines.push('- item one', '- item two', '');
    lines.push('```c', `int section_${s};`, '```', '');
  }
  lines.push('```mermaid', 'graph TD', '  A[Markdown] --> B[Diagram]', '```', '');
  lines.push('[Go to section 4](#section-4)', '');
  return lines.join('\n');
}
// The same layout in AsciiDoc: section s starts at line 3 + 12 * (s - 1).
function adoc() {
  const lines = ['= AsciiDoc test', ''];
  for (let s = 1; s <= 40; s++) {
    lines.push(`== Section ${s}`, '');
    lines.push(`Text of section ${s}.`, 'Second line of the same paragraph.', '');
    lines.push('* item one', '* item two', '');
    lines.push('----', `int section_${s};`, '----', '');
  }
  lines.push('[mermaid]', '....', 'graph TD', '  A[AsciiDoc] --> B[Diagram]', '....', '');
  return lines.join('\n');
}
const PARAGRAPH_4 = 3 + 12 * 3 + 2; // 41-42
const CHANGED_LINE = 3 + 12 * 33 + 2; // 401, in the last hunk

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({executablePath: CHROME});
const page = await browser.newPage({viewport: {width: 1600, height: 900}});
page.on('pageerror', e => console.log('page error:', e.message));

// Development auth. `init --dev` creates the administrator account 1000000.
await page.goto(`${url}/login/?account_id=1000000`);
await page.waitForLoadState('networkidle');

const xsrf = (await page.context().cookies()).find(c => c.name === 'XSRF_TOKEN');
async function rest(method, path, data, contentType = 'application/json') {
  const response = await page.request.fetch(`${url}${path}`, {
    method,
    headers: {'X-Gerrit-Auth': xsrf.value, 'Content-Type': contentType},
    data: contentType === 'application/json' ? JSON.stringify(data) : data,
  });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${text}`);
  return text ? JSON.parse(text.replace(/^\)\]\}'\n/, '')) : undefined;
}

// A file that tries to make the browser send requests. Each URL contains
// "evil", and the test fails if the browser requests one.
const EVIL = [
  '# Evil',
  '',
  '![tracker](https://evil.example/md.png)',
  '',
  '```mermaid',
  'graph TD',
  `  A["<img src='https://evil.example/label.png'>"] --> B["<form action='https://evil.example/f'><input type='password'></form>"]`,
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  C@{ img: "https://evil.example/shape.png", label: "x", pos: "t", h: 60 }',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  L[Click me] --> M',
  '  click L href "https://evil.example/click"',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  `  N["<img src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' usemap='#mm' width='200' height='60'><map name='mm'><area shape='default' href='https://evil.example/area'></map>Map"] --> O`,
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  D --> E',
  '  classDef x fill:url(https://evil.example/css.png)',
  '  class D x',
  '```',
  '',
].join('\n');

// Patchset 1 is the empty change. Patchset 2 adds doc.md, patchset 3
// changes 3 lines of it, patchset 4 adds main.c, patchset 5 adds doc.adoc,
// and patchset 6 adds evil.md.
await rest('PUT', '/projects/test', {create_empty_commit: true});
const {_number: id} = await rest('POST', '/changes/', {
  project: 'test',
  branch: 'master',
  subject: 'Add test document',
});
const edits = [
  ['doc.md', doc(1)],
  ['doc.md', doc(2)],
  ['main.c', 'int main;\n'],
  ['doc.adoc', adoc()],
  ['evil.md', EVIL],
];
for (const [path, content] of edits) {
  await rest('PUT', `/changes/${id}/edit/${path}`, content, 'application/octet-stream');
  await rest('POST', `/changes/${id}/edit:publish`, {notify: 'NONE'});
}

const trigger = page.locator('renderer-diff-trigger gr-button');
const pane = page.locator('renderer-diff-pane');

const frames = () =>
  page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

async function rowTop(line) {
  const row = page.locator(`td.lineNum.right[data-value="${line}"]`).first();
  return (await row.count()) ? (await row.boundingBox())?.y : undefined;
}

// The pane width, its top edge, and the innermost block at the reference
// line, `offset` pixels below that edge.
function paneState(offset = 0) {
  return pane.evaluate((p, offset) => {
    const scroller = p.closest('.sidebarContents');
    const top = scroller.getBoundingClientRect().top;
    const y = top + offset + 1;
    let block;
    for (const el of p.shadowRoot.querySelectorAll('[data-line-start]')) {
      const r = el.getBoundingClientRect();
      if (r.top <= y && r.bottom > y) block = el;
    }
    return {
      width: scroller.getBoundingClientRect().width,
      top,
      start: Number(block?.dataset.lineStart),
      end: Number(block?.dataset.lineEnd),
    };
  }, offset);
}

// The first diff line below `y`. A short diff cannot scroll its first line
// up to the top edge of the pane.
function diffLineAt(y) {
  return page.locator('td.lineNum.right[data-value]').evaluateAll((cells, y) => {
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      const line = Number(c.dataset.value);
      if (line > 0 && r.height && r.bottom > y) return line;
    }
    return undefined;
  }, y + 1);
}

// The block at the reference line of the pane must contain the diff line at
// the same height. If that line is blank, the pane shows the next block.
async function checkAligned(name, offset = 0) {
  await frames();
  await frames();
  const state = await paneState(offset);
  const line = await diffLineAt(state.top + offset);
  check(
    name,
    line !== undefined && state.start - 1 <= line && line <= state.end,
    `diff line=${line} pane block=${state.start}-${state.end}`
  );
}

async function scrollPane(dy) {
  await pane.evaluate((p, d) => (p.closest('.sidebarContents').scrollTop += d), dy);
}

async function scrollDiffTo(line) {
  const {top} = await paneState();
  const y = await rowTop(line);
  await page.evaluate(d => window.scrollBy(0, d), y - top);
}

async function diffFits() {
  return page.locator('gr-diff').first().evaluate(
    d => d.shadowRoot.querySelector('table').getBoundingClientRect().right <=
      document.documentElement.clientWidth + 1
  );
}

// Full file: patchset 2 against its parent, side-by-side view.
await page.goto(`${url}/c/test/+/${id}/2/doc.md`);
await trigger.waitFor();
await trigger.click();
await pane.locator('h1').waitFor();
await frames();
let state = await paneState();
check('pane renders the file', (await pane.locator('h1').textContent()) === 'Test document');
const sides = await pane.evaluate(p => ({
  right: p.closest('.sidebarContents').getBoundingClientRect().right,
  viewport: document.documentElement.clientWidth,
}));
check(
  'pane is on the right',
  Math.abs(sides.right - sides.viewport) < 3,
  `right=${sides.right} viewport=${sides.viewport}`
);
const diffBox = await page.locator('gr-diff').first().boundingBox();
check('diff is on the left', diffBox.x < 50, `x=${diffBox.x}`);
check(
  'side-by-side: pane takes the minimum width',
  Math.abs(state.width - 480) < 5,
  `width=${state.width}`
);
await page.screenshot({path: `${shots}/1-side-by-side.png`});
await pane.frameLocator('iframe.mermaid-diagram').locator('svg').waitFor();
check('Markdown: Mermaid diagram renders', await pane.locator('iframe.mermaid-diagram').isVisible());
// Patchset 2 adds the whole file, so the diagram is green too.
check(
  'Markdown: added diagram is green',
  await pane.locator('iframe.mermaid-diagram').evaluate(f => f.hasAttribute('data-added'))
);

await scrollDiffTo(PARAGRAPH_4);
await checkAligned('diff scroll moves the pane');
await page.screenshot({path: `${shots}/2-diff-scroll.png`});

await scrollPane(400);
await checkAligned('pane scroll moves the diff');
await page.screenshot({path: `${shots}/3-pane-scroll.png`});

// A link to a heading of the file jumps the pane there, and the diff follows.
await pane.locator('a[href="#section-4"]').click();
await checkAligned('link to a section moves the pane and the diff');
state = await paneState();
check('link to a section shows the section', state.start === 39, `block=${state.start}`);

// Unified view: the diff fits next to the pane.
await rest('PUT', '/accounts/self/preferences', {diff_view: 'UNIFIED_DIFF'});
await page.reload();
await pane.locator('h1').waitFor();
await frames();
state = await paneState();
check('unified: diff fits next to the pane', await diffFits(), `width=${state.width}`);
await page.waitForTimeout(1500);
await scrollDiffTo(PARAGRAPH_4);
await checkAligned('unified: diff scroll moves the pane');
await page.screenshot({path: `${shots}/4-unified.png`});

// Side-by-side with line wrapping: the table fills the space next to a pane
// of the maximum width.
await rest('PUT', '/accounts/self/preferences', {diff_view: 'SIDE_BY_SIDE'});
await rest('PUT', '/accounts/self/preferences.diff', {line_wrapping: true});
await page.reload();
await pane.locator('h1').waitFor();
await frames();
state = await paneState();
check(
  'line wrapping: pane takes the maximum width',
  Math.abs(state.width - 800) < 5,
  `width=${state.width}`
);
check('line wrapping: diff fits next to the pane', await diffFits());
await page.screenshot({path: `${shots}/5-line-wrapping.png`});
await rest('PUT', '/accounts/self/preferences.diff', {line_wrapping: false});
await rest('PUT', '/accounts/self/preferences', {diff_view: 'UNIFIED_DIFF'});

// Collapsed common lines: patchset 2 against patchset 3.
await page.goto(`${url}/c/test/+/${id}/2..3/doc.md`);
await pane.locator('h1').waitFor();
await frames();
// After the diff loads, Gerrit moves the diff cursor to the first change and
// scrolls to it. Let it finish before the test scrolls.
await page.waitForTimeout(1500);
check('changed line is shown', (await rowTop(CHANGED_LINE)) !== undefined);
await scrollDiffTo(CHANGED_LINE);
await checkAligned('diff scroll moves the pane with collapsed lines');
const addedBlocks = await pane.evaluate(p =>
  [...p.shadowRoot.querySelectorAll('[data-added]')].map(e => e.dataset.lineStart)
);
check(
  'changed paragraphs are green, and only they',
  addedBlocks.join() === '65,233,401',
  `added=${addedBlocks.join()}`
);
await page.screenshot({path: `${shots}/6-collapsed.png`});

// A click on a diff row aligns the pane with that row, and the reference
// line stays at that height. Line 238 is in the hunk of line 233. With it at the
// top, the hunk of the changed line shows below it in the diff, but not in
// the pane.
await scrollDiffTo(238);
await frames();
const anchor = (await rowTop(CHANGED_LINE)) - (await paneState()).top;
state = await paneState(anchor);
check(
  'before the click, the pane does not show the clicked line',
  !(state.start <= CHANGED_LINE && CHANGED_LINE < state.end),
  `anchor=${anchor} pane block=${state.start}-${state.end}`
);
await page
  .locator('tr.diff-row', {has: page.locator(`td.lineNum.right[data-value="${CHANGED_LINE}"]`)})
  .locator('td.content')
  .first()
  .click();
await checkAligned('click on a diff row aligns the pane with it', anchor);
await page.evaluate(() => window.scrollBy(0, -100));
await checkAligned('diff scroll keeps the reference line at the row height', anchor);
await scrollPane(100);
await checkAligned('pane scroll keeps the reference line at the row height', anchor);
await page.screenshot({path: `${shots}/6-collapsed-click.png`});

// AsciiDoc: patchset 5 adds doc.adoc.
await page.goto(`${url}/c/test/+/${id}/5/doc.adoc`);
await pane.locator('h1').waitFor();
check('AsciiDoc: pane renders the file', (await pane.locator('h1').textContent()) === 'AsciiDoc test');
await pane.frameLocator('iframe.mermaid-diagram').locator('svg').waitFor();
check('AsciiDoc: Mermaid diagram renders', await pane.locator('iframe.mermaid-diagram').isVisible());
await page.waitForTimeout(1500);
await scrollDiffTo(PARAGRAPH_4);
await checkAligned('AsciiDoc: diff scroll moves the pane');
await scrollPane(400);
await checkAligned('AsciiDoc: pane scroll moves the diff');
await page.screenshot({path: `${shots}/7-asciidoc.png`});

// A file that is not Markdown: no button, and the pane takes no space.
await page.goto(`${url}/c/test/+/${id}/4/main.c`);
await page.locator('gr-diff').waitFor();
await page.waitForTimeout(1000);
check('trigger hides on another file', (await trigger.count()) === 0);
state = await paneState();
check('pane takes no space on another file', state.width < 5, `width=${state.width}`);

// No request leaves the pane, also from a Mermaid label or image shape.
// Chromium reports a request that the frame CSP blocks as failed with the
// reason "csp": it does not reach the network.
const evilRequests = [];
const isEvil = r => r.url().includes('evil.example');
page.on('requestfinished', r => isEvil(r) && evilRequests.push(r.url()));
page.on('requestfailed', r => isEvil(r) && r.failure()?.errorText !== 'csp' && evilRequests.push(r.url()));
const mermaidLoads = [];
page.on('request', r => r.url().endsWith('/mermaid.min.js') && mermaidLoads.push(r.url()));
await page.goto(`${url}/c/test/+/${id}/6/evil.md`);
await pane.locator('iframe.mermaid-diagram').first().contentFrame().locator('svg').waitFor();
await page.waitForTimeout(2000);
check('evil.md: diagram renders', await pane.locator('iframe.mermaid-diagram').first().isVisible());
// A click on a node with a link, or on an image map, must not load a page.
// A diagram that Mermaid cannot render has no frame, so find the frame by
// its content. The frame takes no pointer events: force the click.
const diagrams = pane.locator('iframe.mermaid-diagram');
async function clickInDiagram(selector) {
  for (let i = 0; i < (await diagrams.count()); i++) {
    const target = diagrams.nth(i).contentFrame().locator(selector);
    if (await target.count()) {
      await diagrams.nth(i).scrollIntoViewIfNeeded();
      await target.click({force: true});
      return true;
    }
  }
  return false;
}
check('evil.md: the diagram with a link renders', await clickInDiagram('text=Click me'));
check('evil.md: the diagram with an image map renders', await clickInDiagram('img[usemap]'));
await page.waitForTimeout(1000);
check('evil.md: Mermaid loads once for all diagrams', mermaidLoads.length === 1, `loads=${mermaidLoads.length}`);
check('evil.md: no request to the URLs in the file', evilRequests.length === 0, evilRequests.join(' '));
await page.screenshot({path: `${shots}/8-evil.png`});

// In-view navigation: Gerrit keeps the diff view and changes its path.
// Files of patchset 5: doc.adoc, doc.md, main.c.
await page.goto(`${url}/c/test/+/${id}/5/doc.md`);
await pane.locator('h1').waitFor();
await page.waitForTimeout(1000);
await page.keyboard.press(']');
await page.waitForURL(/main\.c$/);
await page.waitForTimeout(1000);
check('navigation: trigger hides on main.c', (await trigger.count()) === 0);
await page.keyboard.press('[');
await page.waitForURL(/doc\.md$/);
await trigger.waitFor();
check('navigation: trigger shows on doc.md', (await trigger.textContent()).includes('Hide rendered'));
await pane.locator('h1').waitFor();
check('navigation: pane renders doc.md', (await pane.locator('h1').textContent()) === 'Test document');

// Closing the pane gives the sidebar back to Gerrit.
await trigger.click();
await page.waitForTimeout(500);
const leftover = await page.locator('gr-diff-view').evaluate(v => v.style.getPropertyValue('--sidebar-width'));
check('closing the pane removes the width', leftover === '', `width=${leftover}`);

await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
