import type { DiagramPlugin } from '@mermaid-js/core';
import { resolveLimits } from '@mermaid-js/core/limits';
import { c4BetaConfigDefaults } from './config.ts';
import { detector } from './detector.ts';
import { c4BetaLabels } from './labels.ts';
import { layoutC4Beta } from './layout/index.ts';
import type { C4BetaLayout } from './layout/index.ts';
import { parseC4Beta } from './parser/index.ts';
import type { C4BetaModel } from './parser/index.ts';
import { renderC4Beta } from './render/index.ts';

const plugin: DiagramPlugin<C4BetaModel, C4BetaLayout> = {
  id: 'c4-beta',
  formats: ['svg'],
  layoutKind: 'graph',
  configDefaults: c4BetaConfigDefaults,
  detector,
  parse: (text, ctx) =>
    parseC4Beta(text, {
      preprocessed: ctx.preprocessed,
      limits: ctx.limits ?? resolveLimits(ctx.config),
    }),
  labels: c4BetaLabels,
  layout: layoutC4Beta,
  render: renderC4Beta,
};

/**
 * The c4-beta plugin, under its own id: no first-party row claims `c4-beta`, so it registers
 * without `replace` and is detected after every first-party type.
 *
 * It names itself as `diagram`. On its lazy paths (a `loader`, and a package's `mermaid`
 * manifest) alpha.1's registry takes `diagram`, else `layout`, from whatever was loaded, so a
 * plugin without this member loads its own `layout` function as the plugin.
 */
export const c4Beta: DiagramPlugin<C4BetaModel, C4BetaLayout> & {
  readonly diagram: DiagramPlugin<C4BetaModel, C4BetaLayout>;
} = { ...plugin, diagram: plugin };
