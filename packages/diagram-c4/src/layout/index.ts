import type { RenderContext } from '@mermaid-js/core';
import type { C4Model } from '../parser/index.ts';

/** Where everything of a C4 diagram goes, in px. */
export interface C4Layout {
  readonly width: number;
  readonly height: number;
}

/** Lays out a C4 diagram. Stage 0: nothing to place yet. */
export function layoutC4(_model: C4Model, _ctx: RenderContext): C4Layout {
  return { width: 0, height: 0 };
}
