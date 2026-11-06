import { boundaryTitle, relText, stereotypeOf } from './layout/index.ts';
import type { C4Model } from './parser/model.ts';

/**
 * Every text the layout hands to core's label layout, as it hands it over: the title, each
 * element's name, stereotype line and description, each boundary's title with its type, and
 * each relationship's line, `[technology]` and description. An extension that loads an engine
 * for a delimiter scans these.
 */
export function c4Labels(model: C4Model): readonly string[] {
  const dynamic = model.kind === 'C4Dynamic';
  return [
    model.title,
    ...model.elements.flatMap((e) => [e.label, stereotypeOf(e), e.descr]),
    ...model.boundaries.map(boundaryTitle),
    ...model.rels.flatMap((r, i) => [
      relText(r, i, dynamic),
      r.techn ? `[${r.techn}]` : '',
      r.descr,
    ]),
  ].filter((t) => t !== '');
}
