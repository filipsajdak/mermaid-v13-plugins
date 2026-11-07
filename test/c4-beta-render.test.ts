/**
 * Every c4-beta fixture rendered through mermaid 13.0.0-alpha.1 in Node, with no DOM: it
 * renders, its SVG passes core's allow-list, every theme alias it uses is declared, every
 * element's name is in it, and the layout has no element overlapping another or leaving its
 * boundary. The layout is read through an extension's `postLayout` hook.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertInert } from '@mermaid-js/core/svg';
import { createMermaid } from 'mermaid';
import type { ExtensionPlugin } from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import { undeclaredAliases } from '../harness/lib/svg-checks.mjs';
import {
  boundaryIds,
  c4Beta,
  c4BetaCompat,
  detector,
  parseC4Beta,
} from '../packages/diagram-c4-beta/src/index.ts';
import type { C4BetaLayout as C4Layout } from '../packages/diagram-c4-beta/src/index.ts';

const FIXTURES = join(import.meta.dirname, '../packages/diagram-c4-beta/fixtures');
const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.mmd'))
  .sort();

let captured: C4Layout | undefined;
const capture: ExtensionPlugin = {
  id: 'capture-layout',
  postLayout(laidOut) {
    captured = laidOut.layout as C4Layout;
    return laidOut;
  },
};

let api: ReturnType<typeof createMermaid>;
beforeAll(async () => {
  api = createMermaid();
  api.initialize({ discovery: false });
  await api.registerExternalDiagrams([c4Beta, c4BetaCompat, capture]);
});

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The text of an SVG, tags dropped, whitespace collapsed. */
const textOf = (svg: string) => svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const box = (b: { x: number; y: number; width: number; height: number }): Box => ({
  left: b.x - b.width / 2,
  right: b.x + b.width / 2,
  top: b.y - b.height / 2,
  bottom: b.y + b.height / 2,
});
/** Overlap by more than rounding. */
const overlaps = (a: Box, b: Box) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;
const inside = (inner: Box, outer: Box) =>
  inner.left >= outer.left - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.bottom <= outer.bottom + 0.5;

describe.each(files)('%s', (file) => {
  const text = readFileSync(join(FIXTURES, file), 'utf8');
  const model = parseC4Beta(text).model;
  const groupsOf = boundaryIds(model);

  it('renders an inert SVG with every theme alias declared and every element named', async () => {
    captured = undefined;
    const r = await api.render('c4test', text);
    expect(r.diagramType).toBe('c4-beta');
    expect(() => {
      assertInert(r.svg, { themeStyle: false });
    }).not.toThrow();
    expect(undeclaredAliases(r.svg)).toEqual([]);
    const words = textOf(r.svg);
    for (const el of model.elements) {
      for (const word of el.name.split(/\s+/).filter(Boolean)) expect(words).toContain(xml(word));
    }
    const layout = captured as C4Layout | undefined;
    expect(layout).toBeDefined();
    if (!layout) return;
    expect(layout.elements.map((e) => e.id).sort()).toEqual(
      model.elements
        .filter((e) => !groupsOf.has(e.id))
        .map((e) => e.id)
        .sort(),
    );

    // No element overlaps another.
    const boxes = layout.elements.map((e) => ({ alias: e.id, box: box(e) }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1))
        expect(overlaps(a.box, b.box), `${a.alias} overlaps ${b.alias}`).toBe(false);
    }
    // Each element sits in its boundary, each boundary in its parent.
    const groups = new Map(layout.groups.map((b) => [b.id, box(b)]));
    for (const el of model.elements) {
      const own = boxes.find((b) => b.alias === el.id)?.box ?? groups.get(el.id);
      const parent = el.parent === undefined ? undefined : groups.get(el.parent);
      if (own && parent)
        expect(inside(own, parent), `${el.id} leaves ${el.parent ?? ''}`).toBe(true);
    }
    // Every relationship between declared things has a route.
    const known = new Set(model.elements.map((x) => x.id));
    const drawable = model.relationships.filter(
      (r) => known.has(r.source) && known.has(r.target),
    ).length;
    expect(layout.edges).toHaveLength(drawable);
  });
});

async function render(text: string): Promise<{ svg: string; warnings: string[] }> {
  const other = createMermaid();
  other.initialize({ discovery: false });
  await other.registerExternalDiagrams([c4Beta, c4BetaCompat]);
  const r = await other.render('c4b', text);
  return { svg: r.svg, warnings: r.warnings.map((w) => w.code) };
}
const count = (svg: string, needle: string) => svg.split(needle).length - 1;

