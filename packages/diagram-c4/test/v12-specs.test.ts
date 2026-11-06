/**
 * The converged v12 parser specs (`diagrams/c4/parser/*.spec.ts`, `c4BoundaryDirection.spec.ts`),
 * ported to the v13 model. Each `describe` names the spec it comes from. Where this port
 * deliberately differs from v12, the test says so in its name.
 */
import { describe, expect, it } from 'vitest';
import { parseC4 } from '../src/parser/index.ts';
import type { C4Model } from '../src/parser/index.ts';

/** Parses `text` and fails on any error diagnostic. */
function parse(text: string): C4Model {
  const r = parseC4(text);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.model;
}

const codes = (text: string) => parseC4(text).diagnostics.map((d) => d.code);

describe('c4Diagram.spec', () => {
  it('handles trailing whitespace after statements', () => {
    const m = parse(`C4Context
title System Context diagram for Internet Banking System
Person(customerA, "Banking Customer A", "A customer of the bank, with personal bank accounts.") `);
    expect(m.elements).toHaveLength(1);
  });

  it.each([
    ['both parameters', 'UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")'],
    ['the first parameter only', 'UpdateLayoutConfig($c4ShapeInRow="2")'],
  ])('warns that UpdateLayoutConfig has no effect, with %s', (_label, statement) => {
    const r = parseC4(`C4Context\nPerson(customer, "Customer")\n${statement}`);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'C4_LAYOUT_CONFIG_IGNORED'],
    ]);
  });

  it('stays silent when the diagram does not use UpdateLayoutConfig', () => {
    expect(codes('C4Context\nPerson(customer, "Customer")')).toEqual([]);
  });

  it('handles parameter names that are keywords', () => {
    const m = parse('C4Context\ntitle title\nPerson(Person, "Person", "Person")');
    expect(m.title).toBe('title');
    expect(m.elements).toHaveLength(1);
    expect(m.elements[0]).toMatchObject({ alias: 'Person', label: 'Person', descr: 'Person' });
  });

  it('allows a # in the title', () => {
    expect(parse('C4Context\ntitle Relationship to a boundary (#4864)\nPerson(P, "P")').title).toBe(
      'Relationship to a boundary (#4864)',
    );
  });

  it('allows a # in the accDescription', () => {
    expect(
      parse('C4Context\naccDescription Context diagram for issue #4864\nPerson(P, "P")').accDescr,
    ).toBe('Context diagram for issue #4864');
  });

  it('sends accTitle to the accessible title, not the visible one', () => {
    const m = parse('C4Context\naccTitle: an accessible title\nPerson(P, "P")');
    expect(m.accTitle).toBe('an accessible title');
    expect(m.title).toBe('');
  });

  it('allows default in the parameters', () => {
    expect(parse('C4Context\nPerson(default, "default", "default")').elements[0]).toMatchObject({
      alias: 'default',
      label: 'default',
      descr: 'default',
    });
  });
});

/** Every element keyword and the type v12 stores for it. */
const PEOPLE_AND_SYSTEMS = [
  ['Person', 'person'],
  ['Person_Ext', 'external_person'],
  ['System', 'system'],
  ['SystemDb', 'system_db'],
  ['SystemQueue', 'system_queue'],
  ['System_Ext', 'external_system'],
  ['SystemDb_Ext', 'external_system_db'],
  ['SystemQueue_Ext', 'external_system_queue'],
] as const;

const CONTAINERS_AND_COMPONENTS = [
  ['Container', 'container'],
  ['ContainerDb', 'container_db'],
  ['ContainerQueue', 'container_queue'],
  ['Container_Ext', 'external_container'],
  ['ContainerDb_Ext', 'external_container_db'],
  ['ContainerQueue_Ext', 'external_container_queue'],
  ['Component', 'component'],
  ['ComponentDb', 'component_db'],
  ['ComponentQueue', 'component_queue'],
  ['Component_Ext', 'external_component'],
  ['ComponentDb_Ext', 'external_component_db'],
  ['ComponentQueue_Ext', 'external_component_queue'],
] as const;

