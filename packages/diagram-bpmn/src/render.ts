/**
 * Writes a laid-out BPMN diagram through `SvgWriter`, within its allow-list: v12 drew the
 * shapes with d3 and the markers with `<marker>`, and the glyphs from an Iconify pack; here
 * everything is a `rect`, `circle`, `polygon`, `line` or `path`, and the markers are drawn at
 * the ends of each line (`bpmn*.ts` shapes and `styles.ts` of the bpmn-beta series, #8166).
 */
import type { RenderContext } from '@mermaid-js/core';
import {
  checkColor,
  checkStyle,
  px,
  rotate,
  scale,
  styleText,
  transforms,
  translate,
} from '@mermaid-js/core/svg';
import type { Attrs, Paint, SvgWriter } from '@mermaid-js/core/svg';
import { ICON_BOX, ICONS } from './icons.ts';
import type { IconAttrs, IconElement } from './icon-types.ts';
import { SIZES, TITLE_FONT_SIZE } from './layout.ts';
import type { BpmnLayout, PlacedBand, PlacedFlow, PlacedGroup, PlacedNode } from './layout.ts';
import type { BpmnModel } from './model.ts';

/** v12's stroke widths (px, `styles.ts`). */
const STROKE = {
  event: 1.6,
  end: 3.4,
  activity: 1.6,
  call: 3.4,
  gateway: 1.6,
  data: 1.4,
  band: 1,
  group: 1.4,
  edge: 1.6,
} as const;

/** Inner ring of an intermediate or boundary event, inside the outer one (px). */
const RING_GAP = 3;
const ACTIVITY_RADIUS = 10;
const GROUP_RADIUS = 10;
const DATA_FOLD = 10;
const STORE_RY = 6;
const STORE_RINGS = [0, 5, 10] as const;
/** The arrowhead's length and half width (px), v12's point marker. */
const HEAD = { length: 8, half: 4 } as const;
/** The message flow's source ring (px). */
const RING_RADIUS = 4;
/** Where a route turns, its corner is rounded with this radius (px), v12's `rounded` curve. */
const CORNER = 5;
const EDGE_LABEL_PAD = { x: 4, y: 2 } as const;
const GROUP_TITLE_INSET = 6;
const dash = (value: string) =>
  checkStyle([`stroke-dasharray: ${value}`]).shape['stroke-dasharray'];
/** v12's `edge-pattern-dashed` and `edge-pattern-dotted`, and the group's dash-dot. */
const DASHED = dash('3');
const DOTTED = dash('2');
const DASH_DOT = dash('10 4 2 4');
const UPWARD = -90;

/** v12's end event is red whatever the theme; only its lightness follows the background. */
const END_EVENT = {
  light: checkColor('hsl(4, 55%, 42%)'),
  dark: checkColor('hsl(4, 55%, 68%)'),
} as const;
/** v12 softens a lane's and an annotation's line towards the background, by these shares. */
const LANE_SHARE = 0.25;
const ANNOTATION_SHARE = 0.55;

/**
 * Every paint, asked for before the root is written so the root declares it. v12 derived them
 * as theme variables under `themeVariables.bpmn` (`bpmnThemeVariables`): events and data take
 * `tertiaryColor`, gateways `secondaryColor`, activities `primaryColor`, lines `lineColor`. A
 * plugin cannot add theme variables, so the derived outlines are core's `nodeBorder`.
 */
function paints(ctx: RenderContext) {
  const { theme } = ctx;
  return {
    font: theme.font(),
    fontSize: theme.length('fontSize'),
    eventFill: theme.color('tertiaryColor'),
    gatewayFill: theme.color('secondaryColor'),
    activityFill: theme.color('primaryColor'),
    outline: theme.outline('nodeBorder'),
    line: theme.color('lineColor'),
    end: (theme.dark ? END_EVENT.dark : END_EVENT.light) ?? theme.color('lineColor'),
    text: theme.color('nodeTextColor'),
    title: theme.color('titleColor'),
    textColor: theme.color('textColor'),
    edgeLabel: theme.color('edgeLabelBackground'),
  };
}

type Paints = ReturnType<typeof paints>;

