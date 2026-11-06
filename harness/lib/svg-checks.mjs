// @ts-check
/**
 * Checks on rendered SVG text that need no DOM.
 */

/**
 * Theme aliases (`var(--_x)`) the SVG uses but its root `style` never declares. The v13 theme
 * declares on the root only the aliases a renderer asked for before writing it, so a paint
 * asked for later draws with the browser default (black fills, invisible text).
 * @param {string} svg
 * @returns {string[]}
 */
export function undeclaredAliases(svg) {
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const style = /\sstyle="([^"]*)"/.exec(root)?.[1] ?? '';
  const declared = new Set([...style.matchAll(/(--_[\w-]+)\s*:/g)].map((m) => m[1] ?? ''));
  const used = new Set([...svg.matchAll(/var\((--_[\w-]+)/g)].map((m) => m[1] ?? ''));
  return [...used].filter((v) => !declared.has(v)).sort();
}