describe.each(PEOPLE_AND_SYSTEMS)('c4Person/c4PersonExt/c4System.spec: %s', (keyword, type) => {
  it('parses one element with alias, label and description', () => {
    const m = parse(`C4Context
title System Context diagram for Internet Banking System
${keyword}(customerA, "Banking Customer A", "A customer of the bank, with personal bank accounts.")`);
    expect(m.elements).toEqual([
      {
        alias: 'customerA',
        ast: 'n:customerA',
        type,
        label: 'Banking Customer A',
        descr: 'A customer of the bank, with personal bank accounts.',
        techn: '',
        style: {},
        other: {},
      },
    ]);
  });

  it('parses the description on its own', () => {
    expect(parse(`C4Context\n${keyword}(customerA, "", "A customer.")`).elements[0]).toMatchObject({
      label: '',
      descr: 'A customer.',
    });
  });

  // v12 stored a named attribute in the label slot as the label's text ({ sprite: 'users' }).
  it.each([
    ['sprite', 'users'],
    ['link', 'https://github.com/mermaidjs'],
    ['tags', 'tag1,tag2'],
  ] as const)(
    'parses $%s in the label slot as that field, not as the label (deviation)',
    (field, value) => {
      const el = parse(`C4Context\n${keyword}(customerA, $${field}="${value}")`).elements[0];
      expect(el?.[field]).toBe(value);
      expect(el?.label).toBe('');
    },
  );

  it('keeps named attributes that land in an earlier positional slot', () => {
    expect(
      parse(
        `C4Context\n${keyword}(customerA, "A", "A customer.", $tags="v1.0+internal", $link="https://example.com")`,
      ).elements[0],
    ).toMatchObject({ alias: 'customerA', tags: 'v1.0+internal', link: 'https://example.com' });
  });
});

describe.each(CONTAINERS_AND_COMPONENTS)('c4Container/c4Component.spec: %s', (keyword, type) => {
  it('parses one element with alias, label, technology and description', () => {
    expect(
      parse(`C4Context
title Container diagram for Internet Banking Container
${keyword}(ContainerAA, "Internet Banking Container", "Technology", "Allows customers to view information.")`)
        .elements,
    ).toEqual([
      {
        alias: 'ContainerAA',
        ast: 'n:ContainerAA',
        type,
        label: 'Internet Banking Container',
        techn: 'Technology',
        descr: 'Allows customers to view information.',
        style: {},
        other: {},
      },
    ]);
  });

  it('parses the technology and the description apart', () => {
    expect(parse(`C4Context\n${keyword}(A, "", "", "Desc")`).elements[0]).toMatchObject({
      techn: '',
      descr: 'Desc',
    });
    expect(parse(`C4Context\n${keyword}(A, "", "Tech")`).elements[0]).toMatchObject({
      techn: 'Tech',
      descr: '',
    });
  });

  it('handles trailing whitespace after the element', () => {
    expect(parse(`C4Component \n${keyword}(A, "B", "C", "D") `).elements).toHaveLength(1);
  });
});

describe('c4NamedAttributes.spec: one named attribute, whichever slot it lands in', () => {
  const elements: [string, string, string[]][] = [
    ['C4Context', 'System(x, "L", $F="V")', ['descr', 'tags', 'sprite', 'link']],
    ['C4Context', 'Person(x, "L", $F="V")', ['descr', 'tags', 'sprite', 'link']],
    ['C4Container', 'Container(x, "L", $F="V")', ['descr', 'techn', 'tags', 'sprite', 'link']],
    ['C4Component', 'Component(x, "L", $F="V")', ['descr', 'techn', 'tags', 'sprite', 'link']],
  ];
  for (const [header, template, fields] of elements) {
    it.each(fields)(template.replace('$F', '$%s'), (field) => {
      const el = parse(`${header}\n${template.replace('$F', `$${field}`)}`).elements[0];
      expect(Object.entries(el ?? {}).find(([k]) => k === field)?.[1]).toBe('V');
    });
  }

  // `System_Boundary` and `Container_Boundary` splice their kind in as a positional argument,
  // so an explicit `$type` still wins: it is named.
  const boundaries: [string, string, string[]][] = [
    ['C4Context', 'System_Boundary(x, "L", $F="V")', ['type', 'tags', 'link']],
    ['C4Container', 'Container_Boundary(x, "L", $F="V")', ['type', 'tags', 'link']],
    ['C4Deployment', 'Node(x, "L", $F="V")', ['type', 'descr', 'tags', 'sprite', 'link']],
  ];
  for (const [header, template, fields] of boundaries) {
    it.each(fields)(template.replace('$F', '$%s'), (field) => {
      const b = parse(`${header}\n${template.replace('$F', `$${field}`)} {\nContainer(i, "I")\n}`)
        .boundaries[0];
      expect(Object.entries(b ?? {}).find(([k]) => k === field)?.[1]).toBe('V');
    });
  }

  it.each(['techn', 'descr', 'tags', 'sprite', 'link'])('Rel(a, b, "uses", $%s="V")', (field) => {
    const rel = parse(`C4Context\nPerson(a, "A")\nPerson(b, "B")\nRel(a, b, "uses", $${field}="V")`)
      .rels[0];
    expect(Object.entries(rel ?? {}).find(([k]) => k === field)?.[1]).toBe('V');
  });

  it('keeps a named $descr that lands in the technology slot', () => {
    expect(
      parse('C4Container\nContainer(c, "C", $descr="a description")').elements[0],
    ).toMatchObject({
      descr: 'a description',
      techn: '',
    });
  });

  it('still defaults descr to empty when it is absent', () => {
    expect(parse('C4Container\nContainer(c, "C", $techn="Java")').elements[0]).toMatchObject({
      techn: 'Java',
      descr: '',
    });
  });
});

