# How our v12 C4 and BPMN work fits Mermaid v13

Legacy C4 fits the v13 plugin contract: all 57 legacy C4 sources render in Node with no DOM, and look like the converged v12 build's renders.
The sources are mermaid's `develop` at 63333fd8d plus the open C4 pull requests listed in mermaid-js/mermaid#7849.
Three things do not fit.
It can only be registered explicitly, with `registerExternalDiagrams([c4], { replace: true })`, because discovery skips it.
The two `c4` config keys the converged build adds cannot be declared in the `c4` section; the package's `c4Compat` extension carries them in a section of its own, through config aliases.
And a boundary's own direction is dropped when a relationship crosses into it.
`c4-beta` fits as well: all 27 sources render and match the converged build's renders element for element (see [Fit table: c4-beta](#fit-table-c4-beta)).
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
`bpmn-beta` and `c4-beta` have no first-party row and register without `replace`: c4-beta under its own id, bpmn-beta under `bpmn`, v12's diagram type and the config section its options live in.

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

| v12 dependency                          | v13 equivalent                                                                                                          | status              | evidence                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration and detection              | `registerExternalDiagrams(..., { replace: true })`                                                                      | FITS, explicit only | Registration above                                                                                                                                                                                                 |
| Parser (`c4Diagram.jison`)              | a hand-written scanner and recursive descent on `@mermaid-js/core/parser-kit`                                           | FITS                | note 3                                                                                                                                                                                                             |
| db and model (`c4Db.ts`)                | a builder with no module state; the model is plain data                                                                 | FITS                | note 3                                                                                                                                                                                                             |
| Language service                        | a facet with diagnostics, highlight categories and alias symbols; no completion or hover                                | FITS                | `src/language.ts`                                                                                                                                                                                                  |
| Limits                                  | `ctx.limits` (`maxDepth`, `maxNodes`, `maxEdges`) as core's limit codes                                                 | FITS                | a nested boundary past `maxDepth` gives `DEPTH_LIMIT`, which core maps to a `LIMIT` error                                                                                                                          |
| Layout: boundaries                      | `LayoutGroup` with `title` and `padding`                                                                                | FITS                | every fixture keeps its elements inside their boundaries (`test/c4-render.test.ts`)                                                                                                                                |
| Layout: relationship to a boundary      | `LayoutEdge.source`/`target` take a group id                                                                            | FITS                | the fixture for #4864 (`e2e-pr-c4-9-...`) draws `Rel(b1, ...)` from the boundary's border                                                                                                                          |
| Layout: a boundary's own direction      | `LayoutGroup.direction`                                                                                                 | GAP                 | note 4                                                                                                                                                                                                             |
| Layout: `Rel_U/D/L/R`                   | no direction hint on `LayoutEdge`                                                                                       | GAP, parity         | the converged build lays them out as `Rel` too (`e2e-pr-directional-relationships`)                                                                                                                                |
| Layout: `UpdateLayoutConfig`            | no column count on `LayoutGraph`                                                                                        | GAP, parity         | the converged build ignores it too; the port warns `C4_LAYOUT_CONFIG_IGNORED`                                                                                                                                      |
| Layout: `RelIndex` and C4Dynamic order  | numbered labels made by the plugin                                                                                      | FITS                | `e2e-pr-dynamic-diagram`, `e2e-pr-dynamic-repeated-pair`                                                                                                                                                           |
| Layout: edge ends on the shape outline  | the engine ends edges on the box side; `LayoutNode.shape` is not read                                                   | GAP                 | note 5                                                                                                                                                                                                             |
| Shapes (person, cylinder, queue, boxes) | `rect`, `circle` and `path` through `w.outline`; arrowheads as paths                                                    | FITS                | no shape needs a tag outside the allow-list, so there is no `<marker>`                                                                                                                                             |
| d3 and DOM                              | none: labels measured by `ctx.measurer`, SVG written through `SvgWriter`                                                | FITS                | lint bans DOM globals in plugin sources                                                                                                                                                                            |
| Themes                                  | `ctx.theme` and `--mermaid-*` variables                                                                                 | GAP                 | notes 1 and 6                                                                                                                                                                                                      |
| Config: v12's `c4` keys                 | core's schema has the `c4` section; the plugin's `configDefaults` fill it                                               | FITS                | `c4.wrap`, `c4.width`, the fonts and the palette colours all apply                                                                                                                                                 |
| Config: converged-only keys             | `c4Compat`, an extension whose own section takes `c4.showStereotypes` and `c4.boundaryDirection` through config aliases | GAP                 | note 7                                                                                                                                                                                                             |
| Icons and sprites                       | nothing to port; `<image href>` would go through `checkImageUrl`                                                        | FITS                | the converged build draws no sprite image, `$sprite` only names a shape (`database`, `queue`); `checkImageUrl` allows relative, http(s) and `data:image` png, jpeg, gif and webp, not SVG data URLs (`svg/url.js`) |
| Legend (`SHOW_LEGEND`)                  | nothing to port                                                                                                         | FITS, parity        | the converged grammar has no `SHOW_LEGEND`; `$legendText` and `$legendSprite` are parsed and kept in the model, not drawn                                                                                          |
| Text wrap and HTML labels               | `layoutLabel` wraps greedily at a width; each line group has its own font                                               | FITS                | the converged build's `<b>` and `<small><i>` edge labels become bold and italic sections                                                                                                                           |
| Accessibility                           | `<title>` and `<desc>` with `aria-labelledby` and `aria-describedby`, `role="img"`                                      | FITS                | `accTitle`, `accDescr`                                                                                                                                                                                             |
| Security                                | every colour from the source through `checkColor`, every `$link` through `checkUrl`                                     | FITS                | `$link="javascript:alert(1)"` is dropped with `URL_REFUSED` (`spec-c4-link-2`)                                                                                                                                     |
| Packaging and types                     | plugin packages need no DOM types; `mermaid`'s own types do                                                             | FITS                | note 2                                                                                                                                                                                                             |

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
   `c4Compat`, an extension to register next to `c4`, declares a section of its own (`c4-converged`) and aliases `c4.showStereotypes` and `c4.boundaryDirection` into it.
   The plugin reads that section after `c4`.
   With it, `c4: { showStereotypes: false }` in front matter or in `initialize` gives no warning and hides the type lines, and `c4.boundaryDirection` sets the direction of a boundary that sets none.
   The two refusals and the alias path are pinned in `test/c4-render.test.ts`.

