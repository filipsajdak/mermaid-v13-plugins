/**
 * Measures a BPMN diagram and lays it out with the swimlane engine (`layoutKind: 'custom'`).
 * The node sizes are v12's shape sizes (`rendering-elements/shapes/bpmn*.ts` of the bpmn-beta
 * series, #8166), with the labels measured by core's text layout instead of the DOM.
 */
import type { RenderContext } from '@mermaid-js/core';
import { layoutLabel } from '@mermaid-js/core/text';
import type { MeasuredLabel } from '@mermaid-js/core/text';
import { buildLaneModel, layoutSwimlanes } from '@mermaid-v13-plugins/swimlane-engine';
import type { LayoutData, Node, SwimlaneDirection } from '@mermaid-v13-plugins/swimlane-engine';
import { dock } from './dock.ts';
import type { DockShape } from './dock.ts';
import { BPMN_CONFIG_DEFAULTS, bpmnLayoutData, drawnAs, edgeId } from './layout-data.ts';
import type { Drawn, NodeSize } from './layout-data.ts';
import type { BpmnFlow, BpmnModel, BpmnNode } from './model.ts';

/** v12's shape sizes (px, `bpmnShapeCore.ts`). */
export const SIZES = {
  event: 36,
  gateway: 50,
  activityWidth: 100,
  activityHeight: 80,
  dataWidth: 36,
  dataHeight: 50,
  store: 50,
  /** Between a shape and the caption under it. */
  labelGap: 6,
  icon: 16,
  /** The width an annotation's text wraps at (`bpmnAnnotation.ts`). */
  annotationWrap: 160,
  annotationPadding: 8,
  annotationMinHeight: 28,
  /** The bracket's arm. */
  annotationArm: 6,
  /** Room an activity keeps around its label, and below its corner icon. */
  activityPadding: 8,
  activityInset: 10,
  activityIconInset: 6,
} as const;

/** The width labels wrap at: v12's HTML label `max-width`. */
const LABEL_WRAP = 200;

/** Room kept around an edge label, as v12's `labelRect` drew it (px). */
const EDGE_LABEL_PAD = { x: 4, y: 2 } as const;

/** v12's `.bpmnTitleText` font size (px). */
export const TITLE_FONT_SIZE = 18;

/** Space under the diagram title (px), v12's `titleTopMargin` less the title line. */
const TITLE_GAP = 10;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedNode {
  readonly node: BpmnNode;
  readonly drawn: Drawn;
  /** Centre of the drawn shape. */
  readonly x: number;
  readonly y: number;
  /** The reserved box, caption included. */
  readonly box: Rect;
  readonly label?: MeasuredLabel;
  /** For an annotation: the face it is attached by, where its bracket stands. */
  readonly face?: 'left' | 'right';
}

/** A pool or a lane: the whole band, and its title band (left in LR and RL, on top otherwise). */
export interface PlacedBand {
  readonly node: BpmnNode;
  readonly box: Rect;
  readonly title: Rect;
  readonly titleReadsUpward: boolean;
  readonly label?: MeasuredLabel;
}

export interface PlacedGroup {
  readonly node: BpmnNode;
  readonly box: Rect;
  readonly label?: MeasuredLabel;
}

export interface PlacedFlow {
  readonly flow: BpmnFlow;
  readonly points: readonly { x: number; y: number }[];
  readonly label?: { readonly x: number; readonly y: number; readonly box: MeasuredLabel };
}

export interface BpmnLayout {
  readonly width: number;
  readonly height: number;
  readonly direction: SwimlaneDirection;
  readonly bands: readonly PlacedBand[];
  readonly groups: readonly PlacedGroup[];
  readonly nodes: readonly PlacedNode[];
  readonly flows: readonly PlacedFlow[];
  readonly title?: { readonly x: number; readonly y: number; readonly box: MeasuredLabel };
}

/** A node's size: v12's sizes, a caption under events, gateways and data. */
function sizeOf(node: BpmnNode, label: MeasuredLabel | undefined, drawn: Drawn): NodeSize {
  const lw = label?.width ?? 0;
  const lh = label?.height ?? 0;
  const hasLabel = lh > 0 && node.label !== '';
  const captioned = (w: number, h: number): NodeSize => {
    const band = hasLabel ? SIZES.labelGap + lh : 0;
    return {
      width: Math.max(w, hasLabel ? lw : 0),
      height: h + 2 * band,
      drawn: { width: w, height: h },
    };
  };
  switch (drawn.shape) {
    case 'bpmn-start':
    case 'bpmn-intermediate':
    case 'bpmn-boundary':
    case 'bpmn-end':
      return captioned(SIZES.event, SIZES.event);
    case 'bpmn-gateway':
      return captioned(SIZES.gateway, SIZES.gateway);
    case 'bpmn-data':
      return captioned(SIZES.dataWidth, SIZES.dataHeight);
    case 'bpmn-data-store':
      return captioned(SIZES.store, SIZES.store);
    case 'bpmn-annotation':
      return {
        width: lw + 2 * SIZES.annotationPadding + SIZES.annotationArm,
        height: Math.max(SIZES.annotationMinHeight, lh + 2 * SIZES.annotationPadding),
      };
    case 'bpmn-activity': {
      const top = drawn.icon ? SIZES.icon + SIZES.activityIconInset : SIZES.activityInset;
      return {
        width: Math.max(SIZES.activityWidth, lw + 2 * SIZES.activityPadding),
        height: Math.max(SIZES.activityHeight, lh + top + SIZES.activityInset),
      };
    }
  }
}

