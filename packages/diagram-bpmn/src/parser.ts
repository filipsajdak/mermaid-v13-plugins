/**
 * The bpmn-beta parser: a hand-written lexer and line parser on `@mermaid-js/core/parser-kit`,
 * accepting what v12's Chevrotain grammar accepts (`parser/bpmn.chevrotain.ts`,
 * `bpmn.tokens.ts` and `bpmn.parser.ts` of the bpmn-beta series, #8166).
 *
 * v12 threw at the first problem; here each one is a diagnostic with its range, and the parse
 * goes on at the next line. The messages are v12's, without the `at line N, column C` that the
 * range now carries.
 */
import { DEFAULT_LIMITS, LIMIT_CODES } from '@mermaid-js/core/limits';
import { FIRST_DIAGRAM_KIND, Kind, ParseState, TokenWriter } from '@mermaid-js/core/parser-kit';
import type { AstNode, ParseOptions, ParseResult, Range } from '@mermaid-js/core/parser-kit';
import { diagramStart, preprocess } from '@mermaid-js/core/preprocess';
import type { PreprocessResult } from '@mermaid-js/core/preprocess';
import {
  BPMN_DIRECTIONS,
  drawsTrigger,
  EVENT_POSITIONS,
  EVENT_TRIGGERS,
  positionsFor,
  TASK_TYPES,
} from './model.ts';
import type {
  BpmnDirection,
  BpmnFlow,
  BpmnFlowKind,
  BpmnModel,
  BpmnNode,
  BpmnNodeKind,
  EventPosition,
} from './model.ts';

/** Token kinds of the lexer, after core's shared ones. */
export const T = {
  Indent: FIRST_DIAGRAM_KIND,
  Keyword: FIRST_DIAGRAM_KIND + 1,
  Identifier: FIRST_DIAGRAM_KIND + 2,
  String: FIRST_DIAGRAM_KIND + 3,
  Arrow: FIRST_DIAGRAM_KIND + 4,
  Meta: FIRST_DIAGRAM_KIND + 5,
} as const;

export interface BpmnParseOptions extends ParseOptions {
  /** The preprocess result the pipeline already has; computed here when absent. */
  readonly preprocessed?: PreprocessResult;
  /** Integrator caps (`ctx.limits`); core's defaults when absent. */
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly maxDepth?: number;
}

export type BpmnDocument = AstNode<'bpmnDocument'>;
export type BpmnParseResult = ParseResult<BpmnModel, BpmnDocument>;

type Connector = 'labelled' | 'message' | 'arrow' | 'association-arrow' | 'association-line';

/** One lexed token of a line. */
interface Token {
  readonly type: 'indent' | 'keyword' | 'identifier' | 'string' | 'connector' | 'meta';
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly connector?: Connector;
}

const KEYWORDS = new Set<string>([
  'bpmn-beta',
  ...BPMN_DIRECTIONS,
  'pool',
  'lane',
  'group',
  ...EVENT_POSITIONS,
  'task',
  'subprocess',
  'call',
  'event-gateway',
  'xor',
  'and',
  'or',
  'complex',
  'data-store',
  'data-collection',
  'data-input',
  'data-output',
  'data',
  'note',
  ...EVENT_TRIGGERS,
  ...TASK_TYPES,
]);

const CONTAINERS: Readonly<Record<string, BpmnNodeKind>> = {
  pool: 'pool',
  lane: 'lane',
  group: 'group',
};
const GATEWAYS = new Set(['xor', 'and', 'or', 'event-gateway', 'complex']);
const ACTIVITIES = new Set(['task', 'subprocess', 'call']);
const ARTIFACTS: Readonly<Record<string, BpmnNodeKind>> = {
  'data-store': 'store',
  'data-collection': 'data',
  'data-input': 'data',
  'data-output': 'data',
  data: 'data',
  note: 'annotation',
};
const DATA_QUALIFIERS: Readonly<Record<string, string>> = {
  'data-input': 'input',
  'data-output': 'output',
  'data-collection': 'collection',
};
const TRIGGER_WORDS = new Set<string>(EVENT_TRIGGERS);
const TASK_TYPE_WORDS = new Set<string>(TASK_TYPES);
const POSITION_WORDS = new Set<string>(EVENT_POSITIONS);
const isPosition = (word: string): word is EventPosition => POSITION_WORDS.has(word);
const isDirection = (word: string): word is BpmnDirection =>
  BPMN_DIRECTIONS.some((d) => d === word);

