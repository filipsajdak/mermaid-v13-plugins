import { LineIndex } from '@mermaid-js/core/parser-kit';
import { describe, expect, it } from 'vitest';
import { detector } from '../src/detector.ts';
import { c4Language } from '../src/language.ts';
import { parseC4 } from '../src/parser/index.ts';

describe('detector', () => {
  it.each(['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'])(
    'accepts %s as the first word',
    (kind) => {
      expect(detector(`${kind}\n  title x`)).toBe(true);
      expect(detector(`  ${kind}`)).toBe(true);
    },
  );

  it('does not take a keyword that appears later in another diagram', () => {
    expect(detector('flowchart LR\n  A[C4Container] --> B')).toBe(false);
    expect(detector('c4-beta context\n  person u "C4Context"')).toBe(false);
  });

  it('needs the whole keyword', () => {
    expect(detector('C4Contextual')).toBe(false);
    expect(detector('C4Context-beta')).toBe(false);
  });
});

describe('parseC4 (stage 0)', () => {
  it('reports the diagram as not ported, at the keyword, with its line and column', () => {
    const text = '---\ntitle: T\n---\n%% note\nC4Dynamic\n  Person(a, "A")\n';
    const r = parseC4(text);
    expect(r.model.kind).toBe('C4Dynamic');
    expect(r.diagnostics).toHaveLength(1);
    const [d] = r.diagnostics;
    expect(d).toMatchObject({ severity: 'error', code: 'C4_NOT_PORTED' });
    expect(text.slice(d!.range.start, d!.range.end)).toBe('C4Dynamic');
    expect(new LineIndex(text).position(d!.range.start)).toEqual({ line: 4, column: 0 });
  });

  it('reports a missing keyword instead of throwing', () => {
    const r = parseC4('graph TD\n');
    expect(r.model.kind).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['C4_NO_KEYWORD']);
  });

  it('never throws on any text', () => {
    for (const text of ['', '\u0000', 'C4Context', '%%{init: {}}%%\nC4Context', '---\n']) {
      expect(() => parseC4(text)).not.toThrow();
    }
  });
});

describe('language facet', () => {
  it('returns the parse diagnostics with tokens kept', () => {
    const r = c4Language.parse('C4Context\n', { keepTokens: true });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['C4_NOT_PORTED']);
    expect(r.tokens?.length).toBeGreaterThan(0);
  });
});
