# renderer-diff: specification

A Gerrit 3.10 web UI plugin that shows the rendered Markdown or AsciiDoc of
a file next to its diff, with the two scroll positions kept in sync.

## Goals

- In the diff view of a Markdown or AsciiDoc file, show the rendered new
  revision in a pane next to the raw diff.
- Keep the scroll position of the pane and of the diff in sync, in both
  directions.
- Reviewers write comments on the raw diff, with the standard Gerrit UI.

## Out of scope

- Rendering of the old revision, and of removed content.
- Comments from the rendered pane.
- Edit mode (patchset `edit`).

## Gerrit integration

The plugin uses the diff page sidebar of Gerrit 3.10. This hook is not
documented. Read `gr-diff-view.ts` in the Gerrit source again before each
Gerrit upgrade.

| Hook | Use |
|---|---|
| `sidebarTrigger` endpoint | A toggle button in the diff header. Params: `onTrigger(name)`, `openSidebar: {name}`. |
| `sidebarContent-renderer-diff` endpoint | The rendered pane. Params: `change`, `path`, `patchNum`, `basePatchNum`, `diff` (the `gr-diff` element), and others. |
| `path` property of `gr-diff-view` | The trigger has no path param, so it reads the path from the diff view. Gerrit sets a new `onTrigger` function on each render of the diff view, also on navigation to another file, so the trigger renders again. (The `showdiff` event fires only once per diff view, not on navigation with `[`, `]` or Prev/Next.) |

Gerrit puts the sidebar on the left, below the sticky header, and stores
the open state in the user preference `diff_page_sidebar`. While the pane
is open, the plugin adds a `<style>` element to the shadow root of
`gr-diff-view` that moves the sidebar to the right (rules on
`.diffContainer.sidebarOpen`, `.sidebarAnchor` and `.sidebarContents`).
Gerrit adopts its own styles, which come after a `<style>` element in the
cascade, so each rule starts with `:host` to have a higher specificity.

Gerrit sets the sidebar width with the CSS variable `--sidebar-width`
(300 px) on `gr-diff-view`. 300 px is too narrow for rendered text, so the
plugin sets this variable on the `gr-diff-view` element.

The width of the diff table is fixed by the line length preference. The
pane takes the width that the table leaves free, from 30% to 50% of the
window. A table that wraps lines fills the free space, so the pane keeps
its current width. A resize observer on the table updates the width when
the reviewer changes the view mode. A side-by-side diff with a line length
of 100 is about 1530 px wide, so it fits next to the pane only on a wide
screen. The unified view fits on a 1600 px screen.

The plugin renders a file if its path ends with `.md` or `.markdown`
(Markdown), or with `.adoc` or `.asciidoc` (AsciiDoc). The test is
case-insensitive. If the sidebar is open on another file, the plugin sets
the width to `0` and shows nothing. The preference stays open, so the pane
comes back on the next file that it renders.

## Content

- The plugin gets the full new file from
  `GET /changes/{project}~{change}/revisions/{patchNum}/files/{path}/content`.
  The response is base64. Decode it as UTF-8.
- If the file does not exist in the new revision (deleted file), the pane
  shows a message.

## Rendering

Each block element gets the attributes `data-line-start` and
`data-line-end` (1-based, end exclusive).

The pane loads no URL. An image loads only from a `data:` URI (PNG, JPEG,
GIF, WebP). A request to a URL would tell its host who opens the change. A
request to the Gerrit host, or a relative path that resolves against the
Gerrit page, carries the session cookie. For other images, the pane shows
the alt text, as a link for an `http(s)` URL. The pane has `contain: paint`,
so that content cannot cover the Gerrit page with `position: fixed`.

Markdown:

- Renderer: markdown-it, with `html: false`. Raw HTML in the file shows as
  text. This prevents script injection into Gerrit.
- markdown-it rejects `javascript:` and similar link schemes by default.
- The line attributes come from the markdown-it token map.
- A tight list hides the paragraph of each item, and its line attributes
  with it. The plugin shows it, with the class `tight` (no margin), so that
  the text of an item is a block of its own.

