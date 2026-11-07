# swimlane-beta fixtures

Every swimlane-beta source the converged v12 build ships (`develop` with the swimlane phases pull request, #8407, merged on top).
The file name's prefix says where it comes from:

| prefix         | source in mermaid-js/mermaid                                              |
| -------------- | ------------------------------------------------------------------------- |
| `docs-`        | the examples in `packages/mermaid/src/docs/syntax/swimlanes.md`, in order |
| `layout-test-` | `e2e/platform/dev-diagrams/layout-tests/swimlanes/*.mmd`                  |
| `regression-`  | `e2e/platform/dev-diagrams/layout-tests/swimlanes/regressions/`           |

`test/swimlane-render.test.ts` renders all of them; `pnpm render packages/diagram-swimlane/fixtures` writes the SVGs.
