// Pure functions for the scroll sync. Lines are 1-based and can have a
// fractional part: line 10.5 is the middle of line 10.

/** A rendered block, with its position in the scroll content of the pane. */
export interface Block {
  start: number; // first source line
  end: number; // source line after the last one
  top: number;
  height: number;
}

/**
 * The diff rows of the new side, in page order. Measuring a row forces a
 * layout read, and a whole-file diff can have thousands of rows, so the
 * functions below measure only the rows of a binary search.
 */
export interface Rows {
  count: number;
  line(index: number): number;
  box(index: number): {top: number; bottom: number};
}

// The first index in [0, count) for which `test` is true, or `count`. The
// test must be false, then true, along the indexes.
function firstIndex(count: number, test: (index: number) => boolean): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (test(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

// Nested blocks (a paragraph in a list item) contain the same line. The
// innermost block gives the most precise position.
function innermost<T extends {height: number}>(blocks: T[]): T | undefined {
  let best: T | undefined;
  for (const b of blocks) {
    if (!best || b.height < best.height) best = b;
  }
  return best;
}

/** The scroll offset in the pane that shows the source line `line`. */
export function lineToOffset(blocks: Block[], line: number): number {
  const block = innermost(blocks.filter(b => b.start <= line && line < b.end));
  if (block) {
    const fraction = (line - block.start) / (block.end - block.start);
    return block.top + fraction * block.height;
  }
  // The line is outside each block: a blank line, or after the last block.
  const next = blocks.filter(b => b.start > line);
  if (next.length) return Math.min(...next.map(b => b.top));
  return Math.max(0, ...blocks.map(b => b.top + b.height));
}

/** The source line at the scroll offset `offset` of the pane. */
export function offsetToLine(blocks: Block[], offset: number): number {
  const block = innermost(
    blocks.filter(b => b.top <= offset && offset < b.top + b.height)
  );
  if (block) {
    const fraction = (offset - block.top) / block.height;
    return block.start + fraction * (block.end - block.start);
  }
  const next = blocks.filter(b => b.top > offset);
  if (next.length) return Math.min(...next.map(b => b.start));
  return Math.max(1, ...blocks.map(b => b.end));
}

/** The source line at the viewport position `y` of the diff. */
export function lineAtY(rows: Rows, y: number): number | undefined {
  const index = firstIndex(rows.count, i => rows.box(i).bottom > y);
  if (index === rows.count) return undefined;
  const {top, bottom} = rows.box(index);
  const fraction = Math.max(0, (y - top) / (bottom - top));
  return rows.line(index) + Math.min(fraction, 1);
}

/** The viewport position of the source line `line` in the diff. */
export function yOfLine(rows: Rows, line: number): number | undefined {
  if (!rows.count) return undefined;
  const whole = Math.floor(line);
  const after = firstIndex(rows.count, i => rows.line(i) >= whole);
  if (after < rows.count && rows.line(after) === whole) {
    const {top, bottom} = rows.box(after);
    return top + (line - whole) * (bottom - top);
  }
  // Gerrit hides the line (collapsed common lines). Use the nearest row,
  // the one before on a tie.
  const before = after - 1;
  const useBefore =
    before >= 0 &&
    (after === rows.count || line - rows.line(before) <= rows.line(after) - line);
  return rows.box(useBefore ? before : after).top;
}
