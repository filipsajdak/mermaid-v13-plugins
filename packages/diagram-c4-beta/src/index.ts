/**
 * c4-beta, the compact Structurizr-style C4 syntax, as an unofficial Mermaid v13 plugin.
 * Imports `@mermaid-js/core` and this repository's c4-shared only.
 */
import { c4Beta } from './plugin.ts';

export { c4Beta };
/** A `loader` that returns this module's namespace hands the registry its `diagram`. */
export const diagram = c4Beta.diagram;
export { c4BetaCompat, c4BetaConfigDefaults, C4_THEME_DEFAULTS } from './config.ts';
export { detector } from './detector.ts';
export { parseC4Beta } from './parser/index.ts';
export type * from './parser/index.ts';
export { boundaryIds, layoutC4Beta } from './layout/index.ts';
export type { C4BetaLayout } from './layout/index.ts';
export { renderC4Beta } from './render/index.ts';
