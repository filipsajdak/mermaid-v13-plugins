#!/usr/bin/env node
// @ts-check
/**
 * Renders `.mmd` files through mermaid v13 and our plugins in Node, with no DOM.
 *
 *   node harness/render.mjs [--png] [--out <dir>] [--plugin <module>]... <file.mmd | dir>...
 *
 * Writes `<out>/<name>.svg` for each diagram that renders, `<out>/<name>.error.txt` for each
 * that does not, and `<out>/report.json` with every outcome and its warnings. `--png` also
 * rasterises each SVG through headless system Chrome. `--plugin` registers the plugins a module
 * exports (any export with an `id` and a `detector`), after ours. Exits 1 when a diagram fails.
 */
import { readdir, readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createRenderer } from './lib/mermaid.mjs';
import { rasterize, withBrowser } from './lib/chrome.mjs';

const DEFAULT_OUT = new URL('./out/', import.meta.url);

/**
 * Every `.mmd` file named or inside a named directory (not recursive), sorted.
 * @param {readonly string[]} inputs
 */
async function sources(inputs) {
  /** @type {string[]} */
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    if ((await stat(path)).isDirectory()) {
      const names = (await readdir(path)).filter((n) => n.endsWith('.mmd')).sort();
      files.push(...names.map((n) => join(path, n)));
    } else files.push(path);
  }
  return files;
}

/**
 * Whether an export looks like a diagram plugin: an object with an id and a detector.
 * @param {unknown} value
 * @returns {value is import('mermaid').ExternalDiagram}
 */
function isDiagram(value) {
  return typeof value === 'object' && value !== null && 'id' in value && 'detector' in value;
}

/**
 * The diagram plugins `module` exports.
 * @param {string} module
 * @returns {Promise<import('mermaid').ExternalDiagram[]>}
 */
async function pluginsOf(module) {
  /** @type {unknown} */
  const m = await import(pathToFileURL(resolve(module)).href);
  /** @type {unknown[]} */
  const exported = typeof m === 'object' && m !== null ? Object.values(m) : [];
  return [...new Set(exported)].filter(isDiagram);
}

/** Unique output names: the file's base name, numbered when two files share one. */
function namer() {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return (/** @type {string} */ file) => {
    const base = basename(file, '.mmd');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      png: { type: 'boolean', default: false },
      out: { type: 'string' },
      plugin: { type: 'string', multiple: true, default: [] },
    },
  });
  if (positionals.length === 0) {
    process.stderr.write(
      'usage: render.mjs [--png] [--out dir] [--plugin module]... <file|dir>...\n',
    );
    process.exit(2);
  }
  const out = values.out ? resolve(values.out) : DEFAULT_OUT.pathname;
  await mkdir(out, { recursive: true });
  const extra = (await Promise.all(values.plugin.map(pluginsOf))).flat();
  const renderer = await createRenderer({ extra });
  const nameOf = namer();
  /** @type {Omit<import('./lib/mermaid.mjs').RenderOutcome, 'svg'>[]} */
  const outcomes = [];
  for (const file of await sources(positionals)) {
    const name = nameOf(file);
    const outcome = await renderer.render(name, file, await readFile(file, 'utf8'));
    await rm(join(out, `${name}.svg`), { force: true });
    await rm(join(out, `${name}.error.txt`), { force: true });
    if (outcome.svg !== undefined) await writeFile(join(out, `${name}.svg`), outcome.svg);
    else if (outcome.error) {
      await writeFile(
        join(out, `${name}.error.txt`),
        `${outcome.error.code}: ${outcome.error.message}\n`,
      );
    }
    const { svg: _svg, ...summary } = outcome;
    outcomes.push(summary);
    const status = outcome.ok
      ? `ok ${outcome.width ?? 0}x${outcome.height ?? 0}`
      : `FAIL ${outcome.error?.code ?? ''}`;
    const warned = outcome.warnings?.length ? ` (${outcome.warnings.length} warnings)` : '';
    process.stdout.write(`${status.padEnd(20)} ${name}${warned}\n`);
  }
  await writeFile(join(out, 'report.json'), `${JSON.stringify(outcomes, null, 2)}\n`);
  if (values.png) {
    await withBrowser(async (browser) => {
      for (const o of outcomes) {
        if (!o.ok) continue;
        const svg = await readFile(join(out, `${o.name}.svg`), 'utf8');
        await rasterize(browser, svg, join(out, `${o.name}.png`));
      }
    });
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  process.stdout.write(`${outcomes.length - failed} rendered, ${failed} failed -> ${out}\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
