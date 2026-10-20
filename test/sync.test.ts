import {describe, expect, test} from 'vitest';
import {Block, lineAtY, lineToOffset, offsetToLine, Rows, yOfLine} from '../src/sync';

interface Row {
  line: number;
  top: number;
  bottom: number;
}

function rowsOf(list: Row[]): Rows {
  return {count: list.length, line: i => list[i].line, box: i => list[i]};
}

// Lines 1-2: heading. Lines 4-9: list (items 4-6 and 7-9). Line 11: paragraph.
const blocks: Block[] = [
  {start: 1, end: 3, top: 0, height: 40},
  {start: 4, end: 10, top: 50, height: 120},
  {start: 4, end: 7, top: 50, height: 60},
  {start: 7, end: 10, top: 110, height: 60},
  {start: 11, end: 12, top: 180, height: 20},
];

describe('lineToOffset', () => {
  test('interpolates inside the innermost block', () => {
    expect(lineToOffset(blocks, 1)).toBe(0);
    expect(lineToOffset(blocks, 2)).toBe(20);
    expect(lineToOffset(blocks, 8)).toBe(130);
  });

  test('uses the next block for a line between blocks', () => {
    expect(lineToOffset(blocks, 3)).toBe(50);
    expect(lineToOffset(blocks, 10.5)).toBe(180);
  });

  test('uses the end of the last block after the last block', () => {
    expect(lineToOffset(blocks, 50)).toBe(200);
  });

  test('returns 0 without blocks', () => {
    expect(lineToOffset([], 5)).toBe(0);
  });
});

describe('offsetToLine', () => {
  test('is the inverse of lineToOffset inside blocks', () => {
    for (const line of [1, 2, 4.5, 8, 11]) {
      expect(offsetToLine(blocks, lineToOffset(blocks, line))).toBeCloseTo(line);
    }
  });

  test('uses the next block in a gap between blocks', () => {
    expect(offsetToLine(blocks, 45)).toBe(4);
  });

  test('uses the end of the last block after the last block', () => {
    expect(offsetToLine(blocks, 500)).toBe(12);
  });
});

// Rows of 20 px. Lines 5-19 are collapsed.
const rowList: Row[] = [
  {line: 1, top: 100, bottom: 120},
  {line: 2, top: 120, bottom: 140},
  {line: 3, top: 140, bottom: 160},
  {line: 4, top: 160, bottom: 180},
  {line: 20, top: 200, bottom: 220},
  {line: 21, top: 220, bottom: 240},
];
const rows = rowsOf(rowList);

describe('lineAtY', () => {
  test('returns the line and the fraction at the position', () => {
    expect(lineAtY(rows, 100)).toBe(1);
    expect(lineAtY(rows, 130)).toBe(2.5);
  });

  test('uses the start of the first row below the position', () => {
    expect(lineAtY(rows, 50)).toBe(1);
    expect(lineAtY(rows, 190)).toBe(20);
  });

  test('returns undefined below the last row', () => {
    expect(lineAtY(rows, 300)).toBeUndefined();
  });
});

describe('yOfLine', () => {
  test('is the inverse of lineAtY for shown lines', () => {
    for (const y of [100, 130, 175, 210]) {
      expect(yOfLine(rows, lineAtY(rows, y)!)).toBe(y);
    }
  });

  test('uses the nearest row for a collapsed line', () => {
    expect(yOfLine(rows, 6)).toBe(160);
    expect(yOfLine(rows, 18)).toBe(200);
  });

  test('returns undefined without rows', () => {
    expect(yOfLine(rowsOf([]), 3)).toBeUndefined();
  });

  test('measures only a few rows of a long diff', () => {
    let measured = 0;
    const long: Rows = {
      count: 3000,
      line: i => i + 1,
      box: i => {
        measured++;
        return {top: i * 20, bottom: i * 20 + 20};
      },
    };
    expect(lineAtY(long, 30000)).toBe(1501);
    expect(yOfLine(long, 2000)).toBe(39980);
    expect(measured).toBeLessThan(40);
  });
});
