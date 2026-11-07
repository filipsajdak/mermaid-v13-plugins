/**
 * v12 `c4Colors.ts` `readableOn`, on core's colour channels instead of khroma. Core has the
 * HSL steps khroma's `lighten`/`darken` take (`shiftHsl`) but does not export them, so the
 * lightness shift is done here.
 */
import { contrastRatio, formatColor, parseColor } from '@mermaid-js/core/theme';
import type { Rgba } from '@mermaid-js/core/theme';

/** WCAG AA for normal text. */
const CONTRAST_TARGET = 4.5;
/** v12 shifts at most 12 times, 5 lightness points each. */
const STEPS = 12;
const STEP = 5;

function toHsl([r, g, b]: Rgba): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function fromHsl(h: number, s: number, l: number, a: number): Rgba {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const f = (n: number): number =>
    ln - sn * Math.min(ln, 1 - ln) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255, a];
}

/** `c` with its lightness moved by `dl` points, clamped (khroma `lighten`/`darken`). */
function shift(c: Rgba, dl: number): Rgba {
  const [h, s, l] = toHsl(c);
  return fromHsl(h, s, Math.max(0, Math.min(100, l + dl)), c[3]);
}

function untilReadable(color: Rgba, background: Rgba, dl: number): Rgba {
  let candidate = color;
  for (let i = 0; i < STEPS && contrastRatio(candidate, background) < CONTRAST_TARGET; i++) {
    const next = shift(candidate, dl);
    if (formatColor(next) === formatColor(candidate)) break;
    candidate = next;
  }
  return candidate;
}

/**
 * `color` shifted until it reads against `background`, trying lighter and darker and keeping
 * the better. A colour that does not parse, or a background JS cannot compute (a CSS
 * expression), leaves `color` as it is.
 */
export function readableOn(color: string, background: Rgba | undefined): string {
  const c = parseColor(color);
  if (!c || !background) return color;
  if (contrastRatio(c, background) >= CONTRAST_TARGET) return color;
  const lighter = untilReadable(c, background, STEP);
  const darker = untilReadable(c, background, -STEP);
  return formatColor(
    contrastRatio(lighter, background) >= contrastRatio(darker, background) ? lighter : darker,
  );
}
