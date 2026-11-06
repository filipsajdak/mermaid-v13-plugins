/**
 * Node discovery (mermaid 13.0.0-alpha.1): an app whose `node_modules` holds a package with a
 * `mermaid` manifest. Discovery scans the app root found from `process.cwd()`, so each case runs
 * in a child Node process inside a throwaway app directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

/** A diagram package whose detector accepts `pattern` and whose entry draws an empty svg. */
function fakePackage(name: string, id: string, pattern: string): Record<string, string> {
  const manifest = {
    name,
    version: '0.0.0',
    type: 'module',
    mermaid: {
      plugin: 'diagram',
      id,
      formats: ['svg'],
      detector: './detector.js',
      entry: './entry.js',
      export: 'plugin',
    },
  };
  const entry = `
const detector = (text) => /${pattern}/.test(text);
export const plugin = {
  id: ${JSON.stringify(id)},
  layoutKind: 'custom',
  detector,
  parse: (text) => ({ model: {}, ast: { id: 'doc', type: 'doc', range: { start: 0, end: text.length } },
    diagnostics: [], symbols: [], statements: [] }),
  render: (_m, _l, _ctx, w) => { w.open('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: [0, 0, 1, 1] }); w.close(); },
};`;
  return {
    'package.json': JSON.stringify(manifest),
    'detector.js': `export default (text) => /${pattern}/.test(text);\n`,
    'entry.js': entry,
  };
}

const PROBE = `
import { createMermaid } from 'mermaid';
const api = createMermaid();
const outcome = (p) => p.then((r) => ({ type: r.diagramType, warnings: r.warnings }), (e) => ({ error: e.code, message: e.message }));
const out = {
  pie: await outcome(api.render('p', 'pie\\n "a": 1')),
  legacyKeyword: await outcome(api.render('l', 'fake-legacy\\n')),
  c4: await outcome(api.render('c', 'C4Context\\n')),
};
process.stdout.write(JSON.stringify(out));
`;

interface Outcome {
  type?: string;
  warnings?: { code: string; message: string }[];
  error?: string;
  message?: string;
}

let app = '';
let result: Record<'pie' | 'legacyKeyword' | 'c4', Outcome>;

beforeAll(async () => {
  app = await mkdtemp(join(tmpdir(), 'mermaid-v13-discovery-'));
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({ name: 'discovery-app', private: true, type: 'module' }),
  );
  await mkdir(join(app, 'node_modules'));
  await symlink(
    await realpath(join(repo, 'node_modules', 'mermaid')),
    join(app, 'node_modules', 'mermaid'),
  );
  const packages = {
    'fake-c4': fakePackage('fake-c4', 'c4', '^\\s*C4Context'),
    'fake-c4-legacy': fakePackage('fake-c4-legacy', 'c4-legacy', '^\\s*(?:C4Context|fake-legacy)'),
  };
  for (const [name, files] of Object.entries(packages)) {
    await mkdir(join(app, 'node_modules', name));
    for (const [file, text] of Object.entries(files)) {
      await writeFile(join(app, 'node_modules', name, file), text);
    }
  }
  await writeFile(join(app, 'probe.mjs'), PROBE);
  const stdout = execFileSync(process.execPath, ['probe.mjs'], { cwd: app, encoding: 'utf8' });
  result = JSON.parse(stdout) as typeof result;
}, 60_000);

afterAll(async () => {
  if (app !== '') await rm(app, { recursive: true, force: true });
});

describe('Node discovery of a C4 package', () => {
  it('skips a package whose diagram id is the first-party c4, with one warning', () => {
    expect(result.pie.type).toBe('pie');
    expect(result.pie.warnings).toContainEqual(
      expect.objectContaining({
        code: 'PLUGIN_SKIPPED',
        message: 'Plugin package "fake-c4" was skipped: "c4" is a first-party diagram id or type',
      }),
    );
  });

  it('registers a package with a new id: its own keyword draws', () => {
    expect(result.legacyKeyword.type).toBe('c4-legacy');
  });

  it('still leaves C4Context to the loaderless first-party row, detected first', () => {
    expect(result.c4).toEqual({
      error: 'UNSUPPORTED_DIAGRAM',
      message: 'Diagram type "c4" is not supported by this version of mermaid.',
    });
  });
});
