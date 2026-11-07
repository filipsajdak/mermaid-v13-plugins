/**
 * The layout data the swimlane engine reads for a BPMN diagram: v12's `BpmnDb.getData()` (the
 * bpmn-beta series, #8166), with each node's size given by the caller instead of the DOM.
 */
import type { Edge, LayoutData, Node } from '@mermaid-v13-plugins/swimlane-engine';
import type { BpmnFlow, BpmnModel, BpmnNode } from './model.ts';

export type BpmnShape =
  | 'bpmn-start'
  | 'bpmn-intermediate'
  | 'bpmn-boundary'
  | 'bpmn-end'
  | 'bpmn-gateway'
  | 'bpmn-activity'
  | 'bpmn-data'
  | 'bpmn-data-store'
  | 'bpmn-annotation';

/** How a node is drawn: its shape and the glyph inside it (an icon of `icons.ts`). */
export interface Drawn {
  readonly shape: BpmnShape;
  readonly icon?: string;
}

const EVENT_SHAPES: Readonly<Record<string, BpmnShape>> = {
  start: 'bpmn-start',
  intermediate: 'bpmn-intermediate',
  boundary: 'bpmn-boundary',
  end: 'bpmn-end',
  throw: 'bpmn-intermediate',
};

const GATEWAY_GLYPHS: Readonly<Record<string, string>> = {
  xor: 'exclusive',
  and: 'parallel-gateway',
  or: 'inclusive',
  'event-gateway': 'event-based',
  complex: 'complex',
};

/** How edges meet each drawn shape; the engine reads these keys without knowing BPMN. */
const POINTED = { endpointProfile: 'vertex' };
const FLAT_SIDED = { endpointProfile: 'flat' };

const ENDPOINT_PROFILES: Readonly<Record<BpmnShape, Record<string, unknown>>> = {
  'bpmn-start': POINTED,
  'bpmn-intermediate': POINTED,
  'bpmn-boundary': POINTED,
  'bpmn-end': POINTED,
  'bpmn-gateway': { ...POINTED, oneLinePerVertex: true, captionBelow: true },
  'bpmn-activity': FLAT_SIDED,
  'bpmn-data': FLAT_SIDED,
  'bpmn-data-store': FLAT_SIDED,
  'bpmn-annotation': FLAT_SIDED,
};

const ARTIFACT_KINDS = new Set<BpmnNode['kind']>(['data', 'store', 'annotation']);

/** Room kept between an artifact and the element it is associated with (px, v12). */
const ARTIFACT_CLEARANCE = 18;

/** v12's padding of a group, which holds its title above its members (px). */
const GROUP_PADDING = 56;
/** v12's padding of a pool or a lane (px). */
const BAND_PADDING = 20;

/** v12's `bpmn` config section and its defaults (px). */
export const BPMN_CONFIG_DEFAULTS = {
  nodeSpacing: 35,
  rankSpacing: 40,
  diagramPadding: 12,
} as const;

export function drawnAs(node: BpmnNode): Drawn {
  const qualifier = node.qualifier && node.qualifier !== 'none' ? node.qualifier : undefined;
  switch (node.kind) {
    case 'event':
      return {
        shape: EVENT_SHAPES[node.keyword] ?? 'bpmn-start',
        ...(qualifier ? { icon: qualifier } : {}),
      };
    case 'gateway':
      return { shape: 'bpmn-gateway', icon: GATEWAY_GLYPHS[node.keyword] ?? 'exclusive' };
    case 'activity':
      if (node.keyword === 'subprocess') return { shape: 'bpmn-activity', icon: 'subprocess' };
      return { shape: 'bpmn-activity', ...(qualifier ? { icon: qualifier } : {}) };
    case 'data':
      return { shape: 'bpmn-data' };
    case 'store':
      return { shape: 'bpmn-data-store' };
    case 'annotation':
      return { shape: 'bpmn-annotation' };
    default:
      return { shape: 'bpmn-activity' };
  }
}

/** Each artifact's host: the non-artifact it is first associated with. */
function artifactHosts(model: BpmnModel): Map<string, string> {
  const artifacts = new Set(
    model.nodes.filter((node) => ARTIFACT_KINDS.has(node.kind)).map((node) => node.id),
  );
  const hosts = new Map<string, string>();
  for (const flow of model.flows) {
    if (flow.kind !== 'association') continue;
    for (const [self, other] of [
      [flow.from, flow.to],
      [flow.to, flow.from],
    ] as const) {
      if (artifacts.has(self) && !artifacts.has(other) && !hosts.has(self)) hosts.set(self, other);
    }
  }
  return hosts;
}

