/**
 * Lays out a C4 diagram: measures every label, sizes each shape the way the converged v12
 * shapes size themselves (`person.ts`, `cylinder.ts`, `tiltedCylinder.ts`, `drawRect.ts`),
 * turns boundaries into groups, and hands the graph to `ctx.layout`.
 */
import type { RenderContext } from '@mermaid-js/core';
import type { LayoutGraph, LayoutModelEdge, LayoutNode, Point } from '@mermaid-js/core/layout';
import { layoutLabel, Style } from '@mermaid-js/core/text';
import type { FontKey, MeasuredLabel } from '@mermaid-js/core/text';
import { C4Config } from '../config.ts';
import type { C4Boundary, C4Element, C4ElementTag, C4Model, C4Rel } from '../parser/model.ts';

/** The shapes C4 elements are drawn as. */
export type C4Shape = 'rounded' | 'person' | 'cylinder' | 'queue' | 'component';

/** One line group of a stacked label: the name, the stereotype, a description. */
export interface C4Section {
  readonly kind: 'name' | 'type' | 'descr' | 'techn';
  readonly label: MeasuredLabel;
  readonly font: FontKey;
  readonly italic?: boolean;
  /** Top of the section, from the top of its block. */
  readonly top: number;
}

/** Sections stacked and centred on one axis. */
export interface C4Block {
  readonly sections: readonly C4Section[];
  readonly width: number;
  readonly height: number;
}

export interface C4PlacedElement {
  readonly alias: string;
  readonly shape: C4Shape;
  /** Centre and size of the shape's box. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Centre of the label block. */
  readonly labelY: number;
  readonly block: C4Block;
}

export interface C4PlacedBoundary {
  readonly alias: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: Point;
  readonly label: MeasuredLabel;
  readonly font: FontKey;
  /** Nesting depth, 0 at the top level: outer boundaries are drawn first. */
  readonly depth: number;
}

export interface C4PlacedRel {
  /** Index into `model.rels`. */
  readonly index: number;
  readonly route: LayoutModelEdge;
  readonly block?: C4Block;
}

/** Where everything of a C4 diagram goes, in px. */
export interface C4Layout {
  readonly width: number;
  readonly height: number;
  readonly title?: {
    readonly label: MeasuredLabel;
    readonly font: FontKey;
    readonly x: number;
    readonly y: number;
  };
  readonly elements: readonly C4PlacedElement[];
  readonly boundaries: readonly C4PlacedBoundary[];
  readonly rels: readonly C4PlacedRel[];
}

/** v12 `c4LabelHelper`: the room between stacked sections. */
const SECTION_GAP = 3;
/** v12 `c4LabelHelper`: the narrowest wrap width. */
const MIN_WRAP = 32;
/** Room between a boundary's border and its contents. */
const GROUP_PAD = 16;
/** Room around a boundary's title, inside its top padding. */
const TITLE_PAD = 6;
/** Room around a relationship label: the background it sits on. */
export const REL_LABEL_PAD = 4;
/** Relationship labels wrap at this width when wrapping is on (v12 flowchart `wrappingWidth`). */
const REL_WRAP = 200;
/** Font size ratios of the converged stylesheet (`styles.js`). */
const RATIO = {
  type: 0.75,
  descr: 0.82,
  boundary: 0.9,
  rel: 0.85,
  small: 0.83,
  title: 1.15,
} as const;

const SHAPE_KEYWORDS: Readonly<Partial<Record<string, C4Shape>>> = {
  person: 'person',
  box: 'rounded',
  rounded: 'rounded',
  cylinder: 'cylinder',
  database: 'cylinder',
  db: 'cylinder',
  queue: 'queue',
  pipe: 'queue',
  component: 'component',
};

const keywordShape = (v: string | undefined): C4Shape | undefined =>
  v === undefined ? undefined : SHAPE_KEYWORDS[v.toLowerCase()];

/** The tags a `$tags` list names, in order, that the diagram defined. */
export function tagsOf<T extends { tagName: string }>(
  tags: string | undefined,
  defined: readonly T[],
): T[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => defined.find((d) => d.tagName === t.trim()))
    .filter((t): t is T => t !== undefined);
}

/** The matched element tags merged, later ones winning (v12 `mergeTagStyle`). */
export function tagStyleOf(el: C4Element, tags: readonly C4ElementTag[]): Partial<C4ElementTag> {
  const out: Partial<C4ElementTag> = {};
  for (const t of tagsOf(el.tags, tags)) {
    if (t.bgColor !== undefined) out.bgColor = t.bgColor;
    if (t.fontColor !== undefined) out.fontColor = t.fontColor;
    if (t.borderColor !== undefined) out.borderColor = t.borderColor;
    if (t.shape !== undefined) out.shape = t.shape;
  }
  return out;
}

