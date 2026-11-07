/**
 * Draws a laid-out legacy C4 diagram through the SvgWriter, in the converged build's
 * c4model.com outline look: each element type's palette colour is its border and text over the
 * theme's background; boundaries are dashed unfilled boxes; relationships are dashed lines with
 * an arrowhead and a label on an opaque background.
 */
import type { RenderContext } from '@mermaid-js/core';
import { checkColor, checkUrl, px, styleText } from '@mermaid-js/core/svg';
import type { OutlinePaint, Paint, SvgWriter } from '@mermaid-js/core/svg';
import {
  dash,
  drawBlock,
  drawEdgeLabel,
  drawEdgeLine,
  drawGroupFrame,
  drawShape,
  headOf,
  readableOn,
  textAttrs,
  userColor,
} from '@mermaid-v13-plugins/c4-shared';
import type { Head, PlacedElement } from '@mermaid-v13-plugins/c4-shared';
import { C4Config } from '../config.ts';
import { tagsOf, tagStyleOf } from '../layout/index.ts';
import type { C4Layout } from '../layout/index.ts';
import type { C4Element, C4Model, C4Rel } from '../parser/index.ts';

/** The converged stylesheet's dashes: boundaries `8 4`, relationships `6 4`. */
const BOUNDARY_DASH = dash('8 4');
const REL_DASH = dash('6 4');

interface Paints {
  readonly background: Paint;
  readonly line: Paint;
  readonly text: Paint;
  readonly title: Paint;
  readonly head: Head;
}

/** The colours a relationship draws with: its own, else a tag's, else the theme's. */
function relPaints(ctx: RenderContext, model: C4Model, rel: C4Rel, paints: Paints) {
  const tags = tagsOf(rel.tags, model.relTags);
  const tagged = (key: 'lineColor' | 'textColor'): string | undefined =>
    tags.reduce<string | undefined>((c, t) => t[key] ?? c, undefined);
  return {
    line: userColor(ctx, rel.lineColor ?? tagged('lineColor'), 'line') ?? paints.line,
    text: userColor(ctx, rel.textColor ?? tagged('textColor'), 'text') ?? paints.text,
  };
}

function drawElement(
  w: SvgWriter,
  ctx: RenderContext,
  model: C4Model,
  el: C4Element,
  placed: PlacedElement,
  identity: OutlinePaint,
  paints: Paints,
): void {
  const tag = tagStyleOf(el, model.elementTags);
  const fill = userColor(ctx, el.style.bgColor ?? tag.bgColor, 'background') ?? paints.background;
  const stroke = userColor(ctx, el.style.borderColor ?? tag.borderColor, 'border') ?? identity;
  const text = userColor(ctx, el.style.fontColor ?? tag.fontColor, 'font') ?? identity;
  const external = el.type.startsWith('external_') ? ' c4-external' : '';
  const href =
    el.link === undefined
      ? undefined
      : checkUrl(el.link, {
          securityLevel: ctx.securityLevel,
          ...(ctx.linkSchemes ? { linkSchemes: ctx.linkSchemes } : {}),
          warn: (x) => {
            ctx.warn(x);
          },
        });
  if (href) w.open('a', { href });
  w.open('g', {
    class: `c4-shape c4-${el.type}${external}`,
    'data-id': el.alias,
    'data-ast': el.ast,
  });
  drawShape(w, placed, fill, stroke, 2);
  drawBlock(w, placed.block, placed.x, placed.labelY, text);
  w.close();
  if (href) w.close();
}

