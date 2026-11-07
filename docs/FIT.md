# How our v12 C4 and BPMN work fits Mermaid v13

Legacy C4 fits the v13 plugin contract: all 57 legacy C4 sources render in Node with no DOM, and look like the converged v12 build's renders.
The sources are mermaid's `develop` at 63333fd8d plus the open C4 pull requests listed in mermaid-js/mermaid#7849.
Three things do not fit.
It can only be registered explicitly, with `registerExternalDiagrams([c4], { replace: true })`, because discovery skips it.
The two `c4` config keys the converged build adds cannot be declared in the `c4` section; an extension can carry them in a section of its own, through config aliases.
And a boundary's own direction is dropped when a relationship crosses into it.
Everything below is measured against `mermaid@13.0.0-alpha.1` and `@mermaid-js/core@13.0.0-alpha.1`, pinned exactly.

Each row gives the v13 equivalent, a gap, or a `BLOCKER`, with the evidence behind it.
`FITS` means the v13 contract already has what the v12 code needs.
`GAP` means it works with extra code or a documented loss.
`BLOCKER` means a plugin cannot do it at all through the public contract.
`OPEN` means not assessed yet.

The v12 side is the converged build: `develop` plus our open pull requests (a local build, not published; the harness takes its renders as input).
Bug checks use the released `mermaid@12.3.0` instead.

## Registration

### 1. The explicit path works, with `replace`

The alpha lists `c4` as a first-party type with no package.
Its row in `mermaid/dist/generated/registry.gen.js` is `{ type: 'c4', pattern: /^\s*C4Context|C4Container|C4Component|C4Dynamic|C4Deployment/ }`, with no `id` and no `load`.
So `C4Context` text fails with `UNSUPPORTED_DIAGRAM`: `Diagram type "c4" is not supported by this version of mermaid.`

A plugin with id `c4` must pass `replace`:

```js
import { createMermaid } from 'mermaid';
import { c4 } from '@mermaid-v13-plugins/diagram-c4';

const mermaid = createMermaid();
mermaid.initialize({ discovery: false });
await mermaid.registerExternalDiagrams([c4], { replace: true });
```

Without `replace` the call rejects with `TypeError: "c4" is a first-party diagram id or type; pass { replace: true } to replace it`.
With it, the plugin takes the first-party row's slot in the detection order (`registry.js` `detectionOrder`), and its own detector replaces the row's regular expression.
Evidence: `test/registration.test.ts`, "explicit registration of the c4 id".

### 2. Discovery skips legacy C4, under any id

Node discovery (`mermaid/dist/node.js`, `node-scan.js`) scans the app's own `node_modules` for a `mermaid` manifest.
A third-party diagram manifest needs `detector` and `entry`; `@mermaid-js/diagram-state`'s manifest has neither, because first-party packages are never discovered.

Two outcomes, measured in a throwaway app (`test/discovery.test.ts`):

| manifest id                               | result                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `c4`                                      | skipped, with the render warning `PLUGIN_SKIPPED`: `Plugin package "fake-c4" was skipped: "c4" is a first-party diagram id or type` |
| `c4-legacy`, detector accepts `C4Context` | registered (its own keyword draws), but `C4Context` text still fails with `UNSUPPORTED_DIAGRAM`                                     |

The second case fails because discovered diagrams are detected after every first-party row, and the loaderless `c4` row matches first.
So the only working path for legacy C4 is the explicit call above.
This repo's own package shows the first case: rendering from the repo root with discovery on gives `PLUGIN_SKIPPED` for `@mermaid-v13-plugins/diagram-c4`.

`swimlane-beta` is in the same position.
The alpha has a loaderless row `{ type: 'swimlane', pattern: /^\s*swimlane-beta\b/ }`, so a swimlane plugin must register as id `swimlane` with `replace`.
`bpmn-beta` and `c4-beta` have no first-party row and register under their own ids.

### 3. The unanchored c4 row takes other diagrams

Only the first alternative of the c4 pattern is anchored.
`C4Container`, `C4Component`, `C4Dynamic` or `C4Deployment` anywhere in the text makes it a C4 diagram.
The row sits fifth in the detection order, before class, er, sequence, flowchart and state, and before every plugin.