/** v12 `resolveNodeShape`: `$shape`/`$sprite`, then a tag's shape or a tag keyword, then the type. */
export function shapeOf(el: C4Element, tags: readonly C4ElementTag[]): C4Shape {
  const explicit = keywordShape(el.style.shape) ?? keywordShape(el.sprite);
  if (explicit) return explicit;
  if (el.tags) {
    const defined = keywordShape(tagStyleOf(el, tags).shape);
    if (defined) return defined;
    for (const t of el.tags.split(',')) {
      const k = keywordShape(t.trim());
      if (k) return k;
    }
  }
  if (el.type === 'person' || el.type === 'external_person') return 'person';
  if (el.type.endsWith('_db')) return 'cylinder';
  if (el.type.endsWith('_queue')) return 'queue';
  return 'rounded';
}

const STEREOTYPES: Readonly<Partial<Record<string, string>>> = {
  person: 'Person',
  system: 'Software System',
  container: 'Container',
  component: 'Component',
};

/** v12 `stereotypeText`: `[Software System]`, `[Container: Node.js]`. */
export function stereotypeOf(el: C4Element): string {
  const base = el.type.replace(/^external_/, '').replace(/_(db|queue)$/, '');
  const name = STEREOTYPES[base] ?? base.replace(/_/g, ' ');
  return el.techn ? `[${name}: ${el.techn}]` : `[${name}]`;
}

/** v12 `showsStereotype`: the element's own `$showStereotype`, else `c4.showStereotypes`. */
export const showsStereotype = (el: C4Element, cfg: C4Config): boolean =>
  el.style.showStereotype === undefined
    ? cfg.bool('showStereotypes', true)
    : el.style.showStereotype !== 'false';

const IMPLICIT_BOUNDARY_TYPES = new Set(['system', 'container', 'node']);

/** v12 `boundaryLabel`: the label, then the type when it is not the keyword's own. */
export function boundaryTitle(b: C4Boundary): string {
  const type = b.type;
  if (!type || IMPLICIT_BOUNDARY_TYPES.has(type.toLowerCase())) return b.label;
  return `${b.label} [${type.toLowerCase() === 'enterprise' ? 'Enterprise' : type}]`;
}

/** A relationship's first line: in a C4Dynamic diagram numbered in declaration order. */
export const relText = (rel: C4Rel, index: number, dynamic: boolean): string =>
  dynamic ? `${index + 1}: ${rel.label}` : rel.label;

const weightOf = (w: string | undefined): number =>
  w === 'bold' ? 700 : w !== undefined && /^\d+$/.test(w) ? Number(w) : 400;

/** Stacks measured sections, each centred on the block's axis. */
function stack(parts: readonly Omit<C4Section, 'top'>[], gap: number): C4Block {
  let top = 0;
  const sections: C4Section[] = [];
  for (const p of parts) {
    sections.push({ ...p, top });
    top += p.label.height + gap;
  }
  return {
    sections,
    width: Math.max(0, ...parts.map((p) => p.label.width)),
    height: sections.length > 0 ? top - gap : 0,
  };
}

interface Sized {
  readonly width: number;
  readonly height: number;
  /** Centre of the label block, from the shape's centre. */
  readonly labelY: number;
}

/** A shape's box around a label block, as the converged v12 shapes size it. */
function sizeShape(shape: C4Shape, block: C4Block, pad: number, minWidth: number): Sized {
  const lw = block.width;
  const lh = block.height;
  switch (shape) {
    case 'person': {
      const w = Math.max(lw + 2 * pad, minWidth, 100);
      const headR = Math.min(Math.max(w * 0.23, 16), 80);
      const overlap = headR * 0.27;
      const bodyH = Math.max(overlap + lh + 2 * pad, w * 0.6);
      const total = bodyH + 2 * headR - overlap;
      const bodyTop = -total / 2 + 2 * headR - overlap;
      return { width: w, height: total, labelY: bodyTop + overlap + (bodyH - overlap) / 2 };
    }
    case 'cylinder': {
      const w = Math.max(minWidth - pad, lw) + pad;
      const ry = w / 2 / (2.5 + w / 50);
      const h = lh + pad + ry;
      return { width: w, height: h + 2 * ry, labelY: ry / 2 };
    }
    case 'queue': {
      const h = lh + pad;
      const rx = h / 2 / (2.5 + h / 50);
      const w = Math.max(minWidth - pad / 2, lw + pad) + 2 * rx;
      return { width: w, height: h, labelY: 0 };
    }
    default:
      return { width: Math.max(lw + 2 * pad, minWidth), height: lh + 2 * pad, labelY: 0 };
  }
}

