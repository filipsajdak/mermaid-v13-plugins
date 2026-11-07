/**
 * `swimlane-beta` diagrams as an unofficial Mermaid v13 plugin. It reuses the first-party
 * flowchart plugin's parser, measuring and drawing, and lays the diagram out with the swimlane
 * engine lifted from mermaid v12.
 */
import { swimlane } from './plugin.ts';

export { swimlane };
/** A `loader` that returns this module's namespace hands the registry its `diagram`. */
export const diagram = swimlane.diagram;
export { detector } from './detector.ts';
export { parseSwimlane } from './parser.ts';
export type { SwimlaneParseOptions, SwimlaneParseResult } from './parser.ts';
export type { SwimlaneModel, SwimlanePhase } from './model.ts';
export { layoutSwimlane } from './layout.ts';
export type { LaneBox, Rect, SwimlaneLayout } from './layout.ts';
export { renderSwimlane } from './render.ts';
