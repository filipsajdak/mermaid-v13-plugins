# bpmn-beta fixtures

Every bpmn-beta source the converged v12 build ships (`develop` with the bpmn-beta series, #8166, merged on top).
The file name's prefix says where it comes from:

| prefix           | source in mermaid-js/mermaid                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `docs-bpmn-`     | the examples in `packages/mermaid/src/docs/syntax/bpmn.md`, in order         |
| `docs-elements-` | the examples in `packages/mermaid/src/docs/syntax/bpmnElements.md`, in order |
| `regression-`    | `e2e/platform/dev-diagrams/layout-tests/bpmn/regressions/`                   |

`test/bpmn-render.test.ts` renders all of them; `pnpm render packages/diagram-bpmn/fixtures` writes the SVGs.