| source                                                       | alpha.1        | alpha.1 with our `c4` (replace) | 12.3.0         |
| ------------------------------------------------------------ | -------------- | ------------------------------- | -------------- |
| `flowchart LR` with a node label `C4Container`               | `c4`           | `flowchart-v2`                  | `c4`           |
| class, er, sequence, state with a C4 keyword in a label      | `c4`           | own type                        | `c4`           |
| `c4-beta` or `bpmn-beta` with `C4Container` in a description | `c4`           | `c4-beta`, `bpmn-beta`          | `c4` (c4-beta) |
| `flowchart LR` with a later line `%% C4Container`            | `c4`           | `flowchart-v2`                  | `flowchart-v2` |
| `c4-beta` or `bpmn-beta` with a later line `%% C4Container`  | `c4`           | `c4-beta`, `bpmn-beta`          | not detected   |
| `%% C4Container` before the `flowchart` keyword              | `flowchart-v2` | `flowchart-v2`                  | `flowchart-v2` |

The label cases are v12 parity: 12.3.0 ships the same regular expression in the same early position.
The comment case is new in v13.
12.3.0's `detectType` removes `%%` comments before any detector runs (`stripAnyComments`).
The alpha's first-party rows test the raw body (`registry.js`: `detect: (body) => e.pattern.test(body)`); only plugin detectors get the cleaned text.
Registering our anchored `c4` plugin fixes both, for every diagram type.
Evidence: `test/registration.test.ts`, "detection order"; the 12.3.0 column comes from `mermaid.detectType` in Node after `mermaid.initialize({ startOnLoad: false })`.

### 4. Smaller registration facts

- `DiagramPlugin.aliases` is not used by the registry. After registering `c4` with alias `C4Context`, `supportsFormat('C4Context', 'svg')` is `false` and `preload({ types: ['C4Context'] })` rejects with `UNSUPPORTED_DIAGRAM`. Only the id and the first-party type name a plugin.
- `readManifest` drops keys it does not know, so a manifest's `language` path (diagram-state has one) is not part of the diagram contract.
- Discovery starts from the nearest `package.json` at or above `process.cwd()` and never scans ancestor folders.

## Fit table: legacy C4