/** Writes the whole `<svg>` document of a laid-out C4 diagram. */
export function renderC4(model: C4Model, layout: C4Layout, ctx: RenderContext, w: SvgWriter): void {
  const { theme } = ctx;
  const cfg = new C4Config(ctx.config);
  // Every paint is asked for before the root is written: the root declares the theme's
  // aliases used so far, and a streamed root cannot be changed afterwards.
  const paints: Paints = {
    background: theme.color('background'),
    line: theme.color('lineColor'),
    text: theme.color('textColor'),
    title: theme.color('titleColor'),
    head: headOf(theme),
  };
  const font = theme.font();
  const fontSize = theme.length('fontSize');
  const surface = theme.rgba('background');
  const identities = new Map<string, OutlinePaint>();
  for (const el of model.elements) {
    if (identities.has(el.type)) continue;
    const palette = cfg.string(`${el.type}_bg_color`);
    const c = palette === undefined ? undefined : checkColor(readableOn(palette, surface));
    identities.set(el.type, c ?? paints.text);
  }
  const prefix = ctx.idPrefix;
  const title = model.accTitle || undefined;
  const desc = model.accDescr || undefined;
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-c4 c4Diagram',
    viewBox: [0, 0, layout.width, layout.height],
    width: layout.width,
    height: layout.height,
    role: 'img',
    'aria-roledescription': 'c4',
    'aria-labelledby': title ? `${prefix}-title` : undefined,
    'aria-describedby': desc ? `${prefix}-desc` : undefined,
    'data-mermaid-version': ctx.version,
    style: styleText({ 'max-width': px(layout.width) }, theme.rootStyleText()),
    'font-family': font,
    'font-size': fontSize,
  });
  if (title) {
    w.open('title', { id: `${prefix}-title` });
    w.text(title);
    w.close();
  }
  if (desc) {
    w.open('desc', { id: `${prefix}-desc` });
    w.text(desc);
    w.close();
  }
  if (layout.title) {
    w.open('g', { class: 'c4-title' });
    const [section] = layout.title.block.sections;
    if (section)
      w.label(section.label, layout.title.x, layout.title.y, textAttrs(section.font, paints.title));
    w.close();
  }
  const boundaries = new Map(model.boundaries.map((b) => [b.alias, b]));
  for (const g of [...layout.groups].sort((p, q) => p.depth - q.depth)) {
    const b = boundaries.get(g.id);
    if (!b) continue;
    w.open('g', {
      class: `c4-boundary${b.nodeType ? ' c4-deployment-node' : ''}`,
      'data-id': g.id,
      'data-ast': b.ast,
    });
    drawGroupFrame(w, g, {
      fill: userColor(ctx, b.style.bgColor, 'background') ?? 'none',
      stroke: userColor(ctx, b.style.borderColor, 'border') ?? paints.line,
      text: userColor(ctx, b.style.fontColor, 'font') ?? paints.text,
      width: 1,
      dash: BOUNDARY_DASH,
    });
    w.close();
  }
  const rels = layout.edges.flatMap((edge) => {
    const index = Number(edge.id.slice(1));
    const rel = model.rels[index];
    return rel ? [{ edge, index, rel, ...relPaints(ctx, model, rel, paints) }] : [];
  });
  for (const { edge, index, rel, line } of rels) {
    w.open('g', { class: `c4-rel c4-${rel.type}`, 'data-id': `rel-${index}`, 'data-ast': rel.ast });
    drawEdgeLine(
      w,
      edge,
      {
        start: rel.type === 'birel' || rel.type === 'rel_b',
        end: rel.type !== 'rel_b',
        stroke: line,
        width: 1.5,
        dash: REL_DASH,
      },
      paints.head,
    );
    w.close();
  }
  const elements = new Map(model.elements.map((e) => [e.alias, e]));
  for (const p of layout.elements) {
    const el = elements.get(p.id);
    if (el) drawElement(w, ctx, model, el, p, identities.get(el.type) ?? paints.text, paints);
  }
  // Labels last, over the elements: the converged build draws them above its nodes too.
  for (const { edge, index, rel, text } of rels) {
    if (!edge.block) continue;
    w.open('g', { class: 'c4-rel-label', 'data-id': `rel-${index}-label` });
    drawEdgeLabel(w, edge, paints.background, text, { x: rel.offsetX ?? 0, y: rel.offsetY ?? 0 });
    w.close();
  }
  w.close();
}
