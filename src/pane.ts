import {LitElement, css, html, nothing, PropertyValues} from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import type {PluginApi} from '@gerritcodereview/typescript-api/plugin';
import type {ChangeInfo} from '@gerritcodereview/typescript-api/rest-api';
import type {DiffInfo} from '@gerritcodereview/typescript-api/diff';
import {HttpMethod} from '@gerritcodereview/typescript-api/rest';
import {renderDiagrams} from './mermaid';
import {isRenderedPath, renderFile} from './render';
import {addedLines, markAdded} from './added';
import {Block, lineAtY, lineToOffset, offsetToLine, Rows, yOfLine} from './sync';

// Limits of the pane width, as a fraction of the window width.
const MIN_WIDTH = 0.3;
const MAX_WIDTH = 0.5;

// Gerrit 3.10 puts the sidebar on the left. These rules, added to the shadow
// root of gr-diff-view while the pane is open, move it to the right. Gerrit
// adopts its own styles, which come after a <style> element in the cascade,
// so each rule starts with :host to have a higher specificity.
const RIGHT_SIDE_CSS = `
  :host .diffContainer.sidebarOpen {
    margin-left: 0;
    margin-right: var(--sidebar-width);
  }
  :host .sidebarAnchor {
    width: 100%;
    display: flex;
    justify-content: flex-end;
  }
  :host .sidebarContents {
    flex-shrink: 0;
    border-left: var(--spacing-xxs) solid var(--border-color);
    border-right: 0;
  }
`;