/** v12's identifier: a letter or `_`, word characters, and `-word` parts. */
const IDENTIFIER = /[A-Z_a-z]\w*(?:-\w+)*/y;
const META = /(?:title[\t ]+|accTitle[\t ]*:|accDescr[\t ]*:)[^\n\r]*/y;
const ACC_DESCR_BLOCK = /accDescr[\t ]*\{[^}]*\}/y;

const isBlank = (c: string | undefined) => c === ' ' || c === '\t';
const isLineBreak = (c: string | undefined) => c === '\n' || c === '\r';

/** Where a `--` that opens a labelled arrow ends: after the first `--+>` on its line. */
function labelledArrowEnd(text: string, at: number, lineEnd: number): number | undefined {
  // `--(?![>-])[^\n\r]*?--+>`, scanned once: the earliest `>` with two dashes before it.
  if (text[at + 2] === '>' || text[at + 2] === '-') return undefined;
  let dashes = 0;
  for (let i = at + 2; i < lineEnd; i++) {
    const c = text[i];
    if (c === '>' && dashes >= 2) return i + 1;
    dashes = c === '-' ? dashes + 1 : 0;
  }
  return undefined;
}

/** The connector at `at`, in v12's token order: labelled, message, plain, then associations. */
function connectorAt(
  text: string,
  at: number,
  lineEnd: number,
): { end: number; connector: Connector } | undefined {
  if (text.startsWith('--', at)) {
    const labelled = labelledArrowEnd(text, at, lineEnd);
    if (labelled !== undefined) return { end: labelled, connector: 'labelled' };
  }
  if (text.startsWith('-.->', at)) return { end: at + 4, connector: 'message' };
  if (text.startsWith('--', at)) {
    let i = at;
    while (text[i] === '-') i++;
    if (text[i] === '>') return { end: i + 1, connector: 'arrow' };
  }
  if (text.startsWith('..', at)) {
    let i = at;
    while (text[i] === '.') i++;
    if (text[i] === '>') return { end: i + 1, connector: 'association-arrow' };
    if (i - at >= 3) return { end: i, connector: 'association-line' };
  }
  return undefined;
}

interface Line {
  readonly start: number;
  readonly end: number;
  readonly tokens: readonly Token[];
  /** The offset of a character no token matched. */
  readonly bad?: number;
}

/**
 * Lexes `text` from `from` into lines of tokens. An `accDescr { … }` block spans lines and is
 * one token. Comments and blanks are dropped (and written to `out` as trivia).
 */
