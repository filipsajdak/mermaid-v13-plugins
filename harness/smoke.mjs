#!/usr/bin/env node
// @ts-check
/**
 * The CI smoke: renders the smoke fixtures in Node (no DOM, no browser) and checks that each
 * renders, that its SVG passes core's well-formedness and allow-list check (`assertInert`), that
 * every theme alias it uses is declared, and that every label it expects is in the SVG text.
 */
import { readFile } from 'node:fs/promises';
import { assertInert } from '@mermaid-js/core/svg';
import { placeholder } from './fixtures/placeholder-plugin.mjs';
import { createRenderer } from './lib/mermaid.mjs';
import { undeclaredAliases } from './lib/svg-checks.mjs';

/** Each fixture and the labels its SVG must contain, as XML-escaped text. */
const CASES = [
  {
    file: new URL('./fixtures/smoke/placeholder.mmd', import.meta.url),
    labels: ['First box', 'Second box &amp; more', 'Third &lt;box&gt;'],
    absent: ['a comment is not a box'],
  },
];

const renderer = await createRenderer({ extra: [placeholder] });
let failed = 0;
for (const c of CASES) {
  const name = c.file.pathname.split('/').pop() ?? 'smoke';
  const o = await renderer.render('smoke', c.file.pathname, await readFile(c.file, 'utf8'));
  /** @type {string[]} */
  const problems = [];
  if (!o.ok || o.svg === undefined)
    problems.push(`did not render: ${o.error?.code ?? ''} ${o.error?.message ?? ''}`);
  else {
    try {
      assertInert(o.svg);
    } catch (e) {
      problems.push(`not inert: ${e instanceof Error ? e.message : String(e)}`);
    }
    const undeclared = undeclaredAliases(o.svg);
    if (undeclared.length > 0)
      problems.push(`theme aliases never declared: ${undeclared.join(', ')}`);
    for (const l of c.labels) if (!o.svg.includes(l)) problems.push(`label missing: ${l}`);
    for (const l of c.absent) if (o.svg.includes(l)) problems.push(`unexpected text: ${l}`);
  }
  if (problems.length > 0) failed++;
  process.stdout.write(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${name}\n`);
  for (const p of problems) process.stdout.write(`     ${p}\n`);
}
if (failed > 0) process.exitCode = 1;
