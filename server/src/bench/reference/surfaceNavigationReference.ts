// Reference copy of shared/surfaceNavigation.ts before the obstacle index
// (21.10.2026): full scans of every building per check. navParityCheck.ts
// compares the indexed version against it answer by answer.
import { WALL_CELL_SIZE, type Building, type Vec2 } from "../../../../shared/types";
import { buildingFootprint, crossesBuilding, insideBuilding, outsideBuilding } from "../../../../shared/buildingGeometry";
import { crossesHearth, insideHearth } from "../../../../shared/campGeometry";
import { isWaterAt, isTerrainBlockedAt } from "../../../../shared/surfaceTerrain";
import { fenceContains } from "../../../../shared/fenceGeometry";
import { surfaceGridLineOpen } from "../../../../shared/surfaceGrid";

export type SurfaceObstacles = { width: number; height: number; buildings: Building[]; entrances: Vec2[] };
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function surfacePointOpen(surface: SurfaceObstacles, p: Vec2, owner?: string): boolean {
  if (p.x < 1 || p.y < 1 || p.x >= surface.width - 1 || p.y >= surface.height - 1 || isTerrainBlockedAt(p.x, p.y)) return false;
  if (surface.entrances.some(c => insideHearth(p.x, p.y, c))) return false;
  return !surface.buildings.some(b => {
    const f = buildingFootprint(b);
    if (f) return insideBuilding(p.x, p.y, f);
    return b.stage === "built" && (b.type === "wall" || b.type === "gate" && b.colonyId !== owner) && fenceContains(b, p);
  });
}

export function surfaceLineOpen(surface: SurfaceObstacles, a: Vec2, b: Vec2, owner?: string): boolean {
  if (!surfacePointOpen(surface, b, owner)) return false;
  if (surface.entrances.some(c => crossesHearth(a.x, a.y, b.x, b.y, c))) return false;
  if (surface.buildings.some(building => { const f = buildingFootprint(building); return f && crossesBuilding(a, b, f); })) return false;
  const fences = surface.buildings.filter(b => b.stage === "built" && (b.type === "wall" || b.type === "gate" && b.colonyId !== owner));
  return surfaceGridLineOpen(a, b, (x, y) => !isTerrainBlockedAt(x, y) && !fences.some(b => fenceContains(b, { x, y })));
}

/** A shared route for simulation and packet interpolation. Failed routes stop,
 * rather than reverting to a straight line through an obstacle. */
export function surfaceRoute(surface: SurfaceObstacles, from: Vec2, target: Vec2, owner?: string): Vec2[] | null {
  let goal = target;
  for (const b of surface.buildings) { const f = buildingFootprint(b); if (f && insideBuilding(goal.x, goal.y, f)) goal = outsideBuilding(goal, f); }
  if (!surfacePointOpen(surface, goal, owner)) {
    let best: Vec2 | undefined;
    for (let r = 1; r <= 12 && !best; r++) for (let i = 0; i < 24; i++) {
      const p = { x: target.x + Math.cos(i * Math.PI / 12) * r, y: target.y + Math.sin(i * Math.PI / 12) * r };
      if (surfacePointOpen(surface, p, owner)) { best = p; break; }
    }
    if (!best) return null; goal = best;
  }
  if (surfaceLineOpen(surface, from, goal, owner)) return [{ ...goal }];
  const step = WALL_CELL_SIZE, width = Math.ceil(surface.width / step), height = Math.ceil(surface.height / step), count = width * height;
  const point = (id: number): Vec2 => ({ x: (id % width + 0.5) * step, y: (Math.floor(id / width) + 0.5) * step });
  const nearby = (p: Vec2, connectFrom: boolean) => {
    const candidates: number[] = [], cx = Math.floor(p.x / step), cy = Math.floor(p.y / step);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const id = y * width + x, q = point(id);
      if (surfacePointOpen(surface, q, owner) && surfaceLineOpen(surface, connectFrom ? p : q, connectFrom ? q : p, owner)) candidates.push(id);
    }
    return candidates.sort((a, b) => distance(point(a), p) - distance(point(b), p));
  };
  const starts = nearby(from, true), ends = nearby(goal, false); if (!starts.length || !ends.length) return null;
  const endSet = new Set(ends), prev = new Int32Array(count).fill(-1), cost = new Float64Array(count).fill(Infinity);
  const heap: Array<{ id: number; score: number }> = [];
  const push = (id: number, score: number) => { let i = heap.length; heap.push({ id, score }); while (i > 0) { const p = (i - 1) >> 1; if (heap[p].score <= score) break; heap[i] = heap[p]; i = p; } heap[i] = { id, score }; };
  const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++; if (last.score <= heap[child].score) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first.id; };
  for (const id of starts) { cost[id] = distance(from, point(id)); prev[id] = -2; push(id, cost[id] + distance(point(id), goal)); }
  const visited = new Uint8Array(count); let found = -1;
  while (heap.length) {
    const id = pop(); if (visited[id]) continue; visited[id] = 1;
    if (endSet.has(id)) { found = id; break; }
    const p = point(id), x = id % width, y = Math.floor(id / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx; if (visited[next]) continue;
      const q = point(next), nextCost = cost[id] + distance(p, q);
      if (nextCost >= cost[next] || !surfaceLineOpen(surface, p, q, owner)) continue;
      cost[next] = nextCost; prev[next] = id; push(next, nextCost + distance(q, goal));
    }
  }
  if (found < 0) return null;
  const raw = [{ ...goal }]; for (let i = found; i >= 0; i = prev[i]) raw.push(point(i)); raw.reverse();
  const result: Vec2[] = []; let last = from;
  for (let i = 0; i < raw.length;) { let far = raw.length - 1; while (far > i && !surfaceLineOpen(surface, last, raw[far], owner)) far--; result.push(raw[far]); last = raw[far]; i = far + 1; }
  return result;
}

/** Distance along safe segments, never a straight chord through the obstacle. */
export function routePoint(from: Vec2, points: Vec2[], ratio: number): Vec2 {
  let total = 0, p = from; for (const q of points) { total += distance(p, q); p = q; }
  let left = total * Math.max(0, Math.min(1, ratio)); p = from;
  for (const q of points) { const d = distance(p, q); if (left <= d) { const t = d ? left / d : 0; return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; } left -= d; p = q; }
  return { ...p };
}
