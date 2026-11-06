import type { AstNode } from '@mermaid-js/core/parser-kit';

/** The five C4 diagram keywords, as v12's grammar names them. */
export type C4DiagramKind =
  'C4Context' | 'C4Container' | 'C4Component' | 'C4Dynamic' | 'C4Deployment';

/** The parsed C4 diagram: plain and serialisable, as the v13 contract asks. */
export interface C4Model {
  /** The keyword the diagram starts with; undefined when the text has none. */
  readonly kind: C4DiagramKind | undefined;
}

/** The root of the C4 AST. */
export type C4Document = AstNode<'c4Document'>;
