/**
 * Where a flow meets the shapes it joins. The swimlane engine ends a route on a node's reserved
 * box; v12's renderer then moved each end onto the drawn shape with the shape's `intersect`
 * (`edges.js`, the `layout === 'swimlane'` branch of `insertEdge`, and the intersect helpers of
 * `bpmnShapeCore.ts`, the bpmn-beta series #8166). This is that step, without the DOM.
 */
import type { Drawn } from './layout-data.ts';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A node as the docking sees it: its centre, the drawn shape's size, and its kind. */
export interface DockShape {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly drawn: Drawn;
  /** An annotation's face, which is the only one it is met on. */
  readonly face?: 'left' | 'right';
}

/** Below this two coordinates are one row or column (px, v12's `AXIS_TOLERANCE`). */
const AXIS_TOLERANCE = 0.5;
/** A face's ends that an edge does not meet, so it never lands on a rounded corner (px). */
const CORNER_INSET = 8;
/** How far round a ring an edge may meet it, as a share of the radius (v12). */
const RING_REACH = 0.85;

/** v12's `markerOffsets`: how far each end marker pulls the line back (px). */
const MARKER_PULL_BACK: Readonly<Record<string, number>> = {
  arrow_point: 4,
  arrow_open_head: 4,
  arrow_hollow_circle: 8,
};

const clamp = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
const sharesColumn = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < AXIS_TOLERANCE;
const sharesRow = (a: Pt, b: Pt) => Math.abs(a.y - b.y) < AXIS_TOLERANCE;
const coincides = (a: Pt, b: Pt) => sharesColumn(a, b) && sharesRow(a, b);

type Face = 'top' | 'bottom' | 'left' | 'right';

/** v12's `faceProjectIntersect`: the face towards `point`, the point projected onto it. */
function faceProject(n: DockShape, point: Pt, fixed?: Face): Pt {
  const hw = n.width / 2;
  const hh = n.height / 2;
  const dx = point.x - n.x;
  const dy = point.y - n.y;
  const face: Face =
    fixed ??
    (Math.abs(dx) * hh > Math.abs(dy) * hw
      ? dx >= 0
        ? 'right'
        : 'left'
      : dy >= 0
        ? 'bottom'
        : 'top');
  const reach = (half: number) => Math.max(0, half - Math.min(CORNER_INSET, half / 2));
  if (face === 'left' || face === 'right') {
    return {
      x: n.x + (face === 'right' ? hw : -hw),
      y: clamp(point.y, n.y - reach(hh), n.y + reach(hh)),
    };
  }
  return {
    x: clamp(point.x, n.x - reach(hw), n.x + reach(hw)),
    y: n.y + (face === 'bottom' ? hh : -hh),
  };
}

/** v12's `ringIntersect`: the ring, met along the axis the point lies on. */
function ring(n: DockShape, point: Pt): Pt {
  const r = n.width / 2;
  const dx = point.x - n.x;
  const dy = point.y - n.y;
  const reach = r * RING_REACH;
  if (Math.abs(dy) >= Math.abs(dx)) {
    const along = clamp(dx, -reach, reach);
    return { x: n.x + along, y: n.y + Math.sign(dy || 1) * Math.sqrt(r * r - along * along) };
  }
  const along = clamp(dy, -reach, reach);
  return { x: n.x + Math.sign(dx || 1) * Math.sqrt(r * r - along * along), y: n.y + along };
}

/** v12's `faceCentreIntersect`: the middle of the face towards the point (a gateway's vertex). */
function faceCentre(n: DockShape, point: Pt): Pt {
  const hw = n.width / 2;
  const hh = n.height / 2;
  const dx = point.x - n.x;
  const dy = point.y - n.y;
  if (Math.abs(dx) * hh > Math.abs(dy) * hw) return { x: n.x + Math.sign(dx) * hw, y: n.y };
  return { x: n.x, y: n.y + Math.sign(dy || 1) * hh };
}

/** The shape's own `intersect`. */
export function intersect(n: DockShape, point: Pt): Pt {
  switch (n.drawn.shape) {
    case 'bpmn-start':
    case 'bpmn-intermediate':
    case 'bpmn-boundary':
    case 'bpmn-end':
      return ring(n, point);
    case 'bpmn-gateway':
      return faceCentre(n, point);
    case 'bpmn-annotation':
      return faceProject(n, point, n.face ?? 'left');
    default:
      return faceProject(n, point);
  }
}