## Parity with the converged build

The harness renders all 57 fixtures and puts each next to the converged build's render (`pnpm render`, then `pnpm sheet`).
Every element, boundary and relationship is drawn in both, the boundaries nest the same way, and `test/c4-render.test.ts` checks that no element overlaps another or leaves its boundary.
These are the differences:

| difference                                                                                                               | fixtures                                                                                                       | cause                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elements are placed differently                                                                                          | most                                                                                                           | the layered engine against the converged build's ELK; with `layout: elk` and `@mermaid-js/layout-elk` registered, the placement comes close to the converged build's (checked on c4-1 and docs-4) |
| A crossed boundary stacks top to bottom                                                                                  | `regression-boundary-direction`                                                                                | note 4                                                                                                                                                                                            |
| `UpdateRelStyle` text colours and `$offsetX`/`$offsetY` show; offsets written for v12's grid can move a label onto a box | `docs-5`, `docs-6`, `e2e-nightly-c4-4-...`, `e2e-pr-c4-3-...`, `e2e-nightly-styling-update-relationship-style` | the converged build's renders show these labels uncoloured and on their line                                                                                                                      |
| Title in the theme font, labels slightly larger                                                                          | all                                                                                                            | v13's default theme font and size differ from v12's                                                                                                                                               |

## Fit table: swimlane-beta

`swimlane-beta` renders through the explicit path in Node with no DOM (`test/swimlane-render.test.ts`, every edge routed and drawn): every one of the 42 swimlane fixtures of the v12 build (the `layout-tests/swimlanes` set and its `regressions`) and the 14 examples of the v12 syntax page, each with every label of the v12 render.
LR drawings come out up to 43% wider than in v12, because the v13 flowchart measures nodes with SVG text and widens them to `minNodeWidth`; the engine gets those sizes.
In v12 the diagram has no grammar of its own: it is the flowchart grammar, `flowDb` and the flowchart renderer with the layout swapped (`swimlanesDiagram.ts` is `createFlowDiagram({ styles })`).
The plugin does the same in v13: it reuses the first-party flowchart plugin's exports and lays the diagram out with the v12 swimlane engine, lifted into `packages/swimlane-engine`.