describe('c4Boundary.spec', () => {
  const body = '{\nSystem(SystemAA, "Internet Banking System")\n}';

  it('parses one boundary', () => {
    const m = parse(`C4Context\ntitle T\nBoundary(b1, "BankBoundary") ${body}`);
    expect(m.boundaries).toEqual([
      {
        alias: 'b1',
        ast: 's:b1',
        type: 'system',
        label: 'BankBoundary',
        descr: '',
        style: {},
        other: {},
      },
    ]);
    expect(m.elements[0]?.parent).toBe('b1');
  });

  it('parses the type', () => {
    expect(parse(`C4Context\nBoundary(b1, "", "company") ${body}`).boundaries[0]?.type).toBe(
      'company',
    );
  });

  it.each([
    ['link', 'https://github.com/mermaidjs'],
    ['tags', 'tag1,tag2'],
  ] as const)('parses $%s in the label slot as that field (deviation)', (field, value) => {
    expect(
      parse(`C4Context\nBoundary(b1, $${field}="${value}") ${body}`).boundaries[0]?.[field],
    ).toBe(value);
  });

  it('keeps a boundary alias usable as a relationship endpoint (#4864)', () => {
    const m = parse(
      `C4Context\nBoundary(b1, "BankBoundary") ${body}\nRel(b1, SystemAA, "Contains")`,
    );
    expect(m.rels[0]).toMatchObject({ from: 'b1', to: 'SystemAA' });
    expect(m.boundaries.map((b) => b.alias)).toEqual(['b1']);
  });

  it.each([
    ['Enterprise_Boundary', 'ENTERPRISE'],
    ['System_Boundary', 'SYSTEM'],
    ['Container_Boundary', 'CONTAINER'],
  ])('%s splices its kind into the type slot, as the v12 grammar does', (keyword, type) => {
    const m = parse(`C4Context\n${keyword}(b, "B", "moved to tags") ${body}`);
    expect(m.boundaries[0]).toMatchObject({ type, tags: 'moved to tags' });
  });

  it('opens the body on the next line too', () => {
    expect(
      parse('C4Context\nSystem_Boundary(b, "B")\n{\nPerson(a, "A")\n}').boundaries,
    ).toHaveLength(1);
  });
});