function openRoot(
  w: SvgWriter,
  model: BpmnModel,
  layout: BpmnLayout,
  ctx: RenderContext,
  p: Paints,
) {
  const width = Math.max(1, Math.ceil(layout.width));
  const height = Math.max(1, Math.ceil(layout.height));
  const prefix = ctx.idPrefix;
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-bpmn',
    viewBox: [0, 0, width, height],
    width: '100%',
    role: 'img',
    'aria-roledescription': 'bpmn',
    'aria-labelledby': model.accTitle ? `${prefix}-title` : undefined,
    'aria-describedby': model.accDescr ? `${prefix}-desc` : undefined,
    'data-mermaid-version': ctx.version,
    style: styleText({ 'max-width': px(width) }, ctx.theme.rootStyleText()),
    'font-family': p.font,
    'font-size': p.fontSize,
  });
  if (model.accTitle) {
    w.open('title', { id: `${prefix}-title` });
    w.text(model.accTitle);
    w.close();
  }
  if (model.accDescr) {
    w.open('desc', { id: `${prefix}-desc` });
    w.text(model.accDescr);
    w.close();
  }
}

/** A label centred on (x, y), turned to read upward when `upward`. */
function label(
  w: SvgWriter,
  box: Parameters<SvgWriter['label']>[0],
  x: number,
  y: number,
  attrs: Attrs,
  upward = false,
) {
  if (!upward) {
    w.label(box, x, y, attrs);
    return;
  }
  w.open('g', { transform: transforms(translate(x, y), rotate(UPWARD)) });
  w.label(box, 0, 0, attrs);
  w.close();
}

function drawBand(w: SvgWriter, band: PlacedBand, p: Paints) {
  const pool = band.node.kind === 'pool';
  w.open('g', {
    class: pool ? 'cluster pool swimlane bpmn-pool' : 'cluster swimlane bpmn-lane',
    'data-id': band.node.id,
  });
  const shape = {
    fill: 'none',
    stroke: p.line,
    'stroke-opacity': LANE_SHARE,
    'stroke-width': STROKE.band,
  } as const;
  w.outline('group', 'rect', {
    class: pool ? 'pool-body' : 'swimlane-body',
    ...band.box,
    ...shape,
  });
  if (band.title.width > 0 && band.title.height > 0) {
    w.outline('group', 'rect', { class: 'swimlane-title', ...band.title, ...shape });
  }
  if (band.label) {
    label(
      w,
      band.label,
      band.title.x + band.title.width / 2,
      band.title.y + band.title.height / 2,
      { class: 'cluster-label', fill: p.title },
      band.titleReadsUpward,
    );
  }
  w.close();
}

function drawGroup(w: SvgWriter, group: PlacedGroup, p: Paints) {
  w.open('g', { class: 'cluster bpmn-group', 'data-id': group.node.id });
  w.outline('group', 'rect', {
    ...group.box,
    rx: GROUP_RADIUS,
    ry: GROUP_RADIUS,
    fill: 'none',
    stroke: p.line,
    'stroke-opacity': LANE_SHARE,
    'stroke-width': STROKE.group,
    'stroke-dasharray': DASH_DOT,
  });
  if (group.label) {
    label(
      w,
      group.label,
      group.box.x + group.box.width / 2,
      group.box.y + GROUP_TITLE_INSET + group.label.height / 2,
      {
        class: 'cluster-label',
        fill: p.title,
      },
    );
  }
  w.close();
}

const PAINT_WORDS = new Set(['none', 'currentColor']);
const isPaint = (v: string | undefined): v is 'none' | 'currentColor' =>
  v !== undefined && PAINT_WORDS.has(v);
const LINECAPS = new Set(['butt', 'round', 'square']);
const isLinecap = (v: string | undefined): v is 'butt' | 'round' | 'square' =>
  v !== undefined && LINECAPS.has(v);
const LINEJOINS = new Set(['miter', 'round', 'bevel']);
const isLinejoin = (v: string | undefined): v is 'miter' | 'round' | 'bevel' =>
  v !== undefined && LINEJOINS.has(v);