AsciiDoc:

- Renderer: Asciidoctor.js 4, with `safe: 'secure'`. Includes do not
  resolve. The document title shows (`showtitle`).
- Passthrough blocks (`++++`) and `pass:[]` copy raw HTML to the output, so
  DOMPurify sanitizes the output. Besides its defaults (no scripts, no event
  handlers), the configuration removes SVG and MathML, form elements,
  `<style>`, media elements, and the `style`, `srcset`, `poster` and
  `background` attributes. A file cannot show a form that sends what the
  reviewer types to another host, or restyle the page.
- With `sourcemap: true`, Asciidoctor gives the start line of each block
  (its delimiter or first content line). The block title, attribute list
  and anchor lines just above it belong to the block. A block ends where
  the next block that it does not contain starts. The
  plugin adds the lines as a role (`rd-<random token>-START-END`), and
  changes this class into the two attributes after sanitizing. The
  sanitizer removes `data-line-start` and `data-line-end` that come from
  the file, so passthrough HTML cannot fake the lines (and hide the green
  background of an added block).
- The HTML converter gives no class to a table row, so the plugin sets the
  line attributes of each `<tr>` after sanitizing. A row starts at the line
  of its first cell and ends where the next row starts. The last row ends
  with the table. In a CSV or DSV table, Asciidoctor gives the first cell
  of a row the line of the previous row. These tables keep one range.
- Asciidoctor adds about 360 KB to the bundle (100 KB gzipped). A dynamic
  `import()` runs its code only when a reviewer opens an AsciiDoc file.

Mermaid:

- Diagram blocks: Markdown fences with the info string `mermaid`, AsciiDoc
  `[source,mermaid]` blocks, and AsciiDoc `[mermaid]` blocks. Asciidoctor
  drops the `[mermaid]` style from the HTML, so the plugin adds it as a role.
- Mermaid is about 5 MB (1.5 MB gzipped). It is a separate file,
  `mermaid.min.js`, in the `static/` directory of the Gerrit site, which
  Gerrit serves at `/static/`. It never runs on the Gerrit page. When a
  file has a diagram, the pane fetches it once as text. A sandboxed frame
  (see below) has an opaque origin, which the browser HTTP cache does not
  serve, so the pane puts the text inline in each frame. The pane refuses
  a text that contains `<script` or `</script`, which would end the inline
  element. Each frame compiles its own copy: each extra diagram costs about
  0.3 s and 8 MB of memory.
- Mermaid lets HTML in labels through (remote images, forms), and it
  renders into the document to measure the diagram. So each diagram renders
  in its own iframe, with `sandbox="allow-scripts"`: an opaque origin
  without access to the Gerrit page or its cookies, no form submission, and
  no navigation of the page. A Content-Security-Policy in the frame allows
  only the scripts with its nonce, and `data:` images and fonts: the frame
  makes no request.
- Configuration: `securityLevel: 'strict'` (no click handlers, sanitized
  labels). The `secure` list stops a diagram from changing the security
  settings or the CSS with an init directive.
- In the frame, the links of the diagram lose their `href`. A Mermaid
  `click ... href` link would load another page in the frame, inside the
  Gerrit page, and the frame CSP does not apply to that page.
- Other defenses against a page in the frame:
  - The frame has `pointer-events: none` and `tabindex="-1"`. A diagram
    has nothing to click, and a click is the way to load another page.
  - Each message carries a random key for the frame. A page that the frame
    loads does not know it, so it cannot resize the frame or send an error.
  - The pane counts the `load` events of the frame. The frame loads its own
    document once. On another load, the pane replaces the frame with the
    message "the diagram tried to load another page". A page that never
    finishes loading does not fire `load`, so this is a fallback only.
- The frame stays rendered, with a height of 0, until Mermaid is done:
  Mermaid measures text, which fails in a frame with `display: none` in
  some browsers.
