/**
 * v12's `swimlanes/__tests__/phases.layout.spec.ts`, ported: the layout part runs the lifted
 * engine on what this plugin's parser reads, instead of v12's flowDb; the painting part reads
 * the plugin's SVG instead of a d3 tree.
 */
import {
  computePhaseBands,
  layoutSwimlanes,
  PHASE_TITLE_THICKNESS,
} from '@mermaid-v13-plugins/swimlane-engine';
import type { LayoutData, Node } from '@mermaid-v13-plugins/swimlane-engine';
import { describe, expect, it } from 'vitest';
import { parseSwimlane } from '../src/parser.ts';
import { renderText } from './render-helpers.ts';

const NODE_WIDTH = 100;
const NODE_HEIGHT = 40;
const NODE_SPACING = 40;
const RANK_SPACING = 100;

const source = (direction: string, extra = '') =>
  [
    `swimlane-beta ${direction}`,
    'phase p1["Intake"]',
    'phase p2["Review"]',
    'phase p3["Closeout"]',
    'subgraph l1',
    '  a@{ phase: p1 }',
    '  b@{ phase: p2 }',
    'end',
    'subgraph l2',
    '  d@{ phase: p1 }',
    '  c@{ phase: p3 }',
    '  c2@{ phase: p3 }',
    'end',
    'a --> b --> c',
    extra,
  ].join('\n');

/** The layout data v12's flowDb.getData() handed the engine, built from our parse. */
function layoutDataOf(
  text: string,
  swimlane: Record<string, unknown>,
  titleExtents: Record<string, number>,
): LayoutData {
  const { model } = parseSwimlane(text);
  const parentOf = new Map<string, string>();
  for (const sg of model.flow.subgraphs) {
    for (const member of sg.nodes) if (!parentOf.has(member)) parentOf.set(member, sg.id);
  }
  const groups: Node[] = [...model.flow.subgraphs].reverse().map((sg) => ({
    id: sg.id,
    label: sg.title,
    isGroup: true,
    parentId: parentOf.get(sg.id),
    padding: 8,
    labelBBox: { width: 40, height: 16 },
  }));
  const nodes: Node[] = model.flow.vertices.map((v) => ({
    id: v.id,
    label: v.text,
    isGroup: false,
    parentId: parentOf.get(v.id),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  return {
    nodes: [...groups, ...nodes],
    edges: model.flow.edges.map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
      label: e.text || undefined,
      type: 'normal',
    })),
    config: { flowchart: { nodeSpacing: NODE_SPACING, rankSpacing: RANK_SPACING }, swimlane },
    direction: model.flow.direction,
    other:
      model.phases.length > 0
        ? {
            phases: model.phases.map((p) => ({ ...p, titleExtent: titleExtents[p.id] })),
            nodePhases: Object.fromEntries(model.nodePhases),
          }
        : {},
  };
}

const laidOut = (
  text: string,
  swimlane: Record<string, unknown> = {},
  titleExtents: Record<string, number> = {},
): LayoutData => {
  const data = layoutDataOf(text, swimlane, titleExtents);
  layoutSwimlanes(data);
  return data;
};

const span = (layout: LayoutData, ids: string[], alongX: boolean) => {
  const boxes = layout.nodes.filter((node) => ids.includes(node.id));
  const starts = boxes.map((node) =>
    alongX ? (node.x ?? 0) - (node.width ?? 0) / 2 : (node.y ?? 0) - (node.height ?? 0) / 2,
  );
  const ends = boxes.map(
    (node, index) => starts[index]! + (alongX ? (node.width ?? 0) : (node.height ?? 0)),
  );
  return { start: Math.min(...starts), end: Math.max(...ends) };
};

const DIRECTIONS = [
  ['TB', false, false],
  ['LR', true, false],
  ['BT', false, true],
  ['RL', true, true],
] as const;