| v12 dependency                                                                     | v13 equivalent                                                                                                                                                                                 | status                                                                                                                                                     | evidence                                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Registration and detection                                                         | `registerExternalDiagrams([swimlane], { replace: true })`, id `swimlane`                                                                                                                       | FITS, explicit only                                                                                                                                        | Registration above; `harness/plugins.mjs`                                                     |
| Reusing another diagram's parser, layout step and renderer                         | `@mermaid-js/diagram-flowchart`'s root export: `parseFlowchart`, `layoutFlowchart`, `renderFlowchart`, `flowchartConfigDefaults` and their types, no deep import into `dist`                   | FITS, at a cost: see note 12                                                                                                                               | `diagram-flowchart/package.json` `exports['.']`, `dist/index.d.ts`                            |
| Parser (flowchart jison)                                                           | `parseFlowchart` from `@mermaid-js/diagram-flowchart`, whose lexer already takes `swimlane-beta` as the graph keyword                                                                          | FITS, by reuse                                                                                                                                             | `diagram-flowchart/dist/parser/lexer.js`, `this.kw('swimlane-beta')`                          |
| `phase id["Title"]` statements                                                     | none: the flowchart parser reports `UNEXPECTED` on them                                                                                                                                        | GAP, see note 8                                                                                                                                            | `packages/diagram-swimlane/src/parser.ts`                                                     |
| `@{ phase: id }` on a node                                                         | the flowchart model drops unknown `@{ }` keys on a vertex (a subgraph keeps them as `metadata`)                                                                                                | GAP, see note 8                                                                                                                                            | `parseFlowchart('flowchart\nA@{ phase: x }')` gives `props: {}` and no other trace of `phase` |
| Nodes listed in two lanes (`droppedSubGraphMembers`, v12 #8386)                    | the v13 flowchart model keeps such a node in the first subgraph and leaves it out of the later ones without a trace                                                                            | GAP: the plugin compares each subgraph's mentions in the AST with its `nodes` to rebuild v12's list, so the engine warns and drops a lane the node emptied | `packages/diagram-swimlane/test/render.test.ts`                                               |
| Layout contract                                                                    | `layoutKind: 'custom'`; `LayoutGraph` has groups but no lanes, pools, bands or per-node data, and `LayoutModelGroup` has a title point, not a title band                                       | GAP, see note 9                                                                                                                                            | `packages/diagram-swimlane/src/layout.ts`                                                     |
| Layout engine (`layout-algorithms/swimlanes`)                                      | the same code, in a private package with no DOM and no dependency                                                                                                                              | FITS: 44 of 46 files (493 KB) lifted, 21 byte-identical, the rest changed only in import paths                                                             | see note 10                                                                                   |
| Flowchart config the layout reads (`nodeSpacing`, `padding`, `wrappingWidth`, ...) | `ctx.config.flowchart` is `undefined` when another plugin renders: v13 merges a section's defaults only for its own plugin                                                                     | GAP: the plugin merges `flowchartConfigDefaults` under the author's values itself                                                                          | `packages/diagram-swimlane/src/context.ts`                                                    |
| `swimlane` config section                                                          | core's `KEY_TREE` holds `lineHops`, `ignoreCrossLaneEdges`, `optimizeRanksByCrossings`, `automaticLaneOrdering`, with no defaults                                                              | FITS: a value there is the author's, which replaces v12's `getUserDefinedConfig()`                                                                         | `@mermaid-js/core/dist/config/generated/keys.js`                                              |
| Rendering nodes, edges, nested subgraphs                                           | `renderFlowchart`                                                                                                                                                                              | FITS, by reuse                                                                                                                                             |                                                                                               |
| Lanes and phase bands                                                              | `renderFlowchart` writes the whole document and has no hook for extra layers                                                                                                                   | GAP, see note 11                                                                                                                                           | `packages/diagram-swimlane/src/render.ts`                                                     |
| Line hops (`swimlane.lineHops`, v12 `applyLineJumpsToSvg` on the DOM)              | none                                                                                                                                                                                           | GAP: not drawn; the key is ignored                                                                                                                         |                                                                                               |
| `look: neo` default, hand-drawn lanes                                              | `look` is removed in v13 (`LOOK_REMOVED`)                                                                                                                                                      | GAP, documented                                                                                                                                            |                                                                                               |
| Allow-list                                                                         | lanes, bands and titles need `rect`, `line`, `g` with `rotate`, `text`                                                                                                                         | FITS                                                                                                                                                       | `assertInert` in `pnpm smoke`                                                                 |
| Themes                                                                             | the lanes and bands use the flowchart's cluster paints, asked for before the flowchart writes the root                                                                                         | FITS                                                                                                                                                       | no `HARNESS_UNDECLARED_ALIAS` on any of the 42 fixtures                                       |
| Accessibility                                                                      | `accTitle` / `accDescr` become `<title>` / `<desc>` through `renderFlowchart`; the root says `aria-roledescription="swimlane"`                                                                 | FITS                                                                                                                                                       | smoke fixture `swimlane-phases.mmd`                                                           |
| Packaging                                                                          | `diagram-swimlane` peer-depends on `@mermaid-js/diagram-flowchart` and depends on the private engine                                                                                           | GAP: not publishable until the engine is published or bundled                                                                                              | `packages/diagram-swimlane/package.json`                                                      |
| Security                                                                           | flowchart's own checks, plus the plugin's phase scan: linear (v13 port fix: the first version backtracked for 26 s on `phase a[` and 5,000 spaces), with phases counted against the node limit | FITS                                                                                                                                                       | `packages/diagram-swimlane/test/parser.test.ts`, "phase lines that cannot be scanned cheaply" |

### Notes

8. **Phases are read beside the flowchart parser, not inside it.**
   The plugin blanks each `phase` statement to spaces before `parseFlowchart` runs, so every range the flowchart reports stays an offset into the source, and reads the statements itself (at a line start or after `;`, as v12's lexer did).
   It finds each node's `@{ phase: id }` from the `dataRange` of the node mentions in the flowchart AST and reads the block with core's `parseYaml`.
   A phase declared twice, or named before it is declared, is a diagnostic where v12 threw.
   A grammar extension point (a diagram that adds a statement or a `@{ }` key to another diagram's syntax) would remove both workarounds.
9. **The custom layout calls the flowchart's layout step with another engine.**
   `layoutFlowchart(model, ctx)` measures every label and builds the `LayoutGraph`, then calls `ctx.layout(graph)`.
   The plugin hands it a proxy of the render context whose `layout` runs the swimlane engine (a spread would run the context's lazy `idPrefix` getter).
   An adapter turns the graph into v12 layout data: the top-level groups are the lanes, as in v12, the node sizes and edge-label sizes come from the graph, the phases from the plugin's model.
   It turns the engine's result back into a `LayoutModel`, leaving the lanes out of `groups` (the plugin draws them) and dropping repeated route points, which v12's renderer ignored and v13's turns into an arrowhead with no direction.
   The lane that holds nodes outside every lane is added to the flowchart model before measuring, so it is measured and drawn like any lane.
10. **How the engine lifted.**
    v12's engine is 46 files and 496 KB, with no d3, dagre or DOM import except in three files.
    `index.ts` (the renderer glue that read `getUserDefinedConfig()`) and `adjustLayout.ts` (line hops applied to the DOM) are not lifted; `phaseBands.ts` lost its d3 painting half.
    New: `index.ts` with `layoutSwimlanes()`, a logger that collects warnings (which become `SWIMLANE_LAYOUT` render warnings), and the subset of v12's `LayoutData` types the engine reads.
    The package keeps v12's compiler level (`strict`, without `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and the unused-local checks) and lint level, so it stays diffable against v12.
    56 of v12's 79 engine specs run unchanged apart from imports (592 tests).
    The other 23 need v12's flowchart parser, captured DOM sizes or the BPMN db: 14 `.ddlt` specs, `routeTouches` (which walks the ddlt fixtures), 4 specs on viewer-measured sizes, `phases.layout` (ported in `diagram-swimlane` instead), `sourceOrder`, and 2 BPMN specs.
11. **Extra layers come from decorating the writer.**
    `SvgWriter` is an interface, so the plugin passes `renderFlowchart` a writer that forwards every call and writes the lanes before the flowchart's `clusters` group and the phase bands before its `edgePaths` group, the v12 stacking.
    It also sets the root's class and `aria-roledescription`.
    This relies on the flowchart's group class names, which are not a contract; a `postRender` tree hook could do the same on the tree writer.
12. **One diagram plugin can be built on another.**
    The flowchart plugin's root export has everything the swimlane plugin needs, typed, so it imports nothing from `dist` paths (lint allows the bare package name only).
    The cost is coupling: the peer dependency is pinned to exactly `13.0.0-alpha.1`, and the plugin also relies on things the flowchart does not promise: that `layoutFlowchart` calls `ctx.layout`, the class names of its `clusters` and `edgePaths` groups, and the shape of `FlowLayout.flow`, whose type (`Prepared`) is reachable only through `FlowLayout`.
    Any of these can change between alpha builds; the render tests and the smoke would catch it.

## Fit table: bpmn-beta

`bpmn-beta` renders through the explicit path in Node with no DOM: the 16 examples of the v12 syntax pages (`bpmn.md`, `bpmnElements.md`) and the one BPMN regression, each with every label of the v12 render, no element over another and every element in its pool or lane (`test/bpmn-render.test.ts`).
With the same theme on both sides (`redux-color`), the drawings match the converged build shape for shape and, in most fixtures, route for route; widths and heights differ by up to 13% (the measured text).

| v12 dependency                                                   | v13 equivalent                                                                                                                                                                                                                                         | status                                                                                                      | evidence                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Registration and detection                                       | `registerExternalDiagrams([bpmn])`, id `bpmn` (v12's diagram type), which the alpha does not list                                                                                                                                                      | FITS                                                                                                        | `harness/plugins.mjs`; `r.diagramType` is `bpmn`                                                                |
| Parser (Chevrotain grammar, #8166)                               | hand-written lexer and line parser on `@mermaid-js/core/parser-kit`                                                                                                                                                                                    | FITS                                                                                                        | 77 ported parser tests; with the parser stubbed, 152 of the 196 BPMN tests fail                                 |
| `@{ }` and `&` shorthand                                         | none in v12 either: the converged grammar has neither                                                                                                                                                                                                  | not applicable                                                                                              | `bpmn.tokens.ts` has no token for them                                                                          |
| Errors (v12 threw at the first)                                  | diagnostics with ranges, the parse going on per line, v12's messages and order                                                                                                                                                                         | FITS                                                                                                        | `test/error-lines.test.ts`: the same line after front matter, comments and directives                           |
| Model and layout data (`BpmnDb`)                                 | a plain model, and v12's `getData()` as `bpmnLayoutData`                                                                                                                                                                                               | FITS                                                                                                        | 30 ported db tests                                                                                              |
| Layout (the swimlane engine)                                     | `layoutKind: 'custom'` calling the lifted engine; pools and lanes as lane roles, anchored boundary events and artifacts, endpoint profiles                                                                                                             | FITS                                                                                                        | `packages/diagram-bpmn/src/layout.ts`                                                                           |
| Edge ends (v12 `insertEdge` with each shape's `intersect`)       | ported as geometry: rings, a gateway's vertex, an annotation's bracket                                                                                                                                                                                 | GAP, see note 13                                                                                            | `packages/diagram-bpmn/src/dock.ts`                                                                             |
| Shapes (d3)                                                      | `SvgWriter`: `rect`, `circle`, `polygon`, `path`                                                                                                                                                                                                       | FITS                                                                                                        | `assertInert` in the render test                                                                                |
| End markers (`<marker>`)                                         | drawn at the line's ends as `path` and `circle`                                                                                                                                                                                                        | FITS, at a cost: see note 14                                                                                |                                                                                                                 |
| Glyphs (an Iconify pack drawn as markup)                         | the pack converted to absolute path commands, replayed through `SvgWriter.path()`                                                                                                                                                                      | GAP, see note 14                                                                                            | `packages/diagram-bpmn/scripts/gen-icons.mjs`                                                                   |
| `themeVariables.bpmn` and the colours v12 derived from the theme | theme lookups (`tertiaryColor`, `secondaryColor`, `primaryColor`, `lineColor`); a plugin cannot add theme variables                                                                                                                                    | GAP: `themeVariables.bpmn` is ignored; outlines are core's `nodeBorder`, not v12's contrast-derived strokes | `docs-bpmn-12` draws the default colours                                                                        |
| `bpmn` config section                                            | the plugin's own section, with `configDefaults` (`nodeSpacing`, `rankSpacing`, `diagramPadding`)                                                                                                                                                       | FITS, because the id is `bpmn`                                                                              | under the id `bpmn-beta`, front matter `bpmn:` gives `CONFIG_UNKNOWN_KEY`                                       |
| Title, `accTitle`, `accDescr`                                    | the title drawn by the plugin; `<title>` and `<desc>` on the root                                                                                                                                                                                      | FITS                                                                                                        |                                                                                                                 |
| Hand-drawn look                                                  | `look` is removed in v13; v12 drew BPMN shapes plain anyway                                                                                                                                                                                            | FITS                                                                                                        |                                                                                                                 |
| Packaging                                                        | depends on the private swimlane engine                                                                                                                                                                                                                 | GAP: not publishable until the engine is published or bundled                                               |                                                                                                                 |
| Security                                                         | the writer's allow-list (`assertInert` passes on every fixture); no markup from the diagram text reaches the SVG; the glyph pack is converted at build time and read as text, never run; the lexer is linear, and the node, edge and depth limits hold | FITS                                                                                                        | `test/bpmn-render.test.ts`; `packages/diagram-bpmn/test/parser.test.ts`, "lines that cannot be scanned cheaply" |

### Notes

13. **Where a flow meets a shape.**
    The engine ends a route on the node's reserved box, caption included; v12's renderer moved each end onto the drawn shape.
    The plugin ports that step (the swimlane branch of `insertEdge` and the `intersect` of each BPMN shape) as plain geometry, so it runs in Node.
    A diagram plugin that wants this has to carry it: `LayoutModelEdge` ends on the box `LayoutNode` gave, and core has no hook for a shape's outline.
    The engine can also end a route on a repeated point.
    `renderFlowchart` draws such a route's arrowhead as `M210,28.05L210,28.05L210,28.05Z`, a marker with no direction and no area: a layout engine registered with `registerLayoutLoaders` that repeats a route's last point reproduces it on a plain flowchart (`flowchart LR\n  a --> b`, alpha.1). The swimlane and BPMN plugins drop repeated points before drawing.
14. **No `<marker>`, `<use>` or raw markup.**
    Every arrowhead, the message flow's source ring and the open head are drawn as elements at the line's ends, and the line is trimmed for them.
    The 29 glyphs of v12's pack (44 elements) are generated data, so a changed pack needs `gen-icons.mjs` run again; the generator reads the pack as text and never runs it.

## Fit table: c4-beta

| v12 dependency                                          | v13 equivalent                                                                                       | status | evidence                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Registration and detection                              | `registerExternalDiagrams([c4Beta, c4BetaCompat])` under its own id, no `replace`                    | FITS   | no first-party row claims `c4-beta`; `test/c4-beta-render.test.ts`                     |
| Lazy registration (a `loader`, the `mermaid` manifest)  | the registry loads the plugin's `diagram` member, else its `layout` member                           | GAP    | note 15                                                                                |
| Parser (`c4.langium` in `@mermaid-js/parser`)           | a hand-written scanner and recursive descent on parser-kit; no Langium                               | FITS   | note 16                                                                                |
| db and validation (`c4-beta/db.ts`)                     | checks in the parse, as warnings: an unexpected kind, technology or instances where v12 ignores them | FITS   | the ported specs, note 16                                                              |
| Code shared with legacy C4                              | the workspace package `@mermaid-v13-plugins/c4-shared`                                               | FITS   | note 17                                                                                |
| Layout: boundaries, nested deployment nodes             | `LayoutGroup` with a stacked title                                                                   | FITS   | `docs-08`: four nested nodes; every fixture keeps its elements inside their boundaries |
| Layout: `direction`                                     | the graph's direction                                                                                | FITS   | `docs-14` lays out left to right                                                       |
| Dynamic step numbers                                    | numbered labels made by the plugin                                                                   | FITS   | `docs-07`: steps 1, 2, 2, 3, 4                                                         |
| Tag styles (`fill`, `stroke`, `color`, `shape`, `line`) | colours through `checkColor`, dash patterns through `checkStyle`                                     | FITS   | `docs-12`: a dark fill, a cylinder, a dotted line                                      |
| Legend                                                  | drawn by the plugin under the drawing                                                                | FITS   | one row per kind, externals apart, then one per tag style; `legend off` draws none     |
| Theme variables `c4PersonBkg` and the rest              | an extension's config fragment declares them                                                         | GAP    | note 18                                                                                |
| Config: v12's `c4beta` section                          | the plugin's `c4-beta` section; `c4BetaCompat` aliases `c4beta` to it                                | GAP    | note 18                                                                                |
| HTML labels                                             | `layoutLabel`; the plugin escapes user text, because core's label layout reads `<b>` and entities    | FITS   | `<b>A & B</b>` is drawn as written                                                     |
| Accessibility                                           | `<title>` and `<desc>` with `aria-labelledby` and `aria-describedby`                                 | FITS   | `accTitle`, `accDescr`                                                                 |

### Notes

15. **A plugin with a `layout` member loads that member on the lazy paths.**
    The registry unwraps whatever a `loader` returns (`registry.js`, `unwrap`): it takes `diagram`, else `layout`, else `default`.
    A manifest's `export` goes through the same step.
    Every diagram plugin has a `layout` method, so it loads that function as the plugin, and the render fails with `plugin.parse is not a function`.
    This hit all four plugins of this repository on all three lazy paths: a loader that returns the plugin, a loader that returns the package's namespace, and the manifest.
    Eager registration was not affected.
    Each plugin now names itself as `diagram` (`{ ...plugin, diagram: plugin }`), and each package exports `diagram` for a loader that returns its namespace.
    `test/lazy-registration.test.ts` renders every plugin through every path; without the self-reference, all nine cases of `c4`, `swimlane` and `bpmn` fail.
16. **Parser.**
    The converged build parses c4-beta with Langium; the alpha has no Langium, and a plugin may depend only on core.
    The port is a scanner and a recursive descent on parser-kit, as legacy C4's is, but the two grammars share no code.
    It unescapes strings as Langium does, keeps going after an error, and reports the limits as core's limit codes.
    The converged build's parser, db and detector specs are ported: 68 tests, 51 on the parse and 17 on the rendered SVG.
    With the parser stubbed to an empty model, 49 of them fail; the 19 that pass check the header defaults, the detector, or that no warning is given.
17. **Shared code.**
    `@mermaid-v13-plugins/c4-shared` (800 lines) holds what both plugins draw with: the stacked label blocks, the shapes, the scene layout over core's layered engine, the edge and boundary drawing, and the colour helpers.
    Legacy C4 keeps 450 lines of its own layout and rendering, c4-beta 600; the parsers are 1,370 and 910 lines.
    Moving the code out left all 57 legacy renders byte-identical except for one wrapper group.
18. **What a diagram plugin cannot declare goes in an extension.**
    `c4BetaCompat` is an extension to register next to the plugin.
    Its config fragment declares the 13 C4 theme variables, so a page can set `--mermaid-c4PersonBkg`; without it, `theme.color('c4PersonBkg')` throws `TypeError: Unknown theme variable "c4PersonBkg"`, and the plugin draws the converged build's colours as literals.
    The same fragment aliases v12's `c4beta` section to the plugin's `c4-beta` section.
    Without it, `c4beta: { hideStereotypes: [person] }` in front matter gives `CONFIG_UNKNOWN_KEY` and the stereotype stays.

## Parity with the converged build: c4-beta

The 27 sources are the c4-beta documentation, the examples, the e2e spec and the proof page of the converged build.
All 27 render, and each sheet was opened next to the converged build's render.
Every element, label, relationship, boundary and legend row is drawn in both, and the placement matches: the same ranks, the same sides.
`test/c4-beta-render.test.ts` checks that no element overlaps another or leaves its boundary.
These are the differences:

| difference                                                    | fixtures                                   | cause                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Lines are wider and wrap less                                 | all                                        | v13's default font size is 14px, the converged build's 16px                                                               |
| Relationship labels sit on a darker grey                      | all with labels                            | core's `edgeLabelBackground` defaults to `secondaryColor`                                                                 |
| Arrowheads are larger                                         | all                                        | core's arrowhead size                                                                                                     |
| A deployment node's technology line is centred under its name | `docs-08` to `docs-11`, `spec-5`, `spec-7` | the converged build left-aligns it                                                                                        |
| An edge into a nested boundary crosses the boundary's title   | `docs-08`, `spec-5`                        | both builds route into a child centred under the title; the converged build does it in `docs-03`, `docs-09` and `docs-11` |
