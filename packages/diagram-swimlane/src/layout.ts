import type { RenderContext } from '@mermaid-js/core';
import type {
  LayoutGraph,
  LayoutModel,
  LayoutModelEdge,
  LayoutModelGroup,
  RoutePoint,
  Side,
} from '@mermaid-js/core/layout';
import { layoutLabel } from '@mermaid-js/core/text';
import { layoutFlowchart } from '@mermaid-js/diagram-flowchart';
import type { FlowLayout, FlowModel } from '@mermaid-js/diagram-flowchart';
import {
  buildLaneModel,
  computePhaseBands,
  DEFAULT_SWIMLANE_ID,
  layoutSwimlanes,
  PHASE_TITLE_MARGIN,
} from '@mermaid-v13-plugins/swimlane-engine';
import type {
  Edge,
  LayoutData,
  Node,
  PhaseBand,
  SwimlaneDirection,
  SwimlanePhase as EnginePhase,
} from '@mermaid-v13-plugins/swimlane-engine';
import { flowchartContext } from './context.ts';
import type { SwimlaneModel } from './model.ts';

/** A box by its edges. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A lane (a top-level subgraph), drawn by this plugin rather than as a flowchart cluster. */
export interface LaneBox {
  readonly id: string;
  /** The whole lane, title band included. */
  readonly box: Rect;
  /** The title band: across the top in TB and BT, down the left in LR and RL. */
  readonly title: Rect;
  /** The title reads upward, in the band down the left. */
  readonly titleReadsUpward: boolean;
}

/**
 * The flowchart's layout with the lanes taken out of its groups (so the flowchart renderer
 * draws only the subgraphs nested in lanes), plus the lanes and the phase bands.
 */
export interface SwimlaneLayout extends FlowLayout {
  readonly lanes: readonly LaneBox[];
  readonly bands: readonly PhaseBand[];
  /** What the engine logged at `warn`. */
  readonly engineWarnings: readonly string[];
}

/** v12's subgraph padding, which flowDb wrote on every subgraph whatever the config said. */
const SUBGRAPH_PADDING = 8;

/** v12 shape names for the v13 canonical ones the engine tells apart (diamonds, hexagons). */
const V12_SHAPES: Readonly<Record<string, string>> = {
  diam: 'question',
  hex: 'hexagon',
  rect: 'squareRect',
  rounded: 'roundedRect',
};

/** Below this two coordinates are one; the engine routes at right angles to the pixel. */
const SAME = 0.5;

/**
 * v12 drew every swimlane edge with rounded corners unless it asked for a curve other than
 * the default `basis`: the routes are orthogonal, and a smooth curve through their bends
 * would cut corners through nodes.
 */
function roundedEdges(flow: FlowModel, configCurve: string | undefined): FlowModel {
  const rounded = (curve: string | undefined) =>
    curve === undefined || curve === 'basis' ? 'rounded' : curve;
  return {
    ...flow,
    defaultInterpolate: rounded(flow.defaultInterpolate ?? configCurve),
    edges: flow.edges.map((e) =>
      e.interpolate === undefined ? e : { ...e, interpolate: rounded(e.interpolate) },
    ),
  };
}

/** Adds the lane v12 synthesised for nodes outside every lane, last, so its palette slot follows. */
function withDefaultLane(flow: FlowModel): FlowModel {
  const inLane = new Set(flow.subgraphs.flatMap((sg) => sg.nodes));
  const loose = flow.vertices.filter((v) => !inLane.has(v.id)).map((v) => v.id);
  if (loose.length === 0 || flow.subgraphs.some((sg) => sg.id === DEFAULT_SWIMLANE_ID)) {
    return flow;
  }
  return {
    ...flow,
    // Last, so its palette slot follows every declared lane's, as v12's colorIndex did.
    subgraphs: [
      ...flow.subgraphs,
      {
        id: DEFAULT_SWIMLANE_ID,
        ast: DEFAULT_SWIMLANE_ID,
        title: '',
        labelType: 'text',
        nodes: loose,
        classes: [],
      },
    ],
  };
}

/** Each phase with the room its title needs along the flow: its width and a margin each end. */
function measuredPhases(model: SwimlaneModel, ctx: RenderContext): EnginePhase[] {
  const font = {
    family: ctx.theme.value('fontFamily'),
    size: ctx.theme.number('fontSize'),
    weight: 400,
  };
  return model.phases.map((phase) => ({
    ...phase,
    titleExtent:
      layoutLabel(phase.label, font, Infinity, ctx.measurer, {
        markdown: phase.labelType === 'markdown',
      }).width +
      2 * PHASE_TITLE_MARGIN,
  }));
}

