/**
 * The layout of a C4 scene: elements with a shape and a label block, groups (boundaries,
 * deployment nodes) with a title block, and edges with an optional label block. Both C4
 * plugins build one from their model and hand it to `ctx.layout`, the engine the `layout`
 * config names.
 */
import type { RenderContext } from '@mermaid-js/core';
import type {
  Dir,
  EdgeRouting,
  LayoutGraph,
  LayoutModelEdge,
  Point,
} from '@mermaid-js/core/layout';
import type { C4Block } from './blocks.ts';
import { sizeShape } from './shapes.ts';
import type { C4Shape, C4ShapeBox } from './shapes.ts';

export interface SceneElement {
  readonly id: string;
  readonly parent?: string;
  readonly shape: C4Shape;
  readonly block: C4Block;
}

export interface SceneGroup {
  readonly id: string;
  readonly parent?: string;
  readonly direction?: Dir;
  readonly title: C4Block;
}

export interface SceneEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly block?: C4Block;
}

export interface Scene {
  readonly direction: Dir;
  readonly elements: readonly SceneElement[];
  readonly groups: readonly SceneGroup[];
  readonly edges: readonly SceneEdge[];
  /** The diagram title, centred above everything. */
  readonly title?: C4Block;
  /** Room inside a shape around its label. */
  readonly pad: number;
  /** The narrowest element. */
  readonly minWidth: number;
  /** Between nodes, and between ranks unless `rankSpacing` says otherwise. */
  readonly spacing: number;
  readonly rankSpacing?: number;
  /** Around the whole drawing. */
  readonly margin: number;
  /** Above and below the title. */
  readonly titleGap: number;
  readonly routing?: EdgeRouting;
}

export interface PlacedElement extends C4ShapeBox {
  readonly id: string;
  /** Centre of the label block. */
  readonly labelY: number;
  readonly block: C4Block;
}

export interface PlacedGroup {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Centre of the title band. */
  readonly title: Point;
  readonly block: C4Block;
  /** Nesting depth, 0 at the top level: outer groups are drawn first. */
  readonly depth: number;
}

export interface PlacedEdge {
  readonly id: string;
  readonly route: LayoutModelEdge;
  readonly block?: C4Block;
}

/** Where everything of a scene goes, in px. */
export interface SceneLayout {
  readonly width: number;
  readonly height: number;
  readonly title?: { readonly block: C4Block; readonly x: number; readonly y: number };
  readonly elements: readonly PlacedElement[];
  readonly groups: readonly PlacedGroup[];
  readonly edges: readonly PlacedEdge[];
}

/** Room between a group's border and its contents. */
export const GROUP_PAD = 16;
/** Room around a group's title, inside its top padding. */
export const TITLE_PAD = 6;
/** Room around an edge label: the background it sits on. */
export const EDGE_LABEL_PAD = 4;

/** Lays a scene out with `ctx.layout`, then puts the title band on top and the margin round. */
export function layoutScene(scene: Scene, ctx: RenderContext): SceneLayout {
  const sized = new Map(
    scene.elements.map((e) => [e.id, sizeShape(e.shape, e.block, scene.pad, scene.minWidth)]),
  );
  const graph: LayoutGraph = {
    direction: scene.direction,
    nodes: scene.elements.map((e) => {
      const s = sized.get(e.id);
      return {
        id: e.id,
        width: s?.width ?? scene.minWidth,
        height: s?.height ?? scene.minWidth,
        ...(e.parent !== undefined ? { parent: e.parent } : {}),
      };
    }),
    groups: scene.groups.map((g) => ({
      id: g.id,
      ...(g.parent !== undefined ? { parent: g.parent } : {}),
      ...(g.direction !== undefined ? { direction: g.direction } : {}),
      padding: { top: GROUP_PAD, right: GROUP_PAD, bottom: GROUP_PAD, left: GROUP_PAD },
      title: { width: g.title.width + 2 * TITLE_PAD, height: g.title.height + 2 * TITLE_PAD },
    })),
    edges: scene.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      minLen: 1,
      ...(e.block
        ? {
            label: {
              width: e.block.width + 2 * EDGE_LABEL_PAD,
              height: e.block.height + 2 * EDGE_LABEL_PAD,
            },
          }
        : {}),
    })),
    spacing: { node: scene.spacing, rank: scene.rankSpacing ?? scene.spacing, edge: 10 },
    routing: scene.routing ?? 'stepped',
    headRoom: ctx.theme.number('arrowheadLength') + ctx.theme.number('arrowheadGap'),
  };
  const laid = ctx.layout(graph);

  const titleBand = scene.title ? scene.title.height + 2 * scene.titleGap : 0;
  const inner = Math.max(laid.width, scene.title?.width ?? 0);
  const dx = scene.margin + (inner - laid.width) / 2;
  const dy = scene.margin + titleBand;
  const width = inner + 2 * scene.margin;
  const height = laid.height + titleBand + 2 * scene.margin;

  const parentOf = new Map(scene.groups.map((g) => [g.id, g.parent]));
  const depthOf = (id: string): number => {
    let d = 0;
    for (let p = parentOf.get(id); p !== undefined && d <= parentOf.size; p = parentOf.get(p)) d++;
    return d;
  };

  const elements = scene.elements.flatMap((e) => {
    const n = laid.nodes.get(e.id);
    const s = sized.get(e.id);
    if (!n || !s) return [];
    const y = n.y + dy;
    return [
      {
        id: e.id,
        shape: e.shape,
        x: n.x + dx,
        y,
        width: n.width,
        height: n.height,
        labelY: y + s.labelY,
        block: e.block,
      },
    ];
  });
  const groups = scene.groups.flatMap((g) => {
    const m = laid.groups.get(g.id);
    if (!m) return [];
    return [
      {
        id: g.id,
        x: m.x + dx,
        y: m.y + dy,
        width: m.width,
        height: m.height,
        title: { x: m.title.x + dx, y: m.title.y + dy },
        block: g.title,
        depth: depthOf(g.id),
      },
    ];
  });
  const edges = scene.edges.flatMap((e) => {
    const m = laid.edges.get(e.id);
    if (!m) return [];
    const route: LayoutModelEdge = {
      ...m,
      points: m.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      ...(m.label ? { label: { x: m.label.x + dx, y: m.label.y + dy } } : {}),
    };
    return [{ id: e.id, route, ...(e.block ? { block: e.block } : {}) }];
  });

  return {
    width,
    height,
    ...(scene.title
      ? { title: { block: scene.title, x: width / 2, y: scene.margin + titleBand / 2 } }
      : {}),
    elements,
    groups,
    edges,
  };
}
