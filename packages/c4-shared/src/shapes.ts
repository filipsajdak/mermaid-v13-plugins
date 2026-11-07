/**
 * The C4 element shapes, sized and drawn the way the converged v12 build's shapes size and
 * draw themselves (`person.ts`, `cylinder.ts`, `tiltedCylinder.ts`, `drawRect.ts`, `fr-rect`).
 */
import type { OutlinePaint, SvgWriter } from '@mermaid-js/core/svg';
import type { C4Block } from './blocks.ts';

/** The shapes C4 elements are drawn as. */
export type C4Shape = 'rounded' | 'box' | 'person' | 'cylinder' | 'queue' | 'component';

/** A shape's box around a label block. */
export interface C4Sized {
  readonly width: number;
  readonly height: number;
  /** Centre of the label block, from the shape's centre. */
  readonly labelY: number;
}

/** Corner radius of a rounded element (the converged adapter's inline `rx:12px`). */
export const ELEMENT_RADIUS = 12;
/** Inset of a component's frame lines (v12 `fr-rect`). */
const FRAME_INSET = 8;
/** v12 `c4LabelHelper`: the narrowest wrap width. */
const MIN_WRAP = 32;

/** A person's head radius for a body `width` wide (v12 `person.ts` proportions). */
const headRadius = (width: number): number => Math.min(Math.max(width * 0.23, 16), 80);

/** The box of `shape` around `block`, with `pad` inside and at least `minWidth` wide. */
export function sizeShape(shape: C4Shape, block: C4Block, pad: number, minWidth: number): C4Sized {
  const lw = block.width;
  const lh = block.height;
  switch (shape) {
    case 'person': {
      const w = Math.max(lw + 2 * pad, minWidth, 100);
      const headR = headRadius(w);
      const overlap = headR * 0.27;
      const bodyH = Math.max(overlap + lh + 2 * pad, w * 0.6);
      const total = bodyH + 2 * headR - overlap;
      const bodyTop = -total / 2 + 2 * headR - overlap;
      return { width: w, height: total, labelY: bodyTop + overlap + (bodyH - overlap) / 2 };
    }
    case 'cylinder': {
      const w = Math.max(minWidth - pad, lw) + pad;
      const ry = w / 2 / (2.5 + w / 50);
      const h = lh + pad + ry;
      return { width: w, height: h + 2 * ry, labelY: ry / 2 };
    }
    case 'queue': {
      const h = lh + pad;
      const rx = h / 2 / (2.5 + h / 50);
      const w = Math.max(minWidth - pad / 2, lw + pad) + 2 * rx;
      return { width: w, height: h, labelY: 0 };
    }
    default:
      return { width: Math.max(lw + 2 * pad, minWidth), height: lh + 2 * pad, labelY: 0 };
  }
}

/** The label wrap width each shape gives (v12 shapes shrink `node.width` before measuring). */
export function wrapWidth(shape: C4Shape, pad: number, minWidth: number): number {
  const width =
    shape === 'cylinder' ? minWidth - pad : shape === 'queue' ? minWidth - pad / 2 : minWidth;
  return Math.max(width - 2 * pad, MIN_WRAP);
}

/** A placed shape: the centre and size of its box. */
export interface C4ShapeBox {
  readonly shape: C4Shape;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Draws a shape's outline, as `w.outline` so an outline extension (hand-drawn) can take it. */
export function drawShape(
  w: SvgWriter,
  el: C4ShapeBox,
  fill: OutlinePaint,
  stroke: OutlinePaint,
  strokeWidth: number,
): void {
  const attrs = { fill, stroke, 'stroke-width': strokeWidth } as const;
  const left = el.x - el.width / 2;
  const top = el.y - el.height / 2;
  const rect = {
    x: left,
    y: top,
    width: el.width,
    height: el.height,
    rx: ELEMENT_RADIUS,
    ry: ELEMENT_RADIUS,
  };
  switch (el.shape) {
    case 'person': {
      // A circular head over a rounded body; the head drawn last.
      const headR = headRadius(el.width);
      const overlap = headR * 0.27;
      const bodyTop = top + 2 * headR - overlap;
      const bodyH = el.height - (2 * headR - overlap);
      const bodyR = Math.min(el.width * 0.177, bodyH * 0.45);
      w.outline('node', 'rect', {
        ...attrs,
        x: left,
        y: bodyTop,
        width: el.width,
        height: bodyH,
        rx: bodyR,
        ry: bodyR,
      });
      w.outline('part', 'circle', { ...attrs, cx: el.x, cy: top + headR, r: headR });
      return;
    }
    case 'cylinder': {
      // rx is half the width, ry follows it.
      const rx = el.width / 2;
      const ry = rx / (2.5 + el.width / 50);
      const h = el.height - 2 * ry;
      const d = w
        .path()
        .moveTo(left, top + ry)
        .arcTo(rx, ry, 0, false, false, left + el.width, top + ry)
        .arcTo(rx, ry, 0, false, false, left, top + ry)
        .lineTo(left, top + ry + h)
        .arcTo(rx, ry, 0, false, false, left + el.width, top + ry + h)
        .lineTo(left + el.width, top + ry)
        .done();
      w.outline('node', 'path', { ...attrs, d });
      return;
    }
    case 'queue': {
      // The cylinder on its side, its cap on the right.
      const ry = el.height / 2;
      const rx = ry / (2.5 + el.height / 50);
      const l = left + rx;
      const r = left + el.width - rx;
      const d = w
        .path()
        .moveTo(l, top)
        .lineTo(r, top)
        .arcTo(rx, ry, 0, false, true, r, top + el.height)
        .lineTo(l, top + el.height)
        .arcTo(rx, ry, 0, false, true, l, top)
        .close()
        .moveTo(r, top)
        .arcTo(rx, ry, 0, false, false, r, top + el.height)
        .done();
      w.outline('node', 'path', { ...attrs, d });
      return;
    }
    case 'component': {
      // A framed rectangle.
      w.outline('node', 'rect', { ...attrs, ...rect });
      for (const x of [left + FRAME_INSET, left + el.width - FRAME_INSET]) {
        w.outline('divider', 'line', {
          stroke,
          'stroke-width': strokeWidth,
          x1: x,
          y1: top,
          x2: x,
          y2: top + el.height,
        });
      }
      return;
    }
    case 'box':
      // Square corners: c4-beta's `rect`.
      w.outline('node', 'rect', { ...attrs, x: left, y: top, width: el.width, height: el.height });
      return;
    default:
      w.outline('node', 'rect', { ...attrs, ...rect });
  }
}
