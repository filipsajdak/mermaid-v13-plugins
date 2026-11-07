import { describe, expect, it } from 'vitest';
import { parseSwimlane } from '../src/parser.ts';
import { renderWithWarnings } from './render-helpers.ts';

const lanes = (svg: string) =>
  [
    ...svg.matchAll(
      /class="cluster swimlane[^"]*" data-id="([^"]+)"[^>]*?(?:data-color-id="([^"]+)")?>/g,
    ),
  ].map((m) => [m[1], m[2]]);

describe('nodes listed in two lanes (v12 #8386)', () => {
  const text = 'swimlane-beta LR\n  subgraph l1[A]\n    a\n  end\n  subgraph l2[B]\n    a\n  end\n';

  it('records the node the flowchart model left out of the second lane', () => {
    expect(parseSwimlane(text).model.sharedNodes).toEqual([
      { node: 'a', keptBy: 'l1', droppedFrom: 'l2' },
    ]);
  });

  it('draws the node in the first lane, drops the lane it emptied, and says so', async () => {
    const { svg, warnings } = await renderWithWarnings(text);

    expect(lanes(svg).map(([id]) => id)).toEqual(['l1']);
    expect(warnings.map((w) => w.code)).toEqual(['SWIMLANE_LAYOUT']);
    expect(warnings[0]?.message).toContain('"a" is listed in lanes "l1" and "l2"');
  });

  it('keeps a lane the author left empty', async () => {
    const { svg } = await renderWithWarnings(
      'swimlane-beta\n  subgraph l1\n    a\n  end\n  subgraph l2\n  end\n',
    );

    expect(
      lanes(svg)
        .map(([id]) => id)
        .sort(),
    ).toEqual(['l1', 'l2']);
  });
});

describe('the lane for nodes outside every lane', () => {
  it('takes the palette slot after the declared lanes', async () => {
    const { svg } = await renderWithWarnings(
      'swimlane-beta\n  subgraph l1\n    a\n  end\n  subgraph l2\n    b\n  end\n  loose\n',
    );

    expect(Object.fromEntries(lanes(svg))).toEqual({
      l1: 'color-0',
      l2: 'color-1',
      __swimlane_default__: 'color-2',
    });
  });
});

describe('a declared phase that no node uses', () => {
  it('is a render warning', async () => {
    const { warnings } = await renderWithWarnings(
      'swimlane-beta\n  phase p1["One"]\n  subgraph l1\n    a\n  end\n',
    );

    expect(warnings.map((w) => w.message).filter((m) => m.includes('"p1"'))).toHaveLength(1);
  });
});
