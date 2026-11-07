/**
 * Draws a laid-out c4-beta diagram in the converged build's outline look (`c4-beta/styles.ts`):
 * each element kind's `c4*Border` theme variable is its border and its `c4*Bkg` the label
 * text, over the theme background; boundaries are dashed (7 7) unfilled boxes; relationships
 * are solid lines unless a tag makes them dashed or dotted; the legend goes under the drawing.
 */
import type { RenderContext } from '@mermaid-js/core';
import { checkColor, px, styleText } from '@mermaid-js/core/svg';
import type { OutlinePaint, Paint, SvgWriter } from '@mermaid-js/core/svg';
import {
  dash,
  drawBlock,
  drawEdgeLabel,
  drawEdgeLine,
  drawGroupFrame,
  drawShape,
  headOf,
  textAttrs,
  userColor,
} from '@mermaid-v13-plugins/c4-shared';
import { C4_THEME_DEFAULTS } from '../config.ts';
import { LEGEND_ROW, LEGEND_SWATCH } from '../layout/layout.ts';
import type { C4BetaLayout } from '../layout/layout.ts';
import type {
  C4BetaElement,
  C4BetaElementKind,
  C4BetaModel,
  C4BetaTagStyle,
} from '../parser/model.ts';

const BOUNDARY_DASH = dash('7 7');
/** v12 flowchart edge patterns, which c4-beta's `line:` tag style picks. */
const LINE_DASH = { dashed: dash('3'), dotted: dash('2') } as const;

/** Each kind's identity variables; external elements share the grey pair. */
const IDENTITY: Readonly<
  Partial<Record<C4BetaElementKind, readonly [text: string, border: string]>>
> = {
  person: ['c4PersonBkg', 'c4PersonBorder'],
  softwareSystem: ['c4SystemBkg', 'c4SystemBorder'],
  container: ['c4ContainerBkg', 'c4ContainerBorder'],
  component: ['c4ComponentBkg', 'c4ComponentBorder'],
  infrastructureNode: ['c4InfrastructureBkg', 'c4InfrastructureBorder'],
};
const EXTERNAL = ['c4ExternalBkg', 'c4ExternalBorder'] as const;

/**
 * A C4 theme variable as paint. With the `c4BetaCompat` extension registered it is a theme
 * alias the page can override; without it the theme does not know the name (`color` throws
 * `Unknown theme variable`), so the converged build's default is drawn as a literal.
 */
function c4Paint(ctx: RenderContext, name: string): Paint {
  try {
    return ctx.theme.color(name);
  } catch {
    return checkColor(C4_THEME_DEFAULTS[name] ?? '') ?? ctx.theme.color('textColor');
  }
}

interface Paints {
  readonly background: Paint;
  readonly line: Paint;
  readonly text: Paint;
  readonly title: Paint;
  readonly labelBackground: Paint;
  readonly boundary: Paint;
  readonly stroke: number;
  readonly identity: ReadonlyMap<string, Paint>;
}

/** The tags' styles merged, later tags winning. */
function tagStyle(
  tags: readonly string[],
  styles: ReadonlyMap<string, C4BetaTagStyle>,
): C4BetaTagStyle {
  const out: C4BetaTagStyle = {};
  for (const t of tags) Object.assign(out, styles.get(t) ?? {});
  return out;
}

function identityOf(
  e: { kind: C4BetaElementKind; tags: readonly string[] },
  paints: Paints,
): readonly [OutlinePaint, OutlinePaint] {
  const pair = e.tags.includes('external') ? EXTERNAL : IDENTITY[e.kind];
  const text = pair ? paints.identity.get(pair[0]) : undefined;
  const border = pair ? paints.identity.get(pair[1]) : undefined;
  return [text ?? paints.text, border ?? paints.text];
}

function drawLegend(w: SvgWriter, layout: C4BetaLayout, paints: Paints, ctx: RenderContext): void {
  const legend = layout.legend;
  if (!legend) return;
  w.open('g', { class: 'c4-legend' });
  drawBlock(
    w,
    legend.title,
    legend.x + legend.title.width / 2,
    legend.y - LEGEND_ROW / 2,
    paints.text,
  );
  legend.rows.forEach((row, i) => {
    const baseline = legend.y + (i + 1) * LEGEND_ROW;
    const [, border] = row.kind
      ? identityOf({ kind: row.kind, tags: row.external ? ['external'] : [] }, paints)
      : [paints.text, paints.text];
    w.leaf('rect', {
      x: legend.x,
      y: baseline - LEGEND_SWATCH - LEGEND_ROW / 2 + LEGEND_SWATCH / 2,
      width: LEGEND_SWATCH,
      height: LEGEND_SWATCH,
      fill: userColor(ctx, row.fill, 'legend') ?? paints.background,
      stroke: userColor(ctx, row.stroke, 'legend') ?? border,
    });
    drawBlock(
      w,
      row.label,
      legend.x + LEGEND_SWATCH + 6 + row.label.width / 2,
      baseline - LEGEND_ROW / 2,
      paints.text,
    );
  });
  w.close();
}

