/**
 * The semantics of each C4 statement: v12's `c4Db.ts` (converged build) as a builder that
 * the parser feeds, with no module state. Positional arguments fill the slots of v12's db
 * functions in order; a named argument (`$descr="..."`) sets its own field whatever slot it
 * lands in.
 */
import type { Range } from '@mermaid-js/core/parser-kit';
import type {
  C4Boundary,
  C4Direction,
  C4Element,
  C4ElementStyle,
  C4ElementTag,
  C4ElementType,
  C4Model,
  C4NodeType,
  C4Rel,
  C4RelTag,
  C4RelType,
  C4DiagramKind,
} from './model.ts';

/** One argument between the parentheses of a statement. */
export type C4Arg =
  | { readonly kind: 'value'; readonly value: string; readonly range: Range }
  | { readonly kind: 'named'; readonly key: string; readonly value: string; readonly range: Range };

/** Reports a problem with a statement that does not stop the parse. */
export type Report = (
  severity: 'error' | 'warning',
  code: string,
  message: string,
  range: Range,
) => void;

const STYLE_KEYS: ReadonlySet<string> = new Set<keyof C4ElementStyle>([
  'bgColor',
  'fontColor',
  'borderColor',
  'shadowing',
  'shape',
  'showStereotype',
  'legendText',
  'legendSprite',
]);

const isStyleKey = (key: string): key is keyof C4ElementStyle => STYLE_KEYS.has(key);

/**
 * The value each field gets from `args`: a positional argument at index `i` sets `slots[i]`,
 * a named one sets its key. Later arguments win. Positional arguments past the last slot are
 * ignored, as v12's db functions ignore extra parameters.
 */
function fieldsOf(args: readonly C4Arg[], slots: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  args.forEach((a, i) => {
    if (a.kind === 'named') out.set(a.key, a.value);
    else {
      const slot = slots[i];
      if (slot !== undefined) out.set(slot, a.value);
    }
  });
  return out;
}

/** The first argument as a plain value: an alias, a tag name, an endpoint. */
const positional = (a: C4Arg | undefined): string | undefined =>
  a?.kind === 'value' ? a.value : undefined;

const KNOWN_DECLARED = new Set([
  'alias',
  'label',
  'descr',
  'techn',
  'type',
  'sprite',
  'tags',
  'link',
]);

/** Sets the fields every declaration shares; the rest go to `style` or `other`. */
function applyCommon(
  target: {
    sprite?: string;
    tags?: string;
    link?: string;
    style: C4ElementStyle;
    other: Record<string, string>;
  },
  fields: Map<string, string>,
): void {
  for (const [key, value] of fields) {
    if (key === 'sprite' || key === 'tags' || key === 'link') target[key] = value;
    else if (isStyleKey(key)) target.style[key] = value;
    else if (!KNOWN_DECLARED.has(key)) target.other[key] = value;
  }
}

const ELEMENT_SLOTS = ['alias', 'label', 'descr', 'sprite', 'tags', 'link'] as const;
const TECHN_ELEMENT_SLOTS = ['alias', 'label', 'techn', 'descr', 'sprite', 'tags', 'link'] as const;
const BOUNDARY_SLOTS = ['alias', 'label', 'type', 'tags', 'link'] as const;
const NODE_SLOTS = ['alias', 'label', 'type', 'descr', 'sprite', 'tags', 'link'] as const;
const REL_SLOTS = ['from', 'to', 'label', 'techn', 'descr', 'sprite', 'tags', 'link'] as const;
const EL_STYLE_SLOTS = [
  'elementName',
  'bgColor',
  'fontColor',
  'borderColor',
  'shadowing',
  'shape',
  'sprite',
  'techn',
  'legendText',
  'legendSprite',
] as const;
const REL_STYLE_SLOTS = ['from', 'to', 'textColor', 'lineColor', 'offsetX', 'offsetY'] as const;
const EL_TAG_SLOTS = ['tagName', 'bgColor', 'fontColor', 'borderColor', 'shape'] as const;
const REL_TAG_SLOTS = ['tagName', 'textColor', 'lineColor'] as const;

/** The boundary keywords and the kind each splices in as its third argument (v12 grammar). */
export type BoundaryKeyword =
  | 'Boundary'
  | 'Enterprise_Boundary'
  | 'System_Boundary'
  | 'Container_Boundary'
  | 'Node'
  | 'Deployment_Node'
  | 'Node_L'
  | 'Node_R';

const SPLICED: Partial<Record<BoundaryKeyword, string>> = {
  Enterprise_Boundary: 'ENTERPRISE',
  System_Boundary: 'SYSTEM',
  Container_Boundary: 'CONTAINER',
};

const NODE_TYPES: Partial<Record<BoundaryKeyword, C4NodeType>> = {
  Node: 'node',
  Deployment_Node: 'node',
  Node_L: 'nodeL',
  Node_R: 'nodeR',
};

