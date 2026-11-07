import { createMermaid } from 'mermaid';
import { swimlane } from '../src/plugin.ts';

let renderer: Promise<ReturnType<typeof createMermaid>> | undefined;

/** One mermaid API object with the swimlane plugin, as an app registers it. */
async function mermaid() {
  renderer ??= (async () => {
    const m = createMermaid();
    m.initialize({ discovery: false });
    await m.registerExternalDiagrams([swimlane], { replace: true });
    return m;
  })();
  return renderer;
}

let count = 0;

/** The SVG of `text`, rendered in Node with no DOM. */
export async function renderText(text: string): Promise<string> {
  const m = await mermaid();
  const { svg } = await m.render(`swimlane-${String(++count)}`, text);
  return svg;
}

/** The SVG and the warnings of `text`. */
export async function renderWithWarnings(text: string) {
  const m = await mermaid();
  return m.render(`swimlane-${String(++count)}`, text);
}
