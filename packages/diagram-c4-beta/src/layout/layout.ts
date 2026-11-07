/**
 * Lays out a c4-beta diagram as a C4 scene, as the converged build's `c4-beta/db.ts`
 * `getData` and `renderer.ts` shape it: an element with children (or a group or deployment
 * node) is a boundary, relationships are numbered in a dynamic diagram, and the legend goes
 * under the drawing.
 */
import type { RenderContext } from '@mermaid-js/core';
import { layoutScene, measureBlock } from '@mermaid-v13-plugins/c4-shared';
import type {
  C4Block,
  C4Shape,
  SceneEdge,
  SceneElement,
  SceneGroup,
  SceneLayout,
} from '@mermaid-v13-plugins/c4-shared';
import type { FontKey } from '@mermaid-js/core/text';
import { C4BetaConfig } from '../config.ts';
import type {
  C4BetaElement,
  C4BetaElementKind,
  C4BetaModel,
  C4BetaRelationship,
} from '../parser/model.ts';

/** One legend row: a swatch and its label. */
export interface C4BetaLegendRow {
  readonly label: C4Block;
  /** The element kind whose identity colour the swatch takes, unless the row has colours. */
  readonly kind?: C4BetaElementKind;
  readonly external?: boolean;
  readonly fill?: string;
  readonly stroke?: string;
}

export interface C4BetaLegend {
  /** The left edge, and the line between the title row and the first swatch row. */
  readonly x: number;
  readonly y: number;
  readonly title: C4Block;
  readonly rows: readonly C4BetaLegendRow[];
}

/** Where everything goes. Edge ids are `r<index into model.relationships>`. */
export interface C4BetaLayout extends SceneLayout {
  readonly legend?: C4BetaLegend;
  /** The step shown on each numbered relationship, by edge id. */
  readonly steps: ReadonlyMap<string, number>;
}

/** v12 `ELEMENT_DISPLAY_NAMES`; a group has no stereotype. */
const DISPLAY_NAMES: Readonly<Partial<Record<C4BetaElementKind, string>>> = {
  person: 'Person',
  softwareSystem: 'Software System',
  container: 'Container',
  component: 'Component',
  deploymentNode: 'Deployment Node',
  infrastructureNode: 'Infrastructure Node',
};

/** Kinds that get a legend swatch: the ones with an identity colour (v12 `LEGEND_KINDS`). */
const LEGEND_KINDS: ReadonlySet<C4BetaElementKind> = new Set<C4BetaElementKind>([
  'person',
  'softwareSystem',
  'container',
  'component',
  'infrastructureNode',
]);

/** v12 c4-beta stylesheet: `small` is 0.75em. */
const SMALL = 0.75;
/** v12 renderer: `nodeSpacing` 80, `rankSpacing` 60. */
const NODE_SPACING = 80;
const RANK_SPACING = 60;
/** v12 c4-beta node padding. */
const PAD = 8;
/**
 * Where c4-beta element labels wrap. Measured on the converged build's renders: every element
 * label there has `max-width: 120px`, a person's from `personWrappingWidth`, the others' alike.
 */
const ELEMENT_WRAP = 120;
/** Relationship labels: the converged build's edge labels have `max-width: 200px`. */
const WRAP = 200;
/** v12 renderer: legend rows. */
export const LEGEND_ROW = 18;
export const LEGEND_SWATCH = 12;
const LEGEND_FONT = 12;
/** v12 `insertTitle(svg, 'c4TitleText', 30, ...)`, at 1.5em. */
const TITLE_GAP = 30;
const TITLE_RATIO = 1.5;

/**
 * User text as core's label layout should take it: literally. v12 escapes it into its HTML
 * labels; core's label layout reads an HTML subset (`<b>`) and decodes entities, so escaping
 * `&`, `<` and `>` keeps the text as written.
 */
