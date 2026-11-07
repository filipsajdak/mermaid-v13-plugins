/**
 * The c4-beta parser: a hand-written lexer and recursive descent over the converged build's
 * `c4.langium` grammar, with the semantics of its `c4-beta/db.ts`. Langium is not available to
 * a v13 plugin, so nothing of the grammar is generated. It never throws: every problem is a
 * diagnostic with a range, and after an error it goes on at the next line.
 */
import { ParseState, TokenWriter } from '@mermaid-js/core/parser-kit';
import type { ParseOptions, ParseResult, Range } from '@mermaid-js/core/parser-kit';
import { LIMIT_CODES } from '@mermaid-js/core/limits';
import type { Limits } from '@mermaid-js/core/limits';
import { diagramStart, preprocess } from '@mermaid-js/core/preprocess';
import type { PreprocessResult } from '@mermaid-js/core/preprocess';
import type {
  C4BetaArrow,
  C4BetaDirection,
  C4BetaDocument,
  C4BetaElement,
  C4BetaElementKind,
  C4BetaKind,
  C4BetaModel,
  C4BetaRelationship,
  C4BetaStatement,
  C4BetaTagStyle,
} from './model.ts';
import { Kind, T } from './tokens.ts';

export interface C4BetaParseOptions extends ParseOptions {
  readonly preprocessed?: PreprocessResult;
  /** The front-matter title, used when the diagram has no `title` statement. */
  readonly frontMatterTitle?: string;
  readonly limits?: Pick<Limits, 'maxDepth' | 'maxNodes' | 'maxEdges'>;
}

export type C4BetaParseResult = ParseResult<C4BetaModel, C4BetaDocument>;

const DIAGRAM_KINDS: ReadonlySet<string> = new Set<C4BetaKind>([
  'context',
  'container',
  'component',
  'dynamic',
  'deployment',
]);
const isDiagramKind = (w: string): w is C4BetaKind => DIAGRAM_KINDS.has(w);
const ELEMENT_KINDS: ReadonlySet<string> = new Set<C4BetaElementKind>([
  'person',
  'softwareSystem',
  'container',
  'component',
  'group',
  'deploymentNode',
  'infrastructureNode',
]);
const isElementKind = (w: string): w is C4BetaElementKind => ELEMENT_KINDS.has(w);
const DIRECTIONS: ReadonlySet<string> = new Set<C4BetaDirection>(['TB', 'BT', 'LR', 'RL']);
const isDirection = (w: string): w is C4BetaDirection => DIRECTIONS.has(w);
const ARROWS: readonly C4BetaArrow[] = ['<-->', '<--', '-->', '---'];

/** Element kinds unexpected in each diagram kind: drawn anyway, with a warning (v12 db). */
const UNEXPECTED: Readonly<Record<C4BetaKind, readonly C4BetaElementKind[]>> = {
  context: ['container', 'component', 'deploymentNode'],
  container: ['component', 'deploymentNode'],
  component: ['deploymentNode'],
  dynamic: ['deploymentNode'],
  deployment: ['person'],
};

const STATEMENTS = [
  'an element such as `person id "Name"`',
  'a relationship such as `a --> b`',
  '`style`',
  '`direction`',
  '`legend`',
];

interface Tok {
  readonly k: number;
  readonly s: number;
  readonly e: number;
  /** Strings unquoted and unescaped, tags without `:::`, meta text trimmed. */
  readonly v: string;
  /** For `Meta`: which statement. */
  readonly meta?: 'title' | 'accTitle' | 'accDescr';
}

const ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};
/** Langium's string conversion: quotes off, `\x` escapes resolved. */
const unescape = (raw: string): string =>
  raw.slice(1, -1).replace(/\\(.)/gs, (_m, c: string) => ESCAPES[c] ?? c);

/** v12's common value converter for single-line title and accessibility text. */
const oneLine = (s: string): string => s.trim().replace(/[\t ]{2,}/g, ' ');
/** v12's common value converter for `accDescr { ... }`. */
const multiLine = (s: string): string =>
  s
    .replace(/^\s*/gm, '')
    .replace(/\s+$/gm, '')
    .replace(/[\t ]{2,}/gm, ' ')
    .replace(/[\n\r]{2,}/gm, '\n');

