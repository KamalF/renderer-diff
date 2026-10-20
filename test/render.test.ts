import {describe, expect, test} from 'vitest';
import {isRenderedPath, renderMarkdown} from '../src/render';

describe('renderMarkdown', () => {
  test('adds 1-based source lines to blocks', () => {
    const html = renderMarkdown('# Title\n\nline 3\nline 4\n\n- a\n- b\n');
    expect(html).toContain('<h1 data-line-start="1" data-line-end="2" id="title">');
    expect(html).toContain('<p data-line-start="3" data-line-end="5">');
    expect(html).toContain('<ul data-line-start="6" data-line-end="8">');
    expect(html).toContain('<li data-line-start="7" data-line-end="8">');
    expect(html).toContain('<p class="tight" data-line-start="7" data-line-end="8">b</p>');
  });

  test('adds source lines to code blocks', () => {
    const html = renderMarkdown('text\n\n```c\nint x;\n```\n');
    expect(html).toMatch(/<code[^>]*data-line-start="3" data-line-end="6"/);
  });

  test('shows raw HTML as text', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('does not render javascript links', () => {
    const html = renderMarkdown('[x](javascript:alert(1))\n');
    expect(html).not.toContain('href="javascript:');
  });

  test('shows alt text for relative images', () => {
    const html = renderMarkdown('![diagram](img/a.png)\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<span class="image-alt">[diagram]</span>');
  });

  test('links web images instead of loading them', () => {
    const html = renderMarkdown('![logo](https://example.com/a.png)\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a class="image-alt" href="https://example.com/a.png">[logo]</a>');
  });

  test('loads data images', () => {
    const html = renderMarkdown('![dot](data:image/png;base64,iVBO)\n');
    expect(html).toContain('<img src="data:image/png;base64,iVBO" alt="dot"');
  });
});

describe('heading ids', () => {
  test('keeps leading punctuation as GitHub does, and skips empty headings', () => {
    const html = renderMarkdown('## & Foo\n\n#\n');
    expect(html).toContain('id="-foo"');
    expect(html).not.toContain('id=""');
  });

  test('uses GitHub slugs, unique in the file', () => {
    const html = renderMarkdown('# Hello, World!\n\n## `Code` and _more_\n\n## Hello World\n\n## Hello World\n');
    const ids = [...html.matchAll(/ id="([^"]*)"/g)].map(m => m[1]);
    expect(ids).toEqual(['hello-world', 'code-and-more', 'hello-world-1', 'hello-world-2']);
  });
});

describe('isRenderedPath', () => {
  test.each([
    ['README.md', true],
    ['doc/Guide.MARKDOWN', true],
    ['doc/guide.adoc', true],
    ['doc/Guide.AsciiDoc', true],
    ['key.asc', false],
    ['main.c', false],
    ['md', false],
    [undefined, false],
  ])('%s → %s', (path, expected) => {
    expect(isRenderedPath(path)).toBe(expected);
  });
});
