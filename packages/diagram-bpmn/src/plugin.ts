import type { DiagramPlugin } from '@mermaid-js/core';
import { resolveLimits } from '@mermaid-js/core/limits';
import { detector } from './detector.ts';
import { BPMN_CONFIG_DEFAULTS } from './layout-data.ts';
import { layoutBpmn } from './layout.ts';
import type { BpmnLayout } from './layout.ts';
import type { BpmnModel } from './model.ts';
import { parseBpmn } from './parser.ts';
import { renderBpmn } from './render.ts';

/**
 * The bpmn-beta plugin. Its id is `bpmn`, v12's diagram type, which the alpha does not list, so
 * it registers without `replace`; the id is also its config section, so v12's `bpmn` options
 * apply unchanged. It is always laid out in pools and lanes by the swimlane engine, as in v12,
 * whatever `layout` says (`layoutKind: 'custom'`).
 */
export const bpmn: DiagramPlugin<BpmnModel, BpmnLayout> = {
  id: 'bpmn',
  formats: ['svg'],
  layoutKind: 'custom',
  configDefaults: BPMN_CONFIG_DEFAULTS,
  detector,
  parse: (text, ctx) => {
    const caps = ctx.limits ?? resolveLimits(ctx.config);
    return parseBpmn(text, {
      preprocessed: ctx.preprocessed,
      maxNodes: caps.maxNodes,
      maxEdges: caps.maxEdges,
      maxDepth: caps.maxDepth,
    });
  },
  labels: (model) => [
    ...model.nodes.map((n) => n.label).filter((l) => l !== ''),
    ...model.flows.flatMap((f) => (f.label ? [f.label] : [])),
  ],
  layout: layoutBpmn,
  render: renderBpmn,
};
