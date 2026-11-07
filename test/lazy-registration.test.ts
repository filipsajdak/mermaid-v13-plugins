/**
 * Each diagram plugin of this repository on the registry's three lazy paths: a `loader` that
 * returns the plugin, a `loader` that returns the package's namespace, and the package's
 * `mermaid` manifest. alpha.1's registry loads a loaded object's `diagram` member, else its
 * `layout` member, so a plugin that does not name itself as `diagram` loads its own layout
 * method and fails with "plugin.parse is not a function".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMermaid } from 'mermaid';
import type { ExternalDiagram } from 'mermaid';
import { describe, expect, it } from 'vitest';
import * as bpmnPackage from '../packages/diagram-bpmn/src/index.ts';
import * as c4Package from '../packages/diagram-c4/src/index.ts';
import * as c4BetaPackage from '../packages/diagram-c4-beta/src/index.ts';
import * as swimlanePackage from '../packages/diagram-swimlane/src/index.ts';

const fixture = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');
const manifestOf = (dir: string): unknown => {
  const pkg: unknown = JSON.parse(fixture(`packages/${dir}/package.json`));
  return typeof pkg === 'object' && pkg !== null && 'mermaid' in pkg ? pkg.mermaid : undefined;
};

interface Case {
  readonly dir: string;
  readonly namespace:
    typeof c4Package | typeof c4BetaPackage | typeof swimlanePackage | typeof bpmnPackage;
  /** The plugin as the package exports it by name. */
  readonly plugin:
    | typeof c4Package.c4
    | typeof c4BetaPackage.c4Beta
    | typeof swimlanePackage.swimlane
    | typeof bpmnPackage.bpmn;
  /** First-party ids (`c4`, `swimlane`) take that type's slot. */
  readonly replace: boolean;
  readonly source: string;
  readonly label: string;
}

const CASES: readonly Case[] = [
  {
    dir: 'diagram-c4',
    namespace: c4Package,
    plugin: c4Package.c4,
    replace: true,
    source: 'C4Context\nPerson(a, "Lazy person")\n',
    label: 'Lazy person',
  },
  {
    dir: 'diagram-c4-beta',
    namespace: c4BetaPackage,
    plugin: c4BetaPackage.c4Beta,
    replace: false,
    source: 'c4-beta context\n person p "Lazy person"\n',
    label: 'Lazy person',
  },
  {
    dir: 'diagram-swimlane',
    namespace: swimlanePackage,
    plugin: swimlanePackage.swimlane,
    replace: true,
    source: fixture('harness/fixtures/smoke/swimlane-phases.mmd'),
    label: 'Underwriting',
  },
  {
    dir: 'diagram-bpmn',
    namespace: bpmnPackage,
    plugin: bpmnPackage.bpmn,
    replace: false,
    source: fixture('packages/diagram-bpmn/fixtures/docs-bpmn-8.mmd'),
    label: 'Needs goods',
  },
];

describe.each(CASES)('$dir', ({ dir, namespace, plugin, replace, source, label }) => {
  const load = () => Promise.resolve(namespace);
  const paths: readonly (readonly [string, ExternalDiagram])[] = [
    [
      'a loader that returns the plugin',
      { id: plugin.id, detector: namespace.detector, loader: () => Promise.resolve(plugin) },
    ],
    [
      'a loader that returns the package namespace',
      { id: plugin.id, detector: namespace.detector, loader: load },
    ],
    [
      "the package's mermaid manifest",
      { manifest: manifestOf(dir), detector: namespace.detector, load },
    ],
  ];
  it.each(paths)('renders when loaded through %s', async (_, def) => {
    const api = createMermaid();
    api.initialize({ discovery: false });
    await api.registerExternalDiagrams([def], { replace });
    const r = await api.render('lazy', source);
    expect(r.diagramType).toBe(plugin.id);
    expect(r.svg).toContain(label);
  });
});
