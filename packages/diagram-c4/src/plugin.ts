import type { DiagramPlugin } from '@mermaid-js/core';
import { resolveLimits } from '@mermaid-js/core/limits';
import { c4ConfigDefaults } from './config.ts';
import { detector } from './detector.ts';
import { layoutC4 } from './layout/index.ts';
import type { C4Layout } from './layout/index.ts';
import { parseC4 } from './parser/index.ts';
import type { C4Model } from './parser/index.ts';
import { c4Labels } from './labels.ts';
import { renderC4 } from './render/index.ts';

/**
 * The legacy C4 plugin. Its id is `c4`, a first-party v12 type that the v13 alpha detects but
 * has no package for, so it registers with `registerExternalDiagrams([c4], { replace: true })`
 * and takes that type's place in the detection order.
 */
export const c4: DiagramPlugin<C4Model, C4Layout> = {
  id: 'c4',
  aliases: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'],
  formats: ['svg'],
  layoutKind: 'graph',
  configDefaults: c4ConfigDefaults,
  detector,
  parse: (text, ctx) =>
    parseC4(text, {
      preprocessed: ctx.preprocessed,
      limits: ctx.limits ?? resolveLimits(ctx.config),
    }),
  labels: c4Labels,
  layout: layoutC4,
  render: renderC4,
};
