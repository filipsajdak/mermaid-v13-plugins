/**
 * The C4 language facet (`@mermaid-v13-plugins/diagram-c4/language`): diagnostics, highlight
 * categories and alias symbols. There are no completions or hover. Nothing here imports the
 * layout or the renderer.
 */
import type { LanguageFacet } from '@mermaid-js/core/parser-kit';
import { c4Categories, parseC4 } from './parser/index.ts';
import type { C4Document } from './parser/index.ts';

export const c4Language: LanguageFacet<C4Document> = {
  id: 'c4',
  parse: (text, options) => parseC4(text, options),
  categories: c4Categories,
  namespaces: [['alias']],
  isValidId: (name) => {
    if (name === '') return 'An alias cannot be empty.';
    if (/[,()"\r\n]/.test(name))
      return 'An alias cannot contain a comma, a parenthesis, a quote or a line break.';
    if (name !== name.trim()) return 'An alias cannot start or end with a space.';
    return undefined;
  },
  completions: () => [],
  hover: () => undefined,
};

/** The facet under the fixed name the language service imports. */
export { c4Language as language };
