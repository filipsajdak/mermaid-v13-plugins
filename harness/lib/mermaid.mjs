// @ts-check
/**
 * One mermaid v13 API object with our plugins, as an app would set it up in Node. The README's
 * "Try it" snippet makes the same calls.
 */
import { createMermaid } from 'mermaid';
import { PLUGINS } from '../plugins.mjs';
import { undeclaredAliases } from './svg-checks.mjs';

/**
 * @typedef {{ readonly name: string, readonly file: string, readonly ok: boolean,
 *   readonly svg?: string, readonly width?: number, readonly height?: number,
 *   readonly warnings?: readonly { code: string, message: string }[],
 *   readonly error?: { code: string, message: string } }} RenderOutcome
 */

/**
 * A mermaid API object with discovery off (the harness registers explicitly, so its renders do
 * not depend on what `node_modules` holds), our plugins, and `extra` plugins after them.
 * @param {{ extra?: readonly import('mermaid').ExternalDiagram[] }} [options]
 */
export async function createRenderer({ extra = [] } = {}) {
  const mermaid = createMermaid();
  mermaid.initialize({ discovery: false });
  for (const p of PLUGINS) {
    await mermaid.registerExternalDiagrams([await p.load()], { replace: p.replace });
  }
  if (extra.length > 0) await mermaid.registerExternalDiagrams(extra);
  return {
    mermaid,
    /**
     * Renders one source; never throws.
     * @param {string} name
     * @param {string} file
     * @param {string} text
     * @returns {Promise<RenderOutcome>}
     */
    async render(name, file, text) {
      try {
        const r = await mermaid.render(name, text);
        const warnings = r.warnings.map((w) => ({ code: w.code, message: w.message }));
        // The harness's own check, reported like a render warning.
        const undeclared = undeclaredAliases(r.svg);
        if (undeclared.length > 0) {
          warnings.push({
            code: 'HARNESS_UNDECLARED_ALIAS',
            message: `Theme aliases used but not declared on the root: ${undeclared.join(', ')}`,
          });
        }
        return { name, file, ok: true, svg: r.svg, width: r.width, height: r.height, warnings };
      } catch (e) {
        const code = e instanceof Error && 'code' in e ? String(e.code) : 'THROWN';
        const message = e instanceof Error ? e.message : String(e);
        return { name, file, ok: false, error: { code, message } };
      }
    },
  };
}