/** Lexes the body after the header into tokens; comments and directives are dropped. */
function lex(
  text: string,
  from: number,
  pre: PreprocessResult,
  tw: TokenWriter,
  st: ParseState,
): Tok[] {
  const toks: Tok[] = [];
  const directives = new Map(pre.directives.map((d) => [d.range.start, d.range.end]));
  let i = from;
  /** Nothing but blanks or comments before this point on its line. */
  const atLineStart = (): boolean => {
    const last = toks.at(-1);
    return last === undefined || last.k === Kind.Newline;
  };
  const push = (t: Tok, kind: number = t.k) => {
    toks.push(t);
    tw.push(kind, t.s, t.e);
  };
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      const s = i;
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      i++;
      push({ k: Kind.Newline, s, e: i, v: '' });
      continue;
    }
    if (text.startsWith('%%', i)) {
      const end = directives.get(i) ?? text.indexOf('\n', i);
      const e = end < 0 ? text.length : end;
      tw.push(directives.has(i) ? Kind.Directive : Kind.Comment, i, e);
      i = e;
      continue;
    }
    const s = i;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text.charAt(j) !== c) j += text.charAt(j) === '\\' ? 2 : 1;
      if (j >= text.length) {
        st.diagnostics.error(
          'C4B_UNCLOSED_STRING',
          'This string has no closing quote.',
          { start: s, end: s + 1 },
          { expected: [c] },
        );
        const eol = text.indexOf('\n', s);
        i = eol < 0 ? text.length : eol;
        tw.push(Kind.Error, s, i);
        continue;
      }
      i = j + 1;
      push({ k: T.String, s, e: i, v: unescape(text.slice(s, i)) });
      continue;
    }
    const tag = /^:::[\w]+(?:-+[\w]+)*/.exec(text.slice(i, i + 200));
    if (tag) {
      i += tag[0].length;
      push({ k: T.Tag, s, e: i, v: tag[0].slice(3) });
      continue;
    }
    const arrow = ARROWS.find((a) => text.startsWith(a, i));
    if (arrow) {
      i += arrow.length;
      push({ k: T.Arrow, s, e: i, v: arrow });
      continue;
    }
    const single: Readonly<Record<string, number>> = {
      ':': T.Colon,
      ',': T.Comma,
      '{': T.LBrace,
      '}': T.RBrace,
    };
    const k = single[c];
    if (k !== undefined) {
      i++;
      push({ k, s, e: i, v: c });
      continue;
    }
    const hex = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])/.exec(text.slice(i, i + 8));
    if (hex) {
      i += hex[0].length;
      push({ k: T.Hex, s, e: i, v: hex[0] });
      continue;
    }
    const word = /^[\w]+(?:-+[\w]+)*/.exec(text.slice(i, i + 400));
    if (word) {
      const w = word[0];
      const meta =
        atLineStart() && (w === 'title' || w === 'accTitle' || w === 'accDescr') ? w : undefined;
      if (meta) {
        const r = metaAt(text, i, meta);
        if (r) {
          i = r.end;
          push({ k: T.Meta, s, e: i, v: r.value, meta });
          continue;
        }
      }
      i += w.length;
      push({ k: /^\d+$/.test(w) ? T.Int : T.Word, s, e: i, v: w });
      continue;
    }
    i++;
    tw.push(Kind.Error, s, i);
    st.diagnostics.error('C4B_UNEXPECTED_CHARACTER', `Unexpected character "${c}".`, {
      start: s,
      end: i,
    });
  }
  return toks;
}