function decodeBase64(text: string): string {
  const binary = atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The sidebar pane that shows the rendered file, in sync with the diff. */
export class RendererDiffPane extends LitElement {
  static override properties = {
    plugin: {attribute: false},
    change: {attribute: false},
    path: {attribute: false},
    patchNum: {attribute: false},
    diff: {attribute: false},
    content: {attribute: false},
    rendered: {state: true},
    message: {state: true},
  };

  declare plugin?: PluginApi;
  declare change?: ChangeInfo;
  declare path?: string;
  declare patchNum?: string | number;
  /** The gr-diff element. */
  declare diff?: HTMLElement;
  /** The diff data, which gives the added lines. */
  declare content?: DiffInfo;
  declare rendered?: string;
  declare message?: string;

  // Gerrit renders this element in the .sidebarContents element, which has a
  // fixed height and is the scroll container of the pane.
  private scroller?: HTMLElement;
  // The gr-diff-view element. Kept, because disconnectedCallback runs after
  // the element leaves the shadow root of gr-diff-view.
  private view?: HTMLElement;
  // The current load, with the change, patchset and path of its file. Gerrit
  // sets a new change object when it reloads the change, for example after a
  // reply, so the key is what starts a load. Only the current load shows its
  // result: an earlier load can have the same key, if the reviewer comes back
  // to the file.
  private current?: {key: string};
  // The offsets of the blocks in the scroll content do not change on scroll.
  // Measure them again only when the content changes size (pane width, a
  // diagram height) or when the pane renders another file.
  private blockCache?: Block[];
  private readonly contentObserver = new ResizeObserver(
    () => (this.blockCache = undefined)
  );
  private frame?: number;
  // Positions that a scroll by the plugin itself produces. The scroll event
  // that such a scroll fires must not sync back to the other side.
  private expectedWindowY?: number;
  private expectedPaneTop?: number;
  // The reference line of the sync, in pixels below the top edge of the
  // pane. A click on a diff row moves it to the top of that row. The diff
  // collapses common lines, so it can show distant parts of the file
  // together. The pane can align only one of them with its top edge.
  private anchor = 0;
  private readonly onWindowResize = () => this.updateWidth();
  // Observe the gr-diff element to find its table when Gerrit renders it.
  // Observe the table to follow a change of view mode or of preference.
  private readonly resizeObserver = new ResizeObserver(this.onWindowResize);
  private observedTable?: Element;
  private readonly rightSideStyle = Object.assign(
    document.createElement('style'),
    {textContent: RIGHT_SIDE_CSS}
  );

  static override styles = css`
    :host {
      display: block;
      /* Clip the content to the pane. Without this, an element with
         position: fixed in a file could cover the Gerrit page. */
      contain: paint;
      padding: 0 var(--spacing-xl, 16px);
      color: var(--primary-text-color);
      font-family: var(--font-family, sans-serif);
      line-height: 1.5;
      overflow-wrap: break-word;
    }
    .message {
      color: var(--deemphasized-text-color);
      font-style: italic;
      padding: var(--spacing-l, 12px) 0;
    }
    code,
    pre {
      font-family: var(--monospace-font-family, monospace);
      background: var(--background-color-tertiary);
      border-radius: 3px;
    }
    code {
      padding: 0 3px;
    }
    pre {
      padding: var(--spacing-m, 8px);
      overflow-x: auto;
    }
    pre code {
      padding: 0;
    }
    blockquote {
      margin-left: 0;
      padding-left: var(--spacing-l, 12px);
      border-left: 4px solid var(--border-color);
      color: var(--deemphasized-text-color);
    }
    table {
      border-collapse: collapse;
    }
    th,
    td {
      border: 1px solid var(--border-color);
      padding: 2px 6px;
    }
    img {
      max-width: 100%;
    }
    iframe.mermaid-diagram {
      display: block;
      width: 100%;
      border: 0;
    }
    p.tight {
      margin: 0;
    }
    [data-added] {
      background: var(--light-add-highlight-color, #d8fed8);
    }
    .image-alt {
      color: var(--deemphasized-text-color);
    }
    .title {
      font-style: italic;
      color: var(--deemphasized-text-color);
    }
    .admonitionblock td {
      border: none;
      vertical-align: top;
    }
    .admonitionblock td.icon {
      font-weight: bold;
      padding-right: var(--spacing-m, 8px);
    }
    .admonitionblock td.content {
      border-left: 2px solid var(--border-color);
    }
    a {
      color: var(--link-color);
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.view = this.diffView();
    this.view?.shadowRoot?.append(this.rightSideStyle);
    this.scroller = this.closest<HTMLElement>('.sidebarContents') ?? undefined;
    this.scroller?.addEventListener('scroll', this.onPaneScroll);
    window.addEventListener('scroll', this.onWindowScroll);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('click', this.onWindowClick);
  }

  override disconnectedCallback() {
    this.scroller?.removeEventListener('scroll', this.onPaneScroll);
    window.removeEventListener('scroll', this.onWindowScroll);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('click', this.onWindowClick);
    this.resizeObserver.disconnect();
    this.contentObserver.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.view?.style.removeProperty('--sidebar-width');
    if (this.scroller) this.scroller.hidden = false;
    this.rightSideStyle.remove();
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has('path') || changed.has('diff')) {
      if (this.diff) this.resizeObserver.observe(this.diff);
      this.updateWidth();
    }
    const key = `${this.change?._number}/${this.patchNum}/${this.path}`;
    if (key !== this.current?.key) {
      this.current = {key};
      this.load(this.current);
    }
    // The base patchset can change while the file stays the same.
    if (changed.has('content')) {
      markAdded(this.renderRoot, addedLines(this.content));
    }
  }

  override render() {
    if (!isRenderedPath(this.path)) return nothing;
    if (this.message) return html`<div class="message">${this.message}</div>`;
    if (this.rendered === undefined) {
      return html`<div class="message">Loading…</div>`;
    }
    return html`<div class="markdown" @click=${this.onClick}>
      ${unsafeHTML(this.rendered)}
    </div>`;
  }

  private diffView(): HTMLElement | undefined {
    const root = this.getRootNode();
    if (!(root instanceof ShadowRoot)) return undefined;
    return root.host.tagName === 'GR-DIFF-VIEW'
      ? (root.host as HTMLElement)
      : undefined;
  }

  /** Gives the pane the width that the diff leaves free, within limits. */
  private updateWidth() {
    const view = this.view;
    if (!view) return;
    // On a file that the plugin does not render, hide the pane but keep it
    // open, so that it comes back on the next file that it renders.
    const shown = isRenderedPath(this.path);
    if (this.scroller) this.scroller.hidden = !shown;
    if (!shown) {
      view.style.setProperty('--sidebar-width', '0px');
      return;
    }
    const table = this.diff?.shadowRoot?.querySelector('table');
    if (table && table !== this.observedTable) {
      if (this.observedTable) this.resizeObserver.unobserve(this.observedTable);
      this.resizeObserver.observe(table);
      this.observedTable = table;
    }
    const viewport = document.documentElement.clientWidth;
    // A table that wraps lines ("responsive") fills the space next to the
    // pane, so its width does not tell the space that it needs.
    const free =
      table && !table.classList.contains('responsive')
        ? viewport - table.getBoundingClientRect().width
        : viewport * MAX_WIDTH;
    const width = Math.min(
      viewport * MAX_WIDTH,
      Math.max(viewport * MIN_WIDTH, free)
    );
    view.style.setProperty('--sidebar-width', `${Math.floor(width)}px`);
  }

  private async load(load: {key: string}) {
    this.rendered = undefined;
    this.message = undefined;
    this.blockCache = undefined;
    this.anchor = 0;
    const result = await this.fetchRendered();
    // The reviewer can go to another file while the request runs.
    if (load !== this.current || !result) return;
    if ('message' in result) {
      this.message = result.message;
      return;
    }
    this.rendered = result.rendered;
    await this.updateComplete;
    const content = this.renderRoot.querySelector('.markdown');
    if (content) this.contentObserver.observe(content);
    this.syncFromDiff();
    renderDiagrams(this.renderRoot);
    markAdded(this.renderRoot, addedLines(this.content));
  }

  /** The rendered file, a message for the reviewer, or nothing to show. */
  private async fetchRendered(): Promise<
    {rendered: string} | {message: string} | undefined
  > {
    const {plugin, change, path, patchNum} = this;
    if (!plugin || !change || !path || !patchNum || !isRenderedPath(path)) {
      return undefined;
    }
    if (patchNum === 'edit') {
      return {message: 'The rendered view does not support edit mode.'};
    }
    const url =
      `/changes/${encodeURIComponent(change.project)}~${change._number}` +
      `/revisions/${patchNum}/files/${encodeURIComponent(path)}/content`;
    let response: Response;
    try {
      response = await plugin.restApi().fetch(HttpMethod.GET, url);
    } catch (e) {
      return {message: `Cannot load the file: ${e}`};
    }
    if (response.status === 404) {
      return {message: 'The file does not exist in this patchset.'};
    }
    if (!response.ok) {
      return {message: `Cannot load the file: HTTP ${response.status}.`};
    }
    try {
      return {rendered: await renderFile(path, decodeBase64(await response.text()))};
    } catch (e) {
      return {message: `Cannot render the file: ${e}`};
    }
  }

  // A link to "#id" in the file jumps to that element in the pane. Without
  // this, the browser would change the URL of the Gerrit page. The scroll of
  // the pane then moves the diff.
  private readonly onClick = (event: MouseEvent) => {
    const link = event
      .composedPath()
      .find((e): e is HTMLAnchorElement => e instanceof HTMLAnchorElement);
    const href = link?.getAttribute('href');
    if (!href?.startsWith('#') || !this.scroller) return;
    event.preventDefault();
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look for the id as written.
    }
    const target = (this.renderRoot as ShadowRoot).getElementById(id);
    if (!target) return;
    this.scroller.scrollTop +=
      target.getBoundingClientRect().top -
      this.scroller.getBoundingClientRect().top;
  };

  // A click anywhere in a diff row: the code, the line number, or a comment
  // thread of the line.
  private readonly onWindowClick = (event: MouseEvent) => {
    const path = event.composedPath();
    if (!this.scroller || !this.diff || !path.includes(this.diff)) return;
    const row = path.find(
      (e): e is HTMLTableRowElement =>
        e instanceof HTMLTableRowElement && e.classList.contains('diff-row')
    );
    if (!row) return;
    // A tall row can start above the pane, under the sticky header.
    this.anchor = Math.max(
      0,
      row.getBoundingClientRect().top -
        this.scroller.getBoundingClientRect().top
    );
    this.syncFromDiff();
  };

  private readonly onWindowScroll = () => {
    if (this.isExpected(window.scrollY, 'expectedWindowY')) return;
    this.schedule(() => this.syncFromDiff());
  };

  private readonly onPaneScroll = () => {
    if (this.isExpected(this.scroller!.scrollTop, 'expectedPaneTop')) return;
    this.schedule(() => this.syncFromPane());
  };

  private isExpected(
    position: number,
    key: 'expectedWindowY' | 'expectedPaneTop'
  ): boolean {
    const expected = this[key];
    this[key] = undefined;
    return expected !== undefined && Math.abs(position - expected) < 1;
  }

  // Sync at most once per animation frame. The last scroll of the frame wins.
  private schedule(sync: () => void) {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      sync();
    });
  }

  private syncFromDiff() {
    const scroller = this.scroller;
    if (!scroller || this.rendered === undefined) return;
    const line = lineAtY(
      this.rows(),
      scroller.getBoundingClientRect().top + this.anchor
    );
    if (line === undefined) return;
    // Near the start of the file, the target can be negative. Clamp it, so
    // that a pane already at its start does not scroll.
    const target = Math.max(
      0,
      Math.round(lineToOffset(this.blocks(), line) - this.anchor)
    );
    if (Math.abs(scroller.scrollTop - target) < 1) return;
    scroller.scrollTop = target;
    // Read back the position: the browser clamps it at the end of the pane.
    this.expectedPaneTop = scroller.scrollTop;
  }

  private syncFromPane() {
    const scroller = this.scroller;
    if (!scroller || this.rendered === undefined) return;
    const line = offsetToLine(this.blocks(), scroller.scrollTop + this.anchor);
    const y = yOfLine(this.rows(), line);
    if (y === undefined) return;
    const delta = y - scroller.getBoundingClientRect().top - this.anchor;
    if (Math.abs(delta) < 1) return;
    window.scrollTo({top: window.scrollY + delta, behavior: 'instant'});
    this.expectedWindowY = window.scrollY;
  }

  /** The rows of the new side of the diff that Gerrit shows. */
  private rows(): Rows {
    const cells: HTMLElement[] = [];
    const lines: number[] = [];
    const all = this.diff?.shadowRoot?.querySelectorAll<HTMLElement>(
      'td.lineNum.right[data-value]'
    );
    for (const cell of all ?? []) {
      // Other values are "FILE" and "LOST" (comments without a line).
      const line = Number(cell.dataset['value']);
      if (!Number.isInteger(line) || line < 1) continue;
      cells.push(cell);
      lines.push(line);
    }
    return {
      count: cells.length,
      line: i => lines[i],
      box: i => cells[i].getBoundingClientRect(),
    };
  }

  /** The rendered blocks, with their offsets in the scroll content. */
  private blocks(): Block[] {
    const scroller = this.scroller;
    if (!scroller) return [];
    if (this.blockCache) return this.blockCache;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const blocks: Block[] = [];
    const elements =
      this.renderRoot.querySelectorAll<HTMLElement>('[data-line-start]');
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.height === 0) continue;
      blocks.push({
        start: Number(element.dataset['lineStart']),
        end: Number(element.dataset['lineEnd']),
        top: rect.top - base,
        height: rect.height,
      });
    }
    this.blockCache = blocks;
    return blocks;
  }
}

customElements.define('renderer-diff-pane', RendererDiffPane);
