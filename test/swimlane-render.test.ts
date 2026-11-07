/**
 * Every swimlane-beta fixture rendered through mermaid 13.0.0-alpha.1 in Node, with no DOM: it
 * renders as a swimlane diagram, its SVG passes core's allow-list, every theme alias it uses is
 * declared, every node and edge label is in it, and every edge of the model is routed and drawn.
 * The layout is read through an extension's `postLayout` hook.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertInert } from '@mermaid-js/core/svg';
import { createMermaid } from 'mermaid';
import type { ExtensionPlugin } from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import { undeclaredAliases } from '../harness/lib/svg-checks.mjs';
import { parseSwimlane, swimlane } from '../packages/diagram-swimlane/src/index.ts';
import type { SwimlaneLayout } from '../packages/diagram-swimlane/src/index.ts';

const FIXTURES = join(import.meta.dirname, '../packages/diagram-swimlane/fixtures');
const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.mmd'))
  .sort();

let captured: SwimlaneLayout | undefined;
const capture: ExtensionPlugin = {
  id: 'capture-swimlane-layout',
  postLayout(laidOut) {
    captured = laidOut.layout as SwimlaneLayout;
    return laidOut;
  },
};

/** Read through a call, so TypeScript does not narrow it to what the test last assigned. */
const laidOut = (): SwimlaneLayout | undefined => captured;

let api: ReturnType<typeof createMermaid>;
beforeAll(async () => {
  api = createMermaid();
  api.initialize({ discovery: false });
  await api.registerExternalDiagrams([swimlane], { replace: true });
  await api.registerExternalDiagrams([capture]);
});

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (svg: string) => svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
/** The words of a label as drawn: markup, `<br>` and markdown marks dropped. */
const wordsOf = (label: string) =>
  label
    .replace(/<br\s*\/?>|\\n/gi, ' ')
    .replace(/\*\*|[`"]/g, '')
    .split(/\s+/)
    .filter(Boolean);

describe.each(files)('%s', (file) => {
  const text = readFileSync(join(FIXTURES, file), 'utf8');
  const { model } = parseSwimlane(text);

  it('renders every label and routes every edge', async () => {
    captured = undefined;
    const r = await api.render('swimlanetest', text);
    expect(r.diagramType).toBe('swimlane');
    expect(() => {
      assertInert(r.svg, { themeStyle: false });
    }).not.toThrow();
    expect(undeclaredAliases(r.svg)).toEqual([]);
    const words = textOf(r.svg);
    for (const v of model.flow.vertices) {
      for (const word of wordsOf(v.text)) expect(words, `${v.id}: ${word}`).toContain(xml(word));
    }
    for (const e of model.flow.edges) {
      for (const word of wordsOf(e.text)) expect(words, `${e.id}: ${word}`).toContain(xml(word));
    }
    const layout = laidOut();
    expect(layout).toBeDefined();
    if (!layout) return;
    expect(layout.edges.size).toBe(model.flow.edges.length);
    const drawn = [...r.svg.matchAll(/<g class="edge [^"]*"[^>]*><path /g)].length;
    expect(drawn).toBe(model.flow.edges.filter((e) => e.stroke !== 'invisible').length);
  });
});