function drawElement(
  w: SvgWriter,
  ctx: RenderContext,
  e: C4BetaElement,
  layout: C4BetaLayout,
  styles: ReadonlyMap<string, C4BetaTagStyle>,
  paints: Paints,
): void {
  const placed = layout.elements.find((p) => p.id === e.id);
  if (!placed) return;
  const style = tagStyle(e.tags, styles);
  const [text, border] = identityOf(e, paints);
  const external = e.tags.includes('external') ? ' c4-external' : '';
  const tagClasses = e.tags.map((t) => ` c4-tag-${t.replace(/[^\w-]/g, '')}`).join('');
  w.open('g', {
    class: `c4-shape c4-${e.kind}${external}${tagClasses}`,
    'data-id': e.id,
    'data-ast': e.ast,
  });
  drawShape(
    w,
    placed,
    userColor(ctx, style.fill, 'fill') ?? paints.background,
    userColor(ctx, style.stroke, 'stroke') ?? border,
    paints.stroke,
  );
  drawBlock(w, placed.block, placed.x, placed.labelY, userColor(ctx, style.color, 'text') ?? text);
  w.close();
}

/** Writes the whole `<svg>` document of a laid-out c4-beta diagram. */
export function renderC4Beta(
  model: C4BetaModel,
  layout: C4BetaLayout,
  ctx: RenderContext,
  w: SvgWriter,
): void {
  const { theme } = ctx;
  // Every paint is asked for before the root is written: the root declares the theme aliases
  // used so far, and a streamed root cannot be changed afterwards.
  const identity = new Map(
    Object.keys(C4_THEME_DEFAULTS).map((name) => [name, c4Paint(ctx, name)]),
  );
  const paints: Paints = {
    background: theme.color('background'),
    line: theme.color('lineColor'),
    text: theme.color('textColor'),
    title: theme.color('titleColor'),
    labelBackground: theme.color('edgeLabelBackground'),
    boundary: identity.get('c4BoundaryBorder') ?? theme.color('lineColor'),
    stroke: theme.number('strokeWidth'),
    identity,
  };
  const head = headOf(theme);
  const font = theme.font();
  const fontSize = theme.length('fontSize');
  const prefix = ctx.idPrefix;
  const accTitle = model.accTitle || undefined;
  const accDescr = model.accDescr || undefined;
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-c4-beta c4beta',
    viewBox: [0, 0, layout.width, layout.height],
    width: layout.width,
    height: layout.height,
    role: 'img',
    'aria-roledescription': 'c4beta',
    'aria-labelledby': accTitle ? `${prefix}-title` : undefined,
    'aria-describedby': accDescr ? `${prefix}-desc` : undefined,
    'data-mermaid-version': ctx.version,
    style: styleText({ 'max-width': px(layout.width) }, theme.rootStyleText()),
    'font-family': font,
    'font-size': fontSize,
  });
  if (accTitle) {
    w.open('title', { id: `${prefix}-title` });
    w.text(accTitle);
    w.close();
  }
  if (accDescr) {
    w.open('desc', { id: `${prefix}-desc` });
    w.text(accDescr);
    w.close();
  }
  if (layout.title) {
    w.open('g', { class: 'c4TitleText' });
    const [section] = layout.title.block.sections;
    if (section)
      w.label(section.label, layout.title.x, layout.title.y, textAttrs(section.font, paints.text));
    w.close();
  }
  const styles = new Map(model.styles);
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  for (const g of [...layout.groups].sort((p, q) => p.depth - q.depth)) {
    const e = byId.get(g.id);
    if (!e) continue;
    const style = tagStyle(e.tags, styles);
    const node = e.kind === 'deploymentNode' ? ' c4-deploymentNode' : '';
    w.open('g', { class: `c4-boundary${node}`, 'data-id': e.id, 'data-ast': e.ast });
    drawGroupFrame(w, g, {
      fill: userColor(ctx, style.fill, 'fill') ?? 'none',
      stroke: userColor(ctx, style.stroke, 'stroke') ?? paints.boundary,
      text: userColor(ctx, style.color, 'text') ?? paints.title,
      width: 1,
      dash: BOUNDARY_DASH,
    });
    w.close();
  }
  const rels = layout.edges.flatMap((edge) => {
    const index = Number(edge.id.slice(1));
    const r = model.relationships[index];
    if (!r) return [];
    const style = tagStyle(r.tags, styles);
    return [
      {
        edge,
        index,
        r,
        line: userColor(ctx, style.stroke, 'stroke') ?? paints.line,
        text: userColor(ctx, style.color, 'text') ?? paints.text,
        pattern: style.line,
      },
    ];
  });
  for (const { edge, index, r, line, pattern } of rels) {
    const tagClasses = r.tags.map((t) => ` c4-tag-${t.replace(/[^\w-]/g, '')}`).join('');
    w.open('g', { class: `c4-rel${tagClasses}`, 'data-id': `rel-${index}`, 'data-ast': r.ast });
    drawEdgeLine(
      w,
      edge,
      {
        start: r.arrow.startsWith('<'),
        end: r.arrow.endsWith('>'),
        stroke: line,
        width: paints.stroke,
        ...(pattern === 'dashed' || pattern === 'dotted' ? { dash: LINE_DASH[pattern] } : {}),
      },
      head,
    );
    w.close();
  }
  for (const e of model.elements)
    if (!layout.groups.some((g) => g.id === e.id)) drawElement(w, ctx, e, layout, styles, paints);
  for (const { edge, index, text } of rels) {
    if (!edge.block) continue;
    w.open('g', { class: 'c4-rel-label', 'data-id': `rel-${index}-label` });
    drawEdgeLabel(w, edge, paints.labelBackground, text);
    w.close();
  }
  drawLegend(w, layout, paints, ctx);
  w.close();
}
