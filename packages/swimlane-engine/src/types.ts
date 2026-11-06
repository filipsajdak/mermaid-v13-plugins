/**
 * The layout data the engine reads and writes: v12's `rendering-util/types.ts`, cut down to the
 * fields the engine and its specs touch, with mermaid's own types (config, shape ids, d3) left
 * out. The engine mutates this data in place, as it did in v12.
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
  look?: string;
  fontSize?: number;
  nodeSpacing?: number;
  rankSpacing?: number;
  flowchart?: { nodeSpacing?: number; rankSpacing?: number; [key: string]: unknown };
  swimlane?: {
    ignoreCrossLaneEdges?: boolean;
    optimizeRanksByCrossings?: boolean;
    automaticLaneOrdering?: boolean;
    lineHops?: boolean | 'arc' | 'gap';
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
  label?: string;
  description?: string[];
  parentId?: string;
  cssStyles?: string[];
  cssClasses?: string;
  labelStyle?: string;
  labelType?: string;
  domId?: string;
  dir?: string;
  padding?: number;
  isGroup?: boolean;
  width?: number;
  height?: number;
  labelBBox?: { width: number; height: number };
  groupTitleRect?: GroupTitleRect;
  intersect?: (point: any) => any;
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  look?: string;
  icon?: string;
  img?: string;
  metadata?: Record<string, unknown>;
  layer?: number;
  order?: number;
  colorIndex?: number;
}

export interface ClusterNode extends BaseNode {
  shape?: ShapeID;
  isGroup: true;
  isEdgeLabel?: boolean;
  edgeStart?: string;
  edgeEnd?: string;
  isDummy?: boolean;
}

export interface NonClusterNode extends BaseNode {
  shape?: ShapeID;
  isGroup: false;
  isEdgeLabel?: boolean;
  edgeStart?: string;
  edgeEnd?: string;
  isDummy?: boolean;
}

export type Node = ClusterNode | NonClusterNode;

export interface Edge {
  id: string;
  label?: string;
  classes?: string;
  style?: string[];
  metadata?: Record<string, unknown>;
  arrowhead?: string;
  arrowTypeEnd?: string;
  arrowTypeStart?: string;
  end?: string;
  interpolate?: string;
  labelType?: string;
  length?: number;
  start?: string;
  stroke?: string;
  text?: string;
  type?: string;
  curve?: string;
  labelStyle?: string[];
  minlen?: number;
  thickness?: 'normal' | 'thick' | 'invisible' | 'dotted';
  look?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  points?: Point[];
  parentId?: string;
  dir?: string;
  source?: string;
  target?: string;
  /** The router threads the edge through the centre of this edge-label node. */
  labelNodeId?: string;
  /** Feeds layering and ordering only; never routed or drawn. */
  isLayoutOnly?: boolean;
}

export interface LayoutData {
  nodes: Node[];
  edges: Edge[];
  config: SwimlaneLayoutConfig;
  diagramId?: string;
  /** `branches` asks the layout to layer each branch of the flow on its own. */
  laneLayering?: 'branches';
  [key: string]: any;
}
