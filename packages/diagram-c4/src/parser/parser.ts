/**
 * The C4 parser: a hand-written scanner and recursive descent over v12's `c4Diagram.jison`
 * (converged build). It never throws; every problem is a diagnostic with a range, and after an
 * error it goes on at the next line.
 *
 * Where it parts from v12 on purpose:
 * - An unquoted argument ends at `,`, `)` or the end of the line. v12's `[^,]+` ran on past
 *   both, so `Person(a, Alice)` swallowed the next line into the label.
 * - A named argument sets its own field in every slot. v12 stored one in the label slot as the
 *   label's text (`Person(a, $sprite="x")` got a label object and no sprite).
 */
import { ParseState, TokenWriter } from '@mermaid-js/core/parser-kit';
import type { ParseOptions, ParseResult, Range } from '@mermaid-js/core/parser-kit';
import { LIMIT_CODES } from '@mermaid-js/core/limits';
import type { Limits } from '@mermaid-js/core/limits';
import { diagramStart, preprocess } from '@mermaid-js/core/preprocess';
import type { PreprocessResult } from '@mermaid-js/core/preprocess';
import { C4Builder } from './build.ts';
import type { BoundaryKeyword, C4Arg } from './build.ts';
import type {
  C4DiagramKind,
  C4Direction,
  C4Document,
  C4ElementType,
  C4Model,
  C4RelType,
  C4Statement,
} from './model.ts';
import { Kind, T } from './tokens.ts';

export interface C4ParseOptions extends ParseOptions {
  /** The preprocess result the pipeline already has; computed here when absent. */
  readonly preprocessed?: PreprocessResult;
  /** The integrator's limits; none are checked when absent. */
  readonly limits?: Pick<Limits, 'maxDepth' | 'maxNodes' | 'maxEdges'>;
}

export type C4ParseResult = ParseResult<C4Model, C4Document>;