function keepsArrivalAxis(originalLast: Pt, lastInner: Pt, candidate: Pt): boolean {
  if (sharesColumn(originalLast, lastInner) && !sharesRow(originalLast, lastInner)) {
    return sharesColumn(candidate, lastInner);
  }
  if (sharesRow(originalLast, lastInner) && !sharesColumn(originalLast, lastInner)) {
    return sharesRow(candidate, lastInner);
  }
  return sharesColumn(candidate, lastInner) || sharesRow(candidate, lastInner);
}

interface Arrival {
  readonly heading: Pt;
  readonly from: Pt;
}

function arrivalSegment(originalLast: Pt, lastInner: Pt, before: Pt): Arrival {
  return coincides(originalLast, lastInner)
    ? { heading: lastInner, from: before }
    : { heading: originalLast, from: lastInner };
}

function runsAgainstHeading({ heading, from }: Arrival, lastInner: Pt, candidate: Pt): boolean {
  return (
    (heading.x - from.x) * (candidate.x - lastInner.x) +
      (heading.y - from.y) * (candidate.y - lastInner.y) <
    0
  );
}

function snapToArrivalAxis({ heading, from }: Arrival, lastInner: Pt, candidate: Pt): Pt {
  if (sharesRow(heading, from) && !sharesColumn(heading, from)) {
    return { x: candidate.x, y: lastInner.y };
  }
  if (sharesColumn(heading, from) && !sharesRow(heading, from)) {
    return { x: lastInner.x, y: candidate.y };
  }
  return candidate;
}

function dockFinalPoint(originalLast: Pt, lastInner: Pt, before: Pt, candidate: Pt): Pt {
  const wasOrthogonal = sharesColumn(originalLast, lastInner) || sharesRow(originalLast, lastInner);
  if (wasOrthogonal && !keepsArrivalAxis(originalLast, lastInner, candidate)) return originalLast;
  const arrival = arrivalSegment(originalLast, lastInner, before);
  if (runsAgainstHeading(arrival, lastInner, candidate)) return lastInner;
  return snapToArrivalAxis(arrival, lastInner, candidate);
}

function finalDockPoint(originalLast: Pt, lastInner: Pt, newLast: Pt, minLength: number) {
  const turned = !coincides(originalLast, lastInner);
  const length = Math.hypot(newLast.x - lastInner.x, newLast.y - lastInner.y);
  if (length >= Math.max(AXIS_TOLERANCE, minLength)) return newLast;
  return turned && length >= AXIS_TOLERANCE ? originalLast : undefined;
}

/**
 * The route with its ends moved onto the shapes, as v12's `insertEdge` did for the swimlane
 * layout: a straight route asks each shape about its own end (or the far end when slanted); a
 * longer one keeps its bends and docks each end on the axis it arrived on.
 */
export function dock(
  points: readonly Pt[],
  tail: DockShape,
  head: DockShape,
  arrowTypeEnd: string,
): Pt[] {
  if (points.length < 2) return [...points];
  if (points.length === 2) {
    const [first, last] = points;
    if (!first || !last) return [...points];
    return sharesColumn(first, last) || sharesRow(first, last)
      ? [intersect(tail, first), intersect(head, last)]
      : [intersect(tail, last), intersect(head, first)];
  }
  const inner = points.slice(1, -1);
  const firstInner = inner[0];
  const lastInner = inner.at(-1);
  const originalLast = points.at(-1);
  const before = inner.at(-2) ?? points[0];
  if (!firstInner || !lastInner || !originalLast || !before) return [...points];
  const newFirst = intersect(tail, firstInner);
  const newLast = dockFinalPoint(originalLast, lastInner, before, intersect(head, lastInner));
  const finalPoint = finalDockPoint(
    originalLast,
    lastInner,
    newLast,
    MARKER_PULL_BACK[arrowTypeEnd] ?? 0,
  );
  const firstIsDuplicate = coincides(newFirst, firstInner);
  return [...(firstIsDuplicate ? [] : [newFirst]), ...inner, ...(finalPoint ? [finalPoint] : [])];
}
