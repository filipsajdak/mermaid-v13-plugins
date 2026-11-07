import type { FlowModel } from '@mermaid-js/diagram-flowchart';

/** A `phase id["Title"]` declaration. */
export interface SwimlanePhase {
  readonly id: string;
  /** The title as written, without its quotes; the id when the declaration has none. */
  readonly label: string;
  /** `markdown` for a "`…`" title, as the flowchart marks a subgraph title. */
  readonly labelType: 'text' | 'markdown';
}

/**
 * The parsed swimlane diagram: the flowchart model, plus the phases, which the flowchart
 * syntax has no place for. Plain and serialisable, as the v13 contract asks.
 */
export interface SwimlaneModel {
  readonly flow: FlowModel;
  /** In declaration order, which is the order the bands are drawn in. */
  readonly phases: readonly SwimlanePhase[];
  /** `[node id, phase id]` for every node that names a declared phase; the last mention wins. */
  readonly nodePhases: readonly (readonly [string, string])[];
  /**
   * Nodes listed in two lanes: a node stays in the first subgraph that lists it, and the
   * flowchart model leaves it out of the others without a trace. v12's flowDb kept this list
   * (`droppedSubGraphMembers`) so the layout could warn and drop a lane it emptied.
   */
  readonly sharedNodes: readonly SharedNode[];
}

/** A node a later subgraph listed, kept by an earlier one. */
export interface SharedNode {
  readonly node: string;
  readonly keptBy: string;
  readonly droppedFrom: string;
}