describe('phases in the swimlane layout', () => {
  it.each(DIRECTIONS)(
    'stacks the phases in declaration order in %s',
    (direction, alongX, reversed) => {
      const layout = laidOut(source(direction));

      const [first, second, third] = [
        span(layout, ['a', 'd'], alongX),
        span(layout, ['b'], alongX),
        span(layout, ['c', 'c2'], alongX),
      ];

      if (reversed) {
        expect(first.start).toBeGreaterThanOrEqual(second.end);
        expect(second.start).toBeGreaterThanOrEqual(third.end);
      } else {
        expect(first.end).toBeLessThanOrEqual(second.start);
        expect(second.end).toBeLessThanOrEqual(third.start);
      }
    },
  );

  it('leaves no empty layer between the bands', () => {
    // c2 has no edge and would sit on the first layer; it must not drag the whole phase down.
    const layout = laidOut(source('TB'));

    const rows = [...new Set(layout.nodes.filter((node) => !node.isGroup).map((node) => node.y))]
      .map((y) => y ?? 0)
      .sort((a, b) => a - b);
    const steps = new Set(rows.slice(1).map((y, index) => Math.round(y - rows[index]!)));

    expect(steps.size).toBe(1);
  });

  it.each(DIRECTIONS)(
    'stacks the phases in %s with the gravity layering too',
    (direction, alongX, reversed) => {
      const layout = laidOut(source(direction), { ignoreCrossLaneEdges: false });

      const [first, second, third] = [
        span(layout, ['a', 'd'], alongX),
        span(layout, ['b'], alongX),
        span(layout, ['c', 'c2'], alongX),
      ];

      if (reversed) {
        expect(first.start).toBeGreaterThanOrEqual(second.end);
        expect(second.start).toBeGreaterThanOrEqual(third.end);
      } else {
        expect(first.end).toBeLessThanOrEqual(second.start);
        expect(second.end).toBeLessThanOrEqual(third.start);
      }
    },
  );

  it('keeps a phase after the earlier ones when nothing links its nodes to them', () => {
    const layout = laidOut(source('TB'));

    expect(span(layout, ['c2'], false).start).toBeGreaterThanOrEqual(
      span(layout, ['b'], false).end,
    );
  });

  it('keeps the order when an edge runs back to an earlier phase', () => {
    const layout = laidOut(source('TB', 'c --> a'));

    const [first, second, third] = [
      span(layout, ['a', 'd'], false),
      span(layout, ['b'], false),
      span(layout, ['c', 'c2'], false),
    ];
    expect(first.end).toBeLessThanOrEqual(second.start);
    expect(second.end).toBeLessThanOrEqual(third.start);
  });

  it('keeps a labelled edge between two phases from breaking the order', () => {
    const layout = laidOut(source('TB', 'a -- "needs review" --> c'));

    expect(span(layout, ['a', 'd'], false).end).toBeLessThanOrEqual(
      span(layout, ['c', 'c2'], false).start,
    );
  });

  it('keeps the bands off the middle phase when a labelled edge jumps over it', () => {
    const middle = 'subgraph l3\n  b2@{ phase: p2 }\nend\nb --> b2 --> c';
    const layout = laidOut(source('TB', `${middle}\na -- "needs review" --> c`));

    const [first, second, third] = computePhaseBands(layout);
    const middleNodes = span(layout, ['b', 'b2'], false);

    const label = layout.nodes.find((node) => node.id.startsWith('edge-label-'));
    expect(label?.y).toBeGreaterThanOrEqual(first!.title.y);
    expect(label?.y).toBeLessThanOrEqual(first!.title.y + first!.title.height);
    expect(first!.title.y + first!.title.height).toBeLessThanOrEqual(middleNodes.start);
    expect(second!.title.y).toBeLessThanOrEqual(middleNodes.start);
    expect(second!.title.y + second!.title.height).toBeGreaterThanOrEqual(middleNodes.end);
    expect(third!.title.y).toBeGreaterThanOrEqual(middleNodes.end);
  });

  it('puts a node that names no phase after every phase', () => {
    const layout = laidOut(source('TB', 'subgraph l3\n  z\nend'));

    expect(span(layout, ['z'], false).start).toBeGreaterThanOrEqual(
      span(layout, ['c', 'c2'], false).end,
    );
  });
});

