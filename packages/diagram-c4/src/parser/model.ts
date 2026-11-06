import type { AstNode } from '@mermaid-js/core/parser-kit';

/** The five C4 diagram keywords, as v12's grammar names them. */
export type C4DiagramKind =
  'C4Context' | 'C4Container' | 'C4Component' | 'C4Dynamic' | 'C4Deployment';

/** The kinds of element, internal and external (v12 `typeC4Shape`). */
export type C4ElementType =
  | 'person'
  | 'external_person'
  | 'system'
  | 'system_db'
  | 'system_queue'
  | 'external_system'
  | 'external_system_db'
  | 'external_system_queue'
  | 'container'
  | 'container_db'
  | 'container_queue'
  | 'external_container'
  | 'external_container_db'
  | 'external_container_queue'
  | 'component'
  | 'component_db'
  | 'component_queue'
  | 'external_component'
  | 'external_component_db'
  | 'external_component_queue';

/** The kinds of relationship. `RelIndex` is a `rel` whose index is dropped, as in v12. */
export type C4RelType = 'rel' | 'birel' | 'rel_u' | 'rel_d' | 'rel_l' | 'rel_r' | 'rel_b';

/** The deployment node keywords: `Node` and `Deployment_Node`, `Node_L`, `Node_R`. */
export type C4NodeType = 'node' | 'nodeL' | 'nodeR';

/** Flow direction of the diagram or of one boundary. */
export type C4Direction = 'TB' | 'BT' | 'LR' | 'RL';

/**
 * What `UpdateElementStyle` can set on an element or boundary. Values are kept as written;
 * colours are checked when they are drawn.
 */
export interface C4ElementStyle {
  bgColor?: string;
  fontColor?: string;
  borderColor?: string;
  shadowing?: string;
  shape?: string;
  /** Only `"false"` hides the stereotype line. */
  showStereotype?: string;
  legendText?: string;
  legendSprite?: string;
}

/** Fields every declared box has. */
interface Declared {
  readonly alias: string;
  /** AST id of the statement that declared it first (`n:<alias>` or `s:<alias>`). */
  readonly ast: string;
  label: string;
  descr: string;
  sprite?: string;
  tags?: string;
  link?: string;
  /** Alias of the enclosing boundary; undefined at the top level. */
  parent?: string;
  style: C4ElementStyle;
  /** Named attributes this port does not use, kept as written (`$foo="bar"`). */
  other: Record<string, string>;
}

/** A person, system, container or component. */
export interface C4Element extends Declared {
  type: C4ElementType;
  techn: string;
}

/** A boundary or deployment node: a box that holds other elements. */
export interface C4Boundary extends Declared {
  /**
   * The boundary type as v12 stores it: the keyword's kind in upper case (`ENTERPRISE`,
   * `SYSTEM`, `CONTAINER`), the default (`system`, `node`), or what the diagram wrote.
   */
  type: string;
  /** Set for `Node`, `Deployment_Node`, `Node_L` and `Node_R`. */
  nodeType?: C4NodeType;
  direction?: C4Direction;
}

/** A relationship. Each statement makes its own, even between the same pair. */
export interface C4Rel {
  /** AST id of its statement (`e:<from>><to>`, `#2` for a repeat). */
  readonly ast: string;
  readonly type: C4RelType;
  readonly from: string;
  readonly to: string;
  label: string;
  techn: string;
  descr: string;
  sprite?: string;
  tags?: string;
  link?: string;
  textColor?: string;
  lineColor?: string;
  offsetX?: number;
  offsetY?: number;
  other: Record<string, string>;
}

/** An `AddElementTag` style, applied to elements that name it in `$tags`. */
export interface C4ElementTag {
  readonly tagName: string;
  bgColor?: string;
  fontColor?: string;
  borderColor?: string;
  shape?: string;
  other: Record<string, string>;
}

/** An `AddRelTag` style, applied to relationships that name it in `$tags`. */
export interface C4RelTag {
  readonly tagName: string;
  textColor?: string;
  lineColor?: string;
  other: Record<string, string>;
}

/** The parsed C4 diagram: plain and serialisable, as the v13 contract asks. */
export interface C4Model {
  /** The keyword the diagram starts with; undefined when the text has none. */
  readonly kind: C4DiagramKind | undefined;
  title: string;
  accTitle: string;
  accDescr: string;
  direction: C4Direction;
  /** In declaration order; a repeated alias updates the first declaration in place. */
  elements: C4Element[];
  boundaries: C4Boundary[];
  rels: C4Rel[];
  elementTags: C4ElementTag[];
  relTags: C4RelTag[];
}

/** A statement in the AST. A boundary's statements are its children. */
export interface C4Statement extends AstNode {
  /** The statement keyword as written (`Person`, `Rel_U`, `title`). */
  readonly keyword: string;
}

/** The root of the C4 AST: one child per top-level statement. */
export interface C4Document extends AstNode<'c4Document'> {
  children: C4Statement[];
}