const isFinite = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function boxOf({ x, y, width, height }: Node): Rect | undefined {
  return isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)
    ? { x: x - width / 2, y: y - height / 2, width, height }
    : undefined;
}

/** The part of a node the shape draws: its reserved box without the caption bands. */
function drawnSize(n: PlacedNode): { width: number; height: number } {
  switch (n.drawn.shape) {
    case 'bpmn-start':
    case 'bpmn-intermediate':
    case 'bpmn-boundary':
    case 'bpmn-end':
      return { width: SIZES.event, height: SIZES.event };
    case 'bpmn-gateway':
      return { width: SIZES.gateway, height: SIZES.gateway };
    case 'bpmn-data':
      return { width: SIZES.dataWidth, height: SIZES.dataHeight };
    case 'bpmn-data-store':
      return { width: SIZES.store, height: SIZES.store };
    default:
      return { width: n.box.width, height: n.box.height };
  }
}

/** Drops repeated points: the engine can end a route on the point before it. */
const dedupe = (points: readonly { x: number; y: number }[]) =>
  points.filter((p, i) => {
    const prev = points[i - 1];
    return prev === undefined || Math.abs(prev.x - p.x) >= 0.5 || Math.abs(prev.y - p.y) >= 0.5;
  });

/** The `bpmn` config section: v12's `nodeSpacing`, `rankSpacing` and `diagramPadding`. */
function bpmnConfig(ctx: RenderContext): Record<string, unknown> {
  const section: unknown = Reflect.get(ctx.config, 'bpmn');
  return typeof section === 'object' && section !== null ? { ...section } : {};
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

export function layoutBpmn(model: BpmnModel, ctx: RenderContext): BpmnLayout {
  const font = {
    family: ctx.theme.value('fontFamily'),
    size: ctx.theme.number('fontSize'),
    weight: 400,
  };
  const measure = (text: string, wrap: number): MeasuredLabel | undefined =>
    text === '' ? undefined : layoutLabel(text, font, wrap, ctx.measurer, { markdown: false });
  const labels = new Map<string, MeasuredLabel | undefined>();
  const drawnOf = new Map<string, Drawn>();
  for (const node of model.nodes) {
    const drawn = drawnAs(node);
    drawnOf.set(node.id, drawn);
    labels.set(
      node.id,
      measure(node.label, node.kind === 'annotation' ? SIZES.annotationWrap : LABEL_WRAP),
    );
  }
  const flowLabels = model.flows.map((flow) => measure(flow.label ?? '', LABEL_WRAP));
  const config = bpmnConfig(ctx);
  const data = bpmnLayoutData(
    model,
    (node) => {
      const drawn = drawnOf.get(node.id);
      return drawn ? sizeOf(node, labels.get(node.id), drawn) : undefined;
    },
    {
      nodeSpacing: numberOr(config.nodeSpacing, BPMN_CONFIG_DEFAULTS.nodeSpacing),
      rankSpacing: numberOr(config.rankSpacing, BPMN_CONFIG_DEFAULTS.rankSpacing),
    },
  );
  const labelSizes = new Map(
    flowLabels.map((label, index) => [
      edgeId(index),
      label
        ? { width: label.width + 2 * EDGE_LABEL_PAD.x, height: label.height + 2 * EDGE_LABEL_PAD.y }
        : undefined,
    ]),
  );
  const { direction, warnings } = layoutSwimlanes(data, { labelSize: (id) => labelSizes.get(id) });
  // v12 logged these at a level hidden by default. A group is never a lane, so the engine's
  // note that a nested subgraph is drawn as a plain box says nothing about a BPMN diagram.
  const groups = new Set(model.nodes.filter((n) => n.kind === 'group').map((n) => n.id));
  for (const message of warnings) {
    const nested = /^Swimlane subgraph "(.*)" is nested in /.exec(message)?.[1];
    if (nested === undefined || !groups.has(nested)) ctx.warn({ code: 'BPMN_LAYOUT', message });
  }
  const title = model.title
    ? layoutLabel(model.title, { ...font, size: TITLE_FONT_SIZE }, Infinity, ctx.measurer)
    : undefined;
  return placed(model, data, direction, {
    labels,
    drawnOf,
    flowLabels,
    title,
    padding: numberOr(config.diagramPadding, BPMN_CONFIG_DEFAULTS.diagramPadding),
  });
}

interface Measures {
  readonly labels: ReadonlyMap<string, MeasuredLabel | undefined>;
  readonly drawnOf: ReadonlyMap<string, Drawn>;
  readonly flowLabels: readonly (MeasuredLabel | undefined)[];
  readonly title: MeasuredLabel | undefined;
  readonly padding: number;
}

function extent(data: LayoutData): { left: number; top: number; right: number; bottom: number } {
  const boxes: Rect[] = [];
  for (const n of data.nodes) {
    const b = boxOf(n);
    if (b) boxes.push(b);
  }
  for (const e of data.edges) {
    if (!e.isLayoutOnly) for (const p of e.points ?? []) boxes.push({ ...p, width: 0, height: 0 });
  }
  if (boxes.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.min(...boxes.map((b) => b.x)),
    top: Math.min(...boxes.map((b) => b.y)),
    right: Math.max(...boxes.map((b) => b.x + b.width)),
    bottom: Math.max(...boxes.map((b) => b.y + b.height)),
  };
}

/** The engine's result, moved so the drawing starts at the padding, under the title. */
function placed(
  model: BpmnModel,
  data: LayoutData,
  direction: SwimlaneDirection,
  m: Measures,
): BpmnLayout {
  const all = extent(data);
  const titleRoom = m.title ? m.title.height + TITLE_GAP : 0;
  const contentWidth = all.right - all.left;
  const width = Math.max(contentWidth, m.title?.width ?? 0) + 2 * m.padding;
  const dx = m.padding - all.left + (width - 2 * m.padding - contentWidth) / 2;
  const dy = m.padding + titleRoom - all.top;
  const move = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const laneModel = buildLaneModel(data.nodes);
  const sideways = direction === 'LR' || direction === 'RL';
  const bands: PlacedBand[] = [];
  const groups: PlacedGroup[] = [];
  const nodes: PlacedNode[] = [];
  const dataById = new Map(data.nodes.map((n) => [n.id, n]));
  for (const n of data.nodes) {
    const node = byId.get(n.id);
    const b = boxOf(n);
    if (!node || !b) continue;
    const box = move(b);
    const label = m.labels.get(n.id);
    if (laneModel.isLane(n.id) || laneModel.isPool(n.id)) {
      const t = n.groupTitleRect;
      const title: Rect = t
        ? move({ x: t.left, y: t.top, width: t.right - t.left, height: t.bottom - t.top })
        : { ...box, height: 0 };
      bands.push({ node, box, title, titleReadsUpward: sideways, ...(label ? { label } : {}) });
    } else if (n.isGroup) {
      groups.push({ node, box, ...(label ? { label } : {}) });
    } else {
      const drawn = m.drawnOf.get(n.id);
      if (!drawn) continue;
      // The drawn shape sits in the middle of the reserved box; the caption takes the bands.
      nodes.push({
        node,
        drawn,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        box,
        ...(label ? { label } : {}),
        ...(n.metadata?.attachFace === 'right' ? { face: 'right' as const } : {}),
      });
    }
  }
  const shapes = new Map<string, DockShape>(
    nodes.map((n) => {
      const size = drawnSize(n);
      return [
        n.node.id,
        { x: n.x, y: n.y, ...size, drawn: n.drawn, ...(n.face ? { face: n.face } : {}) },
      ];
    }),
  );
  const flows: PlacedFlow[] = [];
  for (const [index, flow] of model.flows.entries()) {
    const e = data.edges.find((edge) => edge.id === edgeId(index));
    const routed = dedupe((e?.points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })));
    const tail = shapes.get(flow.from);
    const head = shapes.get(flow.to);
    const points =
      tail && head ? dedupe(dock(routed, tail, head, e?.arrowTypeEnd ?? 'none')) : routed;
    if (points.length < 2) continue;
    const labelNode = e?.labelNodeId === undefined ? undefined : dataById.get(e.labelNodeId);
    const box = m.flowLabels[index];
    flows.push({
      flow,
      points,
      ...(box && labelNode && isFinite(labelNode.x) && isFinite(labelNode.y)
        ? { label: { x: labelNode.x + dx, y: labelNode.y + dy, box } }
        : {}),
    });
  }
  // Outer bands first, so a lane is drawn over the pool that holds it.
  const depth = (n: BpmnNode): number => (n.parentId ? 1 + depth(byId.get(n.parentId) ?? n) : 0);
  bands.sort((a, b) => depth(a.node) - depth(b.node));
  groups.sort((a, b) => depth(a.node) - depth(b.node));
  return {
    width,
    height: all.bottom - all.top + titleRoom + 2 * m.padding,
    direction,
    bands,
    groups,
    nodes,
    flows,
    ...(m.title
      ? { title: { x: width / 2, y: m.padding + m.title.height / 2, box: m.title } }
      : {}),
  };
}
