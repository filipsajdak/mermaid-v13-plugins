import type { Diagnostic, Range } from '@mermaid-js/core/parser-kit';
import { diagramStart, isYamlMap, parseYaml, preprocess } from '@mermaid-js/core/preprocess';
import type { PreprocessResult } from '@mermaid-js/core/preprocess';
import { parseFlowchart } from '@mermaid-js/diagram-flowchart';
import type {
  FlowDocument,
  FlowNodeStmt,
  FlowParseOptions,
  FlowParseResult,
  FlowStatementNode,
} from '@mermaid-js/diagram-flowchart';
import type { SharedNode, SwimlaneModel, SwimlanePhase } from './model.ts';

export type SwimlaneParseOptions = FlowParseOptions;
export type SwimlaneParseResult = Omit<FlowParseResult, 'model'> & { model: SwimlaneModel };

interface PhaseStatement {
  readonly phase: SwimlanePhase;
  /** The whole statement, which is blanked before the flowchart parser sees the text. */
  readonly range: Range;
  /** The id, where a duplicate is reported. */
  readonly idRange: Range;
}

/**
 * `phase id` or `phase id[Title]` / `phase id["Title"]`, alone on its line or ended by `;`.
 * v12 lexed `phase` as a keyword only at the start of a statement and only in swimlane-beta;
 * anywhere else it is an id, so `phase --> x` and `style phase fill:#f00` are left alone.
 */
const PHASE =
  /^([^\S\n]*)phase[^\S\n]+([A-Za-z0-9_][\w-]*)(?:\[\s*(?:"([^"\n]*)"|([^\]"\n]*?))\s*\])?[^\S\n]*(?=;|\n|$)/;

/** Every phase statement after `start`, at a line start or after a `;`. */
function phaseStatements(text: string, start: number): PhaseStatement[] {
  const found: PhaseStatement[] = [];
  const statementStart = /(^|[\n;])/g;
  statementStart.lastIndex = start;
  for (let m = statementStart.exec(text); m !== null; m = statementStart.exec(text)) {
    const at = m.index + (m[1] ?? '').length;
    const hit = PHASE.exec(text.slice(at));
    const [whole, indent = '', id, quoted, bare] = hit ?? [];
    if (whole !== undefined && id !== undefined) {
      const markdown = quoted !== undefined && /^`[^]*`$/.test(quoted);
      const idStart = text.indexOf(id, at + indent.length + 'phase'.length);
      found.push({
        phase: {
          id,
          label: markdown ? quoted.slice(1, -1) : (quoted ?? bare?.trim() ?? id),
          labelType: markdown ? 'markdown' : 'text',
        },
        range: { start: at + indent.length, end: at + whole.length },
        idRange: { start: idStart, end: idStart + id.length },
      });
    }
    if (statementStart.lastIndex === m.index) statementStart.lastIndex++;
  }
  return found;
}

/** `text` with every character of `ranges` but line breaks turned into spaces: offsets stay put. */
function blank(text: string, ranges: readonly Range[]): string {
  let out = '';
  let from = 0;
  for (const r of ranges) {
    out += text.slice(from, r.start) + text.slice(r.start, r.end).replace(/[^\n]/g, ' ');
    from = r.end;
  }
  return out + text.slice(from);
}

