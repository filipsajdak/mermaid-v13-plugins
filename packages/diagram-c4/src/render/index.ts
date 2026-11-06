import type { RenderContext } from '@mermaid-js/core';
import { styleText } from '@mermaid-js/core/svg';
import type { SvgWriter } from '@mermaid-js/core/svg';
import type { C4Layout } from '../layout/index.ts';
import type { C4Model } from '../parser/index.ts';

/** Writes the whole `<svg>` document of a laid-out C4 diagram. Stage 0: the root only. */
export function renderC4(model: C4Model, layout: C4Layout, ctx: RenderContext, w: SvgWriter): void {
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-c4',
    viewBox: [0, 0, layout.width, layout.height],
    width: layout.width,
    height: layout.height,
    role: 'img',
    'aria-roledescription': model.kind ?? 'c4',
    'data-mermaid-version': ctx.version,
    style: styleText({}, ctx.theme.rootStyleText()),
  });
  w.close();
}
