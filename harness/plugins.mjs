// @ts-check
/**
 * The plugins the harness registers, in order. `replace` is for ids the alpha already lists as
 * first-party types without a package (`c4`, `swimlane`): they must take that type's slot.
 *
 * @typedef {{ readonly name: string, readonly load: () => Promise<import('mermaid').ExternalDiagram>,
 *   readonly replace: boolean }} HarnessPlugin
 */

/** @type {readonly HarnessPlugin[]} */
export const PLUGINS = [
  {
    name: '@mermaid-v13-plugins/diagram-c4',
    load: async () => (await import('@mermaid-v13-plugins/diagram-c4')).c4,
    replace: true,
  },
  {
    name: '@mermaid-v13-plugins/diagram-c4 (the converged config keys)',
    load: async () => (await import('@mermaid-v13-plugins/diagram-c4')).c4Compat,
    replace: false,
  },
  {
    name: '@mermaid-v13-plugins/diagram-c4-beta',
    load: async () => (await import('@mermaid-v13-plugins/diagram-c4-beta')).c4Beta,
    replace: false,
  },
  {
    name: '@mermaid-v13-plugins/diagram-c4-beta (v12 theme variables and config key)',
    load: async () => (await import('@mermaid-v13-plugins/diagram-c4-beta')).c4BetaCompat,
    replace: false,
  },
  {
    name: '@mermaid-v13-plugins/diagram-swimlane',
    load: async () => (await import('@mermaid-v13-plugins/diagram-swimlane')).swimlane,
    replace: true,
  },
  {
    name: '@mermaid-v13-plugins/diagram-bpmn',
    load: async () => (await import('@mermaid-v13-plugins/diagram-bpmn')).bpmn,
    replace: false,
  },
];
