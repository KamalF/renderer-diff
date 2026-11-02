import type {DiffInfo} from '@gerritcodereview/typescript-api/diff';

/**
 * The lines of the new revision that the diff adds or changes. If the diff
 * has no common line (a new file), the set is empty: a green background on
 * the whole file tells nothing.
 */
export function addedLines(diff: DiffInfo | undefined): Set<number> {
  const added = new Set<number>();
  let line = 1;
  for (const chunk of diff?.content ?? []) {
    line += (chunk.ab?.length ?? 0) + (chunk.skip ?? 0);
    for (const _ of chunk.b ?? []) {
      // A common chunk differs only in whitespace that the diff ignores.
      if (!chunk.common) added.add(line);
      line++;
    }
  }
  if (added.size === line - 1) added.clear();
  return added;
}

/**
 * Gives a green background (attribute data-added) to the blocks in `root` with
 * added lines. Only the innermost blocks get it, so that one added line does
 * not color a whole section. For an outer block, its own lines before its
 * first inner block (an AsciiDoc section title) color its first element.
 */
export function markAdded(root: ParentNode, added: Set<number>) {
  const hasAdded = (start: number, end: number) => {
    for (let line = start; line < end; line++) {
      if (added.has(line)) return true;
    }
    return false;
  };
  for (const element of root.querySelectorAll<HTMLElement>('[data-line-start]')) {
    const start = Number(element.dataset['lineStart']);
    const inner = element.querySelector<HTMLElement>('[data-line-start]');
    if (!inner) {
      element.toggleAttribute(
        'data-added',
        hasAdded(start, Number(element.dataset['lineEnd']))
      );
      continue;
    }
    const title = element.firstElementChild;
    if (title && !title.hasAttribute('data-line-start')) {
      title.toggleAttribute(
        'data-added',
        hasAdded(start, Number(inner.dataset['lineStart']))
      );
    }
  }
}
