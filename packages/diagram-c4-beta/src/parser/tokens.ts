import {
  FIRST_DIAGRAM_KIND,
  kindCategories,
  Kind,
  SHARED_CATEGORIES,
} from '@mermaid-js/core/parser-kit';
import type { TokenCategory, TokenKind } from '@mermaid-js/core/parser-kit';

/** The c4-beta token kinds (parser-kit numbers, no enum). */
export const T = {
  /** A word: a keyword, an id, a style key or value. */
  Word: FIRST_DIAGRAM_KIND,
  Int: FIRST_DIAGRAM_KIND + 1,
  String: FIRST_DIAGRAM_KIND + 2,
  /** `:::tag`. */
  Tag: FIRST_DIAGRAM_KIND + 3,
  /** `-->`, `<--`, `<-->`, `---`. */
  Arrow: FIRST_DIAGRAM_KIND + 4,
  /** `#fff`, `#1168BD`. */
  Hex: FIRST_DIAGRAM_KIND + 5,
  Colon: FIRST_DIAGRAM_KIND + 6,
  Comma: FIRST_DIAGRAM_KIND + 7,
  LBrace: FIRST_DIAGRAM_KIND + 8,
  RBrace: FIRST_DIAGRAM_KIND + 9,
  /** A `title`, `accTitle` or `accDescr` statement, its text included. */
  Meta: FIRST_DIAGRAM_KIND + 10,
} as const;

export const c4BetaCategories: Readonly<Record<TokenKind, TokenCategory>> = {
  ...SHARED_CATEGORIES,
  ...kindCategories(T, {
    Word: 'Variable',
    Int: 'Number',
    String: 'String',
    Tag: 'Meta',
    Arrow: 'Operator',
    Hex: 'Constant',
    Colon: 'Punctuation',
    Comma: 'Punctuation',
    LBrace: 'Punctuation',
    RBrace: 'Punctuation',
    Meta: 'Keyword',
  }),
};

export { Kind };
