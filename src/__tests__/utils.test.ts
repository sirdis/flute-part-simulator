import { describe, it, expect } from 'vitest';
import { formatNoteName, matchPart } from '../utils';
import type { FlutePartGeometry } from '../types';

// ── formatNoteName ────────────────────────────────────────────────────────────

describe('formatNoteName', () => {
  it('capitalises the note letter', () => {
    expect(formatNoteName('c-2')).toBe('C2');
  });

  it('converts -sharp to ♯', () => {
    expect(formatNoteName('c-sharp-2')).toBe('C♯2');
  });

  it('converts -flat to ♭', () => {
    expect(formatNoteName('b-flat')).toBe('B♭');
  });

  it('converts -natural to ♮', () => {
    expect(formatNoteName('f-natural-1')).toBe('F♮1');
  });

  it('strips hyphen before trailing octave number', () => {
    expect(formatNoteName('d-3')).toBe('D3');
    expect(formatNoteName('g-sharp-2')).toBe('G♯2');
  });

  it('leaves non-note names unchanged except capitalisation', () => {
    // e.g. "keyPost1" – no note letter at start → falls through regex unchanged
    expect(formatNoteName('keyPost1')).toBe('keyPost1');
  });
});

// ── matchPart ─────────────────────────────────────────────────────────────────

const makePart = (name: string): FlutePartGeometry => ({
  name,
  boreLen: 100,
  radiusAtZero: 14,
  radiusAtEnd: 13,
  holes: [],
});

const PARTS = ['lh-part', 'rh-part', 'footer'].map(makePart);

describe('matchPart', () => {
  it('matches lh-part from filename', () => {
    expect(matchPart(PARTS, '0010-flute-lh-part.nc').name).toBe('lh-part');
  });

  it('matches rh-part from filename', () => {
    expect(matchPart(PARTS, '0015-flute-rh-part.nc').name).toBe('rh-part');
  });

  it('matches footer from filename', () => {
    expect(matchPart(PARTS, '0020-footer-holes.nc').name).toBe('footer');
  });

  it('is case-insensitive', () => {
    expect(matchPart(PARTS, 'RH-PART_final.NC').name).toBe('rh-part');
  });

  it('returns first part when no match found', () => {
    expect(matchPart(PARTS, 'unknown-file.nc').name).toBe('lh-part');
  });
});
