/**
 * `bpmn-beta` diagrams as an unofficial Mermaid v13 plugin: BPMN 2.0.2 process and
 * collaboration diagrams, laid out in pools and lanes by the swimlane engine lifted from v12.
 */
import { bpmn } from './plugin.ts';

export { bpmn };
/** A `loader` that returns this module's namespace hands the registry its `diagram`. */
export const diagram = bpmn.diagram;
export { detector } from './detector.ts';
export { parseBpmn, T as BpmnTokenKind } from './parser.ts';
export type { BpmnDocument, BpmnParseOptions, BpmnParseResult } from './parser.ts';
export * from './model.ts';
export { BPMN_CONFIG_DEFAULTS, bpmnLayoutData, drawnAs } from './layout-data.ts';
export type { BpmnShape, Drawn, NodeSize } from './layout-data.ts';
export { layoutBpmn } from './layout.ts';
export type { BpmnLayout, PlacedBand, PlacedFlow, PlacedGroup, PlacedNode } from './layout.ts';
export { renderBpmn } from './render.ts';