| v12 dependency                          | v13 equivalent                                                                           | status              | evidence                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration and detection              | `registerExternalDiagrams(..., { replace: true })`                                       | FITS, explicit only | Registration above                                                                                                                                                                                                 |
| Parser (`c4Diagram.jison`)              | a hand-written scanner and recursive descent on `@mermaid-js/core/parser-kit`            | FITS                | note 3                                                                                                                                                                                                             |
| db and model (`c4Db.ts`)                | a builder with no module state; the model is plain data                                  | FITS                | note 3                                                                                                                                                                                                             |
| Language service                        | a facet with diagnostics, highlight categories and alias symbols; no completion or hover | FITS                | `src/language.ts`                                                                                                                                                                                                  |
| Limits                                  | `ctx.limits` (`maxDepth`, `maxNodes`, `maxEdges`) as core's limit codes                  | FITS                | a nested boundary past `maxDepth` gives `DEPTH_LIMIT`, which core maps to a `LIMIT` error                                                                                                                          |
| Layout: boundaries                      | `LayoutGroup` with `title` and `padding`                                                 | FITS                | every fixture keeps its elements inside their boundaries (`test/c4-render.test.ts`)                                                                                                                                |
| Layout: relationship to a boundary      | `LayoutEdge.source`/`target` take a group id                                             | FITS                | the fixture for #4864 (`e2e-pr-c4-9-...`) draws `Rel(b1, ...)` from the boundary's border                                                                                                                          |
| Layout: a boundary's own direction      | `LayoutGroup.direction`                                                                  | GAP                 | note 4                                                                                                                                                                                                             |
| Layout: `Rel_U/D/L/R`                   | no direction hint on `LayoutEdge`                                                        | GAP, parity         | the converged build lays them out as `Rel` too (`e2e-pr-directional-relationships`)                                                                                                                                |
| Layout: `UpdateLayoutConfig`            | no column count on `LayoutGraph`                                                         | GAP, parity         | the converged build ignores it too; the port warns `C4_LAYOUT_CONFIG_IGNORED`                                                                                                                                      |
| Layout: `RelIndex` and C4Dynamic order  | numbered labels made by the plugin                                                       | FITS                | `e2e-pr-dynamic-diagram`, `e2e-pr-dynamic-repeated-pair`                                                                                                                                                           |
| Layout: edge ends on the shape outline  | the engine ends edges on the box side; `LayoutNode.shape` is not read                    | GAP                 | note 5                                                                                                                                                                                                             |
| Shapes (person, cylinder, queue, boxes) | `rect`, `circle` and `path` through `w.outline`; arrowheads as paths                     | FITS                | no shape needs a tag outside the allow-list, so there is no `<marker>`                                                                                                                                             |
| d3 and DOM                              | none: labels measured by `ctx.measurer`, SVG written through `SvgWriter`                 | FITS                | lint bans DOM globals in plugin sources                                                                                                                                                                            |
| Themes                                  | `ctx.theme` and `--mermaid-*` variables                                                  | GAP                 | notes 1 and 6                                                                                                                                                                                                      |
| Config: v12's `c4` keys                 | core's schema has the `c4` section; the plugin's `configDefaults` fill it                | FITS                | `c4.wrap`, `c4.width`, the fonts and the palette colours all apply                                                                                                                                                 |
| Config: converged-only keys             | an extension's own section, filled from `c4.*` by config aliases; not wired yet          | GAP                 | note 7                                                                                                                                                                                                             |
| Icons and sprites                       | nothing to port; `<image href>` would go through `checkImageUrl`                         | FITS                | the converged build draws no sprite image, `$sprite` only names a shape (`database`, `queue`); `checkImageUrl` allows relative, http(s) and `data:image` png, jpeg, gif and webp, not SVG data URLs (`svg/url.js`) |
| Legend (`SHOW_LEGEND`)                  | nothing to port                                                                          | FITS, parity        | the converged grammar has no `SHOW_LEGEND`; `$legendText` and `$legendSprite` are parsed and kept in the model, not drawn                                                                                          |
| Text wrap and HTML labels               | `layoutLabel` wraps greedily at a width; each line group has its own font                | FITS                | the converged build's `<b>` and `<small><i>` edge labels become bold and italic sections                                                                                                                           |
| Accessibility                           | `<title>` and `<desc>` with `aria-labelledby` and `aria-describedby`, `role="img"`       | FITS                | `accTitle`, `accDescr`                                                                                                                                                                                             |
| Security                                | every colour from the source through `checkColor`, every `$link` through `checkUrl`      | FITS                | `$link="javascript:alert(1)"` is dropped with `URL_REFUSED` (`spec-c4-link-2`)                                                                                                                                     |
| Packaging and types                     | plugin packages need no DOM types; `mermaid`'s own types do                              | FITS                | note 2                                                                                                                                                                                                             |

### Notes

1. **Theme paints must be asked for before the root `<svg>` is written.**
   The root's `style` declares only the theme aliases (`--_mb`, `--_nt`, ...) used so far, and the stream writer cannot change the root afterwards.
   A paint asked for later is used but never declared, so the browser draws black fills and invisible text, with no warning.
   Measured on the harness placeholder: the first version drew black boxes, and its root declared none of `--_ff`, `--_fs`, `--_mb`, `--_nb`, `--_nt`.
   The state plugin avoids it by building every paint first, and so does the C4 renderer.
   The harness reports it as `HARNESS_UNDECLARED_ALIAS`, and the smoke and `test/c4-render.test.ts` fail on it.
2. **Types.**
   With `lib: ["ES2022"]`, strict flags and `skipLibCheck: false`, a plugin package typechecks against `@mermaid-js/core`'s declarations with no DOM library.
   A consumer of `mermaid` itself needs `lib: ["DOM"]`: `mermaid/dist/api.d.ts(80,31): error TS2304: Cannot find name 'Element'` (also `HTMLElement` in `dom.d.ts` and `index.d.ts`), even in a Node-only program.
3. **Parser.**
   parser-kit's `ParseState`, `TokenWriter` and `Diagnostics` were enough; no grammar abstraction was missed.
   The v12 parser specs are ported (177 tests); with the parser stubbed to an empty model, 173 of them fail.
   Two v12 behaviours are fixed rather than ported, each with a named test.
   An unquoted argument ends at `)` and at the line end: in 12.3.0, `Person(a, Alice)` followed by `Person(b, "B")` gives one person labelled `Alice)\nPerson(b`.
   A named argument in the label slot sets its own field: in 12.3.0, `Person(c, $sprite="users")` stores the label as `{ sprite: 'users' }` and sets no sprite.