describe('phase bands', () => {
  const laneBox = (layout: LayoutData) => {
    const lanes = layout.nodes.filter((node) => node.isGroup && !node.parentId);
    return {
      left: Math.min(...lanes.map((lane) => (lane.x ?? 0) - (lane.width ?? 0) / 2)),
      right: Math.max(...lanes.map((lane) => (lane.x ?? 0) + (lane.width ?? 0) / 2)),
      top: Math.min(...lanes.map((lane) => (lane.y ?? 0) - (lane.height ?? 0) / 2)),
      bottom: Math.max(...lanes.map((lane) => (lane.y ?? 0) + (lane.height ?? 0) / 2)),
    };
  };

  it('lists a band per phase that has nodes, in order, with the trailing band last', () => {
    const bands = computePhaseBands(laidOut(source('TB', 'subgraph l3\n  z\nend')));

    expect(bands.map(({ id, label }) => [id, label])).toEqual([
      ['p1', 'Intake'],
      ['p2', 'Review'],
      ['p3', 'Closeout'],
      ['', ''],
    ]);
  });

  it('tiles the lane area along the flow and puts the titles left of the lanes in TB', () => {
    const layout = laidOut(source('TB'));
    const lanes = laneBox(layout);

    const bands = computePhaseBands(layout);

    expect(bands[0]!.title.y).toBeCloseTo(lanes.top);
    expect(bands.at(-1)!.title.y + bands.at(-1)!.title.height).toBeCloseTo(lanes.bottom);
    for (const [index, band] of bands.slice(0, -1).entries()) {
      expect(band.title.y + band.title.height).toBeCloseTo(bands[index + 1]!.title.y);
      expect(band.separator?.y1).toBeCloseTo(bands[index + 1]!.title.y);
    }
    expect(bands.every((band) => band.title.x === lanes.left - PHASE_TITLE_THICKNESS)).toBe(true);
    expect(bands.every((band) => band.titleReadsUpward)).toBe(true);
    expect(bands.at(-1)?.separator).toBeUndefined();
  });

  it('puts the titles above the lanes in LR', () => {
    const layout = laidOut(source('LR'));
    const lanes = laneBox(layout);

    const bands = computePhaseBands(layout);

    expect(bands[0]!.title.x).toBeCloseTo(lanes.left);
    expect(bands.every((band) => band.title.y === lanes.top - PHASE_TITLE_THICKNESS)).toBe(true);
    expect(bands.some((band) => band.titleReadsUpward)).toBe(false);
  });

  it('has no bands when no node names a phase', () => {
    const layout = laidOut('swimlane-beta\nphase p1["One"]\nsubgraph l1\n  a\nend');

    expect(computePhaseBands(layout)).toEqual([]);
  });
});

describe('phase bands that must hold a title', () => {
  const LONG_TITLE = 900;
  const extentOf = (band: ReturnType<typeof computePhaseBands>[number]) =>
    band.titleReadsUpward ? band.title.height : band.title.width;

  it.each(DIRECTIONS)('grows a long first, middle and last title to fit in %s', (direction) => {
    for (const long of ['p1', 'p2', 'p3']) {
      const bands = computePhaseBands(laidOut(source(direction), {}, { [long]: LONG_TITLE }));

      const band = bands.find(({ id }) => id === long)!;
      expect(extentOf(band), `${direction} ${long}`).toBeGreaterThanOrEqual(LONG_TITLE - 0.5);
    }
  });

  it.each(DIRECTIONS)('keeps the neighbouring bands apart in %s', (direction) => {
    const bands = computePhaseBands(laidOut(source(direction), {}, { p2: LONG_TITLE }));
    const startOf = (band: (typeof bands)[number]) =>
      band.titleReadsUpward ? band.title.y : band.title.x;

    const ordered = [...bands].sort((a, b) => startOf(a) - startOf(b));
    for (const [index, band] of ordered.slice(0, -1).entries()) {
      expect(startOf(band) + extentOf(band)).toBeLessThanOrEqual(
        startOf(ordered[index + 1]!) + 0.5,
      );
    }
  });

  it('lays a diagram out as before when every title fits', () => {
    const plain = laidOut(source('TB'));
    const short = laidOut(source('TB'), {}, { p1: 10, p2: 10, p3: 10 });

    expect(short.nodes.map(({ id, x, y }) => [id, x, y])).toEqual(
      plain.nodes.map(({ id, x, y }) => [id, x, y]),
    );
  });

  it('lays out the same diagram twice with the same result', () => {
    const once = laidOut(source('LR'), {}, { p2: LONG_TITLE });
    const twice = laidOut(source('LR'), {}, { p2: LONG_TITLE });

    expect(once.nodes.map(({ id, x, y }) => [id, x, y])).toEqual(
      twice.nodes.map(({ id, x, y }) => [id, x, y]),
    );
  });
});

