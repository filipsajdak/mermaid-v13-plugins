/**
 * The `c4` config section: the converged v12 schema's defaults (`C4DiagramConfig` in
 * `config.schema.yaml`), and typed reads of the resolved section.
 */
import type { ExtensionPlugin } from '@mermaid-js/core';
import type { ResolvedConfig } from '@mermaid-js/core/config';
import type { C4Direction, C4ElementType } from './parser/model.ts';

const FONT_FAMILY = '"Open Sans", sans-serif';

/** The element types, internal and external, that carry per-type config keys. */
export const ELEMENT_TYPES: readonly C4ElementType[] = (
  [
    'person',
    'system',
    'system_db',
    'system_queue',
    'container',
    'container_db',
    'container_queue',
    'component',
    'component_db',
    'component_queue',
  ] as const
).flatMap((t) => [t, `external_${t}` as const]);

const PALETTE: Readonly<Record<string, readonly [bg: string, border: string]>> = {
  person: ['#08427B', '#073B6F'],
  external_person: ['#686868', '#8A8A8A'],
  system: ['#1168BD', '#3C7FC0'],
  external_system: ['#999999', '#8A8A8A'],
  container: ['#438DD5', '#3C7FC0'],
  external_container: ['#B3B3B3', '#A6A6A6'],
  component: ['#85BBF0', '#78A8D8'],
  external_component: ['#CCCCCC', '#BFBFBF'],
};

/** The palette entry of a type: `system_db` shares `system`'s. */
const paletteOf = (type: string): readonly [string, string] =>
  PALETTE[type.replace(/_(db|queue)$/, '')] ?? ['#1168BD', '#3C7FC0'];

function defaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    diagramMarginX: 50,
    diagramMarginY: 10,
    c4ShapeMargin: 50,
    c4ShapePadding: 20,
    width: 216,
    height: 60,
    boxMargin: 10,
    c4ShapeInRow: 4,
    nextLinePaddingX: 0,
    c4BoundaryInRow: 2,
    showStereotypes: true,
    wrap: true,
    wrapPadding: 10,
    boundaryFontSize: 14,
    boundaryFontFamily: FONT_FAMILY,
    boundaryFontWeight: 'normal',
    messageFontSize: 12,
    messageFontFamily: FONT_FAMILY,
    messageFontWeight: 'normal',
  };
  for (const t of ELEMENT_TYPES) {
    const [bg, border] = paletteOf(t);
    out[`${t}FontSize`] = 14;
    out[`${t}FontFamily`] = FONT_FAMILY;
    out[`${t}FontWeight`] = 'normal';
    out[`${t}_bg_color`] = bg;
    out[`${t}_border_color`] = border;
  }
  return out;
}

/** The `c4` section's defaults, as the plugin's `configDefaults`. */
export const c4ConfigDefaults: Readonly<Record<string, unknown>> = Object.freeze(defaults());

/** The section `c4Compat` moves the converged build's own `c4` keys to. */
export const CONVERGED_SECTION = 'c4-converged';

/**
 * The converged build's two `c4` keys that v13's `c4` section lacks, `showStereotypes` and
 * `boundaryDirection`, as an extension to register next to `c4`. Its config fragment declares
 * them in a section of its own and aliases `c4.<key>` to it, so front matter and `initialize`
 * can set them under `c4` as in v12. Without it they are dropped with `CONFIG_UNKNOWN_KEY`.
 */
export const c4Compat: ExtensionPlugin = {
  id: CONVERGED_SECTION,
  config: {
    id: CONVERGED_SECTION,
    keys: { [CONVERGED_SECTION]: { showStereotypes: 0, boundaryDirection: 0 } },
    aliases: [
      { from: 'c4.showStereotypes', to: `${CONVERGED_SECTION}.showStereotypes` },
      { from: 'c4.boundaryDirection', to: `${CONVERGED_SECTION}.boundaryDirection` },
    ],
  },
};

/** The resolved `c4` section and the converged keys' own section, read with their defaults. */
export class C4Config {
  private readonly values: ReadonlyMap<string, unknown>;
  /** Root `wrap` when set, else `c4.wrap` (v12 `isC4WrapEnabled`). */
  readonly wrap: boolean;

  constructor(config: ResolvedConfig) {
    const converged: unknown = Object.entries(config).find(([k]) => k === CONVERGED_SECTION)?.[1];
    this.values = new Map<string, unknown>([
      ...Object.entries(c4ConfigDefaults),
      ...Object.entries(config.c4 ?? {}),
      ...(typeof converged === 'object' && converged !== null ? Object.entries(converged) : []),
    ]);
    const root = config.wrap;
    this.wrap = typeof root === 'boolean' ? root : this.bool('wrap', true);
  }

  number(key: string, fallback: number): number {
    const v = this.values.get(key);
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  string(key: string): string | undefined {
    const v = this.values.get(key);
    return typeof v === 'string' && v !== '' ? v : undefined;
  }

  bool(key: string, fallback: boolean): boolean {
    const v = this.values.get(key);
    return typeof v === 'boolean' ? v : fallback;
  }

  /** `c4.boundaryDirection`, when it names a direction. */
  get boundaryDirection(): C4Direction | undefined {
    const v = this.values.get('boundaryDirection');
    return v === 'TB' || v === 'BT' || v === 'LR' || v === 'RL' ? v : undefined;
  }
}