4. **A boundary's direction is dropped when a relationship crosses into it.**
   The layered engine follows v12's dagre rule: "A group that an edge crosses inherits its parent's [direction] instead" (`LayoutGroup.direction` in `layout/types.d.ts`).
   In `regression-boundary-direction`, `Web shop` lays out left to right, but `Warehouse`, which `Rel(buyer, pick, ...)` enters, stacks top to bottom.
   The converged build lays both out left to right.
   `@mermaid-js/layout-elk` (`layout: elk`) does the same: `Warehouse` still stacks top to bottom (`pnpm render --layout elk`).
5. **Edge ends.**
   The engine reports which side of a box an edge meets, and ends it on that side.
   The converged build ends an edge on the shape's outline: on the person's head arc, on a cylinder's curve.
   Arrows that meet a person from above stop on the head's top only when they arrive at its centre.
6. **Backgrounds and colours.**
   A v13 SVG paints no background, so a dark-theme diagram on a white page loses its light title.
   The converged build's SVG carries its background.
   The C4 palette stays in config, as in v12, because a diagram plugin cannot declare theme variables.
   The theme helped too: `theme.rgba('background')` and core's exported `parseColor`, `contrastRatio` and `formatColor` made v12's `readableOn` portable without khroma.
   Core has the HSL steps it also needs (`shiftHsl`) but does not export them, so the port carries its own; v12's colour spec is ported as `colors.test.ts`.
7. **A plugin cannot add keys to its own config section.**
   The converged build adds `c4.showStereotypes` and `c4.boundaryDirection`; the alpha's schema has neither.
   Front matter `c4: { showStereotypes: false }` gives `CONFIG_UNKNOWN_KEY`: `Unknown config key "c4.showStereotypes"; ignored.`, although the plugin's `configDefaults` declares the key.
   An extension's config fragment cannot declare it either: registering one with `keys: { c4: { showStereotypes: 0 } }` throws `TypeError: Config fragment "c4-keys": "c4" is a core config key`.
   Per-element `UpdateElementStyle(x, $showStereotype="false")` still works, because it is diagram syntax.
   A config alias gets around it.
   An extension declares a section of its own (`c4-converged`) and aliases `c4.showStereotypes` and `c4.boundaryDirection` into it.
   Front matter `c4: { showStereotypes: false, boundaryDirection: LR }` then gives no warning, and the render's config holds `c4-converged: { showStereotypes: false, boundaryDirection: 'LR' }`.
   The legacy plugin does not read that section yet.
   All three behaviours are pinned in `test/c4-render.test.ts`.

## Parity with the converged build

The harness renders all 57 fixtures and puts each next to the converged build's render (`pnpm render`, then `pnpm sheet`).
Every element, boundary and relationship is drawn in both, the boundaries nest the same way, and `test/c4-render.test.ts` checks that no element overlaps another or leaves its boundary.
These are the differences:

| difference                                                                                                               | fixtures                                                                                                       | cause                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elements are placed differently                                                                                          | most                                                                                                           | the layered engine against the converged build's ELK; with `layout: elk` and `@mermaid-js/layout-elk` registered, the placement comes close to the converged build's (checked on c4-1 and docs-4) |
| A crossed boundary stacks top to bottom                                                                                  | `regression-boundary-direction`                                                                                | note 4                                                                                                                                                                                            |
| Stereotypes stay visible                                                                                                 | `e2e-nightly-update-element-style-show-stereotypes-config-off`                                                 | note 7                                                                                                                                                                                            |
| `UpdateRelStyle` text colours and `$offsetX`/`$offsetY` show; offsets written for v12's grid can move a label onto a box | `docs-5`, `docs-6`, `e2e-nightly-c4-4-...`, `e2e-pr-c4-3-...`, `e2e-nightly-styling-update-relationship-style` | the converged build's renders show these labels uncoloured and on their line                                                                                                                      |
| Title in the theme font, labels slightly larger                                                                          | all                                                                                                            | v13's default theme font and size differ from v12's                                                                                                                                               |
