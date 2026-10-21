import { lakeDefinition, lakeIdAt, surfaceTerrainRevision, type LakeId } from "./surfaceTerrain";
import type { Vec2 } from "./types";
const grids = new Map<LakeId, Vec2[]>();
let gridsRevision = -1;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export function lakePoints(id: LakeId): Vec2[] {
  if (gridsRevision !== surfaceTerrainRevision()) { grids.clear(); gridsRevision = surfaceTerrainRevision(); }
  let points = grids.get(id); if (points) return points;
  const lake = lakeDefinition(id); points = [];
  if (!lake) return points;
  for (let y = Math.min(...lake.outline.map(p => p.y)) + 2; y < Math.max(...lake.outline.map(p => p.y)); y += 4)
    for (let x = Math.min(...lake.outline.map(p => p.x)) + 2; x < Math.max(...lake.outline.map(p => p.x)); x += 4) if (lakeIdAt(x, y) === id) points.push({ x, y });
  grids.set(id, points); return points;
}
export function lakeLineOpen(a: Vec2, b: Vec2, id: LakeId): boolean {
  const n = Math.max(1, Math.ceil(distance(a, b) / 0.6));
  for (let i = 0; i <= n; i++) if (lakeIdAt(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n) !== id) return false;
  return true;
}
export function lakeRoute(id: LakeId, from: Vec2, to: Vec2): Vec2[] | null {
  if (lakeLineOpen(from, to, id)) return [{ ...to }];
  const points = lakePoints(id), nearest = (p: Vec2) => points.reduce((best, q, i) => distance(q, p) < distance(points[best], p) ? i : best, 0);
  const start = nearest(from), end = nearest(to);
  if (!lakeLineOpen(from, points[start], id) || !lakeLineOpen(points[end], to, id)) return null;
  const indices = new Map(points.map((p, i) => [`${p.x},${p.y}`, i])), prev = new Map<number, number>([[start, -1]]), queue = [start];
  for (let head = 0; head < queue.length && !prev.has(end); head++) {
    const current = queue[head], p = points[current];
    for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const i = indices.get(`${p.x + dx},${p.y + dy}`); if (i === undefined || prev.has(i) || !lakeLineOpen(p, points[i], id)) continue;
      prev.set(i, current); queue.push(i);
    }
  }
  if (!prev.has(end)) return null;
  const raw = [{ ...to }]; for (let i = end; i >= 0; i = prev.get(i)!) raw.push(points[i]); raw.reverse();
  const result: Vec2[] = []; let p = from;
  for (let i = 0; i < raw.length;) { let far = raw.length - 1; while (far > i && !lakeLineOpen(p, raw[far], id)) far--; result.push(raw[far]); p = raw[far]; i = far + 1; }
  return result;
}
