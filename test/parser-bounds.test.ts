/**
 * Inputs that once made a parser loop, each parsed in a worker under a time bound: ids that
 * nest into themselves.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundedParse } from './lib/bounded.ts';

const C4_BETA = pathToFileURL(
  join(import.meta.dirname, '../packages/diagram-c4-beta/src/parser/index.ts'),
).href;

/** A worker that has not answered by now is taken to loop. */
const HANG_LIMIT_MS = 10_000;
/** A parse of these inputs takes a few milliseconds. */
const PARSE_BUDGET_MS = 1_000;
/** Vitest's own limit for a test: room for the worker's limit to fire first. */
const TEST_TIMEOUT_MS = 2 * HANG_LIMIT_MS;

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
