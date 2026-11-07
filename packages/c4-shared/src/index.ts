/**
 * What the legacy C4 and c4-beta plugins share. Imports `@mermaid-js/core` only.
 */
export { measureBlock } from './blocks.ts';
export type { C4Block, C4Section, C4SectionKind, C4SectionSpec } from './blocks.ts';
export { drawShape, ELEMENT_RADIUS, sizeShape, wrapWidth } from './shapes.ts';
export type { C4Shape, C4ShapeBox, C4Sized } from './shapes.ts';
export { EDGE_LABEL_PAD, GROUP_PAD, layoutScene, TITLE_PAD } from './scene.ts';
export type {
  PlacedEdge,
  PlacedElement,
  PlacedGroup,
  Scene,
  SceneEdge,
  SceneElement,
  SceneGroup,
  SceneLayout,
} from './scene.ts';
export {
  dash,
  drawBlock,
  drawEdgeLabel,
  drawEdgeLine,
  drawGroupFrame,
  headOf,
  textAttrs,
  userColor,
} from './draw.ts';
export type { EdgeStyle, GroupStyle, Head } from './draw.ts';
export { readableOn } from './colors.ts';