describe('c4Rel.spec', () => {
  it('keeps every relationship that repeats a from/to pair (#7183)', () => {
    const m = parse(
      'C4Dynamic\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "Interaction 1")\nRel(a, b, "Interaction 2")',
    );
    expect(m.rels.map((r) => r.label)).toEqual(['Interaction 1', 'Interaction 2']);
    expect(m.rels.map((r) => r.ast)).toEqual(['e:a>b', 'e:a>b#2']);
  });

  it('keeps the two directions of a pair apart', () => {
    const m = parse(
      'C4Context\nPerson(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses")\nRel(b, a, "Sends e-mails to")',
    );
    expect(m.rels.map((r) => [r.from, r.to])).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ]);
  });

  it('applies UpdateRelStyle to every relationship in the named pair', () => {
    const m = parse(`C4Dynamic
System(a, "A")
System(b, "B")
Rel(a, b, "Interaction 1")
Rel(a, b, "Interaction 2")
UpdateRelStyle(a, b, $textColor="blue", $lineColor="blue")`);
    for (const r of m.rels) expect(r).toMatchObject({ textColor: 'blue', lineColor: 'blue' });
  });

  it('carries the technology and description of each relationship', () => {
    expect(
      parse(
        'C4Context\nPerson(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses", "HTTPS", "to read accounts")',
      ).rels[0],
    ).toMatchObject({ label: 'Uses', techn: 'HTTPS', descr: 'to read accounts' });
  });

  it.each([
    ['Rel', 'rel'],
    ['BiRel', 'birel'],
    ['Rel_U', 'rel_u'],
    ['Rel_Up', 'rel_u'],
    ['Rel_D', 'rel_d'],
    ['Rel_Down', 'rel_d'],
    ['Rel_L', 'rel_l'],
    ['Rel_Left', 'rel_l'],
    ['Rel_R', 'rel_r'],
    ['Rel_Right', 'rel_r'],
    ['Rel_Back', 'rel_b'],
  ])('%s is a %s relationship', (keyword, type) => {
    expect(
      parse(`C4Context\nPerson(a, "A")\nPerson(b, "B")\n${keyword}(a, b, "x")`).rels[0]?.type,
    ).toBe(type);
  });

  it('drops the index of RelIndex, as v12 does', () => {
    expect(
      parse('C4Dynamic\nPerson(a, "A")\nPerson(b, "B")\nRelIndex(1, a, b, "x")').rels[0],
    ).toMatchObject({
      type: 'rel',
      from: 'a',
      to: 'b',
      label: 'x',
    });
  });

  it('draws no relationship without a label, as v12, and says so', () => {
    const r = parseC4('C4Context\nPerson(a, "A")\nPerson(b, "B")\nRel(a, b)');
    expect(r.model.rels).toEqual([]);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'C4_REL_INCOMPLETE'],
    ]);
  });
});

describe('c4Direction.spec', () => {
  it.each(['TB', 'BT', 'LR', 'RL'] as const)('accepts %s and stores it', (direction) => {
    expect(parse(`C4Context\ndirection ${direction}\nSystem(a, "A")`).direction).toBe(direction);
  });

  it('defaults to TB when the diagram does not say', () => {
    expect(parse('C4Context\nSystem(a, "A")').direction).toBe('TB');
  });

  it('sets a boundary direction inside the braces, not the diagram one', () => {
    const m = parse(
      'C4Container\nContainer_Boundary(b, "B") {\ndirection LR\nContainer(a, "A")\n}',
    );
    expect(m.boundaries[0]?.direction).toBe('LR');
    expect(m.direction).toBe('TB');
  });
});

describe('c4UpdateElementStyle.spec', () => {
  it('stores $showStereotype on an element', () => {
    const m = parse(
      'C4Context\nPerson(customerA, "A")\nUpdateElementStyle(customerA, $showStereotype="false")',
    );
    expect(m.elements[0]?.style.showStereotype).toBe('false');
  });

  it('stores it on a boundary when no element has the alias', () => {
    const m = parse(`C4Context
Enterprise_Boundary(b1, "Bank") {
Person(customerA, "A")
}
UpdateElementStyle(b1, $showStereotype="false")`);
    expect(m.boundaries[0]?.style.showStereotype).toBe('false');
  });

  it('leaves the field unset when the statement does not mention it', () => {
    const el = parse(
      'C4Context\nPerson(customerA, "A")\nUpdateElementStyle(customerA, $bgColor="grey")',
    ).elements[0];
    expect(el?.style).toEqual({ bgColor: 'grey' });
  });

  it('takes positional style arguments in v12 order', () => {
    const el = parse('C4Context\nPerson(a, "A")\nUpdateElementStyle(a, "red", "blue", "green")')
      .elements[0];
    expect(el?.style).toEqual({ bgColor: 'red', fontColor: 'blue', borderColor: 'green' });
  });
});