/** An icon element's own attributes; a throwing event's glyph is filled, as v12's CSS did. */
function iconAttrs(a: IconAttrs, filled: boolean, foldPaint: Paint): Attrs {
  const fold = a.class === 'bpmn-glyph-fold';
  return {
    ...(a.class ? { class: a.class } : {}),
    fill: filled && !fold ? 'currentColor' : isPaint(a.fill) ? a.fill : 'currentColor',
    stroke: filled && fold ? foldPaint : isPaint(a.stroke) ? a.stroke : undefined,
    'stroke-width': a['stroke-width'],
    'stroke-linecap': isLinecap(a['stroke-linecap']) ? a['stroke-linecap'] : undefined,
    'stroke-linejoin': isLinejoin(a['stroke-linejoin']) ? a['stroke-linejoin'] : undefined,
    opacity: a.opacity,
  };
}

function iconPath(w: SvgWriter, el: Extract<IconElement, { tag: 'path' }>) {
  const b = w.path();
  for (const [cmd, ...n] of el.d) {
    const v = n.map(Number);
    const at = (i: number) => v[i] ?? 0;
    if (cmd === 'M') b.moveTo(at(0), at(1));
    else if (cmd === 'L') b.lineTo(at(0), at(1));
    else if (cmd === 'C') b.curveTo(at(0), at(1), at(2), at(3), at(4), at(5));
    else if (cmd === 'A') b.arcTo(at(0), at(1), at(2), at(3) === 1, at(4) === 1, at(5), at(6));
    else if (cmd === 'Z') b.close();
  }
  return b.done();
}

/** Draws icon `name` in a `size` square centred on (x, y), in `paint`. */
function drawIcon(
  w: SvgWriter,
  name: string | undefined,
  x: number,
  y: number,
  size: number,
  paint: Paint,
  options: { filled?: boolean; foldPaint?: Paint; cls?: string } = {},
) {
  const icon = name === undefined ? undefined : ICONS[name];
  if (!icon) return;
  w.open('g', {
    class: options.cls ?? 'bpmn-glyph',
    color: paint,
    transform: transforms(translate(x - size / 2, y - size / 2), scale(size / ICON_BOX)),
  });
  for (const el of icon) {
    const attrs = iconAttrs(el.attrs, options.filled ?? false, options.foldPaint ?? 'none');
    if (el.tag === 'path') w.leaf('path', { ...attrs, d: iconPath(w, el) });
    else w.leaf('circle', { ...attrs, cx: el.cx, cy: el.cy, r: el.r });
  }
  w.close();
}

/** The caption under a shape whose drawn part is `drawnHeight` tall. */
function caption(w: SvgWriter, n: PlacedNode, drawnHeight: number, p: Paints) {
  if (!n.label) return;
  label(w, n.label, n.x, n.y + drawnHeight / 2 + SIZES.labelGap + n.label.height / 2, {
    class: 'label',
    fill: p.text,
  });
}

function drawEvent(w: SvgWriter, n: PlacedNode, p: Paints) {
  const r = SIZES.event / 2;
  const end = n.node.keyword === 'end';
  const throwing = end || n.node.keyword === 'throw';
  const double = n.drawn.shape === 'bpmn-intermediate' || n.drawn.shape === 'bpmn-boundary';
  w.leaf('circle', {
    class: 'bpmn-event-ring',
    cx: n.x,
    cy: n.y,
    r,
    fill: p.eventFill,
    stroke: end ? p.end : p.line,
    'stroke-width': end ? STROKE.end : STROKE.event,
  });
  if (double) {
    w.leaf('circle', {
      class: 'bpmn-event-ring bpmn-event-ring-inner',
      cx: n.x,
      cy: n.y,
      r: r - RING_GAP,
      fill: 'none',
      stroke: p.line,
      'stroke-width': STROKE.event,
    });
  }
  drawIcon(w, n.drawn.icon, n.x, n.y, SIZES.icon, p.line, {
    filled: throwing,
    foldPaint: p.eventFill,
  });
  caption(w, n, SIZES.event, p);
}

function drawGateway(w: SvgWriter, n: PlacedNode, p: Paints) {
  const h = SIZES.gateway / 2;
  w.leaf('polygon', {
    class: 'bpmn-gateway-diamond',
    points: [n.x, n.y - h, n.x + h, n.y, n.x, n.y + h, n.x - h, n.y],
    fill: p.gatewayFill,
    stroke: p.outline,
    'stroke-width': STROKE.gateway,
    'stroke-linejoin': 'round',
  });
  drawIcon(w, n.drawn.icon, n.x, n.y, SIZES.icon + 2, p.line);
  caption(w, n, SIZES.gateway, p);
}

