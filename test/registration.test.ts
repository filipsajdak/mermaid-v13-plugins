/**
 * How mermaid 13.0.0-alpha.1 registers, discovers and detects a plugin for the legacy C4
 * types. These pin the alpha's behaviour as it is, including what we report upstream, so a
 * later alpha that changes it fails here first.
 */
import { createMermaid } from 'mermaid';
import { describe, expect, it } from 'vitest';
import { placeholderPlugin } from '../harness/fixtures/placeholder-plugin.mjs';
import { c4 } from '../packages/diagram-c4/src/index.ts';

/** An API object with Node discovery off, so `node_modules` does not change what it detects. */
function fresh() {
  const api = createMermaid();
  api.initialize({ discovery: false });
  return api;
}

/** A stand-in for a C4 plugin: id `c4`, an anchored detector, draws its lines as boxes. */
const c4Probe = placeholderPlugin({ id: 'c4', keyword: 'C4Context' });

/** Stand-ins for the beta diagrams, which register under new ids after every first-party row. */
const c4BetaProbe = placeholderPlugin({ id: 'c4-beta', keyword: 'c4-beta' });
const bpmnBetaProbe = placeholderPlugin({ id: 'bpmn-beta', keyword: 'bpmn-beta' });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).name;
  }
}

describe('explicit registration of the c4 id', () => {
  it('draws nothing for C4 text before a plugin is registered', async () => {
    const api = fresh();
    await expect(api.render('d', 'C4Context\n')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DIAGRAM',
      message: 'Diagram type "c4" is not supported by this version of mermaid.',
    });
  });

  it('refuses the first-party id c4 without replace', async () => {
    const api = fresh();
    await expect(api.registerExternalDiagrams([c4Probe])).rejects.toThrow(
      '"c4" is a first-party diagram id or type; pass { replace: true } to replace it',
    );
  });

  it('puts a plugin registered with replace: true in the c4 slot', async () => {
    const api = fresh();
    await api.registerExternalDiagrams([c4Probe], { replace: true });
    expect(api.detectType('C4Context\n  Box')).toBe('c4');
    const r = await api.render('d', 'C4Context\n  Box');
    expect(r.diagramType).toBe('c4');
    expect(r.svg).toContain('>Box</text>');
  });

  it('registers our diagram-c4 package the same way', async () => {
    const api = fresh();
    await api.registerExternalDiagrams([c4], { replace: true });
    expect(api.detectType('C4Container\n')).toBe('c4');
    expect(api.supportsFormat('c4', 'svg')).toBe(true);
    const r = await api.render('d', 'C4Container\n  Container(api, "API", "Go")');
    expect(r.diagramType).toBe('c4');
    expect(r.svg).toContain('>API</');
    // A parse error comes back as a syntax error with its line and column, as in v12.
    await expect(api.render('d', 'C4Container\n')).rejects.toMatchObject({ code: 'SYNTAX' });
  });

  it('does not look plugin aliases up: only the id and the first-party type are names', async () => {
    const api = fresh();
    await api.registerExternalDiagrams([c4], { replace: true });
    expect(c4.aliases).toContain('C4Context');
    expect(api.supportsFormat('C4Context', 'svg')).toBe(false);
    expect(await codeOf(api.preload({ types: ['C4Context'] }))).toBe('UNSUPPORTED_DIAGRAM');
  });
});

describe('detection order: the first-party c4 row is unanchored', () => {
  const label = {
    'c4-beta': 'c4-beta context\n  person u "User" "Reads the C4Container docs"',
    'bpmn-beta': 'bpmn-beta\n  task t "Draw a C4Container view"',
  };
  const comment = {
    'c4-beta': 'c4-beta context\n  %% C4Container\n  person u "User"',
    'bpmn-beta': 'bpmn-beta\n  %% C4Container\n  task t "Draw"',
  };

  for (const id of ['c4-beta', 'bpmn-beta'] as const) {
    it(`takes ${id} text that names C4Container in a label for c4 (as v12.3.0 does)`, async () => {
      const api = fresh();
      await api.registerExternalDiagrams([c4BetaProbe, bpmnBetaProbe]);
      expect(api.detectType(label[id])).toBe('c4');
      expect(await codeOf(api.render('d', label[id]))).toBe('UNSUPPORTED_DIAGRAM');
    });

    it(`takes ${id} text with a %% C4Container comment for c4 (v12.3.0 strips comments first)`, async () => {
      const api = fresh();
      await api.registerExternalDiagrams([c4BetaProbe, bpmnBetaProbe]);
      expect(api.detectType(comment[id])).toBe('c4');
    });

    it(`detects ${id} once an anchored c4 plugin replaces the row`, async () => {
      const api = fresh();
      await api.registerExternalDiagrams([c4BetaProbe, bpmnBetaProbe]);
      await api.registerExternalDiagrams([c4], { replace: true });
      expect(api.detectType(label[id])).toBe(id);
      expect(api.detectType(comment[id])).toBe(id);
    });
  }

  // First-party types detected after the c4 row (v12 order, which v13 keeps).
  const firstParty = [
    ['classDiagram', 'classDiagram\n  class C4Deployment'],
    ['er', 'erDiagram\n  C4Container ||--o{ B : x'],
    ['sequence', 'sequenceDiagram\n  A->>B: C4Component'],
    ['flowchart-v2', 'flowchart LR\n  A[C4Container] --> B'],
    ['stateDiagram', 'stateDiagram-v2\n  s1: C4Dynamic'],
  ] as const;

  for (const [type, text] of firstParty) {
    it(`takes a ${type} that names a C4 keyword in a label for c4, and not once replaced`, async () => {
      const api = fresh();
      expect(api.detectType(text)).toBe('c4');
      await api.registerExternalDiagrams([c4], { replace: true });
      expect(api.detectType(text)).toBe(type);
    });
  }

  it('takes a flowchart with a %% C4Container comment for c4 (v12.3.0: flowchart-v2)', () => {
    const api = fresh();
    expect(api.detectType('flowchart LR\n  %% C4Container\n  A --> B')).toBe('c4');
    // A comment before the keyword is skipped by diagramStart, so it does not hijack.
    expect(api.detectType('%% C4Container\nflowchart LR\n  A --> B')).toBe('flowchart-v2');
  });
});