/** A node's box for the layout, and the part of it the shape draws (the rest is its caption). */
export interface NodeSize {
  readonly width: number;
  readonly height: number;
  readonly drawn?: { readonly width: number; readonly height: number };
}

export interface LayoutDataOptions {
  readonly nodeSpacing?: number;
  readonly rankSpacing?: number;
}

const EDGE_PATTERNS: Readonly<Record<BpmnFlow['kind'], string>> = {
  sequence: 'solid',
  message: 'dashed',
  association: 'dotted',
};

/** The engine's edge id of the flow at `index`. */
export const edgeId = (index: number): string => `bpmn-edge-${String(index)}`;

/** v12's `BpmnDb.getData()`, sizes from `sizeOf`. */
export function bpmnLayoutData(
  model: BpmnModel,
  sizeOf: (node: BpmnNode) => NodeSize | undefined,
  options: LayoutDataOptions = {},
): LayoutData {
  const nodes: Node[] = [];
  let laneIndex = 0;
  const hosts = artifactHosts(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const parsed of model.nodes) {
    const host = hosts.get(parsed.id);
    const besideHost =
      parsed.kind === 'annotation' && host !== undefined && byId.get(host)?.kind === 'gateway';
    const isBand = parsed.kind === 'pool' || parsed.kind === 'lane';
    const isGroup = isBand || parsed.kind === 'group';
    const { shape, icon } = drawnAs(parsed);
    const size = isGroup ? undefined : sizeOf(parsed);
    const metadata: Record<string, unknown> = {
      ...(isBand ? { laneRole: parsed.kind, laneIndex: laneIndex++ } : {}),
      ...(parsed.keyword === 'boundary' && parsed.parentId
        ? { anchorTo: { hostId: parsed.parentId } }
        : {}),
      ...(host
        ? {
            anchorTo: {
              hostId: host,
              gap: ARTIFACT_CLEARANCE,
              ...(besideHost ? { side: 'left' } : {}),
            },
          }
        : {}),
      ...(parsed.qualifier === 'input' || parsed.qualifier === 'output'
        ? { dataDirection: parsed.qualifier }
        : {}),
      ...(parsed.qualifier === 'collection' ? { isCollection: true } : {}),
      ...(parsed.kind === 'annotation' ? { attachFace: besideHost ? 'right' : 'left' } : {}),
      ...(isGroup ? {} : ENDPOINT_PROFILES[shape]),
      ...(size?.drawn ? { drawnExtent: { ...size.drawn } } : {}),
    };
    const shared = {
      id: parsed.id,
      label: parsed.label,
      labelType: 'string',
      parentId: parsed.parentId,
      metadata,
      cssClasses: [
        ...(isGroup ? [`bpmn-${parsed.kind}`] : []),
        ...(parsed.keyword === 'end' || parsed.keyword === 'throw' ? ['bpmn-throw'] : []),
        ...(parsed.keyword === 'call' ? ['bpmn-call'] : []),
      ].join(' '),
      cssStyles: [],
      padding: parsed.kind === 'group' ? GROUP_PADDING : BAND_PADDING,
    };
    if (isGroup) {
      nodes.push({ ...shared, isGroup: true, shape: isBand ? 'rect' : 'roundedWithTitle' });
    } else {
      nodes.push({
        ...shared,
        isGroup: false,
        shape,
        ...(icon ? { icon } : {}),
        ...(size ? { width: size.width, height: size.height } : {}),
      });
    }
  }
  const edges: Edge[] = model.flows.map((flow, index) => ({
    id: edgeId(index),
    start: flow.from,
    end: flow.to,
    type: 'normal',
    label: flow.label ?? '',
    labelType: 'string',
    thickness: 'normal',
    pattern: EDGE_PATTERNS[flow.kind],
    arrowTypeEnd:
      flow.kind === 'sequence'
        ? 'arrow_point'
        : flow.kind === 'message' || flow.directed
          ? 'arrow_open_head'
          : 'none',
    arrowTypeStart: flow.kind === 'message' ? 'arrow_hollow_circle' : 'none',
    style: [],
    labelStyle: [],
    classes: `bpmn-flow bpmn-flow-${flow.kind}`,
  }));
  return {
    nodes,
    edges,
    config: {},
    // v12 handed the engine `TD` as written; the engine takes anything but LR, RL and BT as TB.
    direction: model.direction === 'TD' ? 'TB' : model.direction,
    layoutAlgorithm: 'swimlane',
    laneLayering: 'branches',
    nodeSpacing: options.nodeSpacing ?? BPMN_CONFIG_DEFAULTS.nodeSpacing,
    rankSpacing: options.rankSpacing ?? BPMN_CONFIG_DEFAULTS.rankSpacing,
    type: 'bpmn',
  };
}