/** A `title`, `accTitle:` or `accDescr` statement at `at` (the common grammar's terminals). */
function metaAt(
  text: string,
  at: number,
  word: 'title' | 'accTitle' | 'accDescr',
): { end: number; value: string } | undefined {
  const rest = text.slice(at + word.length);
  const lineEnd = (from: number) => {
    const nl = text.slice(from).search(/[\r\n]|%%/);
    return nl < 0 ? text.length : from + nl;
  };
  if (word === 'title') {
    if (rest !== '' && !/^[\t \r\n]/.test(rest) && !rest.startsWith('%%')) return undefined;
    const end = lineEnd(at + word.length);
    return { end, value: oneLine(text.slice(at + word.length, end)) };
  }
  const m = /^[\t ]*([:{])/.exec(rest);
  if (!m?.[1]) return undefined;
  const open = at + word.length + m[0].length;
  if (m[1] === ':') {
    const end = lineEnd(open);
    return { end, value: oneLine(text.slice(open, end)) };
  }
  if (word !== 'accDescr') return undefined;
  const close = text.indexOf('}', open);
  if (close < 0) return undefined;
  return { end: close + 1, value: multiLine(text.slice(open, close)) };
}

class Parser {
  private p = 0;
  private readonly st = new ParseState();
  private readonly tw = new TokenWriter(256);
  private readonly toks: Tok[] = [];
  private readonly elements: C4BetaElement[] = [];
  private readonly relationships: C4BetaRelationship[] = [];
  private readonly styles = new Map<string, C4BetaTagStyle>();
  private readonly root: C4BetaStatement[] = [];
  private kind: C4BetaKind = 'context';
  private title: string | undefined;
  private accTitle = '';
  private accDescr = '';
  private direction: C4BetaDirection = 'TB';
  private legend = true;
  private depth = 0;
  private stopped = false;
  private readonly text: string;
  private readonly limits: C4BetaParseOptions['limits'];

  constructor(text: string, limits: C4BetaParseOptions['limits']) {
    this.text = text;
    this.limits = limits;
  }

  get state(): ParseState {
    return this.st;
  }

  tokens() {
    return this.tw.finish(this.text);
  }

  private peek(n = 0): Tok | undefined {
    return this.toks[this.p + n];
  }

  private next(): Tok | undefined {
    return this.toks[this.p++];
  }

  private atEnd(): boolean {
    return this.p >= this.toks.length;
  }

  private error(code: string, message: string, range: Range, expected?: string[]): void {
    this.st.diagnostics.error(code, message, range, expected ? { expected } : undefined);
  }

  private warn(code: string, message: string, range: Range): void {
    this.st.diagnostics.warning(code, message, range);
  }

  /** Skips to the end of the line (or a `}` that closes the enclosing block). */
  private recover(): void {
    while (!this.atEnd()) {
      const t = this.peek();
      if (!t || t.k === Kind.Newline) break;
      if (t.k === T.RBrace && this.depth > 0) break;
      this.p++;
    }
  }

  /** The end of a statement: a line break, the end, or a `}` closing the block it is in. */
  private endOfStatement(what: string): void {
    const t = this.peek();
    if (!t || t.k === Kind.Newline || (t.k === T.RBrace && this.depth > 0)) return;
    this.error('C4B_EXPECTED_NEWLINE', `Expected the end of the line after ${what}.`, {
      start: t.s,
      end: t.e,
    });
    this.recover();
  }

  parse(
    start: number,
    pre: PreprocessResult,
    frontMatterTitle: string | undefined,
  ): { model: C4BetaModel; ast: C4BetaDocument } {
    const header = /^c4-beta(?![\w-])/.exec(this.text.slice(start));
    if (!header) {
      this.error('C4B_NO_KEYWORD', 'A c4-beta diagram starts with c4-beta.', {
        start,
        end: Math.min(this.text.length, start + 1),
      });
      return this.finish(frontMatterTitle);
    }
    this.tw.push(T.Word, start, start + header[0].length);
    this.st.statement('header', { start, end: start + header[0].length });
    this.toks.push(...lex(this.text, start + header[0].length, pre, this.tw, this.st));
    // `c4-beta <kind>` on the header line.
    const k = this.peek();
    if (k?.k === T.Word && isDiagramKind(k.v)) {
      this.kind = k.v;
      this.p++;
    }
    this.endOfStatement('the c4-beta header');
    while (!this.atEnd() && !this.stopped) this.statement(undefined);
    this.validate();
    return this.finish(frontMatterTitle);
  }

  private finish(frontMatterTitle: string | undefined): {
    model: C4BetaModel;
    ast: C4BetaDocument;
  } {
    return {
      model: {
        kind: this.kind,
        title: this.title ?? frontMatterTitle ?? '',
        accTitle: this.accTitle,
        accDescr: this.accDescr,
        direction: this.direction,
        legend: this.legend,
        elements: this.elements,
        relationships: this.relationships,
        styles: [...this.styles.entries()],
      },
      ast: {
        id: 'doc',
        type: 'c4BetaDocument',
        range: { start: 0, end: this.text.length },
        children: this.root,
      },
    };
  }

  private leaf(
    into: C4BetaStatement[],
    id: string,
    type: string,
    keyword: string,
    range: Range,
  ): C4BetaStatement {
    this.st.statement(type, range);
    const node: C4BetaStatement = { id, type, keyword, range };
    into.push(node);
    return node;
  }

  /** One statement, in a block when `parent` is set (where only elements are allowed). */
  private statement(parent: { id: string; children: C4BetaStatement[] } | undefined): void {
    const t = this.peek();
    if (!t) return;
    if (t.k === Kind.Newline) {
      this.p++;
      return;
    }
    const into = parent ? parent.children : this.root;
    const n1 = this.peek(1);
    if (parent && !(t.k === T.Word && isElementKind(t.v) && n1?.k !== T.Arrow)) {
      this.error(
        'C4B_ONLY_ELEMENTS',
        'Only elements go between { and }; relationships and styles go at the top level.',
        { start: t.s, end: t.e },
        ['an element'],
      );
      this.recover();
      return;
    }
    if (t.k === T.Meta) {
      this.p++;
      if (t.meta === 'title') this.title = t.v;
      else if (t.meta === 'accTitle') this.accTitle = t.v;
      else this.accDescr = t.v;
      this.leaf(into, this.st.ids.statement(t.meta ?? 'meta'), t.meta ?? 'meta', t.meta ?? 'meta', {
        start: t.s,
        end: t.e,
      });
      this.endOfStatement(t.meta ?? 'the statement');
      return;
    }
    if (t.k === T.Word && t.v === 'direction' && n1?.k === T.Word) {
      this.p += 2;
      if (isDirection(n1.v)) this.direction = n1.v;
      else
        this.error(
          'C4B_EXPECTED_DIRECTION',
          'direction needs TB, BT, LR or RL.',
          { start: n1.s, end: n1.e },
          ['TB', 'BT', 'LR', 'RL'],
        );
      this.leaf(into, this.st.ids.statement('direction'), 'direction', 'direction', {
        start: t.s,
        end: n1.e,
      });
      this.endOfStatement('direction');
      return;
    }
    if (t.k === T.Word && t.v === 'legend' && n1?.k === T.Word) {
      this.p += 2;
      if (n1.v === 'on' || n1.v === 'off') this.legend = n1.v === 'on';
      else
        this.error('C4B_EXPECTED_LEGEND', 'legend needs on or off.', { start: n1.s, end: n1.e }, [
          'on',
          'off',
        ]);
      this.leaf(into, this.st.ids.statement('legend'), 'legend', 'legend', {
        start: t.s,
        end: n1.e,
      });
      this.endOfStatement('legend');
      return;
    }
    if (t.k === T.Word && t.v === 'style' && n1?.k === T.Word && this.peek(2)?.k !== T.Arrow) {
      this.style(into);
      return;
    }
    if (t.k === T.Int && n1?.k === T.Colon) {
      this.relationship(into);
      return;
    }
    if (t.k === T.Word && isElementKind(t.v) && (n1?.k === T.Word || n1?.k === T.Int)) {
      this.element(parent, into);
      return;
    }
    if ((t.k === T.Word || t.k === T.Int) && n1?.k === T.Arrow) {
      this.relationship(into);
      return;
    }
    this.error('C4B_UNEXPECTED', 'Expected a statement.', { start: t.s, end: t.e }, STATEMENTS);
    this.recover();
  }

  private element(parent: { id: string } | undefined, into: C4BetaStatement[]): void {
    const kw = this.next();
    const idTok = this.next();
    if (!kw || !idTok || !isElementKind(kw.v)) return;
    const strings: Tok[] = [];
    while (this.peek()?.k === T.String && strings.length < 3) {
      const s = this.next();
      if (s) strings.push(s);
    }
    if (strings.length === 0) {
      this.error(
        'C4B_EXPECTED_NAME',
        `${kw.v} ${idTok.v} needs a quoted name.`,
        { start: kw.s, end: idTok.e },
        ['a quoted name'],
      );
      this.recover();
      return;
    }
    let instances: string | undefined;
    if (this.peek()?.k === T.Word && this.peek()?.v === 'instances') {
      this.p++;
      const v = this.peek();
      if (v?.k === T.String) {
        instances = v.v;
        this.p++;
      } else
        this.error(
          'C4B_EXPECTED_INSTANCES',
          'instances needs a quoted count such as "4" or "1..N".',
          { start: v?.s ?? kw.s, end: v?.e ?? kw.e },
        );
    }
    const tags: string[] = [];
    while (this.peek()?.k === T.Tag) tags.push(this.next()?.v ?? '');
    const range = { start: kw.s, end: this.toks[this.p - 1]?.e ?? idTok.e };
    // v12 rejects an element declared inside one with its own id.
    for (let a: string | undefined = parent?.id; a !== undefined; a = this.lastElement(a)?.parent) {
      if (a === idTok.v) {
        this.error(
          'C4B_ID_INSIDE_ITSELF',
          `The id "${idTok.v}" is declared inside an element with the same id. Every element needs its own id.`,
          { start: idTok.s, end: idTok.e },
        );
        break;
      }
    }
    const ast = this.st.ids.node(idTok.v);
    this.st.symbol(idTok.v, 'element', { start: idTok.s, end: idTok.e }, 'def');
    const [name, description, technology] = strings;
    this.elements.push({
      id: idTok.v,
      ast,
      kind: kw.v,
      name: name?.v ?? '',
      ...(description !== undefined ? { description: description.v } : {}),
      ...(technology !== undefined ? { technology: technology.v } : {}),
      ...(instances !== undefined ? { instances } : {}),
      tags,
      ...(parent ? { parent: parent.id } : {}),
    });
    this.checkSizes(range);
    if (this.peek()?.k !== T.LBrace) {
      this.leaf(into, ast, 'element', kw.v, range);
      this.endOfStatement(`${kw.v} ${idTok.v}`);
      return;
    }
    const brace = this.next();
    if (!brace) return;
    if (this.limits && this.depth + 1 > this.limits.maxDepth) {
      this.error(
        LIMIT_CODES.maxDepth,
        `Elements nest deeper than the limit of ${this.limits.maxDepth}.`,
        range,
      );
      this.stopped = true;
      return;
    }
    const span = this.st.beginStatement('element', kw.s);
    const children: C4BetaStatement[] = [];
    const node = { id: ast, type: 'element', keyword: kw.v, range: { ...range }, children };
    into.push(node);
    this.depth++;
    const block = { id: idTok.v, children: node.children };
    for (;;) {
      if (this.stopped) return;
      const t = this.peek();
      if (!t) {
        this.error(
          'C4B_UNCLOSED_BLOCK',
          `${kw.v} ${idTok.v} has no closing }.`,
          { start: brace.s, end: brace.e },
          ['`}`'],
        );
        break;
      }
      if (t.k === T.RBrace) {
        this.p++;
        node.range.end = t.e;
        break;
      }
      this.statement(block);
    }
    this.depth--;
    this.st.endStatement(span, node.range.end);
    this.endOfStatement('the closing }');
  }

  /** The latest element declared with `id`: the one that opened an enclosing block. */
  private lastElement(id: string): C4BetaElement | undefined {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const e = this.elements[i];
      if (e?.id === id) return e;
    }
    return undefined;
  }

  private relationship(into: C4BetaStatement[]): void {
    const first = this.peek();
    let step: number | undefined;
    if (first?.k === T.Int && this.peek(1)?.k === T.Colon) {
      step = Number(first.v);
      this.p += 2;
    }
    const src = this.next();
    const arrow = this.next();
    const dst = this.next();
    if (!src || !arrow || arrow.k !== T.Arrow || !dst || (dst.k !== T.Word && dst.k !== T.Int)) {
      const at = dst ?? arrow ?? src ?? first;
      this.error(
        'C4B_EXPECTED_TARGET',
        'A relationship is written `source --> target`.',
        { start: at?.s ?? 0, end: at?.e ?? 0 },
        ['an element id'],
      );
      this.recover();
      return;
    }
    let description: string | undefined;
    let technology: string | undefined;
    if (this.peek()?.k === T.Colon) {
      this.p++;
      const d = this.peek();
      if (d?.k === T.String) {
        description = d.v;
        this.p++;
        if (this.peek()?.k === T.String) technology = this.next()?.v;
      } else {
        this.error(
          'C4B_EXPECTED_DESCRIPTION',
          'After ":" a relationship needs a quoted description.',
          { start: d?.s ?? arrow.s, end: d?.e ?? arrow.e },
          ['a quoted description'],
        );
        this.recover();
        return;
      }
    }
    const tags: string[] = [];
    while (this.peek()?.k === T.Tag) tags.push(this.next()?.v ?? '');
    const range = { start: (first ?? src).s, end: this.toks[this.p - 1]?.e ?? dst.e };
    const ast = this.st.ids.edge(src.v, dst.v);
    this.st.symbol(src.v, 'element', { start: src.s, end: src.e }, 'ref');
    this.st.symbol(dst.v, 'element', { start: dst.s, end: dst.e }, 'ref');
    const a = arrow.v;
    this.relationships.push({
      ast,
      source: src.v,
      target: dst.v,
      arrow: a === '<-->' || a === '<--' || a === '-->' ? a : '---',
      ...(description !== undefined ? { description } : {}),
      ...(technology !== undefined ? { technology } : {}),
      ...(step !== undefined ? { step } : {}),
      tags,
    });
    this.leaf(into, ast, 'relationship', a, range);
    this.checkSizes(range);
    this.endOfStatement('the relationship');
  }

  private style(into: C4BetaStatement[]): void {
    const kw = this.next();
    const tag = this.next();
    if (!kw || !tag) return;
    const style = this.styles.get(tag.v) ?? {};
    for (;;) {
      const key = this.peek();
      const colon = this.peek(1);
      const value = this.peek(2);
      if (
        key?.k !== T.Word ||
        colon?.k !== T.Colon ||
        !value ||
        (value.k !== T.Word && value.k !== T.Hex)
      ) {
        this.error(
          'C4B_EXPECTED_STYLE_ENTRY',
          'A style entry is written key:value, as in fill:#1168BD.',
          { start: key?.s ?? tag.e, end: key?.e ?? tag.e },
          ['key:value'],
        );
        this.recover();
        break;
      }
      this.p += 3;
      this.applyStyle(tag.v, style, key.v, value.v, { start: key.s, end: value.e });
      if (this.peek()?.k !== T.Comma) break;
      this.p++;
    }
    this.styles.set(tag.v, style);
    this.leaf(into, this.st.ids.statement('style'), 'style', 'style', {
      start: kw.s,
      end: this.toks[this.p - 1]?.e ?? tag.e,
    });
    this.endOfStatement('the style');
  }

  /** v12 `addStyle`: what a key may set; anything else is dropped with a warning. */
  private applyStyle(
    tag: string,
    style: C4BetaTagStyle,
    key: string,
    value: string,
    at: Range,
  ): void {
    if (key === 'fill' || key === 'stroke' || key === 'color') style[key] = value;
    else if (key === 'shape' && value === 'cylinder') style.shape = value;
    else if (key === 'line' && (value === 'solid' || value === 'dashed' || value === 'dotted'))
      style.line = value;
    else
      this.warn(
        'C4B_STYLE_IGNORED',
        `Unsupported style "${key}:${value}" for tag "${tag}"; it is ignored.`,
        at,
      );
  }

  private checkSizes(range: Range): void {
    if (!this.limits || this.stopped) return;
    if (this.elements.length > this.limits.maxNodes) {
      this.error(
        LIMIT_CODES.maxNodes,
        `The diagram declares more than ${this.limits.maxNodes} elements.`,
        range,
      );
      this.stopped = true;
    } else if (this.relationships.length > this.limits.maxEdges) {
      this.error(
        LIMIT_CODES.maxEdges,
        `The diagram declares more than ${this.limits.maxEdges} relationships.`,
        range,
      );
      this.stopped = true;
    }
  }

  /** v12 `validateElements`: warnings, and technology or instances where they do not belong. */
  private validate(): void {
    const unexpected = UNEXPECTED[this.kind];
    const ranges = new Map(
      this.st.symbols.filter((s) => s.role === 'def').map((s) => [s.name, s.range]),
    );
    for (const el of this.elements) {
      const at = ranges.get(el.id) ?? { start: 0, end: 0 };
      if (unexpected.includes(el.kind)) {
        this.warn(
          'C4B_UNEXPECTED_KIND',
          `Element "${el.id}" of kind "${el.kind}" is unexpected in a "${this.kind}" diagram; it is drawn anyway.`,
          at,
        );
      }
      if (el.technology !== undefined && (el.kind === 'person' || el.kind === 'softwareSystem')) {
        this.warn(
          'C4B_TECHNOLOGY_IGNORED',
          `Technology "${el.technology}" on ${el.kind} "${el.id}" is ignored; technology only applies to container, component and deploymentNode elements.`,
          at,
        );
        delete el.technology;
      }
      if (el.instances !== undefined && el.kind !== 'deploymentNode') {
        this.warn(
          'C4B_INSTANCES_IGNORED',
          `Instances "${el.instances}" on ${el.kind} "${el.id}" is ignored; instances only apply to deploymentNode elements.`,
          at,
        );
        delete el.instances;
      }
    }
  }
}

/** Parses a c4-beta diagram. `text` is the whole source; every range is an offset into it. Never throws. */
export function parseC4Beta(text: string, options: C4BetaParseOptions = {}): C4BetaParseResult {
  const pre = options.preprocessed ?? preprocess(text);
  const p = new Parser(text, options.limits);
  const { model, ast } = p.parse(
    diagramStart(text, pre),
    pre,
    options.frontMatterTitle ?? pre.frontMatter?.title,
  );
  return p.state.result(model, ast, p.tokens(), options);
}
