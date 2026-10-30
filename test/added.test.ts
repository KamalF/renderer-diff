// @vitest-environment jsdom
import {describe, expect, test} from 'vitest';
import {addedLines, markAdded} from '../src/added';
import {renderMarkdown} from '../src/render';
import {renderAsciidoc} from '../src/asciidoc';

describe('addedLines', () => {
  test('counts new lines through common, skipped and changed chunks', () => {
    const diff = {
      content: [
        {ab: ['1', '2']},
        {a: ['old'], b: ['3', '4']},
        {skip: 10},
        {b: ['15']},
        {a: ['removed']},
        {ab: ['16']},
        {a: [' x'], b: ['x'], common: true},
      ],
    };
    expect([...addedLines(diff as never)]).toEqual([3, 4, 15]);
  });

  test('returns an empty set without a diff', () => {
    expect(addedLines(undefined).size).toBe(0);
  });
});

describe('markAdded', () => {
  function marked(html: string, added: number[]) {
    const root = document.createElement('div');
    root.innerHTML = html;
    markAdded(root, new Set(added));
    return [...root.querySelectorAll('[data-added]')].map(e => e.tagName.toLowerCase() + ':' + e.textContent!.trim().split('\n')[0]);
  }

  test('marks the innermost block only', () => {
    expect(marked(renderMarkdown('# T\n\n- a\n- b changed\n\nend\n'), [4])).toEqual(['p:b changed']);
  });

  test('marks a tight list item that has a nested list', () => {
    expect(marked(renderMarkdown('- item A changed\n  - sub\n'), [1])).toEqual(['p:item A changed']);
  });

  test('marks the added row of a table only', async () => {
    expect(marked(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'), [4])).toEqual(['tr:3']);
    expect(marked(await renderAsciidoc('|===\n| a | b\n| 1 | 2\n| 3 | 4\n|===\n'), [4])).toEqual(['tr:3']);
  });

  test('marks the title of an outer block for its own lines', () => {
    const html = '<div data-line-start="1" data-line-end="5"><h2>Title</h2>' +
      '<div data-line-start="3" data-line-end="5"><p>text</p></div></div>';
    expect(marked(html, [1])).toEqual(['h2:Title']);
    expect(marked(html, [3])).toEqual(['div:text']);
  });
});
