// @ts-check
/**
 * A deliberately trivial diagram plugin: one box per line of text under its keyword. It is not
 * C4 and draws nothing C4 needs; it exists so the harness smoke and the registration tests can
 * prove the plumbing (detect, parse, measure, render, register) without a real diagram.
 */
import { ParseState, TokenWriter } from '@mermaid-js/core/parser-kit';
import { diagramStart } from '@mermaid-js/core/preprocess';
import { px, styleText } from '@mermaid-js/core/svg';
import { layoutLabel } from '@mermaid-js/core/text';

const PAD = 8;
const GAP = 8;

/**
 * @typedef {{ readonly lines: readonly string[] }} PlaceholderModel
 * @typedef {{
 *   readonly width: number,
 *   readonly height: number,
 *   readonly boxes: readonly { readonly y: number, readonly w: number, readonly h: number,
 *     readonly label: import('@mermaid-js/core/text').MeasuredLabel }[],
 * }} PlaceholderLayout
 */

/** Escapes a keyword for use in a regular expression. */
const literal = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A placeholder plugin for `keyword`, registered under `id`.
 * @param {{ id: string, keyword: string }} options
 * @returns {import('@mermaid-js/core').DiagramPlugin<PlaceholderModel, PlaceholderLayout>}
 */
export function placeholderPlugin({ id, keyword }) {
  const header = new RegExp(`^\\s*${literal(keyword)}(?![\\w-])`);
  return {
    id,
    formats: ['svg'],
    layoutKind: 'custom',
    detector: (text) => header.test(text),
    parse(text, ctx) {
      const state = new ParseState();
      const start = diagramStart(text, ctx.preprocessed);
      const body = text.slice(start + keyword.length);
      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('%%'));
      const ast = { id: 'doc', type: 'placeholder', range: { start: 0, end: text.length } };
      return state.result({ lines }, ast, new TokenWriter(0).finish(text));
    },
    layout(model, ctx) {
      const font = {
        family: ctx.theme.value('fontFamily'),
        size: ctx.theme.number('fontSize'),
        weight: 400,
      };
      let y = PAD;
      let width = 0;
      const boxes = model.lines.map((line) => {
        const label = layoutLabel(line, font, Infinity, ctx.measurer);
        const box = { y, w: label.width + 2 * PAD, h: label.height + 2 * PAD, label };
        y += box.h + GAP;
        width = Math.max(width, box.w);
        return box;
      });
      return { width: width + 2 * PAD, height: Math.max(y - GAP + PAD, 2 * PAD), boxes };
    },
    render(_model, layout, ctx, w) {
      const { theme } = ctx;
      // Every paint is asked for before the root is written: the root's `style` declares only
      // the theme aliases used so far, and a streamed root cannot be patched afterwards.
      const paint = {
        font: theme.font(),
        fontSize: theme.length('fontSize'),
        fill: theme.color('mainBkg'),
        stroke: theme.color('nodeBorder'),
        text: theme.color('nodeTextColor'),
      };
      w.open('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        class: `mermaid mermaid-${id}`,
        viewBox: [0, 0, layout.width, layout.height],
        width: layout.width,
        height: layout.height,
        role: 'img',
        'aria-roledescription': id,
        'data-mermaid-version': ctx.version,
        style: styleText({ 'max-width': px(layout.width) }, theme.rootStyleText()),
        'font-family': paint.font,
        'font-size': paint.fontSize,
      });
      for (const [i, b] of layout.boxes.entries()) {
        w.open('g', { class: 'node', 'data-id': `line-${i + 1}` });
        w.leaf('rect', {
          x: PAD,
          y: b.y,
          width: b.w,
          height: b.h,
          fill: paint.fill,
          stroke: paint.stroke,
        });
        w.label(b.label, PAD + b.w / 2, b.y + b.h / 2, { fill: paint.text });
        w.close();
      }
      w.close();
    },
  };
}

/** The placeholder the harness smoke draws: keyword `placeholder-beta`. */
export const placeholder = placeholderPlugin({ id: 'placeholder', keyword: 'placeholder-beta' });