/** The v12 layout data the engine reads, from the flowchart's measured graph. */
function layoutData(
  graph: LayoutGraph,
  flow: FlowModel,
  model: SwimlaneModel,
  phases: EnginePhase[],
  ctx: RenderContext,
): LayoutData {
  const config = ctx.config;
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const parentOf = new Map<string, string | undefined>([
    ...graph.groups.map((g): [string, string | undefined] => [g.id, g.parent]),
    ...graph.nodes.map((n): [string, string | undefined] => [n.id, n.parent]),
  ]);
  // v12 handed the subgraphs over last first, then the vertices, then the lane it made for
  // nodes outside every lane; the engine's lane order follows that order.
  const groups: Node[] = [...flow.subgraphs]
    .filter((sg) => sg.id !== DEFAULT_SWIMLANE_ID)
    .reverse()
    .concat(flow.subgraphs.filter((sg) => sg.id === DEFAULT_SWIMLANE_ID))
    .filter((sg) => groupIds.has(sg.id))
    .map((sg) => ({
      id: sg.id,
      label: sg.title,
      isGroup: true as const,
      parentId: parentOf.get(sg.id),
      padding: SUBGRAPH_PADDING,
      shape: 'rect',
      dir: sg.dir,
      metadata: sg.metadata,
    }));
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    isGroup: false as const,
    parentId: n.parent,
    shape: V12_SHAPES[n.shape ?? 'rect'] ?? n.shape,
    width: n.width,
    height: n.height,
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    start: e.source,
    end: e.target,
    type: 'normal',
    minlen: e.minLen,
    // The engine only asks whether there is a label; the size comes from the graph below.
    label: e.label ? e.id : undefined,
  }));
  const chosen = config.swimlane?.ignoreCrossLaneEdges;
  return {
    nodes: [
      ...groups.filter((g) => g.id !== DEFAULT_SWIMLANE_ID),
      ...nodes,
      ...groups.filter((g) => g.id === DEFAULT_SWIMLANE_ID),
    ],
    edges,
    config: {
      flowchart: {
        nodeSpacing: config.flowchart?.nodeSpacing,
        rankSpacing: config.flowchart?.rankSpacing,
      },
      swimlane: {
        optimizeRanksByCrossings: config.swimlane?.optimizeRanksByCrossings,
        automaticLaneOrdering: config.swimlane?.automaticLaneOrdering,
      },
    },
    direction: graph.direction,
    // Not a config default, so a value here is the author's (v12 read getUserDefinedConfig()).
    ...(typeof chosen === 'boolean' ? { ignoreCrossLaneEdgesChosen: chosen } : {}),
    other: {
      ...(model.phases.length > 0
        ? { phases, nodePhases: Object.fromEntries(model.nodePhases) }
        : {}),
      ...(model.sharedNodes.length > 0 ? { droppedSubGraphMembers: model.sharedNodes } : {}),
    },
  };
}

/** The side of `box` a route leaves or enters through, from its segment at that end. */
function sideOf(from: RoutePoint, to: RoutePoint, leaving: boolean): Side {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const vertical = Math.abs(dx) < Math.abs(dy);
  if (leaving) {
    if (vertical) return dy > 0 ? 'bottom' : 'top';
    return dx > 0 ? 'right' : 'left';
  }
  if (vertical) return dy > 0 ? 'top' : 'bottom';
  return dx > 0 ? 'left' : 'right';
}

/**
 * The route with each point's axis. Repeated points are dropped: the engine can end a route
 * on the point before it, which v12's renderer ignored and v13's turns into a marker that
 * points nowhere.
 */
function routeOf(raw: readonly { x: number; y: number }[]): RoutePoint[] {
  const points = raw.filter((p, i) => {
    const prev = raw[i - 1];
    return prev === undefined || Math.abs(prev.x - p.x) >= SAME || Math.abs(prev.y - p.y) >= SAME;
  });
  return points.map((p, i) => {
    const q = i === 0 ? points[1] : points[i - 1];
    const vertical = q !== undefined && Math.abs(q.x - p.x) < SAME;
    return { x: p.x, y: p.y, axis: vertical ? 'v' : 'h' };
  });
}

const isFinite = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** A node's box, when the engine placed it. */
function boxOf({ x, y, width, height }: Node): Rect | undefined {
  return isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height)
    ? { x: x - width / 2, y: y - height / 2, width, height }
    : undefined;
}

const centre = (r: Rect) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
  width: r.width,
  height: r.height,
});

/** A drawn route: at least two points, with the side it leaves and enters through. */
function routeEdge(
  points: readonly { x: number; y: number }[],
  label: { x: number; y: number } | undefined,
): LayoutModelEdge | undefined {
  const route = routeOf(points);
  const [first, second] = route;
  const last = route.at(-1);
  const beforeLast = route.at(-2);
  if (!first || !second || !last || !beforeLast) return undefined;
  return {
    points: route,
    ports: { source: sideOf(first, second, true), target: sideOf(beforeLast, last, false) },
    ...(label ? { label } : {}),
  };
}