/** The `@{ … }` blocks of a node mention, as YAML maps (`A@{…}@{…}` is one block per pair). */
function shapeData(text: string, range: Range): Record<string, unknown>[] {
  const maps: Record<string, unknown>[] = [];
  const source = text.slice(range.start, range.end);
  const block = /\{/g;
  for (let open = block.exec(source); open !== null; open = block.exec(source)) {
    const close = source.indexOf('}', open.index);
    if (close < 0) break;
    const inner = { start: range.start + open.index + 1, end: range.start + close };
    // As the flowchart parser reads it: a multi-line block is block YAML, a one-liner a flow map.
    const multiline = text.slice(inner.start, inner.end).includes('\n');
    const result = parseYaml(
      text,
      multiline ? inner : { start: inner.start - 1, end: inner.end + 1 },
    );
    if (isYamlMap(result.value)) maps.push(result.value);
    block.lastIndex = close + 1;
  }
  return maps;
}

function* nodeStatements(nodes: readonly FlowStatementNode[]): Generator<FlowNodeStmt> {
  for (const node of nodes) {
    if (node.type === 'Chain') {
      for (const child of node.children) if (child.type === 'Node') yield child;
    } else if (node.type === 'Subgraph') {
      yield* nodeStatements(node.children);
    }
  }
}

/** The nodes each subgraph mentions directly, by the subgraph's model id. */
function mentions(nodes: readonly FlowStatementNode[], into: Map<string, string[]>): void {
  for (const node of nodes) {
    if (node.type !== 'Subgraph') continue;
    const own = into.get(node.name) ?? [];
    for (const child of node.children) {
      if (child.type === 'Chain') {
        for (const part of child.children) if (part.type === 'Node') own.push(part.name);
      }
    }
    into.set(node.name, own);
    mentions(node.children, into);
  }
}

/** Every node a subgraph mentions that the flowchart model gave to an earlier subgraph. */
function sharedNodes(ast: FlowDocument, flow: FlowParseResult['model']): SharedNode[] {
  const owner = new Map<string, string>();
  for (const sg of flow.subgraphs) {
    for (const member of sg.nodes) if (!owner.has(member)) owner.set(member, sg.id);
  }
  const mentioned = new Map<string, string[]>();
  mentions(ast.children, mentioned);
  const found = new Map<string, SharedNode>();
  for (const sg of flow.subgraphs) {
    for (const node of mentioned.get(sg.id) ?? []) {
      const keptBy = owner.get(node);
      if (keptBy !== undefined && keptBy !== sg.id && !sg.nodes.includes(node)) {
        found.set(`${node}\u0000${sg.id}`, { node, keptBy, droppedFrom: sg.id });
      }
    }
  }
  return [...found.values()];
}

/** Finds the declared phases and the phase each node names, reporting what v12 threw on. */
function readPhases(
  text: string,
  statements: readonly PhaseStatement[],
  ast: FlowDocument,
  vertices: ReadonlySet<string>,
  report: (d: Diagnostic) => void,
): Pick<SwimlaneModel, 'phases' | 'nodePhases'> {
  const declaredAt = new Map<string, number>();
  const phases: SwimlanePhase[] = [];
  for (const s of statements) {
    if (declaredAt.has(s.phase.id)) {
      report({
        severity: 'error',
        code: 'SWIMLANE_PHASE_DUPLICATE',
        message: `Phase "${s.phase.id}" is declared twice.`,
        range: s.idRange,
      });
      continue;
    }
    declaredAt.set(s.phase.id, s.range.start);
    phases.push(s.phase);
  }
  const nodePhases = new Map<string, string>();
  for (const node of nodeStatements(ast.children)) {
    if (node.dataRange === undefined || !vertices.has(node.name)) continue;
    for (const data of shapeData(text, node.dataRange)) {
      const named = data.phase;
      if (typeof named !== 'string' && typeof named !== 'number') continue;
      const phase = String(named);
      const at = declaredAt.get(phase);
      if (at === undefined || at > node.dataRange.start) {
        report({
          severity: 'error',
          code: 'SWIMLANE_PHASE_UNKNOWN',
          message: `Unknown phase "${phase}" on node "${node.name}". Declare it before the node with: phase ${phase}["Title"]`,
          range: node.dataRange,
        });
        continue;
      }
      nodePhases.set(node.name, phase);
    }
  }
  return { phases, nodePhases: [...nodePhases] };
}

/**
 * Parses a swimlane diagram: the flowchart syntax (v13's own flowchart parser, which already
 * knows the `swimlane-beta` keyword) plus `phase` statements and `@{ phase: id }` on nodes.
 * `text` is the whole source; every range is an offset into it. Never throws.
 */
export function parseSwimlane(
  text: string,
  options: SwimlaneParseOptions = {},
): SwimlaneParseResult {
  const pre: PreprocessResult = options.preprocessed ?? preprocess(text);
  const statements = phaseStatements(text, diagramStart(text, pre));
  const flow = parseFlowchart(
    blank(
      text,
      statements.map((s) => s.range),
    ),
    { ...options, preprocessed: pre },
  );
  const own: Diagnostic[] = [];
  const vertices = new Set(flow.model.vertices.map((v) => v.id));
  const { phases, nodePhases } = readPhases(text, statements, flow.ast, vertices, (d) =>
    own.push(d),
  );
  const diagnostics = [...flow.diagnostics, ...own].sort((a, b) => a.range.start - b.range.start);
  return {
    ...flow,
    diagnostics,
    model: { flow: flow.model, phases, nodePhases, sharedNodes: sharedNodes(flow.ast, flow.model) },
  };
}
