/**
 * The converged build's c4-beta specs, ported: the parser tests (`packages/parser/tests/c4.test.ts`),
 * the db spec (`c4-beta/db.spec.ts`) and the detector spec, as far as the parse decides them.
 * What v12 checked in `getData` is checked on the rendered SVG in `test/c4-beta-render.test.ts`.
 * Each `describe` names its source.
 */
import { describe, expect, it } from 'vitest';
import { detector, parseC4Beta } from '../src/index.ts';
import type { C4BetaModel } from '../src/index.ts';

function parse(text: string): C4BetaModel {
  const r = parseC4Beta(text);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.model;
}
const warnings = (text: string) =>
  parseC4Beta(text)
    .diagnostics.filter((d) => d.severity === 'warning')
    .map((d) => d.code);

describe('detector.spec', () => {
  it('detects the c4-beta keyword with and without a kind', () => {
    expect(detector('c4-beta')).toBe(true);
    expect(detector('c4-beta context\nperson a "A"')).toBe(true);
  });
  it('does not detect legacy C4 or other diagrams', () => {
    expect(detector('C4Context\nPerson(a, "A")')).toBe(false);
    expect(detector('c4-betaX')).toBe(false);
    expect(detector('flowchart TD\nc4-beta')).toBe(false);
  });
});

describe('parser c4.test: header', () => {
  it.each(['c4-beta', '  c4-beta  ', '\tc4-beta\t', '\nc4-beta\n'])(
    'handles a bare header %j',
    (text) => {
      expect(parse(text).kind).toBe('context');
    },
  );
  it.each(['context', 'container', 'component', 'dynamic', 'deployment'] as const)(
    'handles the %s kind',
    (kind) => {
      expect(parse(`c4-beta ${kind}\n`).kind).toBe(kind);
    },
  );
});

describe('parser c4.test: statements', () => {
  it('handles title, accTitle and accDescr', () => {
    const m = parse(
      'c4-beta context\n  title sample title\n  accTitle: sample accTitle\n  accDescr: sample accDescr\n',
    );
    expect([m.title, m.accTitle, m.accDescr]).toEqual([
      'sample title',
      'sample accTitle',
      'sample accDescr',
    ]);
  });
  it('handles a multi-line accDescr', () => {
    expect(parse('c4-beta context\naccDescr {\n  one\n  two\n}\n').accDescr).toBe('one\ntwo');
  });
  it.each(['TB', 'BT', 'LR', 'RL'] as const)('handles direction %s', (d) => {
    expect(parse(`c4-beta context\n  direction ${d}\n`).direction).toBe(d);
  });
  it.each([
    ['on', true],
    ['off', false],
  ] as const)('handles legend %s', (v, on) => {
    expect(parse(`c4-beta context\n  legend ${v}\n`).legend).toBe(on);
  });
  it('leaves the legend on when no legend statement is given', () => {
    expect(parse('c4-beta context\n  person customer "Customer"\n').legend).toBe(true);
  });
});

describe('parser c4.test: elements', () => {
  it('handles a person with name and description', () => {
    expect(
      parse(
        'c4-beta context\n person customer "Personal Banking Customer" "A customer of the bank."',
      ).elements[0],
    ).toMatchObject({
      kind: 'person',
      id: 'customer',
      name: 'Personal Banking Customer',
      description: 'A customer of the bank.',
    });
  });
  it('marks an external element with the built-in external tag', () => {
    expect(
      parse('c4-beta context\n softwareSystem mainframe "Mainframe" "Core." :::external')
        .elements[0]?.tags,
    ).toContain('external');
  });
  it('handles an infrastructureNode with technology', () => {
    expect(
      parse('c4-beta deployment\n infrastructureNode lb "Load Balancer" "Routes traffic." "nginx"')
        .elements[0],
    ).toMatchObject({
      kind: 'infrastructureNode',
      technology: 'nginx',
    });
  });
  it.each(['4', '1..N'])('handles the instance count %s on a deployment node', (n) => {
    expect(
      parse(`c4-beta deployment\n deploymentNode ec2 "EC2" "" "Ubuntu" instances "${n}"`)
        .elements[0]?.instances,
    ).toBe(n);
  });
  it('handles a container with technology', () => {
    expect(
      parse('c4-beta container\n container spa "Single-Page App" "Web UI" "JavaScript/Angular"')
        .elements[0],
    ).toMatchObject({
      name: 'Single-Page App',
      description: 'Web UI',
      technology: 'JavaScript/Angular',
    });
  });
  it('handles tags', () => {
    expect(
      parse('c4-beta context\n softwareSystem banking "Banking" :::web :::critical-path')
        .elements[0]?.tags,
    ).toEqual(['web', 'critical-path']);
  });
  it('allows element kind keywords as ids', () => {
    const m = parse(
      'c4-beta context\n softwareSystem softwareSystem "System"\n person container "P"\n deploymentNode component "N"',
    );
    expect(m.elements.map((e) => [e.kind, e.id])).toEqual([
      ['softwareSystem', 'softwareSystem'],
      ['person', 'container'],
      ['deploymentNode', 'component'],
    ]);
  });
  it('handles nested elements in braces', () => {
    const m = parse(
      'c4-beta context\n softwareSystem big "Big System" {\n container spa "SPA" "Web UI" "JS"\n }',
    );
    expect(m.elements.map((e) => [e.id, e.parent])).toEqual([
      ['big', undefined],
      ['spa', 'big'],
    ]);
  });
  it('unescapes strings as Langium does', () => {
    expect(parse(`c4-beta context\n person a "say \\"hi\\"" 'single'`).elements[0]).toMatchObject({
      name: 'say "hi"',
      description: 'single',
    });
  });
});