interface Placed {
  readonly model: LayoutModel;
  readonly lanes: LaneBox[];
  readonly bands: PhaseBand[];
}

/** Where everything lies, so the drawing can start at the padding. */
function extent(data: LayoutData, bands: readonly PhaseBand[]) {
  const boxes: Rect[] = [];
  for (const n of data.nodes) {
    const b = boxOf(n);
    if (b) boxes.push(b);
  }
  for (const band of bands) boxes.push(band.title);
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

/** The engine's result as v13's layout model, moved so the drawing starts at the padding. */
function placed(graph: LayoutGraph, data: LayoutData, direction: SwimlaneDirection): Placed {
  const laneModel = buildLaneModel(data.nodes);
  const bands = computePhaseBands(data);
  const pad = graph.diagramPadding ?? 0;
  const all = extent(data, bands);
  const dx = pad - all.left;
  const dy = pad - all.top;
  const move = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

  const sideways = direction === 'LR' || direction === 'RL';
  const lanes: LaneBox[] = [];
  const groups = new Map<string, LayoutModelGroup>();
  const titlePad = new Map(graph.groups.map((g) => [g.id, g.padding.top]));
  const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const n of data.nodes) {
    const b = boxOf(n);
    if (!b) continue;
    const at = move(b);
    if (n.isGroup && laneModel.isLane(n.id)) {
      const t = n.groupTitleRect;
      const title: Rect = t
        ? move({ x: t.left, y: t.top, width: t.right - t.left, height: t.bottom - t.top })
        : { ...at, height: 0 };
      lanes.push({ id: n.id, box: at, title, titleReadsUpward: sideways });
    } else if (n.isGroup) {
      const c = centre(at);
      groups.set(n.id, { ...c, title: { x: c.x, y: at.y + (titlePad.get(n.id) ?? 0) / 2 } });
    } else if (!n.isEdgeLabel) {
      nodes.set(n.id, centre(at));
    }
  }
  const edges = new Map<string, LayoutModelEdge>();
  for (const e of data.edges) {
    if (e.isLayoutOnly) continue;
    const labelNode = e.labelNodeId === undefined ? undefined : byId.get(e.labelNodeId);
    const label =
      labelNode && isFinite(labelNode.x) && isFinite(labelNode.y)
        ? { x: labelNode.x + dx, y: labelNode.y + dy }
        : undefined;
    const route = routeEdge(
      (e.points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })),
      label,
    );
    if (route) edges.set(e.id, route);
  }
  const movedBands = bands.map(({ separator, ...band }) => ({
    ...band,
    title: move(band.title),
    ...(separator
      ? {
          separator: {
            x1: separator.x1 + dx,
            y1: separator.y1 + dy,
            x2: separator.x2 + dx,
            y2: separator.y2 + dy,
          },
        }
      : {}),
  }));
  return {
    model: {
      width: all.right - all.left + 2 * pad,
      height: all.bottom - all.top + 2 * pad,
      nodes,
      edges,
      groups,
      direction: graph.direction,
    },
    lanes,
    bands: movedBands,
  };
}

/**
 * Measures and lays out a swimlane diagram. The flowchart plugin measures every node and edge
 * label and builds its layout graph as for any flowchart; the swimlane engine then places
 * them, in place of the `layout` engine the config names. v13's layout graph has groups but no
 * lanes, pools or phases: the engine decides which groups are lanes (the top-level ones, as in
 * v12) and the phases come from the model.
 */
export function layoutSwimlane(model: SwimlaneModel, ctx: RenderContext): SwimlaneLayout {
  const flow = withDefaultLane(roundedEdges(model.flow, ctx.config.flowchart?.curve));
  const phases = measuredPhases(model, ctx);
  let result: Placed | undefined;
  let engineWarnings: readonly string[] = [];
  const flowCtx = flowchartContext(ctx);
  const layout = (graph: LayoutGraph): LayoutModel => {
    const data = layoutData(graph, flow, model, phases, flowCtx);
    const labels = new Map(graph.edges.map((e) => [e.id, e.label]));
    const { direction, warnings } = layoutSwimlanes(data, { labelSize: (id) => labels.get(id) });
    engineWarnings = warnings;
    // v12 logged these at `warn`, hidden at the default log level; v13 returns warnings.
    for (const message of warnings) ctx.warn({ code: 'SWIMLANE_LAYOUT', message });
    result = placed(graph, data, direction);
    return result.model;
  };
  const laid = layoutFlowchart(flow, flowchartContext(ctx, layout));
  return {
    ...laid,
    lanes: result?.lanes ?? [],
    bands: result?.bands ?? [],
    engineWarnings,
  };
}
