/**
 * Draws a laid-out C4 diagram through the SvgWriter, in the converged build's c4model.com
 * outline look: each element type's palette colour is its border and text over the theme's
 * background; boundaries are dashed unfilled boxes; relationships are dashed lines with an
 * arrowhead and a label on an opaque background.
 */
import type { RenderContext } from '@mermaid-js/core';
import type { RoutePoint } from '@mermaid-js/core/layout';
import { checkColor, checkStyle, checkUrl, px, styleText } from '@mermaid-js/core/svg';
import type { Attrs, OutlinePaint, Paint, SafeColor, SvgWriter } from '@mermaid-js/core/svg';
import type { FontKey } from '@mermaid-js/core/text';
import { C4Config } from '../config.ts';
import { REL_LABEL_PAD, tagsOf, tagStyleOf } from '../layout/index.ts';
import type { C4Block, C4Layout, C4PlacedElement } from '../layout/index.ts';
import type { C4Element, C4Model, C4Rel } from '../parser/index.ts';
import { readableOn } from './colors.ts';

/** The converged stylesheet's dashes: boundaries `8 4`, relationships `6 4`. */
const BOUNDARY_DASH = checkStyle(['stroke-dasharray:8 4']).shape['stroke-dasharray'];
const REL_DASH = checkStyle(['stroke-dasharray:6 4']).shape['stroke-dasharray'];
/** Corner radius of a rounded element (the adapter's inline `rx:12px`). */
const ELEMENT_RADIUS = 12;
/** Corner radius where a stepped relationship turns. */
const TURN_RADIUS = 5;
/** Inset of a component's frame lines (v12 `fr-rect`). */
const FRAME_INSET = 8;

interface Paints {
  readonly background: Paint;
  readonly line: Paint;
  readonly text: Paint;
  readonly title: Paint;
  readonly font: ReturnType<RenderContext['theme']['font']>;
  readonly fontSize: ReturnType<RenderContext['theme']['length']>;
  readonly head: { readonly gap: number; readonly length: number; readonly width: number };
}

/** A font family as an attribute value; undefined when it is not a safe value. */
const familyCache = new Map<string, Attrs['font-family']>();
function family(name: string): Attrs['font-family'] {
  if (!familyCache.has(name))
    familyCache.set(name, checkStyle([`font-family:${name}`]).text['font-family']);
  return familyCache.get(name);
}

/** Text attributes for one section of a label. */
function textAttrs(
  font: FontKey,
  fill: OutlinePaint,
  extra: { bold?: boolean; italic?: boolean } = {},
): Attrs {
  return {
    fill,
    'font-size': px(font.size),
    'font-family': family(font.family),
    'font-weight': extra.bold || font.weight >= 600 ? 'bold' : undefined,
    'font-style': extra.italic ? 'italic' : undefined,
  };
}

/** Draws a block of stacked sections centred on (x, centreY). */
function drawBlock(
  w: SvgWriter,
  block: C4Block,
  x: number,
  centreY: number,
  fill: OutlinePaint,
): void {
  const top = centreY - block.height / 2;
  for (const s of block.sections) {
    w.open('g', { class: `c4-${s.kind}` });
    w.label(
      s.label,
      x,
      top + s.top + s.label.height / 2,
      textAttrs(s.font, fill, { bold: s.kind === 'name', italic: s.italic ?? false }),
    );
    w.close();
  }
}

/** A colour the diagram wrote, or undefined (with a warning) when it is not a safe colour. */
function userColor(
  ctx: RenderContext,
  value: string | undefined,
  what: string,
): SafeColor | undefined {
  if (value === undefined || value === '') return undefined;
  const c = checkColor(value);
  if (!c)
    ctx.warn({
      code: 'C4_COLOR_DROPPED',
      message: `The ${what} colour ${JSON.stringify(value)} is not a colour; it is ignored.`,
    });
  return c;
}

