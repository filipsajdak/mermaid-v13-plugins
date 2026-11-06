# How our v12 C4 and BPMN work fits Mermaid v13

Legacy C4 can only reach the v13 alpha through an explicit `registerExternalDiagrams([c4], { replace: true })`.
Discovery from `node_modules` skips it, and a plugin under a new id never sees C4 text.
Everything below is measured against `mermaid@13.0.0-alpha.1` and `@mermaid-js/core@13.0.0-alpha.1`, pinned exactly.

Each row gives the v13 equivalent, a gap, or a `BLOCKER`, with the evidence behind it.
`FITS` means the v13 contract already has what the v12 code needs.
`GAP` means it works with extra code or a documented loss.
`BLOCKER` means a plugin cannot do it at all through the public contract.
`OPEN` means not assessed yet; the stage that will assess it is named.

The v12 side is the converged build: `develop` plus our open pull requests (`~/dev/c4mermaid-all`, branch `local/all-features`).
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

| v12 dependency                    | v13 equivalent                                                                                    | status              | evidence                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Registration and detection        | `registerExternalDiagrams(..., { replace: true })`                                                | FITS, explicit only | Registration above                                                                                               |
| Parser (`c4Diagram.jison`)        | hand-written lexer and recursive descent on `@mermaid-js/core/parser-kit`; no grammar abstraction | OPEN, stage 1       |                                                                                                                  |
| db and model (`c4Db.ts`)          | plain serialisable model returned by `parse`                                                      | OPEN, stage 1       |                                                                                                                  |
| Layout (`c4LayoutData.ts`)        | `layoutKind: 'graph'`, `ctx.layout(LayoutGraph)`                                                  | OPEN, stage 1       |                                                                                                                  |
| Shapes (person, cylinders, boxes) | `SvgWriter` with an allow-list of 18 tags                                                         | OPEN, stage 1       | `@mermaid-js/core/svg` `ALLOWED_TAGS` has no `marker`, `use`, `symbol`, `clipPath`, `pattern` or `foreignObject` |
| d3 and DOM                        | none: SVG is written as text through `SvgWriter`                                                  | OPEN, stage 1       |                                                                                                                  |
| Themes                            | `ctx.theme` and `--mermaid-*` variables                                                           | GAP, see note 1     | `harness/lib/svg-checks.mjs`, placeholder render                                                                 |
| Config schema (`c4` section)      | core's `KEY_TREE` already holds a `c4` section with v12's `C4DiagramConfig` keys                  | OPEN, stage 1       | `@mermaid-js/core/dist/config/generated/keys.js`                                                                 |
| Icons and sprites                 | `<image href>` through `checkImageUrl`: relative, http(s), or `data:image` png, jpeg, gif, webp   | OPEN, stage 1       | `@mermaid-js/core/dist/svg/url.js`                                                                               |
| Text wrap and HTML labels         | `layoutLabel` wraps greedily at a width; HTML labels are removed (documented)                     | OPEN, stage 1       |                                                                                                                  |
| Accessibility                     | `title`, `desc`, `role`, `aria-*` are on the allow-list                                           | OPEN, stage 1       |                                                                                                                  |
| Security                          | the writer only emits allowed tags and branded values; `inertProblem` checks output               | OPEN, stage 1       |                                                                                                                  |
| Packaging and types               | plugin packages need no DOM types; `mermaid`'s own types do                                       | FITS, see note 2    |                                                                                                                  |

### Notes

1. **Theme paints must be asked for before the root `<svg>` is written.**
   The root's `style` declares only the theme aliases (`--_mb`, `--_nt`, ...) used so far, and the stream writer cannot change the root afterwards.
   A paint asked for later is used but never declared, so the browser draws black fills and invisible text, with no warning.
   Measured on the harness placeholder: the first version drew black boxes, and its root declared none of `--_ff`, `--_fs`, `--_mb`, `--_nb`, `--_nt`.
   The state plugin avoids it by building every paint first.
   The harness now reports this as `HARNESS_UNDECLARED_ALIAS`, and the smoke fails on it.
2. **Types.**
   With `lib: ["ES2022"]`, strict flags and `skipLibCheck: false`, a plugin package typechecks against `@mermaid-js/core`'s declarations with no DOM library.
   A consumer of `mermaid` itself needs `lib: ["DOM"]`: `mermaid/dist/api.d.ts(80,31): error TS2304: Cannot find name 'Element'` (also `HTMLElement` in `dom.d.ts` and `index.d.ts`), even in a Node-only program.
