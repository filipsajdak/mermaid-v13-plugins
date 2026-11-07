import type { RenderContext } from '@mermaid-js/core';
import type { ResolvedConfig } from '@mermaid-js/core/config';
import type { LayoutGraph, LayoutModel } from '@mermaid-js/core/layout';
import { flowchartConfigDefaults } from '@mermaid-js/diagram-flowchart';

/**
 * The render context the flowchart plugin's stages get from this plugin: the `flowchart`
 * section with the flowchart's defaults under the author's values (a swimlane diagram is a
 * flowchart, and v12 handed it the flowchart config; v13 merges a section's defaults only for
 * its own plugin), and, for the layout, the swimlane engine in place of the `layout` engine.
 *
 * A proxy rather than a copy: the pipeline's context has a lazy `idPrefix` getter, which a
 * spread would run.
 */
export function flowchartContext(
  ctx: RenderContext,
  layout?: (graph: LayoutGraph) => LayoutModel,
): RenderContext {
  const config: ResolvedConfig = {
    ...ctx.config,
    flowchart: Object.assign({}, flowchartConfigDefaults, ctx.config.flowchart),
  };
  return new Proxy(ctx, {
    get: (target, key): unknown => {
      if (key === 'config') return config;
      if (key === 'layout' && layout) return layout;
      return Reflect.get(target, key);
    },
  });
}