function drawShape(
  w: SvgWriter,
  el: C4PlacedElement,
  fill: OutlinePaint,
  stroke: OutlinePaint,
): void {
  const attrs = { fill, stroke, 'stroke-width': 2 } as const;
  const left = el.x - el.width / 2;
  const top = el.y - el.height / 2;
  switch (el.shape) {
    case 'person': {
      // v12 `person.ts`: a circular head over a rounded body; the head drawn last.
      const headR = Math.min(Math.max(el.width * 0.23, 16), 80);
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
      // v12 `cylinder.ts`: rx is half the width, ry follows it.
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
      // v12 `tiltedCylinder.ts`: the cylinder on its side, its cap on the right.
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
      // v12 `fr-rect`: a framed rectangle.
      w.outline('node', 'rect', {
        ...attrs,
        x: left,
        y: top,
        width: el.width,
        height: el.height,
        rx: ELEMENT_RADIUS,
        ry: ELEMENT_RADIUS,
      });
      for (const x of [left + FRAME_INSET, left + el.width - FRAME_INSET]) {
        w.outline('divider', 'line', {
          stroke,
          'stroke-width': 2,
          x1: x,
          y1: top,
          x2: x,
          y2: top + el.height,
        });
      }
      return;
    }
    default:
      w.outline('node', 'rect', {
        ...attrs,
        x: left,
        y: top,
        width: el.width,
        height: el.height,
        rx: ELEMENT_RADIUS,
        ry: ELEMENT_RADIUS,
      });
  }
}

/** Unit vector from `a` to `b`. */
function unit(a: RoutePoint, b: RoutePoint): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The relationship line: corners rounded, ends trimmed to leave room for arrowheads. */
function routePath(
  w: SvgWriter,
  points: readonly RoutePoint[],
  trimStart: number,
  trimEnd: number,
) {
  const pts = points.map((p) => ({ ...p }));
  const first = pts[0];
  const second = pts[1];
  const last = pts.at(-1);
  const before = pts.at(-2);
  if (!first || !second || !last || !before) return undefined;
  const s = unit(first, second);
  const e = unit(before, last);
  const start = { x: first.x, y: first.y };
  const end = { x: last.x, y: last.y };
  first.x += s.x * trimStart;
  first.y += s.y * trimStart;
  last.x -= e.x * trimEnd;
  last.y -= e.y * trimEnd;
  const b = w.path().moveTo(first.x, first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const next = pts[i + 1];
    if (!p || !prev || !next) continue;
    const r = Math.min(
      TURN_RADIUS,
      Math.hypot(p.x - prev.x, p.y - prev.y) / 2,
      Math.hypot(next.x - p.x, next.y - p.y) / 2,
    );
    const u = unit(prev, p);
    const v = unit(p, next);
    b.lineTo(p.x - u.x * r, p.y - u.y * r).quadTo(p.x, p.y, p.x + v.x * r, p.y + v.y * r);
  }
  b.lineTo(last.x, last.y);
  return { d: b.done(), start, end, s, e };
}

function arrowhead(
  w: SvgWriter,
  tip: { x: number; y: number },
  dir: { x: number; y: number },
  paints: Paints,
  fill: OutlinePaint,
): void {
  const { gap, length, width } = paints.head;
  const tx = tip.x - dir.x * gap;
  const ty = tip.y - dir.y * gap;
  const bx = tx - dir.x * length;
  const by = ty - dir.y * length;
  const ax = -dir.y * (width / 2);
  const ay = dir.x * (width / 2);
  const d = w
    .path()
    .moveTo(tx, ty)
    .lineTo(bx + ax, by + ay)
    .lineTo(bx - ax, by - ay)
    .close()
    .done();
  w.leaf('path', { class: 'c4-arrowhead', d, fill, stroke: 'none' });
}

