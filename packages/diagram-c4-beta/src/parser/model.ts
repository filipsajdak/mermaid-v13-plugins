import type { AstNode } from '@mermaid-js/core/parser-kit';

/** The `c4-beta <kind>` keyword; `context` when the header names none. */
export type C4BetaKind = 'context' | 'container' | 'component' | 'dynamic' | 'deployment';

export type C4BetaDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type C4BetaElementKind =
  | 'person'
  | 'softwareSystem'
  | 'container'
  | 'component'
  | 'group'
  | 'deploymentNode'
  | 'infrastructureNode';

export type C4BetaArrow = '-->' | '<--' | '<-->' | '---';

export type C4BetaLine = 'solid' | 'dashed' | 'dotted';

/** An element. One with children (or a group or deployment node) is drawn as a boundary. */
export interface C4BetaElement {
  readonly id: string;
  /** AST id of its statement. */
  readonly ast: string;
  readonly kind: C4BetaElementKind;
  readonly name: string;
  readonly description?: string;
  /** Kept only on container, component, deploymentNode and infrastructureNode, as in v12. */
  technology?: string;
  /** Kept only on a deploymentNode, as in v12. */
  instances?: string;
  readonly tags: readonly string[];
  /** Id of the enclosing element; undefined at the top level. */
  readonly parent?: string;
}

export interface C4BetaRelationship {
  readonly ast: string;
  readonly source: string;
  readonly target: string;
  readonly arrow: C4BetaArrow;
  readonly description?: string;
  readonly technology?: string;
  /** The `N:` prefix as written. */
  readonly step?: number;
  readonly tags: readonly string[];
}

/** What a `style <tag> ...` statement sets. */
export interface C4BetaTagStyle {
  shape?: 'cylinder';
  fill?: string;
  stroke?: string;
  color?: string;
  line?: C4BetaLine;
}

/** The parsed c4-beta diagram: plain and serialisable. */
export interface C4BetaModel {
  readonly kind: C4BetaKind;
  title: string;
  accTitle: string;
  accDescr: string;
  direction: C4BetaDirection;
  /** `legend on|off`; on by default, as in v12. */
  legend: boolean;
  readonly elements: C4BetaElement[];
  readonly relationships: C4BetaRelationship[];
  /** Tag styles in declaration order; a later statement for a tag adds to it. */
  readonly styles: [tag: string, style: C4BetaTagStyle][];
}

/** A statement in the AST; an element with a block holds its children. */
export interface C4BetaStatement extends AstNode {
  readonly keyword: string;
}

export interface C4BetaDocument extends AstNode<'c4BetaDocument'> {
  children: C4BetaStatement[];
}