function drawActivity(w: SvgWriter, n: PlacedNode, p: Paints) {
  const { box } = n;
  w.outline('node', 'rect', {
    class: 'bpmn-activity-rect',
    ...box,
    rx: ACTIVITY_RADIUS,
    ry: ACTIVITY_RADIUS,
    fill: p.activityFill,
    stroke: p.outline,
    'stroke-width': n.node.keyword === 'call' ? STROKE.call : STROKE.activity,
  });
  const icon = n.drawn.icon;
  if (icon) {
    drawIcon(
      w,
      icon,
      box.x + SIZES.activityIconInset + SIZES.icon / 2,
      box.y + SIZES.activityIconInset + SIZES.icon / 2,
      SIZES.icon,
      p.line,
      { cls: 'bpmn-activity-icon' },
    );
  }
  if (n.label) {
    const top = box.y + (icon ? SIZES.icon + SIZES.activityIconInset : SIZES.activityInset);
    const bottom = box.y + box.height - SIZES.activityInset;
    label(w, n.label, n.x, (top + bottom) / 2, { class: 'label', fill: p.text });
  }
}

function drawData(w: SvgWriter, n: PlacedNode, p: Paints) {
  const left = n.x - SIZES.dataWidth / 2;
  const top = n.y - SIZES.dataHeight / 2;
  const right = n.x + SIZES.dataWidth / 2;
  const bottom = n.y + SIZES.dataHeight / 2;
  const line = { fill: 'none', stroke: p.line, 'stroke-width': STROKE.data } as const;
  w.leaf('path', {
    class: 'bpmn-data-page',
    d: w
      .path()
      .moveTo(left, top)
      .lineTo(right - DATA_FOLD, top)
      .lineTo(right, top + DATA_FOLD)
      .lineTo(right, bottom)
      .lineTo(left, bottom)
      .close()
      .done(),
    fill: p.eventFill,
    stroke: p.line,
    'stroke-width': STROKE.data,
  });
  w.leaf('path', {
    class: 'bpmn-data-fold',
    d: w
      .path()
      .moveTo(right - DATA_FOLD, top)
      .lineTo(right - DATA_FOLD, top + DATA_FOLD)
      .lineTo(right, top + DATA_FOLD)
      .done(),
    ...line,
  });
  const direction = n.node.qualifier;
  if (direction === 'input' || direction === 'output') {
    // v12: `M left+4,top+9 h7 v-3 l5,4.5 -5,4.5 v-3 h-7 Z`
    const x = left + 4;
    const y = top + 9;
    w.leaf('path', {
      class: `bpmn-data-arrow bpmn-data-arrow-${direction}`,
      d: w
        .path()
        .moveTo(x, y)
        .lineTo(x + 7, y)
        .lineTo(x + 7, y - 3)
        .lineTo(x + 12, y + 1.5)
        .lineTo(x + 7, y + 6)
        .lineTo(x + 7, y + 3)
        .lineTo(x, y + 3)
        .close()
        .done(),
      ...line,
      fill: direction === 'output' ? p.line : 'none',
    });
  }
  if (direction === 'collection') {
    const b = w.path();
    for (const dx of [-4, 0, 4]) b.moveTo(n.x + dx, bottom - 11).lineTo(n.x + dx, bottom - 2);
    w.leaf('path', { class: 'bpmn-data-collection', d: b.done(), ...line });
  }
  caption(w, n, SIZES.dataHeight, p);
}

