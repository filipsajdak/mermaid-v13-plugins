import type { RenderContext } from '@mermaid-js/core';
import { checkStyle, rotate, transforms, translate } from '@mermaid-js/core/svg';
import type {
  AllowedTag,
  Attrs,
  LabelBox,
  OutlineRole,
  OutlineTag,
  SvgWriter,
  ThemeStyleSheet,
} from '@mermaid-js/core/svg';
import { layoutLabel } from '@mermaid-js/core/text';
import { renderFlowchart } from '@mermaid-js/diagram-flowchart';
import type { PhaseBand } from '@mermaid-v13-plugins/swimlane-engine';
import { flowchartContext } from './context.ts';
import type { LaneBox, SwimlaneLayout } from './layout.ts';
import type { SwimlaneModel } from './model.ts';

/** v12's `.swimlane-phase-separator` dash: dashed, so it reads as a guide and not a border. */
const PHASE_SEPARATOR = checkStyle(['stroke-dasharray: 6 4']).shape['stroke-dasharray'];

/** Upward, as v12 turned the titles of lanes and phases that run down the left. */
const UPWARD = -90;

/** The paints the lanes and bands use: the flowchart's cluster paints, asked for the same way. */
function paints(ctx: RenderContext) {
  const { theme } = ctx;
  return {
    fill: theme.color('clusterBkg'),
    stroke: theme.outline('clusterBorder'),
    line: theme.color('clusterBorder'),
    strokeWidth: theme.length('clusterStrokeWidth'),
    text: theme.color('titleColor'),
    border: theme.palette('borderColorArray'),
    bkg: theme.palette('bkgColorArray'),
    font: { family: theme.value('fontFamily'), size: theme.number('fontSize'), weight: 400 },
  };
}

type Paints = ReturnType<typeof paints>;

const cls = (names: readonly string[]): string =>
  names.map((n) => n.replace(/[^\w-]/g, '')).reduce((out, c) => (c ? `${out} ${c}` : out), '');

/** A label centred on (x, y), turned to read upward when `upward`. */
function centredLabel(
  w: SvgWriter,
  box: LabelBox,
  x: number,
  y: number,
  upward: boolean,
  attrs: Attrs,
): void {
  if (!upward) {
    w.label(box, x, y, attrs);
    return;
  }
  w.open('g', { transform: transforms(translate(x, y), rotate(UPWARD)) });
  w.label(box, 0, 0, attrs);
  w.close();
}

/** Draws each lane as v12's swimlane shape did: the lane, its title band, and its title. */
function drawLanes(w: SvgWriter, layout: SwimlaneLayout, ctx: RenderContext, paint: Paints): void {
  const flow = layout.flow;
  if (flow === undefined || layout.lanes.length === 0) return;
  w.open('g', { class: 'swimlanes' });
  for (const lane of layout.lanes) drawLane(w, lane, flow.views.get(lane.id), ctx, paint);
  w.close();
}

type View =
  NonNullable<SwimlaneLayout['flow']>['views'] extends ReadonlyMap<string, infer V> ? V : never;

function drawLane(
  w: SvgWriter,
  lane: LaneBox,
  view: View | undefined,
  ctx: RenderContext,
  paint: Paints,
): void {
  // The palette slot as the flowchart gives one to a cluster; on only with a palette theme.
  const order = view?.order;
  const slot =
    order === undefined || paint.border.length === 0
      ? undefined
      : {
          id: `color-${order % paint.border.length}` as const,
          stroke: paint.border[order % paint.border.length],
          fill: paint.bkg.length > 0 ? paint.bkg[order % paint.bkg.length] : undefined,
        };
  const own = view?.style.shape ?? {};
  w.open('g', {
    class: 'cluster swimlane' + cls(view?.classes ?? []),
    'data-id': lane.id,
    'data-ast': view?.ast,
    'data-color-id': slot?.id,
  });
  const shape = {
    fill: slot?.fill ?? paint.fill,
    stroke: slot?.stroke ?? paint.stroke,
    'stroke-width': paint.strokeWidth,
    ...own,
  };
  w.outline('group', 'rect', { class: 'swimlane-body', ...shape, ...lane.box });
  if (lane.title.width > 0 && lane.title.height > 0) {
    w.outline('group', 'rect', { class: 'swimlane-title', ...shape, ...lane.title });
  }
  if (view && view.label.height > 0) {
    const fill = own.fill;
    centredLabel(
      w,
      view.label,
      lane.title.x + lane.title.width / 2,
      lane.title.y + lane.title.height / 2,
      lane.titleReadsUpward,
      {
        class: 'cluster-label swimlane-label',
        fill: (typeof fill === 'string' && ctx.theme.ink(fill)) || paint.text,
        ...view.style.text,
      },
    );
  }
  w.close();
}

