/**
 * Legacy C4 diagrams (`C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`)
 * as an unofficial Mermaid v13 plugin. Imports `@mermaid-js/core` only.
 */
export { c4 } from './plugin.ts';
export { detector } from './detector.ts';
export { parseC4 } from './parser/index.ts';
export type * from './parser/index.ts';
export { layoutC4 } from './layout/index.ts';
export type { C4Layout } from './layout/index.ts';
export { renderC4 } from './render/index.ts';