function drawStore(w: SvgWriter, n: PlacedNode, p: Paints) {
  const half = SIZES.store / 2;
  const left = n.x - half;
  const top = n.y - half;
  w.leaf('path', {
    class: 'bpmn-store-body',
    d: w
      .path()
      .moveTo(left, top + STORE_RY)
      .arcTo(half, STORE_RY, 0, false, true, left + SIZES.store, top + STORE_RY)
      .lineTo(left + SIZES.store, top + SIZES.store - STORE_RY)
      .arcTo(half, STORE_RY, 0, false, true, left, top + SIZES.store - STORE_RY)
      .close()
      .done(),
    fill: p.eventFill,
    stroke: p.line,
    'stroke-width': STROKE.data,
  });
  const rings = w.path();
  for (const offset of STORE_RINGS) {
    rings
      .moveTo(left, top + STORE_RY + offset)
      .arcTo(half, STORE_RY, 0, false, false, left + SIZES.store, top + STORE_RY + offset);
  }
  w.leaf('path', {
    class: 'bpmn-store-rings',
    d: rings.done(),
    fill: 'none',
    stroke: p.line,
    'stroke-width': STROKE.data,
  });
  caption(w, n, SIZES.store, p);
}

function drawAnnotation(w: SvgWriter, n: PlacedNode, p: Paints) {
  const { box } = n;
  const arm = SIZES.annotationArm;
  // The bracket stands on the face the annotation is attached by, and opens towards its text.
  const right = n.face === 'right';
  const x = right ? box.x + box.width : box.x;
  const toward = right ? -arm : arm;
  w.leaf('path', {
    class: 'bpmn-annotation-bracket',
    d: w
      .path()
      .moveTo(x + toward, box.y)
      .lineTo(x, box.y)
      .lineTo(x, box.y + box.height)
      .lineTo(x + toward, box.y + box.height)
      .done(),
    fill: 'none',
    stroke: p.line,
    'stroke-opacity': ANNOTATION_SHARE,
    'stroke-width': STROKE.data,
  });
  if (n.label) label(w, n.label, n.x + toward / 2, n.y, { class: 'label', fill: p.text });
}

function drawNode(w: SvgWriter, n: PlacedNode, p: Paints) {
  const classes = ['node', `bpmn-${n.drawn.shape.replace(/^bpmn-/, '')}`];
  if (n.node.kind === 'event') classes.push(`bpmn-event`, `bpmn-event-${n.node.keyword}`);
  if (n.node.keyword === 'end' || n.node.keyword === 'throw') classes.push('bpmn-throw');
  if (n.node.keyword === 'call') classes.push('bpmn-call');
  w.open('g', { class: classes.join(' '), 'data-id': n.node.id });
  switch (n.drawn.shape) {
    case 'bpmn-start':
    case 'bpmn-intermediate':
    case 'bpmn-boundary':
    case 'bpmn-end':
      drawEvent(w, n, p);
      break;
    case 'bpmn-gateway':
      drawGateway(w, n, p);
      break;
    case 'bpmn-activity':
      drawActivity(w, n, p);
      break;
    case 'bpmn-data':
      drawData(w, n, p);
      break;
    case 'bpmn-data-store':
      drawStore(w, n, p);
      break;
    case 'bpmn-annotation':
      drawAnnotation(w, n, p);
      break;
  }
  w.close();
}

type Pt = { readonly x: number; readonly y: number };

/** The unit vector from `a` towards `b`. */
function unit(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** The route as a path, its ends pulled back by `startTrim` and `endTrim`, corners rounded. */
function routePath(w: SvgWriter, points: readonly Pt[], startTrim: number, endTrim: number) {
  const pts = [...points];
  const first = pts[0];
  const second = pts[1];
  const last = pts.at(-1);
  const beforeLast = pts.at(-2);
  if (!first || !second || !last || !beforeLast) return w.path().done();
  const s = unit(first, second);
  const e = unit(beforeLast, last);
  pts[0] = { x: first.x + s.x * startTrim, y: first.y + s.y * startTrim };
  pts[pts.length - 1] = { x: last.x - e.x * endTrim, y: last.y - e.y * endTrim };
  const b = w.path().moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const at = pts[i];
    const next = pts[i + 1];
    if (!prev || !at || !next) continue;
    const r = Math.min(
      CORNER,
      Math.hypot(at.x - prev.x, at.y - prev.y) / 2,
      Math.hypot(next.x - at.x, next.y - at.y) / 2,
    );
    const into = unit(at, prev);
    const out = unit(at, next);
    b.lineTo(at.x + into.x * r, at.y + into.y * r).quadTo(
      at.x,
      at.y,
      at.x + out.x * r,
      at.y + out.y * r,
    );
  }
  const end = pts[pts.length - 1] ?? last;
  b.lineTo(end.x, end.y);
  return b.done();
}

