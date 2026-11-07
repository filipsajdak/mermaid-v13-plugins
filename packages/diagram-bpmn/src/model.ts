/**
 * The bpmn-beta vocabulary and the parsed model: v12's `diagrams/bpmn/types.ts` and the
 * parser's `ParsedDiagram` (the bpmn-beta series, #8166), as plain serialisable data.
 */

export const BPMN_DIRECTIONS = ['LR', 'RL', 'TB', 'TD', 'BT'] as const;

export const EVENT_TRIGGERS = [
  'message',
  'timer',
  'error',
  'escalation',
  'cancel',
  'compensation',
  'conditional',
  'link',
  'signal',
  'terminate',
  'parallel-multiple',
  'multiple',
  'none',
] as const;

export const TASK_TYPES = [
  'user',
  'service',
  'receive',
  'send',
  'manual',
  'script',
  'rule',
] as const;

/** The triggers the notation draws at each event position (BPMN 2.0.2, table 10.93 and on). */
export const TRIGGERS_BY_POSITION = {
  start: [
    'none',
    'message',
    'timer',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
    'error',
    'escalation',
    'compensation',
  ],
  intermediate: [
    'message',
    'timer',
    'conditional',
    'link',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  throw: ['none', 'message', 'escalation', 'compensation', 'link', 'signal', 'multiple'],
  boundary: [
    'message',
    'timer',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  end: [
    'none',
    'message',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'signal',
    'terminate',
    'multiple',
  ],
} as const satisfies Record<string, readonly EventTrigger[]>;

export type BpmnDirection = (typeof BPMN_DIRECTIONS)[number];
export type EventTrigger = (typeof EVENT_TRIGGERS)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type EventPosition = keyof typeof TRIGGERS_BY_POSITION;

export const EVENT_POSITIONS = ['start', 'intermediate', 'throw', 'boundary', 'end'] as const;

/** Whether the notation draws `trigger` at `position`. */
export const drawsTrigger = (position: EventPosition, trigger: string): boolean =>
  TRIGGERS_BY_POSITION[position].some((t) => t === trigger);

/** The positions that draw `trigger`. */
export const positionsFor = (trigger: string): EventPosition[] =>
  EVENT_POSITIONS.filter((position) => drawsTrigger(position, trigger));

export type BpmnNodeKind =
  'pool' | 'lane' | 'group' | 'event' | 'gateway' | 'activity' | 'data' | 'store' | 'annotation';

/** One element statement. */
export interface BpmnNode {
  readonly kind: BpmnNodeKind;
  /** The word that declared it: `start`, `xor`, `task`, `data-store`, `note`, ... */
  readonly keyword: string;
  /** An event's trigger, a task's type, or a data object's `input`/`output`/`collection`. */
  readonly qualifier?: string;
  readonly id: string;
  readonly label: string;
  /** Indentation depth, relative to the first element line. */
  readonly level: number;
  /** The element it is indented under. */
  readonly parentId?: string;
}

export type BpmnFlowKind = 'sequence' | 'message' | 'association';

export interface BpmnFlow {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly kind: BpmnFlowKind;
  /** For an association: whether it points at `to` (`..>`) or nowhere (`...`). */
  readonly directed?: boolean;
}

export interface BpmnModel {
  readonly direction: BpmnDirection;
  readonly nodes: readonly BpmnNode[];
  readonly flows: readonly BpmnFlow[];
  readonly title?: string;
  readonly accTitle?: string;
  readonly accDescr?: string;
}
