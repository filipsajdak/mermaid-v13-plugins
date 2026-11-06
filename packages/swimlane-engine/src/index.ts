/**
 * The swimlane layout engine, as mermaid v12 ran it between measuring and painting: lanes and
 * pools from top-level groups, phase bands, Sugiyama layering inside lanes, and orthogonal
 * routing. Pure: no DOM, no mermaid, no third-party code.
 */
import { collectWarnings } from './logger.js';
import { createEdgeLabelNodes } from './edgeLabelNodes.js';
import { prepareLayoutForSwimlanes } from './helpers.js';
import { runSwimlaneLayoutCore, type SwimlaneDirection } from './layoutCore.js';
import type { LayoutData } from './types.js';

export type * from './types.js';
export type { SwimlaneDirection } from './layoutCore.js';
export type { SwimlanePhase } from './phases.js';
export type { PhaseBand } from './phaseBands.js';
export { computePhaseBands, PHASE_TITLE_MARGIN, PHASE_TITLE_THICKNESS } from './phaseBands.js';
export { DEFAULT_SWIMLANE_ID } from './helpers.js';
export { buildLaneModel, type LaneModel } from './lanes.js';
export { collectWarnings } from './logger.js';

export interface SwimlaneLayoutOptions {
  /**
   * The measured size of an edge's label, by edge id. v12 measured the `edge-label-*` nodes in
   * the DOM before the layout ran; without this they are laid out as points.
   */
  readonly labelSize?: (edgeId: string) => { width: number; height: number } | undefined;
}

export interface SwimlaneLayoutResult {
  readonly direction: SwimlaneDirection;
  /** What v12 logged at `warn` while laying the diagram out, in order. */
  readonly warnings: readonly string[];
}

function sizeEdgeLabels(data: LayoutData, { labelSize }: SwimlaneLayoutOptions): void {
  if (!labelSize) {
    return;
  }
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    const node = edge.labelNodeId === undefined ? undefined : byId.get(edge.labelNodeId);
    const size = labelSize(edge.id);
    if (node && size) {
      node.width = size.width;
      node.height = size.height;
    }
  }
}

/**
 * Lays out `data` in place: every node gets `x`/`y` (its centre), every lane its box and
 * `groupTitleRect`, every edge its `points`. Edge labels become `edge-label-*` nodes, as in v12.
 *
 * The sizes must already be on the nodes. `data.ignoreCrossLaneEdgesChosen` carries the
 * author's own `swimlane.ignoreCrossLaneEdges`, which the merged config cannot tell from the
 * default; v12 read it from `getUserDefinedConfig()`.
 */
export function layoutSwimlanes(
  data: LayoutData,
  options: SwimlaneLayoutOptions = {}
): SwimlaneLayoutResult {
  const { result, warnings } = collectWarnings(() => {
    prepareLayoutForSwimlanes(data);
    const labelled = createEdgeLabelNodes(data);
    data.nodes = labelled.nodes;
    data.edges = labelled.edges;
    sizeEdgeLabels(data, options);
    return runSwimlaneLayoutCore(data);
  });
  return { direction: result, warnings };
}
