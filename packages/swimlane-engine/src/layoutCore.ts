import type { LayoutData } from './types.js';
import { postProcessSwimlaneLayout, validateSwimlanesLayout } from './postProcessing.js';
import { toGraphView, writeBackToLayoutData } from './helpers.js';
import { phaseShortfalls } from './phaseBands.js';
import type { PhaseGrowth } from './phases.js';
import { warnUnusedPhases } from './phases.js';
import { sugiyamaLayout } from './pipeline.js';
import { routeEdgesOrthogonal } from './orthogonalRouter/router.js';
import { pinAnchoredNodes } from './anchoredNodes.js';

export type SwimlaneDirection = 'TB' | 'LR' | 'BT' | 'RL';

function numberAt(source: object | undefined, key: string): number | undefined {
  const value = source === undefined ? undefined : Reflect.get(source, key);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function spacing(layout: LayoutData, key: 'nodeSpacing' | 'rankSpacing', fallback: number) {
  return (
    numberAt(layout.config, key) ??
    numberAt(layout, key) ??
    numberAt(layout.config.flowchart, key) ??
    fallback
  );
}

/**
 * Whether lanes share one row: the author's own choice (`ignoreCrossLaneEdgesChosen`) when the
 * layout carries one, else false for a layout that asks for branch-wise layering, else the
 * layout's `swimlane.ignoreCrossLaneEdges`, true when it says nothing.
 */
function compactsLanesToOneRow(data4Layout: LayoutData): boolean {
  const chosen = data4Layout.ignoreCrossLaneEdgesChosen;
  if (typeof chosen === 'boolean') {
    return chosen;
  }
  if (data4Layout.laneLayering === 'branches') {
    return false;
  }
  return data4Layout.config.swimlane?.ignoreCrossLaneEdges ?? true;
}

function getSwimlaneDirection(data4Layout: LayoutData): SwimlaneDirection {
  return ((data4Layout as LayoutData & { direction?: string }).direction ??
    'TB') as SwimlaneDirection;
}

/**
 * Pure swimlane layout core shared by browser rendering and DDLT.
 *
 * The browser measures DOM nodes before this runs; DDLT injects captured sizes
 * before calling the same function.
 */
/**
 * Places the nodes. A band can only be measured once the nodes are placed, so a title too
 * long for its band sends the layout round again with the room it lacks.
 */
function spacingOf(data4Layout: LayoutData) {
  return {
    nodeGap: spacing(data4Layout, 'nodeSpacing', 40),
    layerGap: spacing(data4Layout, 'rankSpacing', 100),
  };
}

function layeringOf(data4Layout: LayoutData) {
  return {
    ignoreCrossLaneEdges: compactsLanesToOneRow(data4Layout),
    optimizeRanksByCrossings: data4Layout.config.swimlane?.optimizeRanksByCrossings ?? true,
    automaticLaneOrdering: data4Layout.config.swimlane?.automaticLaneOrdering ?? false,
  };
}

function placeNodes(data4Layout: LayoutData, direction: SwimlaneDirection): void {
  const spacing = spacingOf(data4Layout);
  const layering = layeringOf(data4Layout);

  const place = (phaseGrowth?: PhaseGrowth) => {
    const graph = toGraphView(data4Layout);
    const { ordered, coordinates } = sugiyamaLayout(graph, {
      ...spacing,
      ...layering,
      direction,
      phaseGrowth,
      spreadByOwnExtent: data4Layout.laneLayering === 'branches',
      gapIsRoomBetween: data4Layout.laneLayering === 'branches',
    });
    writeBackToLayoutData(graph, ordered, coordinates, spacing);
  };
  warnUnusedPhases(data4Layout);
  place();
  const shortfalls = phaseShortfalls(data4Layout);
  if (Object.keys(shortfalls).length > 0) {
    place(shortfalls);
  }
}

export function runSwimlaneLayoutCore(data4Layout: LayoutData): SwimlaneDirection {
  const direction = getSwimlaneDirection(data4Layout);
  placeNodes(data4Layout, direction);

  pinAnchoredNodes(data4Layout, { space: 'canonical', direction });

  // The layout phases above position nodes only; they do not emit edge routing.
  // Reset any edge points carried on the input so routeEdgesOrthogonal below is
  // the single source of truth for swimlane edge geometry.
  for (const edge of data4Layout.edges ?? []) {
    delete edge.points;
  }
  routeEdgesOrthogonal(data4Layout, direction);

  for (const edge of data4Layout.edges ?? []) {
    if (!edge.curve || edge.curve === 'basis') {
      edge.curve = 'rounded';
    }
  }

  postProcessSwimlaneLayout(data4Layout, direction);

  validateSwimlanesLayout(data4Layout);

  return direction;
}
