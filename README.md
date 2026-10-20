# renderer-diff

A Gerrit 3.10 plugin that shows the rendered Markdown or AsciiDoc of a file
next to its diff, with the two scroll positions kept in sync.

Reviewers read the rendered document in the right pane and write comments on
the raw diff, as usual.

## Installation

```sh
npm install
npm run build
cp dist/renderer-diff.js "$site_path/plugins/"
cp dist/mermaid.min.js "$site_path/static/"
```

Gerrit loads the plugin without a restart (by default within a minute).
`mermaid.min.js` (5 MB) is needed only for Mermaid diagrams. The plugin
loads it from `/static/` when a file has a diagram.

## Usage

1. Open the diff of a `.md`, `.markdown`, `.adoc` or `.asciidoc` file.
2. Click **Show rendered** in the diff header.

The pane stays open for the next files of these types, until you click
**Hide rendered**. On other files, the button and the pane do not show.

Blocks with added or changed lines have a green background. A link to a
section of the file (`[text](#heading)` in Markdown, `<<id>>` in AsciiDoc)
scrolls the pane to that section, and the diff follows.

Mermaid diagrams render in Markdown (a code fence with `mermaid`) and in
AsciiDoc (`[mermaid]` or `[source,mermaid]` blocks).

The unified diff view gives the best layout. A side-by-side diff with the
default line length of 100 needs about 1530 px, so on most screens it does
not fit next to the pane. Turn on line wrapping in the diff preferences, or
use the unified view.

## Limits

- The pane shows the new revision. It does not show the old revision or
  removed content.
- Images load only from `data:` URIs. For other images, the pane shows the
  alt text, as a link for an `http(s)` URL.
- Markdown: raw HTML in the file shows as text.
- AsciiDoc: includes do not resolve. The plugin removes scripts, forms,
  styles and media from passthrough HTML.
- Edit mode is not supported.

## Development

```sh
npm run typecheck
npm test          # unit tests
e2e/run.sh        # browser test on a temporary Gerrit site
```

`e2e/run.sh` needs Java 21 or later and Chromium. It downloads the Gerrit
war file to `e2e/.work/`. Set `GERRIT_VERSION`, `JAVA` or `CHROME` to
change the defaults.

## Gerrit upgrades

The plugin uses the diff page sidebar (the `sidebarTrigger` and
`sidebarContent-<plugin>` endpoints), which Gerrit does not document. Before
you upgrade Gerrit, run the browser test with the new version:

```sh
GERRIT_VERSION=3.11.0 e2e/run.sh
```

See [SPEC.md](SPEC.md) for the design.

## License

MIT. See [LICENSE](LICENSE).