// The converged build's `c4-beta/db.spec.ts` checks of `getData`, on the rendered SVG.
describe('db.spec: getData, checked on the rendered SVG', () => {
  it('draws the stereotype, name, technology and description of an element', async () => {
    const { svg } = await render('c4-beta container\n container api "API" "Serves JSON" "Go"');
    expect(textOf(svg)).toContain('«Container»');
    expect(textOf(svg)).toContain('[Go]');
    expect(textOf(svg)).toContain('Serves JSON');
  });
  it('escapes markup in user text', async () => {
    const { svg } = await render('c4-beta context\n person a "<b>A & B</b>"');
    expect(svg).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
  });
  it('draws an element with children, a group and a deployment node as boundaries', async () => {
    const { svg } = await render(
      'c4-beta deployment\n deploymentNode n "Node"\n group g "Group"\n softwareSystem s "S" {\n container c "C"\n }',
    );
    expect(count(svg, 'class="c4-boundary')).toBe(3);
  });
  it('draws an infrastructureNode as a leaf box', async () => {
    const { svg } = await render('c4-beta deployment\n infrastructureNode lb "LB"');
    expect(svg).toContain('class="c4-shape c4-infrastructureNode"');
  });
  it('draws arrowheads as the arrow says', async () => {
    const heads = async (arrow: string) =>
      count(
        (await render(`c4-beta context\n person a "A"\n person b "B"\n a ${arrow} b`)).svg,
        'class="c4-arrowhead"',
      );
    expect([
      await heads('-->'),
      await heads('<--'),
      await heads('<-->'),
      await heads('---'),
    ]).toEqual([1, 1, 2, 0]);
  });
  it('maps shape:cylinder to a cylinder and applies tag colours', async () => {
    const { svg } = await render(
      'c4-beta container\n style db shape:cylinder, fill:#ff0000\n container d "DB" :::db',
    );
    expect(svg).toMatch(/<path[^>]*fill="#ff0000"/);
  });
  it('adds tag classes even for tags without styles', async () => {
    expect((await render('c4-beta context\n person a "A" :::vip')).svg).toContain('c4-tag-vip');
  });
  it('numbers dynamic relationships, an explicit step resetting the count', async () => {
    const { svg } = await render(
      'c4-beta dynamic\n container a "A"\n container b "B"\n a --> b : "one"\n 5: b --> a : "five"\n a --> b : "six"\n 5: a --> b',
    );
    const text = textOf(svg);
    expect(text).toContain('1. one');
    expect(text).toContain('5. five');
    expect(text).toContain('6. six');
    expect(text).toMatch(/ 5\. /);
  });
  it('ignores step numbers in non-dynamic diagrams', async () => {
    expect(
      textOf(
        (await render('c4-beta context\n person a "A"\n person b "B"\n 1: a --> b : "Uses"')).svg,
      ),
    ).not.toContain('1.');
  });
  it('draws an instance badge on a deployment node', async () => {
    expect(
      textOf(
        (await render('c4-beta deployment\n deploymentNode ec2 "EC2" "" "Ubuntu" instances "1..N"'))
          .svg,
      ),
    ).toContain('EC2 x1..N');
  });
  it('warns about a relationship between two boundaries', async () => {
    const { warnings: w } = await render(
      'c4-beta deployment\n deploymentNode a "A"\n deploymentNode b "B"\n a --> b',
    );
    expect(w).toContain('C4B_CLUSTER_TO_CLUSTER');
  });
});

describe('db.spec: legend', () => {
  it('is drawn by default and not with legend off', async () => {
    expect((await render('c4-beta context\n person a "A"')).svg).toContain('class="c4-legend"');
    expect((await render('c4-beta context\n legend off\n person a "A"')).svg).not.toContain(
      'class="c4-legend"',
    );
  });
  it('lists each kind once, externals apart, skipping groups and nodes, then each style tag', async () => {
    const { svg } = await render(
      'c4-beta context\n person a "A"\n person b "B"\n softwareSystem s "S" :::external\n group g "G"\n style hot fill:#f00',
    );
    const legend = textOf(svg.slice(svg.indexOf('<g class="c4-legend"')));
    expect(legend.trim().split(' ').filter(Boolean)).toEqual([
      'Legend',
      'person',
      'external',
      'softwareSystem',
      'hot',
    ]);
  });
});

