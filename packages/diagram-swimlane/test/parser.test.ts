import { describe, expect, it } from 'vitest';
import { detector } from '../src/detector.ts';
import { parseSwimlane } from '../src/parser.ts';

const codes = (text: string) => parseSwimlane(text).diagnostics.map((d) => d.code);

describe('detector', () => {
  it('takes swimlane-beta as the first word, with or without a direction', () => {
    expect(detector('swimlane-beta')).toBe(true);
    expect(detector('  swimlane-beta LR\n  a --> b')).toBe(true);
  });

  it('leaves flowcharts and other words alone', () => {
    expect(detector('flowchart LR\n  a[swimlane-beta]')).toBe(false);
    expect(detector('swimlane')).toBe(false);
    expect(detector('swimlane-betas')).toBe(false);
  });
});

describe('parseSwimlane', () => {
  it('reads the flowchart syntax, lanes and direction', () => {
    const { model, diagnostics } = parseSwimlane(
      'swimlane-beta LR\n  subgraph sales [Sales team]\n    a[Lead] -->|ok| b{Quote?}\n  end\n',
    );

    expect(diagnostics).toEqual([]);
    expect(model.flow.direction).toBe('LR');
    // Members in v12's order, last first.
    expect(model.flow.subgraphs.map((s) => [s.id, s.title, s.nodes])).toEqual([
      ['sales', 'Sales team', ['b', 'a']],
    ]);
    expect(model.flow.edges.map((e) => [e.start, e.end, e.text])).toEqual([['a', 'b', 'ok']]);
    expect(model.phases).toEqual([]);
  });

  it('defaults to TB without a direction', () => {
    expect(parseSwimlane('swimlane-beta\n  a --> b').model.flow.direction).toBe('TB');
  });

  it('reads phases in declaration order, with or without a title', () => {
    const { model, diagnostics } = parseSwimlane(
      [
        'swimlane-beta',
        'phase intake["Intake"]',
        '  phase review[Review step]',
        'phase done',
        'subgraph L',
        '  a["A"]@{ phase: intake }',
        '  b@{ phase: review } --> c@{ phase: done }',
        'end',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([]);
    expect(model.phases).toEqual([
      { id: 'intake', label: 'Intake', labelType: 'text' },
      { id: 'review', label: 'Review step', labelType: 'text' },
      { id: 'done', label: 'done', labelType: 'text' },
    ]);
    expect(model.nodePhases).toEqual([
      ['a', 'intake'],
      ['b', 'review'],
      ['c', 'done'],
    ]);
    expect(model.flow.vertices.map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads a markdown title and a multi-line @{ } block', () => {
    const { model, diagnostics } = parseSwimlane(
      'swimlane-beta\nphase p["`**One**`"]\na@{\n  shape: rect\n  phase: p\n}\n',
    );

    expect(diagnostics).toEqual([]);
    expect(model.phases).toEqual([{ id: 'p', label: '**One**', labelType: 'markdown' }]);
    expect(model.nodePhases).toEqual([['a', 'p']]);
  });

  it('takes phase as a keyword only at the start of a statement', () => {
    const { model, diagnostics } = parseSwimlane(
      'swimlane-beta\nphase p\na@{ phase: p } --> phase\nstyle phase fill:#f00\n',
    );

    expect(diagnostics).toEqual([]);
    expect(model.phases.map((p) => p.id)).toEqual(['p']);
    expect(model.flow.vertices.map((v) => v.id)).toEqual(['a', 'phase']);
  });

  it('reads a phase after a semicolon', () => {
    const { model } = parseSwimlane('swimlane-beta\na --> b; phase p["P"]\nc@{ phase: p }');

    expect(model.phases.map((p) => p.id)).toEqual(['p']);
    expect(model.nodePhases).toEqual([['c', 'p']]);
  });

  it('reports a phase declared twice at its second id', () => {
    const text = 'swimlane-beta\nphase p["One"]\nphase p["Two"]\na@{ phase: p }';
    const { diagnostics, model } = parseSwimlane(text);

    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['SWIMLANE_PHASE_DUPLICATE', 'error'],
    ]);
    const [d] = diagnostics;
    expect(d!.range.start).toBe(text.indexOf('p["Two"]'));
    expect(model.phases.map((p) => p.label)).toEqual(['One']);
  });

  it('reports a phase that is not declared, or declared after the node', () => {
    expect(codes('swimlane-beta\na@{ phase: nope }')).toEqual(['SWIMLANE_PHASE_UNKNOWN']);
    expect(codes('swimlane-beta\na@{ phase: late }\nphase late')).toEqual([
      'SWIMLANE_PHASE_UNKNOWN',
    ]);
  });

  it('keeps every range in the source when phases come before an error', () => {
    const text = 'swimlane-beta\nphase p["P"]\na --> --> b';
    const { diagnostics } = parseSwimlane(text);

    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) {
      expect(d.range.start).toBeGreaterThan(text.indexOf('a -->'));
      expect(d.range.end).toBeLessThanOrEqual(text.length);
    }
  });

  it('never throws', () => {
    for (const text of ['', 'swimlane-beta', 'swimlane-beta\nphase', 'phase x', '\u0000']) {
      expect(() => parseSwimlane(text)).not.toThrow();
    }
  });
});
