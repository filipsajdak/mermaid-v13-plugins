import { relTitle } from './layout/index.ts';
import type { C4BetaModel } from './parser/model.ts';

/**
 * Every text the layout hands to core's label layout: the title, each element's name,
 * technology and description, and each relationship's description and technology. The
 * stereotype line, step numbers and legend labels are made by the plugin and left out.
 */
export function c4BetaLabels(model: C4BetaModel): readonly string[] {
  return [
    model.title,
    ...model.elements.flatMap((e) => [
      e.name,
      e.technology ? `[${e.technology}]` : '',
      e.description ?? '',
    ]),
    ...model.relationships.flatMap((r) => [
      relTitle(r, r.step),
      r.technology ? `[${r.technology}]` : '',
    ]),
  ].filter((t) => t !== '');
}