function drawFlow(w: SvgWriter, f: PlacedFlow, p: Paints) {
  const { kind } = f.flow;
  const message = kind === 'message';
  const head: 'filled' | 'open' | undefined =
    kind === 'sequence' ? 'filled' : message || f.flow.directed ? 'open' : undefined;
  const first = f.points[0];
  const second = f.points[1];
  const last = f.points.at(-1);
  const beforeLast = f.points.at(-2);
  if (!first || !second || !last || !beforeLast) return;
  w.open('g', { class: `edge bpmn-flow bpmn-flow-${kind}` });
  w.outline('edge', 'path', {
    d: routePath(w, f.points, message ? 2 * RING_RADIUS : 0, head === 'filled' ? HEAD.length : 0),
    fill: 'none',
    stroke: p.line,
    'stroke-width': STROKE.edge,
    'stroke-dasharray': message ? DASHED : kind === 'association' ? DOTTED : undefined,
  });
  const e = unit(beforeLast, last);
  // Across the line, for the arrowhead's wings.
  const ax = -e.y * HEAD.half;
  const ay = e.x * HEAD.half;
  const bx = last.x - e.x * HEAD.length;
  const by = last.y - e.y * HEAD.length;
  if (head === 'filled') {
    w.leaf('path', {
      class: 'marker',
      d: w
        .path()
        .moveTo(last.x, last.y)
        .lineTo(bx + ax, by + ay)
        .lineTo(bx - ax, by - ay)
        .close()
        .done(),
      fill: p.line,
      stroke: 'none',
    });
  } else if (head === 'open') {
    w.leaf('path', {
      class: 'marker openArrow',
      d: w
        .path()
        .moveTo(bx + ax, by + ay)
        .lineTo(last.x, last.y)
        .lineTo(bx - ax, by - ay)
        .done(),
      fill: 'none',
      stroke: p.line,
      'stroke-width': STROKE.edge,
    });
  }
  if (message) {
    const s = unit(first, second);
    w.leaf('circle', {
      class: 'marker hollowCircle',
      cx: first.x + s.x * RING_RADIUS,
      cy: first.y + s.y * RING_RADIUS,
      r: RING_RADIUS,
      fill: 'none',
      stroke: p.line,
      'stroke-width': STROKE.edge,
    });
  }
  w.close();
}

function drawFlowLabel(w: SvgWriter, f: PlacedFlow, p: Paints) {
  if (!f.label) return;
  const { x, y, box } = f.label;
  w.open('g', { class: 'edgeLabel' });
  w.leaf('rect', {
    x: x - box.width / 2 - EDGE_LABEL_PAD.x,
    y: y - box.height / 2 - EDGE_LABEL_PAD.y,
    width: box.width + 2 * EDGE_LABEL_PAD.x,
    height: box.height + 2 * EDGE_LABEL_PAD.y,
    fill: p.edgeLabel,
    opacity: 0.5,
  });
  w.label(box, x, y, { fill: p.text });
  w.close();
}

/** Writes the whole `<svg>` document of a laid-out BPMN diagram. */
export function renderBpmn(
  model: BpmnModel,
  layout: BpmnLayout,
  ctx: RenderContext,
  w: SvgWriter,
): void {
  const p = paints(ctx);
  openRoot(w, model, layout, ctx, p);
  if (layout.title) {
    w.label(layout.title.box, layout.title.x, layout.title.y, {
      class: 'bpmnTitleText',
      'font-size': TITLE_FONT_SIZE,
      fill: p.textColor,
    });
  }
  w.open('g', { class: 'clusters' });
  for (const band of layout.bands) drawBand(w, band, p);
  for (const group of layout.groups) drawGroup(w, group, p);
  w.close();
  w.open('g', { class: 'edgePaths' });
  for (const flow of layout.flows) drawFlow(w, flow, p);
  w.close();
  w.open('g', { class: 'edgeLabels' });
  for (const flow of layout.flows) drawFlowLabel(w, flow, p);
  w.close();
  w.open('g', { class: 'nodes' });
  for (const node of layout.nodes) drawNode(w, node, p);
  w.close();
  w.close();
}
