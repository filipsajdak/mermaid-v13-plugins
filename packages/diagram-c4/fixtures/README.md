# Legacy C4 fixtures

Every legacy C4 source from mermaid-js/mermaid, as of `develop` 63333fd8d with the open C4 pull requests (listed in mermaid-js/mermaid#7849) merged on top.
Some of them exist only in those pull requests.
The file name's prefix says where it comes from:

| prefix        | source in mermaid-js/mermaid                                       |
| ------------- | ------------------------------------------------------------------ |
| `docs-`       | the examples in `packages/mermaid/src/docs/syntax/c4.md`, in order |
| `e2e-`        | `e2e/diagrams/c4/**/*.mmd`, the folders joined into the name       |
| `regression-` | `e2e/platform/dev-diagrams/layout-tests/c4/regressions/`           |
| `example-`    | `packages/examples/src/examples/c4.ts`                             |
| `spec-`       | the diagram sources inside `e2e/rendering/c4/**/*.spec.js`         |

`test/c4-render.test.ts` renders all of them; `pnpm render packages/diagram-c4/fixtures` writes the SVGs.
