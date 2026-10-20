import MarkdownIt from 'markdown-it';

// html: false shows raw HTML as text, so that a reviewed file cannot inject
// scripts into the Gerrit page.
const md = new MarkdownIt({html: false, linkify: true});

// Record the source lines of each block. The scroll sync uses them to map a
// line of the diff to a position in the rendered pane. Lines are 1-based,
// and the end is exclusive.
md.core.ruler.push('source_lines', state => {
  for (const token of state.tokens) {
    // A tight list hides the paragraph of each item, and its lines with it.
    // Show it, with a class that keeps the tight spacing.
    if (token.hidden && token.type.startsWith('paragraph_')) {
      token.hidden = false;
      if (token.nesting === 1) token.attrJoin('class', 'tight');
    }
    if (token.map && token.nesting !== -1) {
      token.attrSet('data-line-start', String(token.map[0] + 1));
      token.attrSet('data-line-end', String(token.map[1] + 1));
    }
  }
});

// Give each heading an id, as GitHub does, so that a link to "#heading"
// in the file jumps to it.
md.core.ruler.push('heading_ids', state => {
  const used = new Map<string, number>();
  state.tokens.forEach((token, i) => {
    if (token.type !== 'heading_open') return;
    const text = (state.tokens[i + 1].children ?? [])
      .filter(t => t.type === 'text' || t.type === 'code_inline')
      .map(t => t.content)
      .join('');
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    if (!slug) return;
    const count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    token.attrSet('id', count ? `${slug}-${count}` : slug);
  });
});

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = String(tokens[idx].attrGet('src') ?? '');
  if (isLoadableImage(src)) {
    return defaultImage(tokens, idx, options, env, self);
  }
  const alt = `[${md.utils.escapeHtml(tokens[idx].content)}]`;
  return isWebUrl(src)
    ? `<a class="image-alt" href="${md.utils.escapeHtml(src)}">${alt}</a>`
    : `<span class="image-alt">${alt}</span>`;
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}

// An image loads only from a data: URI. A request to a URL would tell its
// host who opens the change, and a request to the Gerrit host (or a relative
// path, which resolves against the Gerrit page) carries the session cookie.
// The pane shows the alt text instead, as a link for a web URL.
export function isLoadableImage(src: string): boolean {
  return /^data:image\/(png|jpeg|gif|webp);/i.test(src);
}

export function isWebUrl(src: string): boolean {
  return /^https?:/i.test(src);
}

function isMarkdownPath(path: string | undefined): boolean {
  return /\.(md|markdown)$/i.test(path ?? '');
}

function isAsciidocPath(path: string | undefined): boolean {
  return /\.(adoc|asciidoc)$/i.test(path ?? '');
}

export function isRenderedPath(path: string | undefined): boolean {
  return isMarkdownPath(path) || isAsciidocPath(path);
}

export async function renderFile(path: string, source: string): Promise<string> {
  if (!isAsciidocPath(path)) return renderMarkdown(source);
  // Asciidoctor is large. The dynamic import runs its code only when a
  // reviewer opens an AsciiDoc file.
  const {renderAsciidoc} = await import('./asciidoc');
  return renderAsciidoc(source);
}
