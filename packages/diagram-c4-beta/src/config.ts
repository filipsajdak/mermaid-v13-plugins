/**
 * The c4-beta config section (v12's `c4beta`, here under the plugin id; `c4BetaCompat`
 * aliases the old name) and the C4 theme variables. v12's `C4BetaDiagramConfig` defaults: `diagramPadding` 10, `showStereotypes`
 * true, `hideStereotypes` none, `personWrappingWidth` 120.
 */
import type { ExtensionPlugin } from '@mermaid-js/core';
import type { ResolvedConfig } from '@mermaid-js/core/config';
import type { C4BetaElementKind } from './parser/model.ts';

export const c4BetaConfigDefaults: Readonly<Record<string, unknown>> = Object.freeze({
  diagramPadding: 10,
  showStereotypes: true,
  hideStereotypes: [],
  personWrappingWidth: 120,
});

/** The resolved section, read with its defaults. */
export class C4BetaConfig {
  private readonly values: ReadonlyMap<string, unknown>;

  constructor(config: ResolvedConfig) {
    const section: unknown = Object.entries(config).find(([k]) => k === 'c4-beta')?.[1];
    const own = typeof section === 'object' && section !== null ? Object.entries(section) : [];
    this.values = new Map<string, unknown>([...Object.entries(c4BetaConfigDefaults), ...own]);
  }

  number(key: string, fallback: number): number {
    const v = this.values.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  /** v12 `showsStereotype`: `showStereotypes` and not listed in `hideStereotypes`. */
  showsStereotype(kind: C4BetaElementKind): boolean {
    const show = this.values.get('showStereotypes');
    const hidden = this.values.get('hideStereotypes');
    return show !== false && !(Array.isArray(hidden) && hidden.includes(kind));
  }
}

/**
 * The converged build's C4 theme variables (`theme-default.js`), which v13's themes do not
 * have. Without `c4BetaCompat` registered the renderer uses the same colours as literals.
 */
export const C4_THEME_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  c4PersonBkg: '#08427B',
  c4PersonBorder: '#073B6F',
  c4SystemBkg: '#1168BD',
  c4SystemBorder: '#3C7FC0',
  c4ContainerBkg: '#438DD5',
  c4ContainerBorder: '#3C7FC0',
  c4ComponentBkg: '#85BBF0',
  c4ComponentBorder: '#78A8D8',
  c4ExternalBkg: '#999999',
  c4ExternalBorder: '#8A8A8A',
  c4InfrastructureBkg: '#6b6b6b',
  c4InfrastructureBorder: '#5a5a5a',
  c4BoundaryBorder: '#444444',
});

/**
 * What v12 had that a diagram plugin cannot declare, as an extension to register next to
 * `c4Beta`: the C4 theme variables, and v12's `c4beta` config section as an alias of this
 * plugin's `c4-beta` section. Without it the C4 colours are literals the page cannot theme,
 * and front matter under `c4beta:` is dropped with `CONFIG_UNKNOWN_KEY`.
 */
export const c4BetaCompat: ExtensionPlugin = {
  id: 'c4-beta-compat',
  config: {
    id: 'c4-beta-compat',
    keys: {},
    aliases: [{ from: 'c4beta', to: 'c4-beta' }],
    themeVariables: C4_THEME_DEFAULTS,
  },
};