function lexLines(text: string, from: number, out: TokenWriter): Line[] {
  const lines: Line[] = [];
  let at = from;
  while (at <= text.length) {
    let lineEnd = at;
    while (lineEnd < text.length && !isLineBreak(text[lineEnd])) lineEnd++;
    const tokens: Token[] = [];
    let bad: number | undefined;
    let i = at;
    if (isBlank(text[i])) {
      while (isBlank(text[i])) i++;
      tokens.push({ type: 'indent', text: text.slice(at, i), start: at, end: i });
      out.push(T.Indent, at, i);
    }
    while (i < lineEnd) {
      const c = text[i];
      if (isBlank(c)) {
        const s = i;
        while (i < lineEnd && isBlank(text[i])) i++;
        out.push(Kind.Space, s, i);
        continue;
      }
      if (text.startsWith('%%', i)) {
        out.push(Kind.Comment, i, lineEnd);
        break;
      }
      const conn = connectorAt(text, i, lineEnd);
      if (conn) {
        tokens.push({
          type: 'connector',
          text: text.slice(i, conn.end),
          start: i,
          end: conn.end,
          connector: conn.connector,
        });
        out.push(T.Arrow, i, conn.end);
        i = conn.end;
        continue;
      }
      ACC_DESCR_BLOCK.lastIndex = i;
      const block = ACC_DESCR_BLOCK.exec(text);
      if (block) {
        const end = i + block[0].length;
        tokens.push({ type: 'meta', text: block[0], start: i, end });
        out.push(T.Meta, i, end);
        i = end;
        // The block may have run over line ends: the line now ends where the block's line does.
        while (lineEnd < end) {
          lineEnd = end;
          while (lineEnd < text.length && !isLineBreak(text[lineEnd])) lineEnd++;
        }
        continue;
      }
      META.lastIndex = i;
      const meta = META.exec(text);
      if (meta) {
        const end = i + meta[0].length;
        tokens.push({ type: 'meta', text: meta[0], start: i, end });
        out.push(T.Meta, i, end);
        i = end;
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < lineEnd && text[j] !== '"') j++;
        if (j < lineEnd) {
          tokens.push({ type: 'string', text: text.slice(i, j + 1), start: i, end: j + 1 });
          out.push(T.String, i, j + 1);
          i = j + 1;
          continue;
        }
      }
      IDENTIFIER.lastIndex = i;
      const word = IDENTIFIER.exec(text);
      if (word) {
        const end = i + word[0].length;
        const keyword = KEYWORDS.has(word[0]);
        tokens.push({ type: keyword ? 'keyword' : 'identifier', text: word[0], start: i, end });
        out.push(keyword ? T.Keyword : T.Identifier, i, end);
        i = end;
        continue;
      }
      bad = i;
      out.push(Kind.Error, i, i + 1);
      break;
    }
    lines.push({ start: at, end: lineEnd, tokens, ...(bad === undefined ? {} : { bad }) });
    if (lineEnd >= text.length) break;
    const breakLength = text.startsWith('\r\n', lineEnd) ? 2 : 1;
    out.push(Kind.Newline, lineEnd, lineEnd + breakLength);
    at = lineEnd + breakLength;
  }
  return lines;
}

/** `an` before a vowel sound (`end`, `intermediate`, `xor`), as v12 wrote it. */
const articleFor = (word: string): string => (/^[aeiox]/i.test(word) ? 'an' : 'a');

const listOf = (items: readonly string[]): string =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1] ?? ''}`
    : (items[0] ?? '');

const arrowOf = (flow: BpmnFlow): string => {
  if (flow.kind === 'message') return '-.->';
  if (flow.kind === 'association') return flow.directed ? '..>' : '...';
  return '-->';
};

interface Draft {
  kind: BpmnNodeKind;
  keyword: string;
  qualifier?: string;
  id: string;
  label: string;
  level: number;
  parentId?: string;
  /** Where the statement starts, which is where a placement problem is reported. */
  at: Range;
}

interface DraftFlow {
  flow: BpmnFlow;
  /** The source identifier, where an undeclared end is reported. */
  at: Range;
}

const rangeOf = (t: Token): Range => ({ start: t.start, end: t.end });

/** Reads one line's statement. Reports a syntax problem and returns false when it has one. */
class LineParser {
  private i = 0;
  private readonly tokens: readonly Token[];
  private readonly line: Line;
  private readonly st: ParseState;

  constructor(line: Line, st: ParseState) {
    this.line = line;
    this.tokens = line.tokens.filter((t) => t.type !== 'indent');
    this.st = st;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private take(): Token | undefined {
    return this.tokens[this.i++];
  }

  /** A syntax problem at the next token, or at the end of the line when there is none. */
  fail(expected: string): false {
    const t = this.peek();
    const range = t ? rangeOf(t) : { start: this.line.end, end: this.line.end };
    const found = t ? `\`${t.text}\`` : 'the end of the line';
    this.st.diagnostics.error('BPMN_SYNTAX', `Expected ${expected}, got ${found}.`, range);
    return false;
  }

  done(): boolean {
    return this.i >= this.tokens.length;
  }

  /** An optional id, then an optional quoted label. */
  nameAndLabel(): { id?: Token; label?: string } {
    const id = this.peek()?.type === 'identifier' ? this.take() : undefined;
    const label = this.peek()?.type === 'string' ? this.take()?.text.slice(1, -1) : undefined;
    return { ...(id ? { id } : {}), ...(label === undefined ? {} : { label }) };
  }

  first(): Token | undefined {
    return this.tokens[0];
  }

  next(): Token | undefined {
    return this.peek();
  }

  advance(): Token | undefined {
    return this.take();
  }
}

