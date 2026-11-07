/**
 * Every bpmn-beta fixture rendered through mermaid 13.0.0-alpha.1 in Node, with no DOM (v12's
 * `bpmn.docs.spec.ts` rendered the documentation examples the same way, in jsdom): it renders,
 * its SVG passes core's allow-list, every theme alias it uses is declared, every label is in
 * it, every flow is drawn, no two elements overlap, and every element sits inside the pool or lane that holds it.
 * The layout is read through an extension's `postLayout` hook.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertInert } from '@mermaid-js/core/svg';
import { createMermaid } from 'mermaid';
import type { ExtensionPlugin } from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import { undeclaredAliases } from '../harness/lib/svg-checks.mjs';
import { bpmn, parseBpmn } from '../packages/diagram-bpmn/src/index.ts';
import type { BpmnLayout } from '../packages/diagram-bpmn/src/index.ts';

const FIXTURES = join(import.meta.dirname, '../packages/diagram-bpmn/fixtures');
const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.mmd'))
  .sort();

let captured: BpmnLayout | undefined;
const capture: ExtensionPlugin = {
  id: 'capture-bpmn-layout',
  postLayout(laidOut) {
    captured = laidOut.layout as BpmnLayout;
    return laidOut;
  },
};

/** Read through a call, so TypeScript does not narrow it to what the test last assigned. */
const laidOut = (): BpmnLayout | undefined => captured;

let api: ReturnType<typeof createMermaid>;
beforeAll(async () => {
  api = createMermaid();
  api.initialize({ discovery: false });
  await api.registerExternalDiagrams([bpmn]);
  await api.registerExternalDiagrams([capture]);
});

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (svg: string) => svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Overlap by more than rounding. */
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

describe.each(files)('%s', (file) => {
  const text = readFileSync(join(FIXTURES, file), 'utf8');
  const model = parseBpmn(text).model;

  it('renders an inert SVG with every theme alias declared and every label in it', async () => {
    captured = undefined;
    const r = await api.render('bpmntest', text);
    expect(r.diagramType).toBe('bpmn');
    expect(() => {
      assertInert(r.svg, { themeStyle: false });
    }).not.toThrow();
    expect(undeclaredAliases(r.svg)).toEqual([]);
    const words = textOf(r.svg);
    for (const node of model.nodes) {
      for (const word of node.label.split(/\s+/).filter(Boolean)) {
        expect(words, `${node.id}: ${word}`).toContain(xml(word));
      }
    }
    for (const flow of model.flows) {
      for (const word of (flow.label ?? '').split(/\s+/).filter(Boolean)) {
        expect(words).toContain(xml(word));
      }
    }
    expect(captured).toBeDefined();
    // Every flow is routed and drawn: one edge group with a line per flow.
    expect(laidOut()?.flows.length).toBe(model.flows.length);
    expect([...r.svg.matchAll(/<g class="edge bpmn-flow[^"]*"><path /g)].length).toBe(
      model.flows.length,
    );
  });

  it('lays no element over another and keeps each in its pool or lane', () => {
    const layout = captured;
    expect(layout).toBeDefined();
    if (!layout) return;
    // A boundary event sits on its activity's border by design.
    const free = layout.nodes.filter((n) => n.node.keyword !== 'boundary');
    for (const [i, a] of free.entries()) {
      for (const b of free.slice(i + 1)) {
        expect(overlaps(a.box, b.box), `${a.node.id} / ${b.node.id}`).toBe(false);
      }
    }
    const bands = new Map(layout.bands.map((band) => [band.node.id, band.box]));
    const parentOf = new Map(model.nodes.map((n) => [n.id, n.parentId]));
    for (const n of free) {
      let up = n.node.parentId;
      while (up !== undefined && !bands.has(up)) up = parentOf.get(up);
      const band = up === undefined ? undefined : bands.get(up);
      if (band) expect(inside(n.box, band), `${n.node.id} in ${up ?? ''}`).toBe(true);
    }
  });
});
