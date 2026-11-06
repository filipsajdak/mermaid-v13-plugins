/**
 * v12's `c4Colors.spec.ts` (converged build), ported: `readableOn` on core's colour channels
 * instead of khroma.
 */
import { contrastRatio, luminance, parseColor } from '@mermaid-js/core/theme';
import { describe, expect, it } from 'vitest';
import { readableOn } from '../src/render/colors.ts';

const rgba = (c: string) => parseColor(c)!;
const ratio = (one: string, other: string) => contrastRatio(rgba(one), rgba(other));
const lum = (c: string) => luminance(rgba(c));
const on = (color: string, surface: string) => readableOn(color, parseColor(surface));

/** The shipped c4 palette, which is what the defaults put on screen. */
const PALETTE = ['#08427B', '#686868', '#1168BD', '#999999', '#438DD5', '#B3B3B3', '#85BBF0'];

describe('readableOn', () => {
  it('leaves a colour alone when it already reads on the background', () => {
    expect(on('#08427B', '#ffffff')).toBe('#08427B');
  });

  it('darkens a pale colour on a light background', () => {
    const readable = on('#85BBF0', '#ffffff');
    expect(readable).not.toBe('#85BBF0');
    expect(lum(readable)).toBeLessThan(lum('#85BBF0'));
    expect(ratio(readable, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a dark colour on a dark background', () => {
    const readable = on('#08427B', '#333333');
    expect(lum(readable)).toBeGreaterThan(lum('#08427B'));
    expect(ratio(readable, '#333333')).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches a readable contrast for every palette colour on every theme surface', () => {
    for (const surface of ['#ffffff', '#f4f4f4', '#333333']) {
      for (const color of PALETTE)
        expect(ratio(on(color, surface), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('darkens against a mid-grey background, where lightening cannot reach the target', () => {
    const readable = on('#08427B', '#888888');
    expect(lum(readable)).toBeLessThan(lum('#08427B'));
    expect(ratio(readable, '#888888')).toBeGreaterThanOrEqual(4.5);
  });

  it('never returns a colour less readable than the original', () => {
    for (const surface of ['#ffffff', '#f4f4f4', '#333333', '#6f6f6f', '#888888', '#999999']) {
      for (const color of PALETTE) {
        expect(ratio(on(color, surface), surface)).toBeGreaterThanOrEqual(ratio(color, surface));
      }
    }
  });

  it('returns a value it cannot parse untouched, and a colour on an unknown background', () => {
    expect(on('not-a-color', '#ffffff')).toBe('not-a-color');
    expect(readableOn('#08427B', undefined)).toBe('#08427B');
  });
});