describe('a declared phase that no node uses', () => {
  const warned = (text: string) =>
    layoutSwimlanes(layoutDataOf(text, {}, {})).warnings.filter((m) => /phase/i.test(m));

  it('is named in a warning once, and draws no band', () => {
    const text = source('TB').replace(
      'phase p3["Closeout"]',
      'phase p3["Closeout"]\nphase p4["Spare"]',
    );

    const messages = warned(text);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"p4"');
    expect(computePhaseBands(laidOut(text)).map(({ id }) => id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('is named even when no node uses any phase', () => {
    const messages = warned('swimlane-beta\nphase p1["One"]\nsubgraph l1\n  a\nend');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"p1"');
  });

  it('stays quiet when every phase has a node', () => {
    expect(warned(source('TB'))).toEqual([]);
  });
});

describe('painting phase bands', () => {
  /** The classes of the root's children, in order, as the plugin writes them. */
  const layers = (svg: string) => {
    const found: string[] = [];
    let depth = 0;
    for (const tag of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      const [, closing, , attrs, selfClosing] = tag;
      if (closing) {
        depth--;
        continue;
      }
      if (depth === 1) {
        const cls = /class="([^"]+)"/.exec(attrs ?? '')?.[1];
        if (cls && tag[2] === 'g') found.push(cls);
      }
      if (!selfClosing) depth++;
    }
    return found;
  };
  const count = (svg: string, cls: string) =>
    [...svg.matchAll(new RegExp(`class="${cls}"`, 'g'))].length;
  const labels = (svg: string, cls: string) =>
    [...svg.matchAll(new RegExp(`class="${cls}"[^>]*>(?:<tspan[^>]*>)?([^<]*)`, 'g'))].map(
      (m) => m[1],
    );

  it('draws one titled cell per band and a separator between bands, above the lanes and under the edges', async () => {
    const svg = await renderText(source('TB'));

    expect(layers(svg)).toEqual([
      'swimlanes',
      'clusters',
      'swimlane-phases',
      'edgePaths',
      'edgeLabels',
      'nodes',
    ]);
    expect(count(svg, 'swimlane-phase')).toBe(3);
    expect(count(svg, 'swimlane-phase-separator')).toBe(2);
    expect(labels(svg, 'cluster-label swimlane-phase-label')).toEqual([
      'Intake',
      'Review',
      'Closeout',
    ]);
  });

  it('turns the labels upward in the left strip of a TB diagram and not in LR', async () => {
    const turned = (svg: string) =>
      [...svg.matchAll(/<g transform="([^"]*)"><text class="cluster-label swimlane-phase-label/g)]
        .length;

    expect(turned(await renderText(source('TB')))).toBe(3);
    expect(turned(await renderText(source('LR')))).toBe(0);
  });

  it('draws nothing for a diagram without phases', async () => {
    const svg = await renderText('swimlane-beta\nsubgraph l1\n  a\nend');

    expect(count(svg, 'swimlane-phases')).toBe(0);
  });

  it.each([
    ['an ampersand', '"R&D"', 'R&amp;D'],
    ['markdown', '"`**Bold** start`"', 'Bold'],
  ])('draws %s the way a lane title does', async (_name, title, shown) => {
    const phase = await renderText(
      `swimlane-beta TB\nphase p1[${title}]\nsubgraph l1\n  a@{ phase: p1 }\nend`,
    );
    const lane = await renderText(`swimlane-beta\nsubgraph l1[${title}]\n  a\nend`);

    expect(labels(phase, 'cluster-label swimlane-phase-label')[0]).toBe(shown);
    expect(labels(lane, 'cluster-label swimlane-label')[0]).toBe(shown);
  });
});
