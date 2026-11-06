/**
 * The layout data the engine reads and writes: v12's `rendering-util/types.ts`, cut down to the
 * fields the engine and its specs touch, with mermaid's own types (config, shape ids, d3) left
 * out. The engine mutates this data in place, as it did in v12. Optional fields also take
 * `undefined`, so callers built with `exactOptionalPropertyTypes` can pass what they have.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

/** v12 named its shapes with a closed union; the engine only compares them to strings. */
export type ShapeID = string;

/** The config keys the engine reads; v12 passed the whole merged `MermaidConfig`. */
export interface SwimlaneLayoutConfig {
  look?: string | undefined;
  fontSize?: number | undefined;
  nodeSpacing?: number | undefined;
  rankSpacing?: number | undefined;
  flowchart?: {
    nodeSpacing?: number | undefined;
    rankSpacing?: number | undefined;
    [key: string]: unknown;
  };
  swimlane?: {
    ignoreCrossLaneEdges?: boolean | undefined;
    optimizeRanksByCrossings?: boolean | undefined;
    automaticLaneOrdering?: boolean | undefined;
    lineHops?: boolean | 'arc' | 'gap' | undefined;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GroupTitleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface BaseNode {
  id: string;
  label?: string | undefined;
  description?: string[] | undefined;
  parentId?: string | undefined;
  cssStyles?: string[] | undefined;
  cssClasses?: string | undefined;
  labelStyle?: string | undefined;
  labelType?: string | undefined;
  domId?: string | undefined;
  dir?: string | undefined;
  padding?: number | undefined;
  isGroup?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
  labelBBox?: { width: number | undefined; height: number };
  groupTitleRect?: GroupTitleRect | undefined;
  intersect?: ((point: any) => any) | undefined;
  rx?: number | undefined;
  ry?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  look?: string | undefined;
  icon?: string | undefined;
  img?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  layer?: number | undefined;
  order?: number | undefined;
  colorIndex?: number | undefined;
}

export interface ClusterNode extends BaseNode {
  shape?: ShapeID | undefined;
  isGroup: true;
  isEdgeLabel?: boolean | undefined;
  edgeStart?: string | undefined;
  edgeEnd?: string | undefined;
  isDummy?: boolean | undefined;
}

export interface NonClusterNode extends BaseNode {
  shape?: ShapeID | undefined;
  isGroup: false;
  isEdgeLabel?: boolean | undefined;
  edgeStart?: string | undefined;
  edgeEnd?: string | undefined;
  isDummy?: boolean | undefined;
}

export type Node = ClusterNode | NonClusterNode;

export interface Edge {
  id: string;
  label?: string | undefined;
  classes?: string | undefined;
  style?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
  arrowhead?: string | undefined;
  arrowTypeEnd?: string | undefined;
  arrowTypeStart?: string | undefined;
  end?: string | undefined;
  interpolate?: string | undefined;
  labelType?: string | undefined;
  length?: number | undefined;
  start?: string | undefined;
  stroke?: string | undefined;
  text?: string | undefined;
  type?: string | undefined;
  curve?: string | undefined;
  labelStyle?: string[] | undefined;
  minlen?: number | undefined;
  thickness?: 'normal' | 'thick' | 'invisible' | 'dotted' | undefined;
  look?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  points?: Point[] | undefined;
  parentId?: string | undefined;
  dir?: string | undefined;
  source?: string | undefined;
  target?: string | undefined;
  /** The router threads the edge through the centre of this edge-label node. */
  labelNodeId?: string | undefined;
  /** Feeds layering and ordering only; never routed or drawn. */
  isLayoutOnly?: boolean | undefined;
}

export interface LayoutData {
  nodes: Node[];
  edges: Edge[];
  config: SwimlaneLayoutConfig;
  diagramId?: string | undefined;
  /** `branches` asks the layout to layer each branch of the flow on its own. */
  laneLayering?: 'branches' | undefined;
  [key: string]: any;
}
