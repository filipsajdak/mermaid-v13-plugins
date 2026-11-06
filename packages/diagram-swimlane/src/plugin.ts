import type { DiagramPlugin } from '@mermaid-js/core';
import { resolveLimits } from '@mermaid-js/core/limits';
import { detector } from './detector.ts';
import { layoutSwimlane } from './layout.ts';
import type { SwimlaneLayout } from './layout.ts';
import type { SwimlaneModel } from './model.ts';
import { parseSwimlane } from './parser.ts';
import { renderSwimlane } from './render.ts';

/**
 * The swimlane plugin: `swimlane-beta` diagrams, which are flowcharts laid out in lanes. Its id
 * is `swimlane`, a type the v13 alpha detects but has no package for, so it registers with
 * `registerExternalDiagrams([swimlane], { replace: true })`.
 *
 * `layoutKind` is `custom`: the swimlane engine always lays it out, whatever `layout` says.
 */
export const swimlane: DiagramPlugin<SwimlaneModel, SwimlaneLayout> = {
  id: 'swimlane',
  formats: ['svg'],
  layoutKind: 'custom',
  detector,
  parse: (text, ctx) => {
    const caps = ctx.limits ?? resolveLimits(ctx.config);
    return parseSwimlane(text, {
      preprocessed: ctx.preprocessed,
      maxEdges: caps.maxEdges,
      maxNodes: caps.maxNodes,
      maxDepth: caps.maxDepth,
      ...(ctx.config.flowchart?.inheritDir === undefined
        ? {}
        : { inheritDir: ctx.config.flowchart.inheritDir }),
      ...(ctx.claims === undefined ? {} : { claims: ctx.claims }),
    });
  },
  layout: layoutSwimlane,
  render: renderSwimlane,
};