/** The colours a relationship draws with: its own, else a tag's, else the theme's. */
function relPaints(ctx: RenderContext, model: C4Model, rel: C4Rel, paints: Paints) {
  const tags = tagsOf(rel.tags, model.relTags);
  const tagged = (key: 'lineColor' | 'textColor'): string | undefined =>
    tags.reduce<string | undefined>((c, t) => t[key] ?? c, undefined);
  return {
    line: userColor(ctx, rel.lineColor ?? tagged('lineColor'), 'line') ?? paints.line,
    text: userColor(ctx, rel.textColor ?? tagged('textColor'), 'text') ?? paints.text,
  };
}

/** A relationship's line and arrowheads. Its label is drawn later, over the elements. */
function drawRelLine(
  w: SvgWriter,
  rel: C4Rel,
  placed: C4Layout['rels'][number],
  line: OutlinePaint,
  paints: Paints,
): void {
  const atStart = rel.type === 'birel' || rel.type === 'rel_b';
  const atEnd = rel.type !== 'rel_b';
  const trim = paints.head.gap + Math.max(0, paints.head.length - 1);
  w.open('g', {
    class: `c4-rel c4-${rel.type}`,
    'data-id': `rel-${placed.index}`,
    'data-ast': rel.ast,
  });
  const route = routePath(w, placed.route.points, atStart ? trim : 0, atEnd ? trim : 0);
  if (route) {
    w.outline('edge', 'path', {
      d: route.d,
      fill: 'none',
      stroke: line,
      'stroke-width': 1.5,
      'stroke-dasharray': REL_DASH,
    });
    if (atEnd) arrowhead(w, route.end, route.e, paints, line);
    if (atStart) arrowhead(w, route.start, { x: -route.s.x, y: -route.s.y }, paints, line);
  }
  w.close();
}

/** A relationship's label on its opaque background, moved by `$offsetX`/`$offsetY`. */
function drawRelLabel(
  w: SvgWriter,
  rel: C4Rel,
  placed: C4Layout['rels'][number],
  text: OutlinePaint,
  paints: Paints,
): void {
  const at = placed.route.label;
  const block = placed.block;
  if (!at || !block) return;
  const x = at.x + (rel.offsetX ?? 0);
  const y = at.y + (rel.offsetY ?? 0);
  w.open('g', { class: 'c4-rel-label', 'data-id': `rel-${placed.index}-label` });
  w.leaf('rect', {
    x: x - block.width / 2 - REL_LABEL_PAD,
    y: y - block.height / 2 - REL_LABEL_PAD,
    width: block.width + 2 * REL_LABEL_PAD,
    height: block.height + 2 * REL_LABEL_PAD,
    fill: paints.background,
    stroke: 'none',
  });
  drawBlock(w, block, x, y, text);
  w.close();
}

function drawElement(
  w: SvgWriter,
  ctx: RenderContext,
  model: C4Model,
  el: C4Element,
  placed: C4PlacedElement,
  identity: OutlinePaint,
  paints: Paints,
): void {
  const tag = tagStyleOf(el, model.elementTags);
  const fill = userColor(ctx, el.style.bgColor ?? tag.bgColor, 'background') ?? paints.background;
  const stroke = userColor(ctx, el.style.borderColor ?? tag.borderColor, 'border') ?? identity;
  const text = userColor(ctx, el.style.fontColor ?? tag.fontColor, 'font') ?? identity;
  const external = el.type.startsWith('external_') ? ' c4-external' : '';
  const href =
    el.link === undefined
      ? undefined
      : checkUrl(el.link, {
          securityLevel: ctx.securityLevel,
          ...(ctx.linkSchemes ? { linkSchemes: ctx.linkSchemes } : {}),
          warn: (x) => {
            ctx.warn(x);
          },
        });
  if (href) w.open('a', { href });
  w.open('g', {
    class: `c4-shape c4-${el.type}${external}`,
    'data-id': el.alias,
    'data-ast': el.ast,
  });
  drawShape(w, placed, fill, stroke);
  drawBlock(w, placed.block, placed.x, placed.labelY, text);
  w.close();
  if (href) w.close();
}