describe('db.spec: config', () => {
  const person = 'c4-beta context\n person p "P"\n softwareSystem s "S"\n';
  const withConfig = (yaml: string) => `---\nconfig:\n${yaml}\n---\n${person}`;
  it('shows every stereotype by default, none with showStereotypes false', async () => {
    expect(textOf((await render(person)).svg)).toContain('«Person»');
    const { svg } = await render(withConfig('  c4-beta:\n    showStereotypes: false'));
    expect(textOf(svg)).not.toContain('«');
  });
  it('hides the stereotype on the kinds hideStereotypes names', async () => {
    const text = textOf(
      (await render(withConfig('  c4-beta:\n    hideStereotypes: [person]'))).svg,
    );
    expect(text).not.toContain('«Person»');
    expect(text).toContain('«Software System»');
  });
  it("takes v12's c4beta section through c4BetaCompat, and drops it without", async () => {
    const yaml = '  c4beta:\n    hideStereotypes: [person]';
    const r = await render(withConfig(yaml));
    expect(r.warnings).toEqual([]);
    expect(textOf(r.svg)).not.toContain('«Person»');
    const bare = createMermaid();
    bare.initialize({ discovery: false });
    await bare.registerExternalDiagrams([c4Beta]);
    const dropped = await bare.render('c4b', withConfig(yaml));
    expect(dropped.warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_KEY']);
    expect(textOf(dropped.svg)).toContain('«Person»');
  });
  it('wraps a person label at personWrappingWidth', async () => {
    const long = 'c4-beta context\n person p "A rather long person name to wrap"\n';
    const lines = (svg: string) => count(svg.slice(svg.indexOf('class="c4-name"')), '<tspan');
    const narrow = await render(
      `---\nconfig:\n  c4-beta:\n    personWrappingWidth: 60\n---\n${long}`,
    );
    expect(lines(narrow.svg)).toBeGreaterThan(lines((await render(long)).svg));
  });
});

describe('lazy registration', () => {
  const pkg: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '../packages/diagram-c4-beta/package.json'), 'utf8'),
  );
  const manifest: unknown =
    typeof pkg === 'object' && pkg !== null && 'mermaid' in pkg ? pkg.mermaid : undefined;
  const load = () => import('../packages/diagram-c4-beta/src/index.ts');
  it.each([
    [
      'a loader that returns the plugin',
      { id: 'c4-beta', detector, loader: () => Promise.resolve(c4Beta) },
    ],
    ['a loader that returns the package namespace', { id: 'c4-beta', detector, loader: load }],
    ["the package's mermaid manifest", { manifest, detector, load }],
  ] as const)('loads the plugin through %s', async (_, def) => {
    const lazy = createMermaid();
    lazy.initialize({ discovery: false });
    await lazy.registerExternalDiagrams([def, c4BetaCompat]);
    const r = await lazy.render('c4b', 'c4-beta context\n person p "Lazy person"\n');
    expect(r.diagramType).toBe('c4-beta');
    expect(textOf(r.svg)).toContain('Lazy person');
  });
});

describe('theme', () => {
  // The converged build's renderer.spec "should emit theme-driven css": here, theme aliases.
  const text = 'c4-beta context\n person p "P"\n';
  it('paints with the C4 theme variables when c4BetaCompat is registered', async () => {
    const { svg } = await render(text);
    expect(svg).toContain('stroke="var(--_c4PersonBorder)"');
    expect(svg).toContain('--_c4PersonBorder:var(--mermaid-c4PersonBorder,#073B6F)');
    expect(undeclaredAliases(svg)).toEqual([]);
  });
  it('paints the same colours as literals without it', async () => {
    const bare = createMermaid();
    bare.initialize({ discovery: false });
    await bare.registerExternalDiagrams([c4Beta]);
    const { svg, warnings } = await bare.render('c4b', text);
    expect(warnings).toEqual([]);
    expect(svg).toContain('stroke="#073B6F"');
    expect(svg).not.toContain('c4PersonBorder');
    expect(undeclaredAliases(svg)).toEqual([]);
  });
});

describe('determinism', () => {
  it('draws the same SVG on two fresh API objects', async () => {
    const text = readFileSync(join(FIXTURES, 'docs-11.mmd'), 'utf8');
    const once = async () => {
      const other = createMermaid();
      other.initialize({ discovery: false });
      await other.registerExternalDiagrams([c4Beta, c4BetaCompat]);
      return (await other.render('same-id', text)).svg;
    };
    expect(await once()).toBe(await once());
  });
});