const KINDS: readonly C4DiagramKind[] = [
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

/** Element keywords: the element type, and whether a technology slot follows the label. */
const ELEMENTS: Readonly<Partial<Record<string, readonly [C4ElementType, boolean]>>> = {
  Person: ['person', false],
  Person_Ext: ['external_person', false],
  System: ['system', false],
  SystemDb: ['system_db', false],
  SystemQueue: ['system_queue', false],
  System_Ext: ['external_system', false],
  SystemDb_Ext: ['external_system_db', false],
  SystemQueue_Ext: ['external_system_queue', false],
  Container: ['container', true],
  ContainerDb: ['container_db', true],
  ContainerQueue: ['container_queue', true],
  Container_Ext: ['external_container', true],
  ContainerDb_Ext: ['external_container_db', true],
  ContainerQueue_Ext: ['external_container_queue', true],
  Component: ['component', true],
  ComponentDb: ['component_db', true],
  ComponentQueue: ['component_queue', true],
  Component_Ext: ['external_component', true],
  ComponentDb_Ext: ['external_component_db', true],
  ComponentQueue_Ext: ['external_component_queue', true],
};

const RELS: Readonly<Partial<Record<string, C4RelType>>> = {
  Rel: 'rel',
  BiRel: 'birel',
  Rel_U: 'rel_u',
  Rel_Up: 'rel_u',
  Rel_D: 'rel_d',
  Rel_Down: 'rel_d',
  Rel_L: 'rel_l',
  Rel_Left: 'rel_l',
  Rel_R: 'rel_r',
  Rel_Right: 'rel_r',
  Rel_Back: 'rel_b',
  RelIndex: 'rel',
};

const BOUNDARIES: ReadonlySet<string> = new Set<BoundaryKeyword>([
  'Boundary',
  'Enterprise_Boundary',
  'System_Boundary',
  'Container_Boundary',
  'Node',
  'Deployment_Node',
  'Node_L',
  'Node_R',
]);
const isBoundaryKeyword = (w: string): w is BoundaryKeyword => BOUNDARIES.has(w);

const STYLES = new Set([
  'UpdateElementStyle',
  'UpdateRelStyle',
  'AddElementTag',
  'AddRelTag',
  'UpdateLayoutConfig',
]);

const DIRECTIONS: ReadonlySet<string> = new Set<C4Direction>(['TB', 'BT', 'LR', 'RL']);
const isDirection = (w: string): w is C4Direction => DIRECTIONS.has(w);

/** What can start a statement, for "expected" lists. */
const STATEMENT_NAMES = [
  'an element such as `Person(...)`',
  'a relationship such as `Rel(...)`',
  'a boundary',
  '`title`',
  '`}`',
];

const isWordStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isWordChar = (c: string): boolean => /\w/.test(c);
const isBlank = (c: string): boolean => c === ' ' || c === '\t';
const isLineEnd = (c: string): boolean => c === '\n' || c === '\r' || c === '';

/** One open boundary while its body is parsed. */
interface Open {
  readonly span: ReturnType<ParseState['beginStatement']>;
  readonly node: C4Statement & { children: C4Statement[] };
  readonly brace: Range;
  statements: number;
}

class Parser {
  private i: number;
  private readonly st = new ParseState();
  private readonly tw = new TokenWriter(256);
  private readonly b: C4Builder;
  private readonly root: C4Statement[] = [];
  private readonly open: Open[] = [];
  private readonly directiveAt: Map<number, number>;
  private statements = 0;
  private limitHit = false;

  private readonly text: string;
  private readonly kind: C4DiagramKind | undefined;
  private readonly limits: C4ParseOptions['limits'];

  constructor(
    text: string,
    start: number,
    kind: C4DiagramKind | undefined,
    pre: PreprocessResult,
    limits: C4ParseOptions['limits'],
  ) {
    this.text = text;
    this.kind = kind;
    this.limits = limits;
    this.i = start;
    this.directiveAt = new Map(pre.directives.map((d) => [d.range.start, d.range.end]));
    this.b = new C4Builder(kind, (severity, code, message, range) => {
      this.st.diagnostics.add(severity, code, message, range);
    });
  }

  /** The character at the cursor; '' at the end. A method, so checks on it do not narrow. */
  private c(): string {
    return this.text.charAt(this.i);
  }

  get state(): ParseState {
    return this.st;
  }

  tokens() {
    return this.tw.finish(this.text);
  }

  private token(kind: number, start: number, end: number): void {
    if (end > start) this.tw.push(kind, start, end);
  }

  private error(code: string, message: string, range: Range, expected?: string[]): void {
    this.st.diagnostics.error(code, message, range, expected ? { expected } : undefined);
  }

  private skipBlanks(): void {
    while (isBlank(this.c())) this.i++;
  }

  /** Consumes one line break, if there is one. */
  private newline(): boolean {
    const start = this.i;
    if (this.c() === '\r') this.i++;
    if (this.c() === '\n') this.i++;
    if (this.i === start) return false;
    this.token(Kind.Newline, start, this.i);
    return true;
  }

  /** A `%%` comment or `%%{...}%%` directive at the cursor, consumed as trivia. */
  private trivia(): boolean {
    if (!this.text.startsWith('%%', this.i)) return false;
    const directiveEnd = this.directiveAt.get(this.i);
    const start = this.i;
    if (directiveEnd !== undefined) {
      this.i = directiveEnd;
      this.token(Kind.Directive, start, this.i);
    } else {
      this.toLineEnd();
      this.token(Kind.Comment, start, this.i);
    }
    return true;
  }

  private toLineEnd(): void {
    while (!isLineEnd(this.c())) this.i++;
  }

  private word(): string {
    const start = this.i;
    while (isWordChar(this.c())) this.i++;
    return this.text.slice(start, this.i);
  }

  parse(): { model: C4Model; ast: C4Document } {
    const headerStart = this.i;
    if (this.kind === undefined) {
      this.error(
        'C4_NO_KEYWORD',
        'A C4 diagram starts with C4Context, C4Container, C4Component, C4Dynamic or C4Deployment.',
        { start: headerStart, end: Math.min(this.text.length, headerStart + 1) },
      );
      return this.finish();
    }
    this.i += this.kind.length;
    this.token(T.Header, headerStart, this.i);
    this.st.statement('header', { start: headerStart, end: this.i });
    this.endOfLine();
    while (this.i < this.text.length && !this.limitHit) this.line();
    for (const o of [...this.open].reverse()) {
      this.error('C4_UNCLOSED_BOUNDARY', 'This boundary has no closing `}`.', o.brace, ['`}`']);
      this.st.endStatement(o.span, this.text.length);
    }
    if (this.statements === 0 && !this.st.diagnostics.hasErrors) {
      this.error(
        'C4_EMPTY',
        `A ${this.kind} diagram needs at least one statement after its keyword.`,
        {
          start: headerStart,
          end: headerStart + this.kind.length,
        },
      );
    }
    return this.finish();
  }

  private finish(): { model: C4Model; ast: C4Document } {
    return {
      model: this.b.result(),
      ast: {
        id: 'doc',
        type: 'c4Document',
        range: { start: 0, end: this.text.length },
        children: this.root,
      },
    };
  }

  /** The rest of a line after a statement: blanks, `}`s, a comment, then the line break. */
  private endOfLine(): void {
    for (;;) {
      this.skipBlanks();
      if (this.c() !== '}') break;
      this.closeBrace();
    }
    this.trivia();
    if (isLineEnd(this.c())) {
      this.newline();
      return;
    }
    const start = this.i;
    this.toLineEnd();
    this.token(Kind.Error, start, this.i);
    this.error('C4_EXPECTED_NEWLINE', 'Expected the end of the line after this statement.', {
      start,
      end: this.i,
    });
    this.newline();
  }

  private line(): void {
    this.skipBlanks();
    if (this.newline() || this.trivia()) return;
    if (this.c() === '}') {
      this.endOfLine();
      return;
    }
    const start = this.i;
    if (!isWordStart(this.c())) {
      this.toLineEnd();
      this.token(Kind.Error, start, this.i);
      this.error('C4_UNEXPECTED', 'Expected a statement.', { start, end: this.i }, STATEMENT_NAMES);
      this.newline();
      return;
    }
    const word = this.word();
    const at = { start, end: this.i };
    // The boundary this statement sits in, taken before a boundary statement opens its own.
    const enclosing = this.open.at(-1);
    if (this.statement(word, at)) {
      this.statements++;
      if (enclosing) enclosing.statements++;
    }
    this.endOfLine();
  }

  /** One statement after its first word; false when it was not one. */
  private statement(word: string, at: Range): boolean {
    switch (word) {
      case 'title':
      case 'accDescription':
        return this.textStatement(word, at);
      case 'accTitle':
      case 'accDescr':
        return this.accStatement(word, at);
      case 'direction':
        return this.directionStatement(at);
    }
    const element = ELEMENTS[word];
    const rel = RELS[word];
    if (!element && !rel && !isBoundaryKeyword(word) && !STYLES.has(word)) {
      this.token(Kind.Error, at.start, at.end);
      this.error('C4_UNKNOWN_STATEMENT', `Unknown statement "${word}".`, at, STATEMENT_NAMES);
      this.toLineEnd();
      return false;
    }
    this.token(T.Keyword, at.start, at.end);
    const args = this.args(word, at);
    if (!args) return false;
    const range = { start: at.start, end: this.i };
    if (element) return this.element(word, element[0], element[1], args, range);
    if (rel) return this.rel(word, rel, args, range);
    if (isBoundaryKeyword(word)) return this.boundary(word, args, range);
    return this.style(word, args, range);
  }

  private leaf(id: string, type: string, keyword: string, range: Range): void {
    this.st.statement(type, range);
    const node: C4Statement = { id, type, keyword, range };
    const top = this.open.at(-1);
    (top ? top.node.children : this.root).push(node);
  }

  private element(
    word: string,
    type: C4ElementType,
    withTechn: boolean,
    args: readonly C4Arg[],
    range: Range,
  ): boolean {
    const first = args[0];
    const alias = first?.kind === 'value' ? first.value : undefined;
    const ast = alias === undefined ? this.st.ids.statement('element') : this.st.ids.node(alias);
    if (alias !== undefined && first) this.st.symbol(alias, 'alias', first.range, 'def');
    this.b.element(type, withTechn, args, range, ast);
    this.leaf(ast, 'element', word, range);
    this.checkSizes(range);
    return true;
  }

  private rel(word: string, type: C4RelType, raw: readonly C4Arg[], range: Range): boolean {
    // v12 drops RelIndex's index.
    const args = word === 'RelIndex' ? raw.slice(1) : raw;
    const [from, to] = args;
    const ast =
      from?.kind === 'value' && to?.kind === 'value'
        ? this.st.ids.edge(from.value, to.value)
        : this.st.ids.statement('rel');
    for (const a of [from, to])
      if (a?.kind === 'value') this.st.symbol(a.value, 'alias', a.range, 'ref');
    this.b.rel(type, args, range, ast);
    this.leaf(ast, 'rel', word, range);
    this.checkSizes(range);
    return true;
  }

  private style(word: string, args: readonly C4Arg[], range: Range): boolean {
    const id = this.st.ids.statement('style');
    const [first, second] = args;
    switch (word) {
      case 'UpdateElementStyle':
        if (first?.kind === 'value') this.st.symbol(first.value, 'alias', first.range, 'ref');
        this.b.updateElementStyle(args, range);
        break;
      case 'UpdateRelStyle':
        for (const a of [first, second])
          if (a?.kind === 'value') this.st.symbol(a.value, 'alias', a.range, 'ref');
        this.b.updateRelStyle(args, range);
        break;
      case 'AddElementTag':
        this.b.addElementTag(args, range);
        break;
      case 'AddRelTag':
        this.b.addRelTag(args, range);
        break;
      default:
        // The converged build accepts it so PlantUML sources parse, and says it does nothing.
        this.st.diagnostics.warning(
          'C4_LAYOUT_CONFIG_IGNORED',
          'UpdateLayoutConfig has no effect: the layout engine decides how many shapes and boundaries share a row.',
          range,
        );
    }
    this.leaf(id, 'style', word, range);
    return true;
  }

  private boundary(word: BoundaryKeyword, args: readonly C4Arg[], range: Range): boolean {
    // The body opens with `{` on this line or on the next non-blank one.
    const save = this.i;
    this.skipBlanks();
    this.trivia();
    while (this.i < this.text.length && isLineEnd(this.c())) {
      this.newline();
      this.skipBlanks();
      this.trivia();
    }
    if (this.c() !== '{') {
      this.i = save;
      this.error('C4_EXPECTED_BRACE', `${word} needs its contents between { and }.`, range, [
        '`{`',
      ]);
      return false;
    }
    const brace = { start: this.i, end: this.i + 1 };
    this.token(T.LBrace, brace.start, brace.end);
    this.i++;
    const maxDepth = this.limits?.maxDepth;
    if (maxDepth !== undefined && this.b.depth + 1 > maxDepth) {
      this.error(
        LIMIT_CODES.maxDepth,
        `Boundaries nest deeper than the limit of ${maxDepth}.`,
        range,
      );
      this.limitHit = true;
      return false;
    }
    const first = args[0];
    const alias = first?.kind === 'value' ? first.value : undefined;
    const id =
      alias === undefined ? this.st.ids.statement('boundary') : this.st.ids.subgraph(alias);
    if (!this.b.boundary(word, args, range, id)) return false;
    if (alias !== undefined && first) this.st.symbol(alias, 'alias', first.range, 'def');
    const span = this.st.beginStatement('boundary', range.start);
    const node = { id, type: 'boundary', keyword: word, range: { ...range }, children: [] };
    const top = this.open.at(-1);
    (top ? top.node.children : this.root).push(node);
    this.open.push({ span, node, brace, statements: 0 });
    this.checkSizes(range);
    return true;
  }

  private closeBrace(): void {
    const at = { start: this.i, end: this.i + 1 };
    this.token(T.RBrace, at.start, at.end);
    this.i++;
    const o = this.open.pop();
    if (!o || !this.b.close()) {
      this.error('C4_UNEXPECTED_BRACE', 'This `}` closes no boundary.', at);
      return;
    }
    if (o.statements === 0) {
      this.error('C4_EMPTY_BOUNDARY', 'A boundary needs at least one statement between { and }.', {
        start: o.brace.start,
        end: at.end,
      });
    }
    this.st.endStatement(o.span, at.end);
    o.node.range.end = at.end;
  }

  private checkSizes(range: Range): void {
    if (!this.limits || this.limitHit) return;
    const { nodes, edges } = this.b.sizes;
    if (nodes > this.limits.maxNodes) {
      this.error(
        LIMIT_CODES.maxNodes,
        `The diagram declares more than ${this.limits.maxNodes} elements and boundaries.`,
        range,
      );
      this.limitHit = true;
    } else if (edges > this.limits.maxEdges) {
      this.error(
        LIMIT_CODES.maxEdges,
        `The diagram declares more than ${this.limits.maxEdges} relationships.`,
        range,
      );
      this.limitHit = true;
    }
  }

  /** `title text` and `accDescription text`: the rest of the line, up to a `;`. */
  private textStatement(word: 'title' | 'accDescription', at: Range): boolean {
    this.token(T.Meta, at.start, at.end);
    if (!isBlank(this.c())) {
      this.error('C4_EXPECTED_TEXT', `${word} needs its text after a space.`, at);
      this.toLineEnd();
      return false;
    }
    const start = this.i;
    while (!isLineEnd(this.c()) && this.c() !== ';') this.i++;
    const value = this.text.slice(start, this.i).trim();
    this.token(T.MetaText, start, this.i);
    if (word === 'title') this.b.title = value;
    else this.b.accDescr = value;
    this.leaf(this.st.ids.statement(word), word, word, { start: at.start, end: this.i });
    return true;
  }

  /** `accTitle: text`, `accDescr: text` and `accDescr { lines }`. */
  private accStatement(word: 'accTitle' | 'accDescr', at: Range): boolean {
    this.token(T.Meta, at.start, at.end);
    this.skipBlanks();
    if (word === 'accDescr' && this.c() === '{') {
      const open = this.i;
      const close = this.text.indexOf('}', open + 1);
      if (close < 0) {
        this.error(
          'C4_UNCLOSED_ACC_DESCR',
          'accDescr { has no closing }.',
          { start: open, end: open + 1 },
          ['`}`'],
        );
        this.i = this.text.length;
        return false;
      }
      this.token(T.MetaText, open + 1, close);
      this.b.accDescr = this.text.slice(open + 1, close).trim();
      this.i = close + 1;
      this.leaf(this.st.ids.statement(word), word, word, { start: at.start, end: this.i });
      return true;
    }
    if (this.c() !== ':') {
      this.error('C4_EXPECTED_COLON', `${word} needs a ":" before its text.`, at, ['`:`']);
      this.toLineEnd();
      return false;
    }
    this.i++;
    const start = this.i;
    this.toLineEnd();
    const value = this.text.slice(start, this.i).trim();
    this.token(T.MetaText, start, this.i);
    if (word === 'accTitle') this.b.accTitle = value;
    else this.b.accDescr = value;
    this.leaf(this.st.ids.statement(word), word, word, { start: at.start, end: this.i });
    return true;
  }

  /** `direction TB|BT|LR|RL`: the diagram's, or inside a boundary that boundary's. */
  private directionStatement(at: Range): boolean {
    this.token(T.Meta, at.start, at.end);
    const gap = this.i;
    this.skipBlanks();
    const start = this.i;
    const value = this.word();
    if (start === gap || !isDirection(value)) {
      this.error(
        'C4_EXPECTED_DIRECTION',
        'direction needs TB, BT, LR or RL.',
        { start, end: Math.max(this.i, start + 1) },
        ['TB', 'BT', 'LR', 'RL'],
      );
      this.toLineEnd();
      return false;
    }
    this.token(T.Direction, start, this.i);
    this.b.setDirection(value);
    this.leaf(this.st.ids.statement('direction'), 'direction', 'direction', {
      start: at.start,
      end: this.i,
    });
    return true;
  }

  /**
   * The arguments of `word(...)`, which must follow the keyword at once, as in v12. Undefined
   * after an error that leaves no usable statement.
   */
  private args(word: string, at: Range): C4Arg[] | undefined {
    if (this.c() !== '(') {
      this.error('C4_EXPECTED_PAREN', `Expected "(" right after ${word}.`, at, ['`(`']);
      this.toLineEnd();
      return undefined;
    }
    const open = { start: this.i, end: this.i + 1 };
    this.token(T.LParen, open.start, open.end);
    this.i++;
    const args: C4Arg[] = [];
    let expectArg = true;
    for (;;) {
      this.skipBlanks();
      const c = this.c();
      const start = this.i;
      if (isLineEnd(c)) {
        this.error('C4_UNCLOSED_PAREN', `${word}( has no closing ")" on its line.`, open, ['`)`']);
        return undefined;
      }
      if (c === ')') {
        this.token(T.RParen, start, start + 1);
        this.i++;
        if (args.length > 0) return args;
        this.error('C4_EXPECTED_ARGUMENT', `${word}() needs at least one argument.`, {
          start: at.start,
          end: this.i,
        });
        return undefined;
      }
      if (c === ',') {
        this.token(T.Comma, start, start + 1);
        this.i++;
        if (expectArg) args.push({ kind: 'value', value: '', range: { start, end: start } });
        expectArg = true;
        continue;
      }
      if (!expectArg) {
        this.error(
          'C4_EXPECTED_COMMA',
          'Expected "," or ")" after an argument.',
          { start, end: start + 1 },
          ['`,`', '`)`'],
        );
        while (!isLineEnd(this.c()) && this.c() !== ',' && this.c() !== ')') this.i++;
        continue;
      }
      const arg = c === '"' ? this.quoted() : c === '$' ? this.named() : this.bare();
      if (!arg) {
        this.toLineEnd();
        return undefined;
      }
      args.push(arg);
      expectArg = false;
    }
  }

  /** `"text"`, which may run over lines as in v12. The value is trimmed, as v12 trims it. */
  private quoted(): C4Arg | undefined {
    const start = this.i;
    const close = this.text.indexOf('"', start + 1);
    if (close < 0) {
      this.error(
        'C4_UNCLOSED_STRING',
        'This string has no closing quote.',
        { start, end: start + 1 },
        ['`"`'],
      );
      return undefined;
    }
    this.i = close + 1;
    this.token(T.String, start, this.i);
    return {
      kind: 'value',
      value: this.text.slice(start + 1, close).trim(),
      range: { start, end: this.i },
    };
  }

  /** `$name="value"`. */
  private named(): C4Arg | undefined {
    const start = this.i;
    this.i++;
    while (!isLineEnd(this.c()) && this.c() !== '=' && this.c() !== ',' && this.c() !== ')')
      this.i++;
    const key = this.text.slice(start + 1, this.i).trim();
    if (this.c() !== '=' || key === '') {
      this.error('C4_EXPECTED_NAMED', 'A named argument is written $name="value".', {
        start,
        end: Math.max(this.i, start + 1),
      });
      return undefined;
    }
    this.i++;
    this.token(T.NamedKey, start, this.i);
    this.skipBlanks();
    const valueStart = this.i;
    const close = this.c() === '"' ? this.text.indexOf('"', valueStart + 1) : -1;
    if (close < 0) {
      this.error(
        'C4_EXPECTED_NAMED',
        'The value of a named argument is a quoted string.',
        {
          start: valueStart,
          end: valueStart + 1,
        },
        ['`"`'],
      );
      return undefined;
    }
    this.i = close + 1;
    this.token(T.String, valueStart, this.i);
    return {
      kind: 'named',
      key,
      value: this.text.slice(valueStart + 1, close).trim(),
      range: { start, end: this.i },
    };
  }

  /** An unquoted argument: up to `,`, `)` or the end of the line, trimmed. */
  private bare(): C4Arg {
    const start = this.i;
    while (!isLineEnd(this.c()) && this.c() !== ',' && this.c() !== ')') this.i++;
    this.token(T.Text, start, this.i);
    return {
      kind: 'value',
      value: this.text.slice(start, this.i).trim(),
      range: { start, end: this.i },
    };
  }
}

/** The keyword at `start`, when one is there and is a whole word. */
function kindAt(text: string, start: number): C4DiagramKind | undefined {
  return KINDS.find(
    (k) => text.startsWith(k, start) && !/[\w-]/.test(text.charAt(start + k.length)),
  );
}

/**
 * Parses a C4 diagram. `text` is the whole source; every range is an offset into it. Never
 * throws.
 */
export function parseC4(text: string, options: C4ParseOptions = {}): C4ParseResult {
  const pre = options.preprocessed ?? preprocess(text);
  const start = diagramStart(text, pre);
  const p = new Parser(text, start, kindAt(text, start), pre, options.limits);
  const { model, ast } = p.parse();
  return p.state.result(model, ast, p.tokens(), options);
}
