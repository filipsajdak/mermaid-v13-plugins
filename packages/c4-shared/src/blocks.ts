/**
 * Stacked label blocks: an element's name, stereotype and description, a relationship's
 * text, a deployment node's title. Each section is measured on its own, so each can have its
 * own size, weight and style, as the converged v12 build's stacked labels do.
 */
import { layoutLabel, Style } from '@mermaid-js/core/text';
import type { FontKey, MeasuredLabel, Measurer } from '@mermaid-js/core/text';

/** What a section is, which sets how it is drawn. */
export type C4SectionKind = 'name' | 'type' | 'descr' | 'techn' | 'title';

/** One line group of a stacked label. */
export interface C4Section {
  readonly kind: C4SectionKind;
  readonly label: MeasuredLabel;
  readonly font: FontKey;
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** Top of the section, from the top of its block. */
  readonly top: number;
}

/** Sections stacked and centred on one axis. */
export interface C4Block {
  readonly sections: readonly C4Section[];
  readonly width: number;
  readonly height: number;
}

/** A section to measure: its text and how it is set. */
export interface C4SectionSpec {
  readonly kind: C4SectionKind;
  readonly text: string;
  readonly font: FontKey;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/**
 * Measures each section at `maxWidth` (`Infinity` to wrap only at explicit breaks) and stacks
 * them `gap` apart. Empty texts are left out.
 */
export function measureBlock(
  specs: readonly C4SectionSpec[],
  measurer: Measurer,
  maxWidth: number,
  gap: number,
): C4Block {
  let top = 0;
  const sections: C4Section[] = [];
  for (const s of specs) {
    if (s.text === '') continue;
    const style = (s.bold ? Style.Bold : 0) | (s.italic ? Style.Italic : 0);
    const label = layoutLabel(s.text, s.font, maxWidth, measurer, { style });
    sections.push({
      kind: s.kind,
      label,
      font: s.font,
      ...(s.bold ? { bold: true } : {}),
      ...(s.italic ? { italic: true } : {}),
      top,
    });
    top += label.height + gap;
  }
  return {
    sections,
    width: Math.max(0, ...sections.map((s) => s.label.width)),
    height: sections.length > 0 ? top - gap : 0,
  };
}