- The frame sends its height to the pane with `postMessage`. The pane has
  one `message` listener, which finds the frame from the window that sent
  the message.
- The frame replaces the `<pre>` of the block and keeps its line
  attributes. If Mermaid cannot load or cannot parse the diagram, the code
  block stays, with an error message below it.

## Added content

The pane gives a green background (`--light-add-highlight-color`, the color
of added lines in the Gerrit diff) to each block with an added or changed
line (attribute `data-added`, which the AsciiDoc sanitizer removes from
file content, so that a file cannot fake it). The `content` param (the diff
data) gives these lines: the `b` lines of each chunk, except in a `common`
chunk, which differs only in ignored whitespace. Only the innermost blocks
get the color, so that one added line does not color a whole section or
table (a table row is a block, in Markdown and in AsciiDoc). For
an outer block, its own lines before its first inner block (an AsciiDoc
section title) color its first element. The colors update when the base
patchset changes.

If the diff has no common line (a new file, or a file that the change
replaces), no block gets the color. A green background on the whole file
tells nothing.

## Links in the file

A click on a link to `#id` scrolls the pane to the element with this id,
and the diff follows. Without this, the browser would change the URL of the
Gerrit page. Markdown headings get GitHub ids (lower case, punctuation
removed, spaces changed to `-`, `-1`, `-2` for duplicates). Asciidoctor
gives its own section ids (`_section_title`), which `<<...>>` cross
references use.

## Scroll sync

The reference line is a horizontal line across the diff and the pane. Both
sides show the same source line at this height. At first, it is the top
edge of the pane, which is just below the sticky header.

The diff collapses common lines, so it can show distant parts of the file
together. At one height, the pane shows only one of them. A click in a diff
row (`tr.diff-row`) moves the reference line to the top of that row. The
click can be on the code, on the line number, or on a comment thread of the
line. The pane then scrolls to show the line at the height of the row. The
reference line stays at this height for the next scrolls, until the next
click. On another file, the reference line goes back to the top edge of the
pane.

Diff to pane, on each window scroll:

1. Find the first row of the right side (`td.lineNum.right[data-value]`) of
   the diff that is below the reference line. Get its line number `L`.
2. Find the rendered block that contains `L`. If no block contains `L`, use
   the next block after `L`.
3. Scroll the pane so that the position of `L` in that block is at the
   reference line. Interpolate inside the block with
   `(L - start) / (end - start)`.

Pane to diff, on each scroll of the pane by the user:

1. Find the block at the reference line, and the source line `L` at that
   position (inverse of the interpolation).
2. Find the diff row with line `L`. If Gerrit hides that line (collapsed
   common lines), use the nearest row that it shows.
3. Scroll the window so that this row is at the reference line.

Measurement cost: a whole-file diff can have thousands of rows. The sync
measures only the rows of a binary search (rows are in page order, and
their line numbers and positions increase). The block offsets in the scroll
content do not change on scroll: the pane measures them again only when
the content changes size or the pane renders another file.

To stop a loop between the two scroll handlers, the plugin records the
position that its own scroll produces. A scroll event at that position does
not sync back to the other side.

## Build

- TypeScript and Lit, without decorators.
- esbuild bundles everything except Mermaid into one file:
  `dist/renderer-diff.js`. The `node:*` imports of Asciidoctor are
  external. The browser never runs them.
- The build copies `mermaid.min.js` from the pinned `mermaid` package to
  `dist/`.
- Gerrit takes the plugin name from the file name.
- Install: copy `dist/renderer-diff.js` to `$site_path/plugins/` and
  `dist/mermaid.min.js` to `$site_path/static/`.

## Tests

- Unit tests (vitest) for the line attributes and heading ids in the
  rendered HTML, the sanitizer, the added lines, and the functions that map
  lines to scroll offsets and back.
- End-to-end test (`e2e/run.sh`): a temporary Gerrit site in development
  mode, a change with Markdown and AsciiDoc files (with Mermaid diagrams),
  and checks in headless Chromium (playwright-core). Run it after each
  Gerrit upgrade.
