export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
/** Polygon vertices are absolute world coordinates; the rectangle is its bounding box. */
export type Area = Rect & { polygon?: Point[] };
const EPSILON = 1e-8;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signedArea = (points: Point[]) => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;
const onSegment = (p: Point, a: Point, b: Point) => Math.abs(cross(a, b, p)) <= EPSILON &&
  p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
  p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;

/** Reject degenerate and self-intersecting polygons, including overlapping adjacent edges. */
export function validatePolygon(points: Point[]): void {
  if (points.length < 3 || Math.abs(signedArea(points)) <= EPSILON) throw new Error('Polygon must have positive area');
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON ||
      (Math.abs(cross(a, b, c)) <= EPSILON && (onSegment(c, a, b) || onSegment(a, b, c))))
      throw new Error('Polygon has a duplicate vertex or overlapping edge');
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const d = points[j], e = points[(j + 1) % points.length];
      if ((cross(a, b, d) * cross(a, b, e) < 0 && cross(d, e, a) * cross(d, e, b) < 0) ||
        onSegment(d, a, b) || onSegment(e, a, b) || onSegment(a, d, e) || onSegment(b, d, e))
        throw new Error('Polygon must not self-intersect');
    }
  }
}

export function polygonArea(points: Point[]): Area {
  validatePolygon(points);
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y, polygon: points };
}

export function contains(area: Area, x: number, y: number): boolean {
  if (!area.polygon) return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
  const p = { x, y };
  let inside = false;
  for (let i = 0, j = area.polygon.length - 1; i < area.polygon.length; j = i++) {
    const a = area.polygon[i], b = area.polygon[j];
    if (onSegment(p, a, b)) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function vertices(area: Area): Point[] {
  return area.polygon ?? [{ x: area.x, y: area.y }, { x: area.x + area.width, y: area.y },
    { x: area.x + area.width, y: area.y + area.height }, { x: area.x, y: area.y + area.height }];
}

/** Sutherland–Hodgman clipping against a convex, counterclockwise boundary. */
function clippedArea(subject: Point[], boundary: Point[]): number {
  let result = subject;
  for (let i = 0; i < boundary.length && result.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const input = result;
    result = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const cp = cross(a, b, p), cq = cross(a, b, q);
      if (cp >= 0) result.push(p);
      if ((cp >= 0) !== (cq >= 0)) {
        const t = cp / (cp - cq);
        result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return Math.abs(signedArea(result));
}

/** Positive-area overlap; touching an edge alone is walkable. Handles concave polygons. */
export function overlapArea(area: Area, rect: Rect): number {
  const width = Math.min(area.x + area.width, rect.x + rect.width) - Math.max(area.x, rect.x);
  const height = Math.min(area.y + area.height, rect.y + rect.height) - Math.max(area.y, rect.y);
  if (width <= 0 || height <= 0) return 0;
  return area.polygon ? clippedArea(area.polygon, vertices(rect)) : width * height;
}

function triangles(points: Point[]): Point[][] {
  const remaining = signedArea(points) < 0 ? [...points].reverse() : [...points];
  const result: Point[][] = [];
  while (remaining.length > 3) {
    let removed = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (Math.abs(cross(a, b, c)) <= EPSILON) { remaining.splice(i, 1); removed = true; break; }
      if (cross(a, b, c) < 0 || remaining.some(p => p !== a && p !== b && p !== c &&
        cross(a, b, p) >= -EPSILON && cross(b, c, p) >= -EPSILON && cross(c, a, p) >= -EPSILON)) continue;
      result.push([a, b, c]); remaining.splice(i, 1); removed = true; break;
    }
    if (!removed) throw new Error('Unable to triangulate polygon');
  }
  result.push(remaining);
  return result;
}

export function areasOverlap(a: Area, b: Area): boolean {
  if (!b.polygon) return overlapArea(a, b) > EPSILON;
  if (!a.polygon) return overlapArea(b, a) > EPSILON;
  if (a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height) return false;
  return triangles(b.polygon).some(triangle => clippedArea(a.polygon!, triangle) > EPSILON);
}