/** A trigger the position does not draw, as v12 refused it. */
function triggerProblem(position: EventPosition, trigger: string): string | undefined {
  if (drawsTrigger(position, trigger)) return undefined;
  if (trigger === 'none') {
    return `${articleFor(position)} ${position} event must name what triggers it.`;
  }
  const positions = positionsFor(trigger);
  const instead = positions.length
    ? ` The notation draws ${trigger} on ${listOf(positions)} events.`
    : '';
  return `${articleFor(position)} ${position} event cannot carry the ${trigger} trigger.${instead}`;
}

const CONTAINER_KINDS = new Set<BpmnNodeKind>(['pool', 'lane', 'group']);

class Reader {
  readonly st = new ParseState();
  readonly nodes: Draft[] = [];
  readonly flows: DraftFlow[] = [];
  direction: BpmnDirection = 'LR';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  private readonly declared = new Map<string, Range>();
  private baseLevel: number | undefined;
  private syntaxErrors = 0;
  private readonly options: BpmnParseOptions;

  constructor(options: BpmnParseOptions) {
    this.options = options;
  }

  get hasSyntaxErrors(): boolean {
    return this.syntaxErrors > 0;
  }

  private syntax(line: Line, parse: (p: LineParser) => boolean): void {
    const errors = this.st.diagnostics.list.length;
    const p = new LineParser(line, this.st);
    const ok = parse(p) && (p.done() || p.fail('the end of the line'));
    if (!ok || this.st.diagnostics.list.length > errors) this.syntaxErrors++;
  }

  header(line: Line): void {
    this.syntax(line, (p) => {
      const head = p.advance();
      if (head?.text !== 'bpmn-beta') {
        if (head) {
          this.st.diagnostics.error(
            'BPMN_NO_HEADER',
            'A BPMN diagram starts with `bpmn-beta`.',
            rangeOf(head),
          );
          return false;
        }
        return p.fail('`bpmn-beta`');
      }
      this.st.statement('header', { start: head.start, end: line.end });
      const dir = p.next();
      if (dir?.type === 'keyword' && isDirection(dir.text)) {
        p.advance();
        this.direction = dir.text;
      }
      return true;
    });
  }

  line(line: Line): void {
    const indent = line.tokens[0]?.type === 'indent' ? line.tokens[0].text.length : 0;
    this.syntax(line, (p) => {
      const first = p.first();
      if (first === undefined) return true;
      if (first.type === 'meta') {
        p.advance();
        this.meta(first);
        return true;
      }
      if (first.type === 'identifier') return this.flow(p);
      if (first.type !== 'keyword') return p.fail('an element, a flow or a title');
      return this.element(p, indent, line);
    });
  }

