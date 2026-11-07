/**
 * Drawing a laid-out C4 scene's parts through the SvgWriter: label blocks, relationship lines
 * with drawn arrowheads (no `<marker>`), relationship labels on an opaque background, group
 * frames with their titles, and colours from the diagram source checked on the way in.
 */
import type { RenderContext } from '@mermaid-js/core';
import type { RoutePoint } from '@mermaid-js/core/layout';
import { checkColor, checkStyle, px } from '@mermaid-js/core/svg';
import type { Attrs, OutlinePaint, Paint, SafeColor, SvgWriter } from '@mermaid-js/core/svg';
import type { FontKey } from '@mermaid-js/core/text';
import type { C4Block } from './blocks.ts';
import type { PlacedEdge, PlacedGroup } from './scene.ts';
import { EDGE_LABEL_PAD } from './scene.ts';

/** A dash pattern as an attribute value. Core has no constructor for a constant one. */
export const dash = (pattern: string): Attrs['stroke-dasharray'] =>
  checkStyle([`stroke-dasharray:${pattern}`]).shape['stroke-dasharray'];

/** Corner radius where a stepped route turns. */
const TURN_RADIUS = 5;

const familyCache = new Map<string, Attrs['font-family']>();
/** A font family as an attribute value; undefined when it is not a safe value. */
function family(name: string): Attrs['font-family'] {
  if (!familyCache.has(name))
    familyCache.set(name, checkStyle([`font-family:${name}`]).text['font-family']);
  return familyCache.get(name);
}

/** Text attributes for one section of a label. */
export function textAttrs(
  font: FontKey,
  fill: OutlinePaint,
  extra: { bold?: boolean; italic?: boolean } = {},
): Attrs {
  return {
    fill,
    'font-size': px(font.size),
    'font-family': family(font.family),
    'font-weight': extra.bold === true || font.weight >= 600 ? 'bold' : undefined,
    'font-style': extra.italic === true ? 'italic' : undefined,
  };
}

/** Draws a block of stacked sections centred on (x, centreY). */
export function drawBlock(
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
      textAttrs(s.font, fill, { bold: s.bold ?? false, italic: s.italic ?? false }),
    );
    w.close();
  }
}

/** A colour the diagram wrote, or undefined (with a warning) when it is not a safe colour. */
export function userColor(
  ctx: RenderContext,
  value: string | undefined,
  what: string,
): SafeColor | undefined {
  if (value === undefined || value === '') return undefined;
  const c = checkColor(value);
  if (!c) {
    ctx.warn({
      code: 'C4_COLOR_DROPPED',
      message: `The ${what} colour ${JSON.stringify(value)} is not a colour; it is ignored.`,
    });
  }
  return c;
}

/** The theme's arrowhead lengths. */
export interface Head {
  readonly gap: number;
  readonly length: number;
  readonly width: number;
}

export const headOf = (theme: RenderContext['theme']): Head => ({
  gap: theme.number('arrowheadGap'),
  length: theme.number('arrowheadLength'),
  width: theme.number('arrowheadWidth'),
});

function unit(a: RoutePoint, b: RoutePoint): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The route as a path: corners rounded, ends trimmed to leave room for arrowheads. */
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
  head: Head,
  fill: OutlinePaint,
): void {
  const tx = tip.x - dir.x * head.gap;
  const ty = tip.y - dir.y * head.gap;
  const bx = tx - dir.x * head.length;
  const by = ty - dir.y * head.length;
  const ax = -dir.y * (head.width / 2);
  const ay = dir.x * (head.width / 2);
  const d = w
    .path()
    .moveTo(tx, ty)
    .lineTo(bx + ax, by + ay)
    .lineTo(bx - ax, by - ay)
    .close()
    .done();
  w.leaf('path', { class: 'c4-arrowhead', d, fill, stroke: 'none' });
}

/** How a relationship line is drawn. */
export interface EdgeStyle {
  readonly start: boolean;
  readonly end: boolean;
  readonly stroke: OutlinePaint;
  readonly width: number;
  readonly dash?: Attrs['stroke-dasharray'];
}

/** A relationship's line and arrowheads; the caller opens and closes its group. */
export function drawEdgeLine(w: SvgWriter, edge: PlacedEdge, style: EdgeStyle, head: Head): void {
  const trim = head.gap + Math.max(0, head.length - 1);
  const route = routePath(w, edge.route.points, style.start ? trim : 0, style.end ? trim : 0);
  if (!route) return;
  w.outline('edge', 'path', {
    d: route.d,
    fill: 'none',
    stroke: style.stroke,
    'stroke-width': style.width,
    'stroke-dasharray': style.dash,
  });
  if (style.end) arrowhead(w, route.end, route.e, head, style.stroke);
  if (style.start) arrowhead(w, route.start, { x: -route.s.x, y: -route.s.y }, head, style.stroke);
}

/** A relationship's label on an opaque background, moved by `offset`. */
export function drawEdgeLabel(
  w: SvgWriter,
  edge: PlacedEdge,
  background: Paint,
  text: OutlinePaint,
  offset: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): void {
  const at = edge.route.label;
  const block = edge.block;
  if (!at || !block) return;
  const x = at.x + offset.x;
  const y = at.y + offset.y;
  w.leaf('rect', {
    x: x - block.width / 2 - EDGE_LABEL_PAD,
    y: y - block.height / 2 - EDGE_LABEL_PAD,
    width: block.width + 2 * EDGE_LABEL_PAD,
    height: block.height + 2 * EDGE_LABEL_PAD,
    fill: background,
    stroke: 'none',
  });
  drawBlock(w, block, x, y, text);
}

/** How a group frame is drawn. */
export interface GroupStyle {
  readonly fill: OutlinePaint;
  readonly stroke: OutlinePaint;
  readonly text: OutlinePaint;
  readonly width: number;
  readonly dash?: Attrs['stroke-dasharray'];
}

/** A group's frame and its title; the caller opens and closes its group element. */
export function drawGroupFrame(w: SvgWriter, g: PlacedGroup, style: GroupStyle): void {
  w.outline('group', 'rect', {
    x: g.x - g.width / 2,
    y: g.y - g.height / 2,
    width: g.width,
    height: g.height,
    fill: style.fill,
    stroke: style.stroke,
    'stroke-width': style.width,
    'stroke-dasharray': style.dash,
  });
  drawBlock(w, g.block, g.title.x, g.title.y, style.text);
}
