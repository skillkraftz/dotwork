import { describe, expect, it } from 'vitest';
import { emptyBook } from '../src/book/book';
import { opening, slotLabel } from '../src/book/labels';

describe('openings and labels', () => {
  it('pairs a left (even) page with the right page after it, covers included', () => {
    expect([0, 1, 4, 5, 8, 9].map(opening)).toEqual([[0, 1], [0, 1], [4, 5], [4, 5], [8, 9], [8, 9]]);
    const b = emptyBook(8);
    expect([0, 3, 9].map((n) => slotLabel(b, n))).toEqual(['Inside front cover', 'Page 3', 'Inside back cover']);
  });
});
