/**
 * The C4 language facet (`@mermaid-v13-plugins/diagram-c4/language`): diagnostics only. The
 * language service gets every parse error with its range; there are no completions, hover or
 * highlight categories yet. Nothing here imports the layout or the renderer.
 */
import type { LanguageFacet } from '@mermaid-js/core/parser-kit';
import { parseC4 } from './parser/index.ts';
import type { C4Document } from './parser/index.ts';

export const c4Language: LanguageFacet<C4Document> = {
  id: 'c4',
  parse: (text, options) => parseC4(text, options),
  categories: {},
  namespaces: [],
  isValidId: () => 'C4 aliases are not checked yet.',
  completions: () => [],
  hover: () => undefined,
};

/** The facet under the fixed name the language service imports. */
export { c4Language as language };
