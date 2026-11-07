/**
 * Lays out a legacy C4 diagram: turns the model into a C4 scene (each element's shape and
 * stacked label, each boundary's title, each relationship's label) and lays it out with the
 * shared scene layout.
 */
import type { RenderContext } from '@mermaid-js/core';
import { layoutScene, measureBlock, wrapWidth } from '@mermaid-v13-plugins/c4-shared';
import type { C4Shape, SceneEdge, SceneLayout } from '@mermaid-v13-plugins/c4-shared';
import type { FontKey } from '@mermaid-js/core/text';
import { C4Config } from '../config.ts';
import type { C4Boundary, C4Element, C4ElementTag, C4Model, C4Rel } from '../parser/model.ts';

/** Where everything of a C4 diagram goes, in px. Edge ids are `r<index into model.rels>`. */
export type C4Layout = SceneLayout;

/** v12 `c4LabelHelper`: the room between stacked sections. */
const SECTION_GAP = 3;
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

/** Lays out a C4 diagram with `ctx.layout`, the engine the `layout` config names. */
export function layoutC4(model: C4Model, ctx: RenderContext): C4Layout {
  const cfg = new C4Config(ctx.config);
  const { measurer, theme } = ctx;
  const rootSize = theme.number('fontSize');
  const pad = cfg.number('c4ShapePadding', 20);
  const minWidth = cfg.number('width', 216);
  const fontOf = (prefix: string, ratio: number): FontKey => ({
    family: cfg.string(`${prefix}FontFamily`) ?? theme.value('fontFamily'),
    size: cfg.number(`${prefix}FontSize`, rootSize) * ratio,
    weight: weightOf(cfg.string(`${prefix}FontWeight`)),
  });
  const scaled = (f: FontKey, ratio: number): FontKey => ({ ...f, size: f.size * ratio });

  const elements = model.elements.map((el) => {
    const shape = shapeOf(el, model.elementTags);
    const base = fontOf(el.type, 1);
    const block = measureBlock(
      [
        { kind: 'name', text: el.label, font: base, bold: true },
        {
          kind: 'type',
          text: showsStereotype(el, cfg) ? stereotypeOf(el) : '',
          font: scaled(base, RATIO.type),
        },
        { kind: 'descr', text: el.descr, font: scaled(base, RATIO.descr) },
      ],
      measurer,
      cfg.wrap ? wrapWidth(shape, pad, minWidth) : Number.POSITIVE_INFINITY,
      SECTION_GAP,
    );
    return {
      id: el.alias,
      shape,
      block,
      ...(el.parent !== undefined ? { parent: el.parent } : {}),
    };
  });

  const titleFont = fontOf('boundary', RATIO.boundary);
  const groups = model.boundaries.map((b) => {
    const direction = b.direction ?? cfg.boundaryDirection;
    return {
      id: b.alias,
      ...(b.parent !== undefined ? { parent: b.parent } : {}),
      ...(direction !== undefined ? { direction } : {}),
      title: measureBlock(
        [{ kind: 'title', text: boundaryTitle(b), font: titleFont }],
        measurer,
        Number.POSITIVE_INFINITY,
        0,
      ),
    };
  });

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
  const smallFont = scaled(relFont, RATIO.small);
  const edges = model.rels.flatMap((rel, index): SceneEdge[] => {
    const missing = [rel.from, rel.to].filter((a) => !known.has(a));
    if (missing.length > 0) {
      ctx.warn({
        code: 'C4_UNKNOWN_ENDPOINT',
        message: `Rel(${rel.from}, ${rel.to}) is not drawn: ${missing.map((m) => `"${m}"`).join(' and ')} is not declared.`,
      });
      return [];
    }
    const block = measureBlock(
      [
        { kind: 'name', text: relText(rel, index, dynamic), font: relFont, bold: true },
        { kind: 'techn', text: rel.techn ? `[${rel.techn}]` : '', font: smallFont, italic: true },
        { kind: 'descr', text: rel.descr, font: smallFont },
      ],
      measurer,
      cfg.wrap ? REL_WRAP : Number.POSITIVE_INFINITY,
      0,
    );
    return [
      {
        id: `r${index}`,
        source: rel.from,
        target: rel.to,
        ...(block.sections.length > 0 ? { block } : {}),
      },
    ];
  });

  const tFont: FontKey = {
    family: theme.value('fontFamily'),
    size: rootSize * RATIO.title,
    weight: 400,
  };
  const title = model.title
    ? measureBlock(
        [{ kind: 'title', text: model.title, font: tFont }],
        measurer,
        Number.POSITIVE_INFINITY,
        0,
      )
    : undefined;
  return layoutScene(
    {
      direction: model.direction,
      elements,
      groups,
      edges,
      ...(title ? { title } : {}),
      pad,
      minWidth,
      spacing: cfg.number('c4ShapeMargin', 50),
      margin: cfg.number('diagramMarginX', 50),
      titleGap: cfg.number('diagramMarginY', 10),
    },
    ctx,
  );
}