const literal = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The ids drawn as boundaries: deployment nodes, groups, and any element with children. */
export function boundaryIds(model: C4BetaModel): Set<string> {
  return new Set(
    model.elements.flatMap((e) => [
      ...(e.kind === 'deploymentNode' || e.kind === 'group' ? [e.id] : []),
      ...(e.parent === undefined ? [] : [e.parent]),
    ]),
  );
}

/** v12 `buildLegendItems`: one row per kind in use (externals apart), then one per tag style. */
function legendRows(model: C4BetaModel, measure: (t: string) => C4Block): C4BetaLegendRow[] {
  const rows: C4BetaLegendRow[] = [];
  const seen = new Set<string>();
  for (const e of model.elements) {
    if (!LEGEND_KINDS.has(e.kind)) continue;
    const external = e.tags.includes('external');
    const label = external ? `external ${e.kind}` : e.kind;
    if (seen.has(label)) continue;
    seen.add(label);
    rows.push({ label: measure(label), kind: e.kind, external });
  }
  for (const [tag, style] of model.styles) {
    const stroke = style.stroke ?? style.fill;
    rows.push({
      label: measure(tag),
      ...(style.fill !== undefined ? { fill: style.fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
    });
  }
  return rows;
}

/** v12: the step of each relationship in a dynamic diagram; an explicit `N:` resets the count. */
function stepsOf(model: C4BetaModel): Map<number, number> {
  const steps = new Map<number, number>();
  if (model.kind !== 'dynamic') return steps;
  let max = 0;
  model.relationships.forEach((r, i) => {
    const step = r.step ?? max + 1;
    max = Math.max(max, step);
    steps.set(i, step);
  });
  return steps;
}

/** The relationship label's first line: `N. description` (v12 `buildRelationshipLabel`). */
export const relTitle = (r: C4BetaRelationship, step: number | undefined): string =>
  [step === undefined ? '' : `${step}.`, r.description ?? ''].filter((s) => s !== '').join(' ');

/** The shape an element takes: a person, a cylinder by tag, else a square-cornered box. */
export function shapeOf(e: C4BetaElement, model: C4BetaModel): C4Shape {
  const styles = new Map(model.styles);
  if (e.tags.some((t) => styles.get(t)?.shape === 'cylinder')) return 'cylinder';
  return e.kind === 'person' ? 'person' : 'box';
}

export function layoutC4Beta(model: C4BetaModel, ctx: RenderContext): C4BetaLayout {
  const cfg = new C4BetaConfig(ctx.config);
  const { measurer, theme } = ctx;
  const base: FontKey = {
    family: theme.value('fontFamily'),
    size: theme.number('fontSize'),
    weight: 400,
  };
  const small: FontKey = { ...base, size: base.size * SMALL };
  const boundaries = boundaryIds(model);
  const known = new Set(model.elements.map((e) => e.id));

  const elements: SceneElement[] = [];
  const groups: SceneGroup[] = [];
  for (const e of model.elements) {
    const parent = e.parent !== undefined ? { parent: e.parent } : {};
    if (boundaries.has(e.id)) {
      const title =
        e.kind === 'deploymentNode'
          ? measureBlock(
              [
                // v12 sets the instance count apart from the bold name.
                e.instances
                  ? {
                      kind: 'name',
                      text: `<b>${literal(e.name)}</b> x${literal(e.instances)}`,
                      font: base,
                    }
                  : { kind: 'name', text: literal(e.name), font: base, bold: true },
                {
                  kind: 'techn',
                  text: e.technology ? literal(`[${e.technology}]`) : '',
                  font: small,
                },
              ],
              measurer,
              Number.POSITIVE_INFINITY,
              0,
            )
          : measureBlock(
              [{ kind: 'title', text: literal(e.name), font: base }],
              measurer,
              Number.POSITIVE_INFINITY,
              0,
            );
      groups.push({ id: e.id, ...parent, title });
      continue;
    }
    const display = DISPLAY_NAMES[e.kind] ?? e.kind;
    const shape = shapeOf(e, model);
    const block = measureBlock(
      [
        { kind: 'type', text: cfg.showsStereotype(e.kind) ? `«${display}»` : '', font: small },
        { kind: 'name', text: literal(e.name), font: base, bold: true },
        {
          kind: 'techn',
          text: e.technology ? literal(`[${e.technology}]`) : '',
          font: small,
          italic: true,
        },
        { kind: 'descr', text: literal(e.description ?? ''), font: base },
      ],
      measurer,
      e.kind === 'person' ? cfg.number('personWrappingWidth', ELEMENT_WRAP) : ELEMENT_WRAP,
      0,
    );
    elements.push({ id: e.id, ...parent, shape, block });
  }

  const stepByIndex = stepsOf(model);
  const steps = new Map<string, number>();
  const edges = model.relationships.flatMap((r, i): SceneEdge[] => {
    const missing = [r.source, r.target].filter((id) => !known.has(id));
    if (missing.length > 0) {
      ctx.warn({
        code: 'C4B_UNKNOWN_ENDPOINT',
        message: `"${r.source} ${r.arrow} ${r.target}" is not drawn: ${missing.map((m) => `"${m}"`).join(' and ')} is not declared.`,
      });
      return [];
    }
    if (boundaries.has(r.source) && boundaries.has(r.target)) {
      ctx.warn({
        code: 'C4B_CLUSTER_TO_CLUSTER',
        message: `"${r.source} ${r.arrow} ${r.target}" connects two boundaries; relationships should connect leaf elements.`,
      });
    }
    const step = stepByIndex.get(i);
    if (step !== undefined) steps.set(`r${i}`, step);
    const block = measureBlock(
      [
        { kind: 'name', text: literal(relTitle(r, step)), font: base, bold: true },
        {
          kind: 'techn',
          text: r.technology ? literal(`[${r.technology}]`) : '',
          font: small,
          italic: true,
        },
      ],
      measurer,
      WRAP,
      0,
    );
    return [
      {
        id: `r${i}`,
        source: r.source,
        target: r.target,
        ...(block.sections.length > 0 ? { block } : {}),
      },
    ];
  });

  const margin = cfg.number('diagramPadding', 10);
  const titleFont: FontKey = { ...base, size: base.size * TITLE_RATIO };
  const title = model.title
    ? measureBlock(
        [{ kind: 'title', text: literal(model.title), font: titleFont }],
        measurer,
        Number.POSITIVE_INFINITY,
        0,
      )
    : undefined;
  const laid = layoutScene(
    {
      direction: model.direction,
      elements,
      groups,
      edges,
      ...(title ? { title } : {}),
      pad: PAD,
      minWidth: 0,
      spacing: NODE_SPACING,
      rankSpacing: RANK_SPACING,
      margin,
      titleGap: TITLE_GAP / 2,
    },
    ctx,
  );

  const legendFont: FontKey = { ...base, size: LEGEND_FONT };
  const measureLegend = (t: string) =>
    measureBlock(
      [{ kind: 'title', text: t, font: legendFont }],
      measurer,
      Number.POSITIVE_INFINITY,
      0,
    );
  const rows = model.legend ? legendRows(model, measureLegend) : [];
  if (rows.length === 0) return { ...laid, steps };
  const legendTitle = measureBlock(
    [{ kind: 'title', text: 'Legend', font: legendFont, bold: true }],
    measurer,
    Number.POSITIVE_INFINITY,
    0,
  );
  const x = margin;
  // v12 puts the legend's top one row under the drawing; the title row is centred above `y`.
  const y = laid.height - margin + LEGEND_ROW + LEGEND_ROW / 2 + legendTitle.height / 2;
  const width = Math.max(
    laid.width,
    x + LEGEND_SWATCH + 6 + Math.max(legendTitle.width, ...rows.map((r) => r.label.width)) + margin,
  );
  const height = y + rows.length * LEGEND_ROW + margin;
  return { ...laid, width, height, legend: { x, y, title: legendTitle, rows }, steps };
}
