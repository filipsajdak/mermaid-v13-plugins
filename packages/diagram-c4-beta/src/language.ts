/**
 * The c4-beta language facet (`@mermaid-v13-plugins/diagram-c4-beta/language`): diagnostics,
 * highlight categories and element symbols. There are no completions or hover. Nothing here
 * imports the layout or the renderer.
 */
import type { LanguageFacet } from '@mermaid-js/core/parser-kit';
import { c4BetaCategories, parseC4Beta } from './parser/index.ts';
import type { C4BetaDocument } from './parser/index.ts';

export const c4BetaLanguage: LanguageFacet<C4BetaDocument> = {
  id: 'c4-beta',
  parse: (text, options) => parseC4Beta(text, options),
  categories: c4BetaCategories,
  namespaces: [['element']],
  isValidId: (name) =>
    /^[\w]+(?:-+[\w]+)*$/.test(name)
      ? undefined
      : 'An id is letters, digits and underscores, with dashes only between them.',
  completions: () => [],
  hover: () => undefined,
};

/** The facet under the fixed name the language service imports. */
export { c4BetaLanguage as language };