describe('AddElementTag and AddRelTag', () => {
  it('collect tag styles by name, later statements adding to them', () => {
    const m = parse(`C4Context
AddElementTag("v1", $bgColor="#d73027")
AddElementTag("v1", $fontColor="white", $shape="cylinder")
AddRelTag("async", $lineColor="red")
Person(a, "A", $tags="v1")`);
    expect(m.elementTags).toEqual([
      { tagName: 'v1', bgColor: '#d73027', fontColor: 'white', shape: 'cylinder', other: {} },
    ]);
    expect(m.relTags).toEqual([{ tagName: 'async', lineColor: 'red', other: {} }]);
  });
});

describe('parser behaviour that is not in the v12 specs', () => {
  it('ends an unquoted argument at ) and at the line end (deviation: v12 ran on to the next comma)', () => {
    const m = parse('C4Context\nPerson(a, Alice)\nPerson(b, "B")');
    expect(m.elements.map((e) => [e.alias, e.label])).toEqual([
      ['a', 'Alice'],
      ['b', 'B'],
    ]);
  });

  it('reads empty arguments as v12 does', () => {
    expect(parse('C4Context\nPerson(a,,"d")').elements[0]).toMatchObject({ label: '', descr: 'd' });
  });

  it('reports an empty diagram, as v12 does', () => {
    expect(codes('C4Context\n')).toEqual(['C4_EMPTY']);
  });

  it('reports an empty boundary, as v12 does', () => {
    expect(codes('C4Context\nSystem_Boundary(b, "B") {\n}')).toEqual(['C4_EMPTY_BOUNDARY']);
  });

  it('needs the parenthesis right after the keyword, as v12 does', () => {
    expect(codes('C4Context\nPerson (a, "A")')).toContain('C4_EXPECTED_PAREN');
  });

  it('reports an unknown statement and goes on at the next line', () => {
    const r = parseC4('C4Context\nPersonX(a, "A")\nPerson(b, "B")');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['C4_UNKNOWN_STATEMENT']);
    expect(r.model.elements.map((e) => e.alias)).toEqual(['b']);
  });

  it('reports an unclosed boundary with the brace that opened it', () => {
    const text = 'C4Context\nSystem_Boundary(b, "B") {\nPerson(a, "A")';
    const d = parseC4(text).diagnostics.find((x) => x.code === 'C4_UNCLOSED_BOUNDARY');
    expect(d && text.slice(d.range.start, d.range.end)).toBe('{');
  });

  it('reports a closing brace with no boundary', () => {
    expect(codes('C4Context\nPerson(a, "A")\n}')).toEqual(['C4_UNEXPECTED_BRACE']);
  });

  it('enforces the depth limit with the limit code core maps to LIMIT', () => {
    const text = 'C4Context\nBoundary(a, "A") {\nBoundary(b, "B") {\nPerson(p, "P")\n}\n}';
    const r = parseC4(text, { limits: { maxDepth: 1, maxNodes: 100, maxEdges: 100 } });
    expect(r.diagnostics.map((d) => d.code)).toContain('DEPTH_LIMIT');
  });

  it('records alias definitions and references for the language service', () => {
    const r = parseC4('C4Context\nPerson(a, "A")\nPerson(b, "B")\nRel(a, b, "x")');
    expect(r.symbols.map((s) => [s.name, s.role])).toEqual([
      ['a', 'def'],
      ['b', 'def'],
      ['a', 'ref'],
      ['b', 'ref'],
    ]);
  });
});

describe('c4BoundaryDirection.spec', () => {
  // The converged build reads `c4.boundaryDirection` from front matter. The alpha's schema has
  // no such key and drops it (see test/c4-render.test.ts), so here only the model side is
  // covered: a `direction` statement inside a boundary is that boundary's.
  it('keeps each boundary its own direction statement', () => {
    const m = parse(`C4Container
Container_Boundary(shop, "Web shop") {
  direction LR
  Container(cart, "Cart", "Python")
}
Container_Boundary(warehouse, "Warehouse") {
  direction TB
  Container(pick, "Pick", "Go")
}`);
    expect(m.boundaries.map((b) => [b.alias, b.direction])).toEqual([
      ['shop', 'LR'],
      ['warehouse', 'TB'],
    ]);
  });
});
