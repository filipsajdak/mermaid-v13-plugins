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

describe('phase lines that cannot be scanned cheaply', () => {
  /** Generous for one linear pass over 50,000 characters, far below a quadratic one. */
  const BOUND_MS = 250;
  const LONG = 50_000;
  const timed = (text: string) => {
    const start = performance.now();
    const result = parseSwimlane(text);
    return { ms: performance.now() - start, result };
  };

  it.each([
    ['an unclosed bracket', `swimlane-beta\nphase a[${' '.repeat(LONG)}`],
    ['an unterminated quote', `swimlane-beta\nphase a["${' '.repeat(LONG)}`],
    ['an unterminated quote and bracket', `swimlane-beta\nphase a["${'x '.repeat(LONG / 2)}`],
    ['trailing blanks then text', `swimlane-beta\nphase a${' '.repeat(LONG)}x`],
    ['many statement ends', `swimlane-beta\n${';'.repeat(LONG)}`],
    ['many short lines', `swimlane-beta\n${'phase\n'.repeat(LONG / 6)}`],
  ])('reads %s in linear time', (_name, text) => {
    // Warm up once, so the bound measures the scan and not the first compile.
    parseSwimlane('swimlane-beta\nphase a["A"]\na@{ phase: a }');
    const { ms } = timed(text);

    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('caps the phases at the node limit', () => {
    const text = `swimlane-beta\n${['a', 'b', 'c'].map((id) => `phase ${id}`).join('\n')}\n`;
    const { diagnostics, model } = parseSwimlane(text, { maxNodes: 2 });

    expect(model.phases.map((p) => p.id)).toEqual(['a', 'b']);
    expect(diagnostics.map((d) => d.code)).toContain('NODE_LIMIT');
  });
});

describe('ranges after blanking the phase lines', () => {
  /** The phases example of the v12 syntax page (`swimlanes.md`, "Phases"). */
  const DOCS_PHASES = [
    'swimlane-beta LR',
    '  phase intake["Intake"]',
    '  phase review["Review"]',
    '  phase closeout["Closeout"]',
    '',
    '  subgraph underwriting [Underwriting]',
    '    receive["Receive request"]@{ phase: intake }',
    '    assess["Assess"]@{ phase: review }',
    '    sign["Sign off"]@{ phase: closeout }',
    '  end',
    '',
    '  subgraph servicing [Servicing]',
    '    log["Log request"]@{ phase: intake }',
    '    close["Close file"]@{ phase: closeout }',
    '  end',
    '',
    '  log --> receive --> assess --> sign --> close',
  ];
  const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length - 1;

  it('parses the docs example without a diagnostic', () => {
    expect(parseSwimlane(DOCS_PHASES.join('\n')).diagnostics).toEqual([]);
  });

  it.each([
    ['after the phases', 4, '  a --> --> b'],
    ['between two phases', 2, '  a --> --> b'],
    ['inside a lane', 7, '    x[unclosed'],
    ['at the end', DOCS_PHASES.length, '  a --> --> b'],
  ])('points an error %s at its own line', (_name, at, bad) => {
    const lines = [...DOCS_PHASES];
    lines.splice(at, 0, bad);
    const text = lines.join('\n');
    const errors = parseSwimlane(text).diagnostics.filter((d) => d.severity === 'error');

    expect(errors.length).toBeGreaterThan(0);
    expect(lineOf(text, errors[0]!.range.start)).toBe(at);
  });

  it('points a malformed phase line, which is not blanked, at its own line', () => {
    const lines = [...DOCS_PHASES];
    lines.splice(2, 0, '  phase broken["Unclosed');
    const text = lines.join('\n');
    const [first] = parseSwimlane(text).diagnostics;

    expect(first && lineOf(text, first.range.start)).toBe(2);
  });

  it('points a phase error at the node that names it', () => {
    const text = DOCS_PHASES.join('\n').replace('phase: review', 'phase: reveiw');
    const [d] = parseSwimlane(text).diagnostics;

    expect(d?.code).toBe('SWIMLANE_PHASE_UNKNOWN');
    expect(lineOf(text, d!.range.start)).toBe(7);
  });
});
