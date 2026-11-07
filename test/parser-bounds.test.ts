/**
 * Inputs that once made a parser loop or go quadratic, each parsed in a worker under a time
 * bound: ids that nest into themselves, and long runs of whitespace or blank lines.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundedParse } from './lib/bounded.ts';

const C4_BETA = pathToFileURL(
  join(import.meta.dirname, '../packages/diagram-c4-beta/src/parser/index.ts'),
).href;
const C4 = pathToFileURL(
  join(import.meta.dirname, '../packages/diagram-c4/src/parser/index.ts'),
).href;

/** A worker that has not answered by now is taken to loop. */
const HANG_LIMIT_MS = 10_000;
/** A linear parse of these inputs takes a few milliseconds; a quadratic one takes minutes. */
const PARSE_BUDGET_MS = 1_000;
/** Vitest's own limit for a test: room for the worker's limit to fire first. */
const TEST_TIMEOUT_MS = 2 * HANG_LIMIT_MS;
/** The sizes the security review asked for. */
const SPACES = 200_000;
const BLANK_LINES = 50_000;

const spaces = ' '.repeat(SPACES);
const blankLines = '\n'.repeat(BLANK_LINES);

describe('c4-beta: an id nested into itself', () => {
  it.each([
    ['two levels deep', 'softwareSystem a "A" {\n container a "A2" {\n component b "B"\n }\n }'],
    [
      'three levels deep',
      'softwareSystem a "A" {\n container b "B" {\n component a "A2" {\n component c "C"\n }\n }\n }',
    ],
    [
      'twice on one path',
      'softwareSystem a "A" {\n container a "A2" {\n component a "A3" {\n component d "D"\n }\n }\n }',
    ],
  ])(
    'is reported without looping, %s',
    async (_, body) => {
      const r = await boundedParse(C4_BETA, 'parseC4Beta', `c4-beta\n${body}\n`, HANG_LIMIT_MS);
      expect(r.ms).toBeLessThan(PARSE_BUDGET_MS);
      expect(r.codes).toContain('C4B_ID_INSIDE_ITSELF');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('long whitespace runs parse in linear time', () => {
  it.each([
    [
      'c4-beta: spaces inside accDescr { }',
      C4_BETA,
      'parseC4Beta',
      `c4-beta\naccDescr {\na${spaces}b\n${spaces}c\n}\n`,
      'a b\nc',
    ],
    [
      'c4-beta: blank lines inside accDescr { }',
      C4_BETA,
      'parseC4Beta',
      `c4-beta\naccDescr {\na${blankLines}b\n}\n`,
      'a\nb',
    ],
    [
      'legacy C4: spaces inside accDescr { }',
      C4,
      'parseC4',
      `C4Context\naccDescr {\na${spaces}b\n${spaces}c\n}\n`,
      undefined,
    ],
    [
      'legacy C4: blank lines inside accDescr { }',
      C4,
      'parseC4',
      `C4Context\naccDescr {\na${blankLines}b\n}\n`,
      undefined,
    ],
  ])(
    '%s',
    async (_, module, fn, text, accDescr) => {
      const r = await boundedParse(module, fn, text, HANG_LIMIT_MS);
      expect(r.ms).toBeLessThan(PARSE_BUDGET_MS);
      if (accDescr !== undefined) expect(r.model).toMatchObject({ accDescr });
    },
    TEST_TIMEOUT_MS,
  );
});