describe('parser c4.test: relationships and styles', () => {
  it('handles a relationship with description and technology', () => {
    expect(
      parse('c4-beta context\n banking --> mainframe : "Gets account information from" "XML/HTTPS"')
        .relationships[0],
    ).toMatchObject({
      source: 'banking',
      target: 'mainframe',
      arrow: '-->',
      description: 'Gets account information from',
      technology: 'XML/HTTPS',
    });
  });
  it.each(['-->', '<--', '<-->', '---'] as const)('handles the %s arrow', (arrow) => {
    expect(parse(`c4-beta context\n a ${arrow} b`).relationships[0]?.arrow).toBe(arrow);
  });
  it('handles a numbered step prefix', () => {
    expect(
      parse('c4-beta dynamic\n 1: spa --> api : "Submits credentials to"').relationships[0],
    ).toMatchObject({ step: 1, source: 'spa' });
  });
  it('allows element kind keywords as endpoints', () => {
    expect(
      parse(
        'c4-beta context\n person person "P"\n softwareSystem softwareSystem "S"\n person --> softwareSystem : "Uses"',
      ).relationships[0],
    ).toMatchObject({
      source: 'person',
      target: 'softwareSystem',
    });
  });
  it('handles tags on relationships', () => {
    expect(parse('c4-beta context\n a --> b : "Calls" :::async').relationships[0]?.tags).toEqual([
      'async',
    ]);
  });
  it('handles style statements, merging repeats for one tag', () => {
    const m = parse(
      'c4-beta context\n style database fill:#438DD5, stroke:#3C7FC0, shape:cylinder\n style async line:dashed, color:#fff\n style database color:#000',
    );
    expect(m.styles).toEqual([
      ['database', { fill: '#438DD5', stroke: '#3C7FC0', shape: 'cylinder', color: '#000' }],
      ['async', { line: 'dashed', color: '#fff' }],
    ]);
  });
  it('warns about and ignores unsupported style keys and values', () => {
    const r = parseC4Beta('c4-beta context\n style t shape:folder, line:wavy, width:thick');
    expect(r.model.styles).toEqual([['t', {}]]);
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'C4B_STYLE_IGNORED',
      'C4B_STYLE_IGNORED',
      'C4B_STYLE_IGNORED',
    ]);
  });
});

describe('db.spec: semantics', () => {
  it('defaults kind to context and direction to TB', () => {
    const m = parse('c4-beta\nperson a "A"');
    expect([m.kind, m.direction]).toEqual(['context', 'TB']);
  });
  it('warns about element kinds unexpected for the diagram kind', () => {
    expect(
      warnings('c4-beta context\n container c "C"\n component d "D"\n deploymentNode n "N"'),
    ).toEqual(['C4B_UNEXPECTED_KIND', 'C4B_UNEXPECTED_KIND', 'C4B_UNEXPECTED_KIND']);
    expect(warnings('c4-beta deployment\n person p "P"')).toEqual(['C4B_UNEXPECTED_KIND']);
  });
  it('does not warn when element kinds match the diagram kind', () => {
    expect(
      warnings('c4-beta container\n person p "P"\n softwareSystem s "S"\n container c "C"'),
    ).toEqual([]);
  });
  it.each(['person', 'softwareSystem'])('drops technology on a %s and warns', (kind) => {
    const r = parseC4Beta(`c4-beta context\n ${kind} x "X" "d" "Tech"`);
    expect(r.model.elements[0]?.technology).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['C4B_TECHNOLOGY_IGNORED']);
  });
  it('keeps technology on a container', () => {
    expect(parse('c4-beta container\n container c "C" "d" "Go"').elements[0]?.technology).toBe(
      'Go',
    );
  });
  it('drops instances on a non-deploymentNode and warns', () => {
    const r = parseC4Beta('c4-beta container\n container c "C" "" "" instances "3"');
    expect(r.model.elements[0]?.instances).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['C4B_INSTANCES_IGNORED']);
  });
  it.each([
    'c4-beta context\n softwareSystem a "A" {\n container a "Inner"\n }',
    'c4-beta context\n softwareSystem a "A" {\n container b "B" {\n component a "Deep"\n }\n }',
  ])('rejects an id declared inside an element with the same id', (text) => {
    expect(parseC4Beta(text).diagnostics.map((d) => d.code)).toContain('C4B_ID_INSIDE_ITSELF');
  });
  it('keeps accepting siblings that share an id, and nested distinct ids', () => {
    expect(
      parse('c4-beta context\n softwareSystem a "A"\n softwareSystem a "A again"').elements,
    ).toHaveLength(2);
    expect(
      parse('c4-beta context\n softwareSystem a "A" {\n container b "B"\n }').elements,
    ).toHaveLength(2);
  });
  it('takes the front-matter title when there is no title statement', () => {
    expect(parse('---\ntitle: From front matter\n---\nc4-beta\nperson a "A"').title).toBe(
      'From front matter',
    );
    expect(
      parse('---\ntitle: From front matter\n---\nc4-beta\ntitle Own\nperson a "A"').title,
    ).toBe('Own');
  });
});

describe('limits', () => {
  const limits = { maxDepth: 1, maxNodes: 2, maxEdges: 1 };
  it.each([
    [
      'DEPTH_LIMIT',
      'c4-beta context\n softwareSystem a "A" {\n container b "B" {\n component c "C"\n }\n }',
    ],
    ['NODE_LIMIT', 'c4-beta context\n person a "A"\n person b "B"\n person c "C"'],
    ['EDGE_LIMIT', 'c4-beta context\n a --> b\n b --> a'],
  ])('reports %s, which core maps to a LIMIT error', (code, text) => {
    expect(parseC4Beta(text, { limits }).diagnostics.map((d) => d.code)).toContain(code);
  });
});