  private meta(t: Token): void {
    const after = (keyword: string) =>
      t.text
        .slice(keyword.length)
        .replace(/^[\t :]+/, '')
        .trim();
    this.st.statement('meta', rangeOf(t));
    if (t.text.startsWith('title')) this.title = after('title');
    else if (t.text.startsWith('accTitle')) this.accTitle = after('accTitle');
    else if (/^accDescr[\t ]*\{/.test(t.text)) {
      this.accDescr = t.text
        .replace(/^accDescr[\t ]*\{/, '')
        .replace(/\}$/, '')
        .trim();
    } else this.accDescr = after('accDescr');
  }

  private element(p: LineParser, indent: number, line: Line): boolean {
    const opener = p.advance();
    if (opener === undefined) return false;
    let kind: BpmnNodeKind;
    let keyword = opener.text;
    let qualifier: string | undefined;
    let triggerAt: Token = opener;
    const container = CONTAINERS[keyword];
    const artifact = ARTIFACTS[keyword];
    if (container) {
      kind = container;
    } else if (isPosition(keyword)) {
      kind = 'event';
      const trigger = p.next();
      if (trigger?.type === 'keyword' && TRIGGER_WORDS.has(trigger.text)) {
        p.advance();
        qualifier = trigger.text;
        triggerAt = trigger;
      }
    } else if (GATEWAYS.has(keyword)) {
      kind = 'gateway';
    } else if (TASK_TYPE_WORDS.has(keyword) || ACTIVITIES.has(keyword)) {
      kind = 'activity';
      if (TASK_TYPE_WORDS.has(keyword)) {
        qualifier = keyword;
        const activity = p.next();
        if (activity?.type !== 'keyword' || !ACTIVITIES.has(activity.text)) {
          return p.fail('`task`, `subprocess` or `call`');
        }
        p.advance();
        keyword = activity.text;
      }
    } else if (artifact) {
      kind = artifact;
      qualifier = DATA_QUALIFIERS[keyword];
      keyword = kind === 'store' ? 'data-store' : kind === 'annotation' ? 'note' : 'data';
    } else {
      p.advance();
      return p.fail('an element, a flow or a title');
    }
    const { id, label } = p.nameAndLabel();
    if (!p.done()) return p.fail('an id, a quoted label or the end of the line');
    const at = { start: opener.start, end: line.end };
    this.st.statement(kind, at);
    if (kind === 'event' && isPosition(keyword)) {
      const problem = triggerProblem(keyword, qualifier ?? 'none');
      if (problem) this.st.diagnostics.error('BPMN_TRIGGER', problem, rangeOf(triggerAt));
    }
    if (id) this.declare(id);
    this.baseLevel ??= indent;
    const draft: Draft = {
      kind,
      keyword,
      ...(qualifier ? { qualifier } : {}),
      id: id?.text ?? '',
      label: label || id?.text || '',
      level: Math.max(0, indent - this.baseLevel),
      at,
    };
    if (this.nodes.length >= (this.options.maxNodes ?? DEFAULT_LIMITS.maxNodes)) {
      this.st.diagnostics.error(
        LIMIT_CODES.maxNodes,
        `Node limit exceeded: the diagram has more than ${String(this.nodes.length)} elements. The limit is set by the page or app that renders the diagram.`,
        at,
      );
      return true;
    }
    this.nodes.push(draft);
    return true;
  }

  private declare(id: Token): void {
    if (this.declared.has(id.text)) {
      this.st.diagnostics.error(
        'BPMN_DUPLICATE_ID',
        `"${id.text}" is already declared. Give each element its own id.`,
        rangeOf(id),
      );
      return;
    }
    this.declared.set(id.text, rangeOf(id));
    this.st.symbol(id.text, 'element', rangeOf(id), 'def');
  }

  private flow(p: LineParser): boolean {
    const ids: Token[] = [];
    const connectors: Token[] = [];
    const first = p.advance();
    if (first) ids.push(first);
    do {
      const c = p.next();
      if (c?.type !== 'connector') return p.fail('a flow such as `-->`, `-.->`, `..>` or `...`');
      p.advance();
      connectors.push(c);
      const to = p.next();
      if (to?.type !== 'identifier') return p.fail('the id of an element');
      p.advance();
      ids.push(to);
    } while (!p.done());
    const start = first?.start ?? 0;
    this.st.statement('flow', { start, end: ids.at(-1)?.end ?? start });
    for (const [index, connector] of connectors.entries()) {
      const from = ids[index];
      const to = ids[index + 1];
      if (!from || !to) break;
      const kind: BpmnFlowKind =
        connector.connector === 'message'
          ? 'message'
          : connector.connector === 'association-arrow' ||
              connector.connector === 'association-line'
            ? 'association'
            : 'sequence';
      if (this.flows.length >= (this.options.maxEdges ?? DEFAULT_LIMITS.maxEdges)) {
        this.st.diagnostics.error(
          LIMIT_CODES.maxEdges,
          `Edge limit exceeded: the diagram has more than ${String(this.flows.length)} flows. The limit is set by the page or app that renders the diagram.`,
          rangeOf(connector),
        );
        return true;
      }
      for (const end of [from, to]) this.st.symbol(end.text, 'element', rangeOf(end), 'ref');
      this.flows.push({
        flow: {
          from: from.text,
          to: to.text,
          kind,
          ...(kind === 'association'
            ? { directed: connector.connector === 'association-arrow' }
            : {}),
          ...(connector.connector === 'labelled'
            ? {
                label: connector.text.replace(/^--/, '').replace(/-+>$/, '').trim(),
              }
            : {}),
        },
        at: rangeOf(from),
      });
    }
    return true;
  }

  /** An element written without an id gets one that no element names. */
  assignGeneratedIds(): void {
    let generated = 0;
    const taken = new Set(this.declared.keys());
    for (const node of this.nodes) {
      if (node.id) continue;
      do {
        node.id = `${node.keyword}-${String(++generated)}`;
      } while (taken.has(node.id));
      taken.add(node.id);
    }
  }

  /** Each element's parent: the nearest element above it indented less. */
  assignParents(): void {
    const maxDepth = this.options.maxDepth ?? DEFAULT_LIMITS.maxDepth;
    const open: Draft[] = [];
    for (const node of this.nodes) {
      while (open.length > 0 && (open.at(-1)?.level ?? 0) >= node.level) open.pop();
      const parent = open.at(-1);
      if (parent) node.parentId = parent.id;
      this.checkPlaced(node, parent);
      if (open.length >= maxDepth) {
        this.st.diagnostics.error(
          LIMIT_CODES.maxDepth,
          `Nesting limit exceeded: elements are indented more than ${String(maxDepth)} deep. The limit is set by the page or app that renders the diagram.`,
          node.at,
        );
        return;
      }
      open.push(node);
    }
  }

  /** Only a pool, a lane or a group holds other elements, and a boundary event sits on an activity. */
  private checkPlaced(node: Draft, parent: Draft | undefined): void {
    if (node.keyword === 'boundary') {
      if (parent?.kind !== 'activity') {
        this.st.diagnostics.error(
          'BPMN_PLACEMENT',
          'a boundary event must be indented under the activity it is attached to.',
          node.at,
        );
      }
      return;
    }
    if (parent && !CONTAINER_KINDS.has(parent.kind)) {
      this.st.diagnostics.error(
        'BPMN_PLACEMENT',
        `${articleFor(node.keyword)} ${node.keyword} cannot be indented under the ${parent.keyword} "${parent.id}", because only a pool, a lane or a group holds other elements.`,
        node.at,
      );
    }
  }

  /** A flow end that names no declared element has nothing to attach to. */
  checkFlowEnds(): void {
    const declared = new Set(this.nodes.map((node) => node.id));
    for (const { flow, at } of this.flows) {
      const missing = [flow.from, flow.to].find((id) => !declared.has(id));
      if (missing !== undefined) {
        this.st.diagnostics.error(
          'BPMN_UNDECLARED',
          `the flow "${flow.from} ${arrowOf(flow)} ${flow.to}" refers to "${missing}", which is not declared. Declare it as an element before using it.`,
          at,
        );
      }
    }
  }
}

/**
 * Parses a bpmn-beta diagram. `text` is the whole source; every range is an offset into it.
 * Never throws.
 */
export function parseBpmn(text: string, options: BpmnParseOptions = {}): BpmnParseResult {
  const pre = options.preprocessed ?? preprocess(text);
  const start = diagramStart(text, pre);
  const tokens = new TokenWriter(64);
  const lines = lexLines(text, start, tokens);
  const reader = new Reader(options);
  const [head, ...rest] = lines;
  const lexical = (line: Line) => {
    if (line.bad === undefined) return false;
    reader.st.diagnostics.error(
      'BPMN_SYNTAX',
      `Unexpected character \`${text.charAt(line.bad)}\`.`,
      { start: line.bad, end: line.bad + 1 },
    );
    return true;
  };
  if (head === undefined || head.tokens.length === 0) {
    reader.st.diagnostics.error('BPMN_NO_HEADER', 'A BPMN diagram starts with `bpmn-beta`.', {
      start,
      end: start,
    });
  } else if (!lexical(head)) {
    reader.header(head);
  }
  for (const line of rest) if (!lexical(line)) reader.line(line);
  reader.assignGeneratedIds();
  reader.assignParents();
  // A flow end on a line that did not parse would be reported as undeclared; v12 stopped first.
  if (!reader.hasSyntaxErrors && !lines.some((l) => l.bad !== undefined)) reader.checkFlowEnds();
  const model: BpmnModel = {
    direction: reader.direction,
    nodes: reader.nodes.map(({ at: _at, ...node }): BpmnNode => node),
    flows: reader.flows.map((f) => f.flow),
    ...(reader.title ? { title: reader.title } : {}),
    ...(reader.accTitle ? { accTitle: reader.accTitle } : {}),
    ...(reader.accDescr ? { accDescr: reader.accDescr } : {}),
  };
  const ast: BpmnDocument = {
    id: 'doc',
    type: 'bpmnDocument',
    range: { start: 0, end: text.length },
  };
  return reader.st.result(model, ast, tokens.finish(text), options);
}
