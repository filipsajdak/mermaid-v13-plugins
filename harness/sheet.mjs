#!/usr/bin/env node
// @ts-check
/**
 * Side-by-side sheets: our v13 render next to the v12 reference render of the same diagram.
 *
 *   node harness/sheet.mjs --v12 <dir> [--v13 harness/out] [--out harness/out/sheets]
 *                          [--v12-label "v12 converged (<build>)"]
 *
 * `--v13` is a `render.mjs` output directory (its `report.json` names the diagrams). `--v12`
 * holds `<name>.svg` or `<name>.png` for each, rendered by the v12 build. Both SVGs are
 * rasterised by the same headless Chrome. Writes `<out>/<name>.png` per diagram and an
 * `<out>/index.html` that lists them; `serve.mjs` serves it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rasterize, screenshot, withBrowser } from './lib/chrome.mjs';

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {string} path */
async function dataUrl(path) {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

/** The short commit of the plugin repo, or `unknown` outside git. */
function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * One side of a sheet: an image, or the reason there is none.
 * @param {string} caption
 * @param {string | undefined} png
 * @param {string} missing
 */
async function panel(caption, png, missing) {
  const body = png
    ? `<img src="${await dataUrl(png)}" style="max-width:760px">`
    : `<pre class="missing">${esc(missing)}</pre>`;
  return `<div class="panel"><div class="cap">${esc(caption)}</div>${body}</div>`;
}

/**
 * Whether `raw` is the outcome list `render.mjs` writes to `report.json`.
 * @param {unknown} raw
 * @returns {raw is Omit<import('./lib/mermaid.mjs').RenderOutcome, 'svg'>[]}
 */
function isReport(raw) {
  return (
    Array.isArray(raw) &&
    raw.every((o) => typeof o === 'object' && o !== null && 'name' in o && 'ok' in o)
  );
}

const STYLE = `body{margin:0;font:13px/1.4 system-ui,sans-serif;background:#fff;color:#111}
#sheet{display:inline-block;padding:16px}
h1{font-size:15px;margin:0 0 10px}
.row{display:flex;gap:24px;align-items:flex-start}
.panel{border:1px solid #ccc;padding:8px;min-width:240px}
.cap{font-weight:600;margin-bottom:6px}
.missing{color:#a00;white-space:pre-wrap;max-width:520px}
.warn{color:#850;margin-top:8px;max-width:1560px}`;

async function main() {
  const { values } = parseArgs({
    options: {
      v12: { type: 'string' },
      v13: { type: 'string', default: fileURLToPath(new URL('./out/', import.meta.url)) },
      out: { type: 'string' },
      'v12-label': { type: 'string', default: 'v12 reference' },
    },
  });
  if (!values.v12) {
    process.stderr.write(
      'usage: sheet.mjs --v12 <dir> [--v13 dir] [--out dir] [--v12-label text]\n',
    );
    process.exit(2);
  }
  const v12 = resolve(values.v12);
  const v13 = resolve(values.v13);
  const out = values.out ? resolve(values.out) : join(v13, 'sheets');
  await mkdir(out, { recursive: true });
  /** @type {unknown} */
  const report = JSON.parse(await readFile(join(v13, 'report.json'), 'utf8'));
  if (!isReport(report)) throw new Error(`${join(v13, 'report.json')} is not a render.mjs report`);
  const v13Label = `v13: mermaid@13.0.0-alpha.1 + mermaid-v13-plugins ${commit()}`;
  const tmp = await mkdtemp(join(tmpdir(), 'mermaid-v13-sheet-'));
  /** @type {string[]} */
  const rows = [];
  try {
    await withBrowser(async (browser) => {
      for (const o of report) {
        let ours;
        if (o.ok) {
          ours = join(tmp, `${o.name}.v13.png`);
          await rasterize(browser, await readFile(join(v13, `${o.name}.svg`), 'utf8'), ours);
        }
        let theirs;
        if (existsSync(join(v12, `${o.name}.svg`))) {
          theirs = join(tmp, `${o.name}.v12.png`);
          await rasterize(browser, await readFile(join(v12, `${o.name}.svg`), 'utf8'), theirs);
        } else if (existsSync(join(v12, `${o.name}.png`))) theirs = join(v12, `${o.name}.png`);
        const failure = o.error ? `${o.error.code}: ${o.error.message}` : 'no render';
        const warnings = (o.warnings ?? []).map((w) => `${w.code}: ${w.message}`);
        const html = `<!doctype html><html><head><style>${STYLE}</style></head><body><div id="sheet">
<h1>${esc(o.name)}</h1><div class="row">
${await panel(v13Label, ours, failure)}
${await panel(values['v12-label'], theirs, `no ${o.name}.svg or .png in ${v12}`)}
</div>${warnings.length ? `<div class="warn">${warnings.map(esc).join('<br>')}</div>` : ''}
</div></body></html>`;
        await screenshot(browser, html, '#sheet', join(out, `${o.name}.png`), { scale: 1 });
        const status = o.ok ? 'ok' : `FAIL ${o.error?.code ?? ''}`;
        rows.push(
          `<tr><td><a href="${encodeURIComponent(o.name)}.png">${esc(o.name)}</a></td>` +
            `<td>${esc(status)}</td><td>${warnings.length}</td><td>${theirs ? 'yes' : 'missing'}</td></tr>`,
        );
        process.stdout.write(`${status.padEnd(28)} ${o.name}\n`);
      }
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  const index = `<!doctype html><html><head><meta charset="utf-8"><title>v13 sheets</title>
<style>body{font:14px system-ui,sans-serif;margin:24px}td,th{padding:4px 10px;text-align:left}</style></head>
<body><h1>v13 vs v12 sheets</h1><p>${esc(v13Label)}<br>${esc(values['v12-label'])}</p>
<table><tr><th>diagram</th><th>v13</th><th>warnings</th><th>v12 reference</th></tr>
${rows.join('\n')}</table></body></html>\n`;
  await writeFile(join(out, 'index.html'), index);
  process.stdout.write(`${rows.length} sheets -> ${out}\n`);
}

await main();
