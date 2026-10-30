import DOMPurify from 'dompurify';
import {load, type AbstractBlock} from '@asciidoctor/core';
import {isLoadableImage, isWebUrl} from './render';

function isDescendant(node: AbstractBlock, ancestor: AbstractBlock): boolean {
  for (let p = node.getParent(); p; p = p.getParent()) {
    if (p === ancestor) return true;
  }
  return false;
}

// The Table type of Asciidoctor is not exported.
type TableBlock = AbstractBlock & {
  rows: {bySection(): [string, AbstractBlock[][]][]};
};

// Asciidoctor gives the start line of each block, but not the end line. A
// block ends where the next block that it does not contain starts. The
// converter keeps a role in the class attribute of the block element. The
// role has a random token, so that passthrough HTML in the file cannot fake
// it, and the plugin changes it to line attributes after sanitizing.
//
// The converter gives no class to a table row. The returned map gives the
// row bounds of each table, by the start line of the table (see
// setRowLines).
async function convertWithLines(
  source: string,
  token: string
): Promise<{html: string; rows: Map<number, number[]>}> {
  const doc = await load(source, {
    safe: 'secure',
    sourcemap: true,
    attributes: {showtitle: true},
  });
  const lines = source.replace(/\n$/, '').split('\n');
  const blocks = doc
    .findBy()
    .filter(b => b.getContext() !== 'document' && b.getLineNumber());
  // Asciidoctor gives the line of the delimiter or of the first content
  // line. A block title (.Title), an attribute list ([source,c], [NOTE]) or
  // an anchor ([[id]]) just above the block belongs to the block. Like
  // Asciidoctor, ignore trailing spaces and the \r of CRLF line ends.
  const starts = blocks.map(b => {
    let start = b.getLineNumber()!;
    while (start > 1 && /^(\[.*\]|\.[^.\s].*)$/.test(lines[start - 2].trimEnd())) {
      start--;
    }
    return start;
  });
  const rows = new Map<number, number[]>();
  blocks.forEach((block, i) => {
    const start = starts[i];
    const next = blocks.findIndex(
      (b, j) => j > i && !isDescendant(b, block) && starts[j] > start
    );
    const end = next === -1 ? lines.length + 1 : starts[next];
    block.addRole(`${token}-${start}-${end}`);
    // The HTML converter drops the [mermaid] style. Keep it as a class, so
    // that the pane finds the diagram.
    if (block.getStyle() === 'mermaid') block.addRole('mermaid');
    // A row starts at the line of its first cell. In a CSV or DSV table,
    // Asciidoctor gives that cell the line of the previous row, so these
    // tables keep one range.
    if (block.getContext() === 'table' && block.getAttribute('format', 'psv') === 'psv') {
      const rowStarts = (block as TableBlock).rows
        .bySection()
        .flatMap(([, section]) => section.map(row => row[0].getLineNumber()!));
      rows.set(start, [...rowStarts, end]);
    }
  });
  return {html: await doc.convert(), rows};
}

function setLines(root: DocumentFragment, token: string) {
  const pattern = new RegExp(`^${token}-(\\d+)-(\\d+)$`);
  for (const element of root.querySelectorAll('[class]')) {
    for (const name of element.classList) {
      const match = pattern.exec(name);
      if (!match) continue;
      element.classList.remove(name);
      if (!element.classList.length) element.removeAttribute('class');
      element.setAttribute('data-line-start', match[1]);
      element.setAttribute('data-line-end', match[2]);
      break;
    }
  }
}

// A row ends where the next row starts. The last row ends with the table.
function setRowLines(root: DocumentFragment, rows: Map<number, number[]>) {
  for (const table of root.querySelectorAll<HTMLElement>('table[data-line-start]')) {
    const bounds = rows.get(Number(table.dataset['lineStart']));
    if (!bounds) continue;
    table.querySelectorAll(':scope > * > tr').forEach((tr, i) => {
      tr.setAttribute('data-line-start', String(bounds[i]));
      tr.setAttribute('data-line-end', String(bounds[i + 1]));
    });
  }
}

// Passthrough blocks (++++) and pass:[] copy raw HTML to the output. A file
// must not run code in the Gerrit page, show a form that sends what the
// reviewer types to another host, restyle the page, or make the browser send
// requests. Remove scripts and event handlers (DOMPurify default), SVG and
// MathML, form elements, styles, and the elements and attributes that load
// a URL, except img (see isLoadableImage).
const PURIFY_CONFIG = {
  USE_PROFILES: {html: true},
  FORBID_TAGS: [
    'style', 'form', 'input', 'button', 'select', 'textarea', 'option',
    'video', 'audio', 'source', 'track', 'picture',
  ],
  // The line attributes and the mark of added blocks come from the plugin
  // only (see setLines and markAdded).
  FORBID_ATTR: [
    'style', 'srcset', 'poster', 'background',
    'data-line-start', 'data-line-end', 'data-added',
  ],
};

export async function renderAsciidoc(source: string): Promise<string> {
  const token = `rd-${crypto.randomUUID()}`;
  const {html, rows} = await convertWithLines(source, token);
  const fragment = DOMPurify.sanitize(html, {
    ...PURIFY_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  });
  setLines(fragment, token);
  setRowLines(fragment, rows);
  for (const img of fragment.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (isLoadableImage(src)) continue;
    const web = isWebUrl(src);
    const alt = document.createElement(web ? 'a' : 'span');
    if (web) alt.setAttribute('href', src);
    alt.className = 'image-alt';
    alt.textContent = `[${img.getAttribute('alt') ?? ''}]`;
    img.replaceWith(alt);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