/** Writes the whole `<svg>` document of a laid-out C4 diagram. */
export function renderC4(model: C4Model, layout: C4Layout, ctx: RenderContext, w: SvgWriter): void {
  const { theme } = ctx;
  const cfg = new C4Config(ctx.config);
  // Every paint is asked for before the root is written: the root declares the theme's
  // aliases used so far, and a streamed root cannot be changed afterwards.
  const paints: Paints = {
    background: theme.color('background'),
    line: theme.color('lineColor'),
    text: theme.color('textColor'),
    title: theme.color('titleColor'),
    font: theme.font(),
    fontSize: theme.length('fontSize'),
    head: {
      gap: theme.number('arrowheadGap'),
      length: theme.number('arrowheadLength'),
      width: theme.number('arrowheadWidth'),
    },
  };
  const surface = theme.rgba('background');
  const identities = new Map<string, OutlinePaint>();
  for (const el of model.elements) {
    if (identities.has(el.type)) continue;
    const palette = cfg.string(`${el.type}_bg_color`);
    const c = palette === undefined ? undefined : checkColor(readableOn(palette, surface));
    identities.set(el.type, c ?? paints.text);
  }
  const prefix = ctx.idPrefix;
  const title = model.accTitle || undefined;
  const desc = model.accDescr || undefined;
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-c4 c4Diagram',
    viewBox: [0, 0, layout.width, layout.height],
    width: layout.width,
    height: layout.height,
    role: 'img',
    'aria-roledescription': 'c4',
    'aria-labelledby': title ? `${prefix}-title` : undefined,
    'aria-describedby': desc ? `${prefix}-desc` : undefined,
    'data-mermaid-version': ctx.version,
    style: styleText({ 'max-width': px(layout.width) }, theme.rootStyleText()),
    'font-family': paints.font,
    'font-size': paints.fontSize,
  });
  if (title) {
    w.open('title', { id: `${prefix}-title` });
    w.text(title);
    w.close();
  }
  if (desc) {
    w.open('desc', { id: `${prefix}-desc` });
    w.text(desc);
    w.close();
  }
  if (layout.title) {
    w.open('g', { class: 'c4-title' });
    w.label(
      layout.title.label,
      layout.title.x,
      layout.title.y,
      textAttrs(layout.title.font, paints.title),
    );
    w.close();
  }
  const byAlias = new Map(model.boundaries.map((b) => [b.alias, b]));
  for (const b of [...layout.boundaries].sort((p, q) => p.depth - q.depth)) {
    const boundary = byAlias.get(b.alias);
    if (!boundary) continue;
    const fill = userColor(ctx, boundary.style.bgColor, 'background') ?? 'none';
    const stroke = userColor(ctx, boundary.style.borderColor, 'border') ?? paints.line;
    const text = userColor(ctx, boundary.style.fontColor, 'font') ?? paints.text;
    const node = boundary.nodeType ? ' c4-deployment-node' : '';
    w.open('g', { class: `c4-boundary${node}`, 'data-id': b.alias, 'data-ast': boundary.ast });
    w.outline('group', 'rect', {
      x: b.x - b.width / 2,
      y: b.y - b.height / 2,
      width: b.width,
      height: b.height,
      fill,
      stroke,
      'stroke-width': 1,
      'stroke-dasharray': BOUNDARY_DASH,
    });
    w.label(b.label, b.title.x, b.title.y, textAttrs(b.font, text));
    w.close();
  }
  const rels = layout.rels.flatMap((r) => {
    const rel = model.rels[r.index];
    return rel ? [{ r, rel, ...relPaints(ctx, model, rel, paints) }] : [];
  });
  for (const { r, rel, line } of rels) drawRelLine(w, rel, r, line, paints);
  const elements = new Map(model.elements.map((e) => [e.alias, e]));
  for (const p of layout.elements) {
    const el = elements.get(p.alias);
    if (el) drawElement(w, ctx, model, el, p, identities.get(el.type) ?? paints.text, paints);
  }
  for (const { r, rel, text } of rels) drawRelLabel(w, rel, r, text, paints);
  w.close();
}
