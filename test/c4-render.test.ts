/**
 * Every legacy C4 fixture rendered through mermaid 13.0.0-alpha.1 in Node, with no DOM: it
 * renders, its SVG passes core's allow-list, every theme alias it uses is declared, every
 * element's name is in it, and the layout has no element overlapping another or leaving its
 * boundary. The layout is read through an extension's `postLayout` hook.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertInert } from '@mermaid-js/core/svg';
import elkLayouts from '@mermaid-js/layout-elk';
import { createMermaid } from 'mermaid';
import type { ExtensionPlugin } from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import { undeclaredAliases } from '../harness/lib/svg-checks.mjs';
import { c4, c4Compat, parseC4 } from '../packages/diagram-c4/src/index.ts';
import type { C4Layout } from '../packages/diagram-c4/src/index.ts';

const FIXTURES = join(import.meta.dirname, '../packages/diagram-c4/fixtures');
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
  await api.registerExternalDiagrams([c4], { replace: true });
  await api.registerExternalDiagrams([capture]);
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
  const model = parseC4(text).model;

  it('renders an inert SVG with every theme alias declared and every element named', async () => {
    captured = undefined;
    const r = await api.render('c4test', text);
    expect(r.diagramType).toBe('c4');
    expect(() => {
      assertInert(r.svg, { themeStyle: false });
    }).not.toThrow();
    expect(undeclaredAliases(r.svg)).toEqual([]);
    const words = textOf(r.svg);
    for (const el of model.elements) {
      for (const word of el.label.split(/\s+/).filter(Boolean)) expect(words).toContain(xml(word));
    }
    const layout = captured as C4Layout | undefined;
    expect(layout).toBeDefined();
    if (!layout) return;
    expect(layout.elements.map((e) => e.id).sort()).toEqual(
      model.elements.map((e) => e.alias).sort(),
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
      const own = boxes.find((b) => b.alias === el.alias)?.box;
      const parent = el.parent === undefined ? undefined : groups.get(el.parent);
      if (own && parent)
        expect(inside(own, parent), `${el.alias} leaves ${el.parent ?? ''}`).toBe(true);
    }
    for (const b of model.boundaries) {
      const own = groups.get(b.alias);
      const parent = b.parent === undefined ? undefined : groups.get(b.parent);
      if (own && parent)
        expect(inside(own, parent), `${b.alias} leaves ${b.parent ?? ''}`).toBe(true);
    }
    // Every relationship between declared things has a route.
    const known = new Set([...model.elements, ...model.boundaries].map((x) => x.alias));
    const drawable = model.rels.filter((r) => known.has(r.from) && known.has(r.to)).length;
    expect(layout.edges).toHaveLength(drawable);
  });
});

describe('with @mermaid-js/layout-elk', () => {
  it('lays C4 out with ELK when the layout config names it', async () => {
    const other = createMermaid();
    other.registerLayoutLoaders(elkLayouts);
    other.initialize({ discovery: false, layout: 'elk' });
    await other.registerExternalDiagrams([c4], { replace: true });
    const text = readFileSync(join(FIXTURES, 'regression-boundary-direction.mmd'), 'utf8');
    const r = await other.render('elk', text);
    expect(r.warnings.map((w) => w.code)).toEqual([]);
    expect(r.svg).toContain('>Warehouse</');
  });
});

describe('determinism', () => {
  it('draws the same SVG on two fresh API objects', async () => {
    const text = readFileSync(join(FIXTURES, 'docs-1.mmd'), 'utf8');
    const once = async () => {
      const other = createMermaid();
      other.initialize({ discovery: false });
      await other.registerExternalDiagrams([c4], { replace: true });
      return (await other.render('same-id', text)).svg;
    };
    expect(await once()).toBe(await once());
  });
});

describe('config the alpha drops', () => {
  // The converged build adds `c4.showStereotypes` and `c4.boundaryDirection`. The alpha's schema
  // has neither; the plugin's `configDefaults` cannot add a key, and an extension's config
  // fragment may not touch a core section. Pinned so a later alpha that allows it shows here.
  it('drops c4.showStereotypes from front matter with CONFIG_UNKNOWN_KEY', async () => {
    const r = await api.render(
      'cfg',
      '---\nconfig:\n  c4:\n    showStereotypes: false\n---\nC4Context\nPerson(a, "A")',
    );
    expect(r.warnings).toContainEqual(
      expect.objectContaining({
        code: 'CONFIG_UNKNOWN_KEY',
        message: 'Unknown config key "c4.showStereotypes"; ignored.',
      }),
    );
    expect(r.svg).toContain('[Person]');
  });

  it('refuses a config fragment that declares keys in the c4 section', async () => {
    const other = createMermaid();
    other.initialize({ discovery: false });
    await expect(
      other.registerExternalDiagrams([
        { id: 'c4-keys', config: { id: 'c4-keys', keys: { c4: { showStereotypes: 0 } } } },
      ]),
    ).rejects.toThrow('Config fragment "c4-keys": "c4" is a core config key');
  });

  describe('with c4Compat', () => {
    const withCompat = async (init: Record<string, unknown> = {}) => {
      const other = createMermaid();
      other.initialize({ discovery: false, ...init });
      await other.registerExternalDiagrams([c4], { replace: true });
      await other.registerExternalDiagrams([c4Compat, capture]);
      return other;
    };

    it('takes c4.showStereotypes from front matter and from initialize', async () => {
      const fromFrontMatter = await (
        await withCompat()
      ).render(
        'cfg',
        '---\nconfig:\n  c4:\n    showStereotypes: false\n---\nC4Context\nPerson(a, "A")',
      );
      expect(fromFrontMatter.warnings).toEqual([]);
      expect(fromFrontMatter.svg).not.toContain('[Person]');
      const fromInitialize = await (
        await withCompat({ c4: { showStereotypes: false } })
      ).render('cfg', 'C4Context\nPerson(a, "A")');
      expect(fromInitialize.warnings).toEqual([]);
      expect(fromInitialize.svg).not.toContain('[Person]');
    });

    it('takes c4.boundaryDirection for a boundary that sets no direction', async () => {
      const source = (direction: string) =>
        `---\nconfig:\n  c4:\n    boundaryDirection: ${direction}\n---\nC4Context\nBoundary(b, "B") {\n  Person(p, "P")\n  Person(q, "Q")\n  Rel(p, q, "Calls")\n}`;
      const placed = async (direction: string) => {
        captured = undefined;
        const r = await (await withCompat()).render('dir', source(direction));
        expect(r.warnings).toEqual([]);
        const [p, q] = ['p', 'q'].map((id) => captured?.elements.find((e) => e.id === id));
        return { p, q };
      };
      const lr = await placed('LR');
      expect(lr.p?.y).toBe(lr.q?.y);
      expect(lr.p?.x).not.toBe(lr.q?.x);
      const tb = await placed('TB');
      expect(tb.p?.x).toBe(tb.q?.x);
      expect(tb.p?.y).not.toBe(tb.q?.y);
    });
  });
});

describe('repeated aliases', () => {
  it('draws a boundary that shares its alias with an element, and warns', async () => {
    const r = await api.render(
      'dup',
      'C4Context\nPerson(a, "Alone")\nBoundary(a, "Box") {\n  Person(p, "Inside")\n}\n',
    );
    expect(r.warnings.map((w) => w.code)).toEqual(['C4_DUPLICATE_ID']);
    expect(r.svg).toContain('Box');
    expect(r.svg).toContain('Inside');
  });
});