/** The label wrap width each shape gives (v12 shapes shrink `node.width` before measuring). */
function wrapWidth(shape: C4Shape, pad: number, minWidth: number): number {
  const width =
    shape === 'cylinder' ? minWidth - pad : shape === 'queue' ? minWidth - pad / 2 : minWidth;
  return Math.max(width - 2 * pad, MIN_WRAP);
}

/** Lays out a C4 diagram with `ctx.layout`, the engine the `layout` config names. */
export function layoutC4(model: C4Model, ctx: RenderContext): C4Layout {
  const cfg = new C4Config(ctx.config);
  const { measurer, theme } = ctx;
  const rootSize = theme.number('fontSize');
  const pad = cfg.number('c4ShapePadding', 20);
  const minWidth = cfg.number('width', 216);
  const gap = cfg.number('c4ShapeMargin', 50);
  const margin = cfg.number('diagramMarginX', 50);
  const measure = (text: string, font: FontKey, max: number, style = 0): MeasuredLabel =>
    layoutLabel(text, font, max, measurer, { style });
  const fontOf = (prefix: string, ratio: number): FontKey => ({
    family: cfg.string(`${prefix}FontFamily`) ?? theme.value('fontFamily'),
    size: cfg.number(`${prefix}FontSize`, rootSize) * ratio,
    weight: weightOf(cfg.string(`${prefix}FontWeight`)),
  });

  // Elements: measured, then sized by their shape.
  const nodes: LayoutNode[] = [];
  const sizes = new Map<string, { shape: C4Shape; sized: Sized; block: C4Block }>();
  for (const el of model.elements) {
    const shape = shapeOf(el, model.elementTags);
    const max = cfg.wrap ? wrapWidth(shape, pad, minWidth) : Number.POSITIVE_INFINITY;
    const base = fontOf(el.type, 1);
    const parts: Omit<C4Section, 'top'>[] = [];
    if (el.label)
      parts.push({ kind: 'name', label: measure(el.label, base, max, Style.Bold), font: base });
    if (showsStereotype(el, cfg)) {
      const f = { ...base, size: base.size * RATIO.type };
      parts.push({ kind: 'type', label: measure(stereotypeOf(el), f, max), font: f });
    }
    if (el.descr) {
      const f = { ...base, size: base.size * RATIO.descr };
      parts.push({ kind: 'descr', label: measure(el.descr, f, max), font: f });
    }
    const block = stack(parts, SECTION_GAP);
    const sized = sizeShape(shape, block, pad, minWidth);
    sizes.set(el.alias, { shape, sized, block });
    nodes.push({
      id: el.alias,
      width: sized.width,
      height: sized.height,
      ...(el.parent !== undefined ? { parent: el.parent } : {}),
    });
  }

  // Boundaries: groups with their title in the top padding.
  const titleFont = fontOf('boundary', RATIO.boundary);
  const boundaryLabels = new Map<string, MeasuredLabel>();
  const groups = model.boundaries.map((b) => {
    const label = measure(boundaryTitle(b), titleFont, Number.POSITIVE_INFINITY);
    boundaryLabels.set(b.alias, label);
    const direction = b.direction ?? cfg.boundaryDirection;
    return {
      id: b.alias,
      ...(b.parent !== undefined ? { parent: b.parent } : {}),
      ...(direction !== undefined ? { direction } : {}),
      padding: { top: GROUP_PAD, right: GROUP_PAD, bottom: GROUP_PAD, left: GROUP_PAD },
      title: { width: label.width + 2 * TITLE_PAD, height: label.height + 2 * TITLE_PAD },
    };
  });

  // Relationships, between things that exist.
  const known = new Set([
    ...model.elements.map((e) => e.alias),
    ...model.boundaries.map((b) => b.alias),
  ]);
  const dynamic = model.kind === 'C4Dynamic';
  const relFont: FontKey = {
    family: theme.value('fontFamily'),
    size: rootSize * RATIO.rel,
    weight: 400,
  };
  const smallFont: FontKey = { ...relFont, size: relFont.size * RATIO.small };
  const relMax = cfg.wrap ? REL_WRAP : Number.POSITIVE_INFINITY;
  const relBlocks = new Map<number, C4Block>();
  const edges = model.rels.flatMap((rel, index) => {
    const missing = [rel.from, rel.to].filter((a) => !known.has(a));
    if (missing.length > 0) {
      ctx.warn({
        code: 'C4_UNKNOWN_ENDPOINT',
        message: `Rel(${rel.from}, ${rel.to}) is not drawn: ${missing.map((m) => `"${m}"`).join(' and ')} is not declared.`,
      });
      return [];
    }
    const parts: Omit<C4Section, 'top'>[] = [];
    const name = relText(rel, index, dynamic);
    if (name)
      parts.push({
        kind: 'name',
        label: measure(name, relFont, relMax, Style.Bold),
        font: relFont,
      });
    if (rel.techn) {
      parts.push({
        kind: 'techn',
        label: measure(`[${rel.techn}]`, smallFont, relMax, Style.Italic),
        font: smallFont,
        italic: true,
      });
    }
    if (rel.descr)
      parts.push({ kind: 'descr', label: measure(rel.descr, smallFont, relMax), font: smallFont });
    const block = stack(parts, 0);
    if (parts.length > 0) relBlocks.set(index, block);
    const label =
      parts.length > 0
        ? {
            label: {
              width: block.width + 2 * REL_LABEL_PAD,
              height: block.height + 2 * REL_LABEL_PAD,
            },
          }
        : {};
    return [{ id: `r${index}`, source: rel.from, target: rel.to, minLen: 1, ...label }];
  });

  const graph: LayoutGraph = {
    direction: model.direction,
    nodes,
    edges,
    groups,
    spacing: { node: gap, rank: gap, edge: 10 },
    routing: 'stepped',
    headRoom: theme.number('arrowheadLength') + theme.number('arrowheadGap'),
  };
  const laid = ctx.layout(graph);

  // The title band on top, then the margin all round.
  const tFont: FontKey = {
    family: theme.value('fontFamily'),
    size: rootSize * RATIO.title,
    weight: 400,
  };
  const tLabel = model.title ? measure(model.title, tFont, Number.POSITIVE_INFINITY) : undefined;
  const titleBand = tLabel ? tLabel.height + cfg.number('diagramMarginY', 10) * 2 : 0;
  const inner = Math.max(laid.width, tLabel?.width ?? 0);
  const dx = margin + (inner - laid.width) / 2;
  const dy = margin + titleBand;
  const width = inner + 2 * margin;
  const height = laid.height + titleBand + 2 * margin;

  const parentOf = new Map(model.boundaries.map((b) => [b.alias, b.parent]));
  const depthOf = (alias: string): number => {
    let d = 0;
    for (let p = parentOf.get(alias); p !== undefined && d <= parentOf.size; p = parentOf.get(p))
      d++;
    return d;
  };

  const elements = model.elements.flatMap((el) => {
    const n = laid.nodes.get(el.alias);
    const s = sizes.get(el.alias);
    if (!n || !s) return [];
    const x = n.x + dx;
    const y = n.y + dy;
    return [
      {
        alias: el.alias,
        shape: s.shape,
        x,
        y,
        width: n.width,
        height: n.height,
        labelY: y + s.sized.labelY,
        block: s.block,
      },
    ];
  });
  const boundaries = model.boundaries.flatMap((b) => {
    const g = laid.groups.get(b.alias);
    const label = boundaryLabels.get(b.alias);
    if (!g || !label) return [];
    return [
      {
        alias: b.alias,
        x: g.x + dx,
        y: g.y + dy,
        width: g.width,
        height: g.height,
        title: { x: g.title.x + dx, y: g.title.y + dy },
        label,
        font: titleFont,
        depth: depthOf(b.alias),
      },
    ];
  });
  const rels = model.rels.flatMap((_rel, index) => {
    const e = laid.edges.get(`r${index}`);
    if (!e) return [];
    const route: LayoutModelEdge = {
      ...e,
      points: e.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      ...(e.label ? { label: { x: e.label.x + dx, y: e.label.y + dy } } : {}),
    };
    const block = relBlocks.get(index);
    return [{ index, route, ...(block ? { block } : {}) }];
  });

  return {
    width,
    height,
    ...(tLabel
      ? { title: { label: tLabel, font: tFont, x: width / 2, y: margin + titleBand / 2 } }
      : {}),
    elements,
    boundaries,
    rels,
  };
}
