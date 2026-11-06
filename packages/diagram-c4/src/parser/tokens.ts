import {
  FIRST_DIAGRAM_KIND,
  kindCategories,
  Kind,
  SHARED_CATEGORIES,
} from '@mermaid-js/core/parser-kit';
import type { TokenCategory, TokenKind } from '@mermaid-js/core/parser-kit';

/** The C4 token kinds (parser-kit numbers, no enum). */
export const T = {
  /** `C4Context` and the other four diagram keywords. */
  Header: FIRST_DIAGRAM_KIND,
  /** A statement keyword: `Person`, `Rel_U`, `System_Boundary`, `UpdateElementStyle`, ... */
  Keyword: FIRST_DIAGRAM_KIND + 1,
  /** `title`, `accTitle`, `accDescr`, `accDescription`, `direction`. */
  Meta: FIRST_DIAGRAM_KIND + 2,
  /** The text of a title or accessibility statement. */
  MetaText: FIRST_DIAGRAM_KIND + 3,
  /** `TB`, `BT`, `LR` or `RL` after `direction`. */
  Direction: FIRST_DIAGRAM_KIND + 4,
  LParen: FIRST_DIAGRAM_KIND + 5,
  RParen: FIRST_DIAGRAM_KIND + 6,
  Comma: FIRST_DIAGRAM_KIND + 7,
  /** A quoted argument, quotes included. */
  String: FIRST_DIAGRAM_KIND + 8,
  /** An unquoted argument. */
  Text: FIRST_DIAGRAM_KIND + 9,
  /** `$name=` of a named argument; its value is a {@link T.String}. */
  NamedKey: FIRST_DIAGRAM_KIND + 10,
  LBrace: FIRST_DIAGRAM_KIND + 11,
  RBrace: FIRST_DIAGRAM_KIND + 12,
} as const;

/** Highlight category of every kind the C4 parser emits. */
export const c4Categories: Readonly<Record<TokenKind, TokenCategory>> = {
  ...SHARED_CATEGORIES,
  ...kindCategories(T, {
    Header: 'Keyword',
    Keyword: 'Function',
    Meta: 'Keyword',
    MetaText: 'String',
    Direction: 'Constant',
    LParen: 'Punctuation',
    RParen: 'Punctuation',
    Comma: 'Punctuation',
    String: 'String',
    Text: 'Variable',
    NamedKey: 'Variable',
    LBrace: 'Punctuation',
    RBrace: 'Punctuation',
  }),
};

export { Kind };