/** Draws the phase bands: a title cell per band and a dashed line between bands. */
function drawBands(
  w: SvgWriter,
  bands: readonly PhaseBand[],
  model: SwimlaneModel,
  ctx: RenderContext,
  paint: Paints,
): void {
  if (bands.length === 0) return;
  const markdown = new Set(model.phases.filter((p) => p.labelType === 'markdown').map((p) => p.id));
  w.open('g', { class: 'swimlane-phases' });
  for (const band of bands) {
    w.open('g', { class: 'swimlane-phase', 'data-id': band.id });
    w.leaf('rect', {
      class: 'swimlane-phase-title',
      ...band.title,
      fill: paint.fill,
      stroke: paint.stroke,
      'stroke-width': paint.strokeWidth,
    });
    if (band.label) {
      centredLabel(
        w,
        layoutLabel(band.label, paint.font, Infinity, ctx.measurer, {
          markdown: markdown.has(band.id),
        }),
        band.title.x + band.title.width / 2,
        band.title.y + band.title.height / 2,
        band.titleReadsUpward,
        { class: 'cluster-label swimlane-phase-label', fill: paint.text },
      );
    }
    w.close();
    if (band.separator) {
      w.leaf('line', {
        class: 'swimlane-phase-separator',
        ...band.separator,
        stroke: paint.line,
        'stroke-dasharray': PHASE_SEPARATOR,
      });
    }
  }
  w.close();
}

/**
 * Passes everything through to `w`, and lets the plugin write its own layers into the
 * flowchart's document: the lanes under the flowchart's clusters (the subgraphs nested in
 * lanes), the phase bands above them and under the edges, as v12 stacked them.
 */
class LayeredWriter implements SvgWriter {
  private depth = 0;
  private lanesDrawn = false;
  private readonly w: SvgWriter;
  private readonly lanes: () => void;
  private readonly bands: () => void;

  constructor(w: SvgWriter, lanes: () => void, bands: () => void) {
    this.w = w;
    this.lanes = lanes;
    this.bands = bands;
  }

  open(tag: AllowedTag, attrs?: Attrs): void {
    if (this.depth === 0 && tag === 'svg') {
      this.w.open(tag, {
        ...attrs,
        class: 'mermaid mermaid-swimlane',
        'aria-roledescription': 'swimlane',
      });
      this.depth++;
      return;
    }
    if (this.depth === 1 && tag === 'g') {
      if (attrs?.class === 'clusters' || attrs?.class === 'edgePaths') this.drawLanes();
      if (attrs?.class === 'edgePaths') this.bands();
    }
    this.w.open(tag, attrs);
    this.depth++;
  }

  private drawLanes(): void {
    if (this.lanesDrawn) return;
    this.lanesDrawn = true;
    this.lanes();
  }

  close(): void {
    this.depth--;
    this.w.close();
  }

  leaf(tag: AllowedTag, attrs?: Attrs): void {
    this.w.leaf(tag, attrs);
  }

  outline(role: OutlineRole, tag: OutlineTag, attrs?: Attrs): void {
    this.w.outline(role, tag, attrs);
  }

  text(content: string): void {
    this.w.text(content);
  }

  label(box: LabelBox, x: number, y: number, attrs?: Attrs): void {
    this.w.label(box, x, y, attrs);
  }

  path(): ReturnType<SvgWriter['path']> {
    return this.w.path();
  }

  styleSheet(css: ThemeStyleSheet): void {
    this.w.styleSheet(css);
  }
}

/** Writes the whole `<svg>` document of a laid-out swimlane diagram. */
export function renderSwimlane(
  model: SwimlaneModel,
  layout: SwimlaneLayout,
  ctx: RenderContext,
  w: SvgWriter,
): void {
  // Asked for before the flowchart writes the root, so the root declares every paint.
  const paint = paints(ctx);
  const layered = new LayeredWriter(
    w,
    () => {
      drawLanes(w, layout, ctx, paint);
    },
    () => {
      drawBands(w, layout.bands, model, ctx, paint);
    },
  );
  renderFlowchart(model.flow, layout, flowchartContext(ctx), layered);
}