/** `parseInt` as v12 applies it to label offsets; undefined for what is not a number. */
function offset(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export class C4Builder {
  private readonly elements = new Map<string, C4Element>();
  private readonly boundaries = new Map<string, C4Boundary>();
  private readonly rels: C4Rel[] = [];
  private readonly elementTags = new Map<string, C4ElementTag>();
  private readonly relTags = new Map<string, C4RelTag>();
  /** Aliases of the boundaries open at this point of the parse, innermost last. */
  private readonly open: string[] = [];
  title = '';
  accTitle = '';
  accDescr = '';
  direction: C4Direction = 'TB';

  private readonly kind: C4DiagramKind | undefined;
  private readonly report: Report;

  constructor(kind: C4DiagramKind | undefined, report: Report) {
    this.kind = kind;
    this.report = report;
  }

  /** How many boundaries are open: the nesting depth of the next statement. */
  get depth(): number {
    return this.open.length;
  }

  private get parent(): string | undefined {
    return this.open.at(-1);
  }

  /** `Person`, `System_Ext`, `ContainerDb`, ...: v12 `addPersonOrSystem`, `addContainer`, `addComponent`. */
  element(
    type: C4ElementType,
    withTechn: boolean,
    args: readonly C4Arg[],
    at: Range,
    ast: string,
  ): void {
    const alias = positional(args[0]);
    if (alias === undefined) {
      this.report(
        'error',
        'C4_ALIAS_EXPECTED',
        'An element needs an alias as its first argument.',
        args[0]?.range ?? at,
      );
      return;
    }
    const fields = fieldsOf(args, withTechn ? TECHN_ELEMENT_SLOTS : ELEMENT_SLOTS);
    let el = this.elements.get(alias);
    if (!el) {
      el = { alias, ast, type, label: '', descr: '', techn: '', style: {}, other: {} };
      this.elements.set(alias, el);
    }
    el.type = type;
    // v12 resets the label on every declaration, and keeps an earlier description or technology.
    el.label = fields.get('label') ?? '';
    el.descr = fields.get('descr') ?? el.descr;
    el.techn = fields.get('techn') ?? el.techn;
    const parent = this.parent;
    if (parent === undefined) delete el.parent;
    else el.parent = parent;
    applyCommon(el, fields);
  }

  /** A boundary or deployment node; its statements follow until {@link close}. */
  boundary(keyword: BoundaryKeyword, args: readonly C4Arg[], at: Range, ast: string): boolean {
    const nodeType = NODE_TYPES[keyword];
    const spliced = SPLICED[keyword];
    // v12's grammar splices the kind in as a positional third argument, so an explicit third
    // argument moves along one slot (and a short list gets the kind as its label).
    const list = [...args];
    if (spliced !== undefined) list.splice(2, 0, { kind: 'value', value: spliced, range: at });
    const alias = positional(list[0]);
    if (alias === undefined) {
      this.report(
        'error',
        'C4_ALIAS_EXPECTED',
        'A boundary needs an alias as its first argument.',
        args[0]?.range ?? at,
      );
      return false;
    }
    const fields = fieldsOf(list, nodeType ? NODE_SLOTS : BOUNDARY_SLOTS);
    let b = this.boundaries.get(alias);
    if (!b) {
      b = { alias, ast, type: '', label: '', descr: '', style: {}, other: {} };
      this.boundaries.set(alias, b);
    }
    b.label = fields.get('label') ?? '';
    b.type =
      fields.get('type') ??
      (nodeType ? 'node' : keyword === 'Container_Boundary' ? 'container' : 'system');
    if (nodeType) {
      b.nodeType = nodeType;
      b.descr = fields.get('descr') ?? b.descr;
    }
    const parent = this.parent;
    if (parent === undefined) delete b.parent;
    else b.parent = parent;
    applyCommon(b, fields);
    this.open.push(alias);
    return true;
  }

  /** The `}` of the innermost open boundary; false when none is open. */
  close(): boolean {
    return this.open.pop() !== undefined;
  }

  /** `direction` inside a boundary sets that boundary's; outside, the diagram's. */
  setDirection(dir: C4Direction): void {
    const parent = this.parent;
    const b = parent === undefined ? undefined : this.boundaries.get(parent);
    if (b) b.direction = dir;
    else this.direction = dir;
  }

  /** `Rel` and friends: v12 `addRel`. A relationship without a label is dropped, as in v12. */
  rel(type: C4RelType, args: readonly C4Arg[], at: Range, ast: string): void {
    const fields = fieldsOf(args, REL_SLOTS);
    const from = positional(args[0]);
    const to = positional(args[1]);
    const label = fields.get('label');
    if (from === undefined || to === undefined || label === undefined) {
      this.report(
        'warning',
        'C4_REL_INCOMPLETE',
        'A relationship needs a source, a target and a label; v12 draws nothing for this one either.',
        at,
      );
      return;
    }
    const rel: C4Rel = {
      ast,
      type,
      from,
      to,
      label,
      techn: fields.get('techn') ?? '',
      descr: fields.get('descr') ?? '',
      other: {},
    };
    for (const [key, value] of fields) {
      if (key === 'sprite' || key === 'tags' || key === 'link') rel[key] = value;
      else if (key === 'textColor' || key === 'lineColor') rel[key] = value;
      else if (!REL_SLOTS.some((s) => s === key)) rel.other[key] = value;
    }
    this.rels.push(rel);
  }

  /** `UpdateElementStyle(alias, ...)`: an element first, else a boundary of that alias. */
  updateElementStyle(args: readonly C4Arg[], at: Range): void {
    const name = positional(args[0]);
    const target =
      name === undefined ? undefined : (this.elements.get(name) ?? this.boundaries.get(name));
    if (!target) {
      this.report(
        'warning',
        'C4_UNKNOWN_ALIAS',
        `UpdateElementStyle names ${name === undefined ? 'no alias' : `"${name}"`}, which is not declared before it; it has no effect.`,
        args[0]?.range ?? at,
      );
      return;
    }
    for (const [key, value] of fieldsOf(args, EL_STYLE_SLOTS)) {
      if (key === 'elementName') continue;
      if (isStyleKey(key)) target.style[key] = value;
      else if (key === 'sprite' || key === 'tags' || key === 'link') target[key] = value;
      else if (key === 'label' || key === 'descr') target[key] = value;
      else if (key === 'techn' && 'techn' in target) target.techn = value;
      else target.other[key] = value;
    }
  }

  /** `UpdateRelStyle(from, to, ...)`: every relationship between the pair declared so far. */
  updateRelStyle(args: readonly C4Arg[], at: Range): void {
    const from = positional(args[0]);
    const to = positional(args[1]);
    const matching = this.rels.filter((r) => r.from === from && r.to === to);
    if (matching.length === 0) {
      this.report(
        'warning',
        'C4_UNKNOWN_REL',
        'UpdateRelStyle names a pair with no relationship declared before it; it has no effect.',
        at,
      );
      return;
    }
    const fields = fieldsOf(args, REL_STYLE_SLOTS);
    for (const rel of matching) {
      for (const [key, value] of fields) {
        if (key === 'from' || key === 'to') continue;
        if (key === 'textColor' || key === 'lineColor') rel[key] = value;
        else if (key === 'offsetX') {
          const n = offset(value);
          if (n === undefined) delete rel.offsetX;
          else rel.offsetX = n;
        } else if (key === 'offsetY') {
          const n = offset(value);
          if (n === undefined) delete rel.offsetY;
          else rel.offsetY = n;
        } else rel.other[key] = value;
      }
    }
  }

  /** `AddElementTag(name, ...)`: a later statement for the same name adds to it. */
  addElementTag(args: readonly C4Arg[], at: Range): void {
    const name = positional(args[0]);
    if (name === undefined) {
      this.report(
        'error',
        'C4_TAG_EXPECTED',
        'AddElementTag needs a tag name as its first argument.',
        at,
      );
      return;
    }
    let tag = this.elementTags.get(name);
    if (!tag) {
      tag = { tagName: name, other: {} };
      this.elementTags.set(name, tag);
    }
    for (const [key, value] of fieldsOf(args, EL_TAG_SLOTS)) {
      if (key === 'tagName') continue;
      if (key === 'bgColor' || key === 'fontColor' || key === 'borderColor' || key === 'shape')
        tag[key] = value;
      else tag.other[key] = value;
    }
  }

  /** `AddRelTag(name, ...)`. */
  addRelTag(args: readonly C4Arg[], at: Range): void {
    const name = positional(args[0]);
    if (name === undefined) {
      this.report(
        'error',
        'C4_TAG_EXPECTED',
        'AddRelTag needs a tag name as its first argument.',
        at,
      );
      return;
    }
    let tag = this.relTags.get(name);
    if (!tag) {
      tag = { tagName: name, other: {} };
      this.relTags.set(name, tag);
    }
    for (const [key, value] of fieldsOf(args, REL_TAG_SLOTS)) {
      if (key === 'tagName') continue;
      if (key === 'textColor' || key === 'lineColor') tag[key] = value;
      else tag.other[key] = value;
    }
  }

  /** Counts of what the diagram declares so far, for the limits. */
  get sizes(): { nodes: number; edges: number } {
    return { nodes: this.elements.size + this.boundaries.size, edges: this.rels.length };
  }

  result(): C4Model {
    return {
      kind: this.kind,
      title: this.title,
      accTitle: this.accTitle,
      accDescr: this.accDescr,
      direction: this.direction,
      elements: [...this.elements.values()],
      boundaries: [...this.boundaries.values()],
      rels: this.rels,
      elementTags: [...this.elementTags.values()],
      relTags: [...this.relTags.values()],
    };
  }
}
