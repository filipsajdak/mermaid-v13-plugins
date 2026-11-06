import { ParseState, TokenWriter } from '@mermaid-js/core/parser-kit';
import type { ParseOptions, ParseResult } from '@mermaid-js/core/parser-kit';
import { diagramStart, preprocess } from '@mermaid-js/core/preprocess';
import type { PreprocessResult } from '@mermaid-js/core/preprocess';
import type { C4DiagramKind, C4Document, C4Model } from './model.ts';

export interface C4ParseOptions extends ParseOptions {
  /** The preprocess result the pipeline already has; computed here when absent. */
  readonly preprocessed?: PreprocessResult;
}

export type C4ParseResult = ParseResult<C4Model, C4Document>;

const KINDS: readonly C4DiagramKind[] = [
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

/** The keyword at `start`, when one is there and is a whole word. */
function kindAt(text: string, start: number): C4DiagramKind | undefined {
  return KINDS.find(
    (k) => text.startsWith(k, start) && !/[\w-]/.test(text.charAt(start + k.length)),
  );
}

/**
 * Parses a C4 diagram. `text` is the whole source; every range is an offset into it. Never
 * throws.
 *
 * Stage 0 of the port: only the keyword is read. Anything after it is reported as
 * `C4_NOT_PORTED`, so the diagram fails with a clear message rather than drawing a guess.
 */
export function parseC4(text: string, options: C4ParseOptions = {}): C4ParseResult {
  const state = new ParseState();
  const pre = options.preprocessed ?? preprocess(text);
  const start = diagramStart(text, pre);
  const kind = kindAt(text, start);
  if (kind === undefined) {
    state.diagnostics.error(
      'C4_NO_KEYWORD',
      'A C4 diagram starts with C4Context, C4Container, C4Component, C4Dynamic or C4Deployment.',
      { start, end: Math.min(text.length, start + 1) },
    );
  } else {
    state.statement('header', { start, end: start + kind.length });
    state.diagnostics.error(
      'C4_NOT_PORTED',
      `${kind} diagrams are not ported to Mermaid v13 yet.`,
      { start, end: start + kind.length },
    );
  }
  const ast: C4Document = { id: 'doc', type: 'c4Document', range: { start: 0, end: text.length } };
  return state.result({ kind }, ast, new TokenWriter(0).finish(text), options);
}
