# mermaid-v13-plugins

Diagram plugins for the Mermaid v13 alpha: legacy C4, `c4-beta`, `bpmn-beta` and `swimlane-beta`.
They port diagram work written for Mermaid v12, to find out whether it fits the v13 plugin architecture and what blocks it.
The findings are in [docs/FIT.md](docs/FIT.md).

This is an unofficial community port.
It is not affiliated with or endorsed by the Mermaid project or mermaid.ai.

## Pinned alpha

Everything here is built and tested against exactly `mermaid@13.0.0-alpha.1` and `@mermaid-js/core@13.0.0-alpha.1`.
The npm tag `v13-alpha` moves every few days, so the versions are pinned rather than tagged.
Each plugin declares `@mermaid-js/core` as a peer dependency, at that exact version, and has no other runtime dependency.
The exceptions are the swimlane plugin, which also peer-depends on `@mermaid-js/diagram-flowchart` (a swimlane diagram is a flowchart in lanes), and the swimlane and BPMN plugins, which depend on our private swimlane engine.

## Status

| plugin    | package                                 | keyword                                                                | status                                                                                                                          |
| --------- | --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Legacy C4 | `@mermaid-v13-plugins/diagram-c4`       | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` | renders: all 57 legacy C4 sources of mermaid's docs, e2e and open C4 pull requests; the differences from v12 are in docs/FIT.md |
| C4 beta   | `@mermaid-v13-plugins/diagram-c4-beta`  | `c4-beta`                                                              | renders: all 27 c4-beta sources of the converged build's docs, examples and e2e; the differences from v12 are in docs/FIT.md    |
| BPMN      | `@mermaid-v13-plugins/diagram-bpmn`     | `bpmn-beta`                                                            | renders: the 16 syntax-page examples and the BPMN regression; the differences from v12 are in docs/FIT.md                       |
| Swimlane  | `@mermaid-v13-plugins/diagram-swimlane` | `swimlane-beta`                                                        | renders: all 42 v12 fixtures and the 14 syntax-page examples; the differences from v12 are in docs/FIT.md                       |

The stages are: not started, parses, renders, parity (matches the v12 render of every fixture).

## Try it

The packages are not on npm.
Build them from a clone, with Node 22 and pnpm (the version is pinned in `package.json`):

```sh
pnpm install
pnpm build
```

Then, in Node:

```js
import { createMermaid } from 'mermaid';
import { c4 } from '@mermaid-v13-plugins/diagram-c4';

const mermaid = createMermaid();
// Our packages are registered explicitly; Node discovery would skip the C4 one (see docs/FIT.md).
mermaid.initialize({ discovery: false });
// The alpha knows the `c4` type but ships no package for it, so the plugin takes its slot.
await mermaid.registerExternalDiagrams([c4], { replace: true });

const source =
  'C4Context\n  Person(user, "User")\n  System(app, "App")\n  Rel(user, app, "Uses")\n';
const { svg, warnings } = await mermaid.render('diagram-1', source);
```

`c4-beta` has an id of its own, so it needs no `replace`.
Register `c4BetaCompat` with it: it carries the C4 theme variables and v12's `c4beta` config section, which a diagram plugin cannot declare.

```js
import { c4Beta, c4BetaCompat } from '@mermaid-v13-plugins/diagram-c4-beta';

await mermaid.registerExternalDiagrams([c4Beta, c4BetaCompat]);
const beta = await mermaid.render('diagram-2', 'c4-beta context\n  person user "User"\n');
```

The harness makes the same calls (`harness/lib/mermaid.mjs`).

## Develop

| command                                    | what it does                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm check`                               | typecheck, tests, lint and format check: the gates CI runs              |
| `pnpm build`                               | compiles every package to its `dist/`                                   |
| `pnpm smoke`                               | renders the smoke fixtures in Node and checks their SVG                 |
| `pnpm render [--png] <file.mmd or dir>...` | renders to `harness/out/<name>.svg`, and `.png` through headless Chrome |
| `pnpm sheet --v12 <dir>`                   | side-by-side PNGs of our render and the v12 render of each diagram      |
| `pnpm serve`                               | serves `harness/out` on http://127.0.0.1:9238                           |

The harness renders in Node with no DOM.
It rasterises through the installed Chrome (`CHROME_PATH` to point at another) and never downloads a browser.
`pnpm build` must run before `pnpm render`, `pnpm smoke` and `pnpm sheet`, which load the built packages.

Plugins follow the v13 conventions: they import only `@mermaid-js/core` (the swimlane plugin also the flowchart plugin, and the swimlane and BPMN plugins our engine), use no DOM, write SVG only through `SvgWriter`, take colours from theme variables, return parse problems as diagnostics instead of throwing, take lengths from the measurer, and render deterministically.
Lint enforces the import and DOM rules.

## License

MIT; see [LICENSE](LICENSE).
The code is derived from Mermaid, so its copyright line is kept.
