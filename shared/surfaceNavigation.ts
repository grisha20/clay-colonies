import { WALL_CELL_SIZE, type Building, type Vec2 } from "./types";
import { buildingFootprint, crossesBuilding, insideBuilding, outsideBuilding, type BuildingFootprint } from "./buildingGeometry";
import { crossesHearth, insideHearth } from "./campGeometry";
import { isTerrainBlockedAt, surfaceTerrainRevision } from "./surfaceTerrain";
import { surfaceGridLineOpen } from "./surfaceGrid";
import { GATE_SPAN } from "./fenceGeometry";

export type SurfaceObstacles = { width: number; height: number; buildings: Building[]; entrances: Vec2[] };
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Obstacle index of a buildings array: footprints bucketed by 8-unit cells and
 * the fence cells of built walls and gates. Route checks used to scan every
 * building (and rebuild the fence list) per segment, which made late matches
 * step at 15-25 ms. Answers are exactly those of the full scans
 * (fenceContains == membership of the fence cell; a footprint can only hit a
 * point or segment whose box overlaps its own). Rebuilt when a cheap numeric
 * signature of the array changes (stage, type, position, owner, gate shape).
 */
type ObstacleIndex = {
  sig: number;
  epoch: number;
  len: number;
  foot: BuildingFootprint[];
  buckets: Map<number, number[]>;
  walls: Set<number>;
  gates: Map<number, string[]>;
};
const BUCKET = 8;
const FENCE_KEY = 4096;
const indexCache = new WeakMap<Building[], ObstacleIndex>();
/** Rebuild counters for perf benches (rebuilds = new arrays or changed obstacles). */
export const obstacleIndexStats = { builds: 0, changed: 0 };
const TYPE_CODE: Record<string, number> = { hut: 1, storage: 2, workshop: 3, idol: 4, wall: 5, gate: 6 };

/** Numeric signature of the built obstacles (the only buildings that block):
 * cheap cache key for routes, regions and this index. */
export function builtObstacleSignature(buildings: Building[]): number {
  let h = 0;
  for (const b of buildings) {
    if (b.stage !== "built") continue;
    h = (Math.imul(h, 31) + 1) | 0;
    h = (Math.imul(h, 31) + (TYPE_CODE[b.type] ?? 7)) | 0;
    h = (Math.imul(h, 31) + Math.round(b.pos.x * 1024)) | 0;
    h = (Math.imul(h, 31) + Math.round(b.pos.y * 1024)) | 0;
    h = (Math.imul(h, 31) + (b.gateAxis === "vertical" ? 1 : 0) + (b.gateSpan ?? 1) * 2) | 0;
    const id = b.colonyId ?? "";
    h = (Math.imul(h, 31) + id.length * 977 + (id.length ? id.charCodeAt(id.length - 1) : 0)) | 0;
  }
  return h;
}

const bucketKey = (bx: number, by: number) => (by + 16) * 1024 + (bx + 16);
const fenceKey = (cx: number, cy: number) => (cy + 1) * FENCE_KEY + (cx + 1);

/**
 * Buildings change in place only when a site is completed (stage -> "built");
 * removals, gate swaps and loads make a new array. The simulation calls
 * markObstaclesChanged() on completion, so the O(n) signature is recomputed
 * only after that or when the array length changes, not on every check.
 */
let obstacleEpoch = 0;
export function markObstaclesChanged(): void { obstacleEpoch += 1; }

/** Numeric key of the built obstacles of this array (for route and region caches). */
export function builtObstacleKey(buildings: Building[]): number { return obstacleIndex(buildings).sig; }

function obstacleIndex(buildings: Building[]): ObstacleIndex {
  const cached = indexCache.get(buildings);
  if (cached && cached.epoch === obstacleEpoch && cached.len === buildings.length) return cached;
  const sig = builtObstacleSignature(buildings);
  if (cached && cached.sig === sig) { cached.epoch = obstacleEpoch; cached.len = buildings.length; return cached; }
  obstacleIndexStats.builds += 1;
  if (cached) obstacleIndexStats.changed += 1;
  const index: ObstacleIndex = { sig, epoch: obstacleEpoch, len: buildings.length, foot: [], buckets: new Map(), walls: new Set(), gates: new Map() };
  for (const b of buildings) {
    const f = buildingFootprint(b);
    if (f) {
      const fi = index.foot.length;
      index.foot.push(f);
      for (let by = Math.floor((f.y - f.ry) / BUCKET); by <= Math.floor((f.y + f.ry) / BUCKET); by++)
        for (let bx = Math.floor((f.x - f.rx) / BUCKET); bx <= Math.floor((f.x + f.rx) / BUCKET); bx++) {
          const key = bucketKey(bx, by);
          const list = index.buckets.get(key);
          if (list) list.push(fi); else index.buckets.set(key, [fi]);
        }
      continue;
    }
    if (b.stage !== "built" || (b.type !== "wall" && b.type !== "gate")) continue;
    const cx = Math.floor(b.pos.x / WALL_CELL_SIZE), cy = Math.floor(b.pos.y / WALL_CELL_SIZE);
    const span = b.type === "gate" && b.gateSpan === GATE_SPAN ? 1 : 0;
    for (let k = -span; k <= span; k++) {
      const key = b.gateAxis === "vertical" ? fenceKey(cx, cy + k) : fenceKey(cx + k, cy);
      if (b.type === "wall") index.walls.add(key);
      else { const list = index.gates.get(key); if (list) list.push(b.colonyId); else index.gates.set(key, [b.colonyId]); }
    }
  }
  indexCache.set(buildings, index);
  return index;
}

function fenceBlocks(index: ObstacleIndex, x: number, y: number, owner?: string): boolean {
  const key = fenceKey(Math.floor(x / WALL_CELL_SIZE), Math.floor(y / WALL_CELL_SIZE));
  if (index.walls.has(key)) return true;
  const gates = index.gates.get(key);
  return !!gates && gates.some(colony => colony !== owner);
}

function footprintsNear(index: ObstacleIndex, x0: number, y0: number, x1: number, y1: number, visit: (f: BuildingFootprint) => boolean): boolean {
  const bx0 = Math.floor(Math.min(x0, x1) / BUCKET), bx1 = Math.floor(Math.max(x0, x1) / BUCKET);
  const by0 = Math.floor(Math.min(y0, y1) / BUCKET), by1 = Math.floor(Math.max(y0, y1) / BUCKET);
  if ((bx1 - bx0 + 1) * (by1 - by0 + 1) > 48) return index.foot.some(visit);
  if (bx0 === bx1 && by0 === by1) return (index.buckets.get(bucketKey(bx0, by0)) ?? []).some(fi => visit(index.foot[fi]));
  const seen = new Set<number>();
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    for (const fi of index.buckets.get(bucketKey(bx, by)) ?? []) {
      if (seen.has(fi)) continue;
      seen.add(fi);
      if (visit(index.foot[fi])) return true;
    }
  }
  return false;
}

/** Terrain answer at wall-cell centres, cached per terrain revision. */
let cellTerrainRevision = -1;
let cellTerrain = new Uint8Array(0);
const CELL_GRID = 512;
function cellTerrainBlocked(x: number, y: number): boolean {
  const cx = Math.floor(x / WALL_CELL_SIZE), cy = Math.floor(y / WALL_CELL_SIZE);
  if (cx < 0 || cy < 0 || cx >= CELL_GRID || cy >= CELL_GRID) return isTerrainBlockedAt(x, y);
  const revision = surfaceTerrainRevision();
  if (revision !== cellTerrainRevision) { cellTerrainRevision = revision; cellTerrain = new Uint8Array(CELL_GRID * CELL_GRID); }
  const id = cy * CELL_GRID + cx;
  let v = cellTerrain[id];
  if (!v) { v = isTerrainBlockedAt(x, y) ? 2 : 1; cellTerrain[id] = v; }
  return v === 2;
}

export function surfacePointOpen(surface: SurfaceObstacles, p: Vec2, owner?: string): boolean {
  if (p.x < 1 || p.y < 1 || p.x >= surface.width - 1 || p.y >= surface.height - 1 || isTerrainBlockedAt(p.x, p.y)) return false;
  if (surface.entrances.some(c => insideHearth(p.x, p.y, c))) return false;
  const index = obstacleIndex(surface.buildings);
  if (footprintsNear(index, p.x, p.y, p.x, p.y, f => insideBuilding(p.x, p.y, f))) return false;
  return !fenceBlocks(index, p.x, p.y, owner);
}

export function surfaceLineOpen(surface: SurfaceObstacles, a: Vec2, b: Vec2, owner?: string): boolean {
  if (!surfacePointOpen(surface, b, owner)) return false;
  if (surface.entrances.some(c => crossesHearth(a.x, a.y, b.x, b.y, c))) return false;
  const index = obstacleIndex(surface.buildings);
  if (footprintsNear(index, a.x, a.y, b.x, b.y, f => crossesBuilding(a, b, f))) return false;
  return surfaceGridLineOpen(a, b, (x, y) => !cellTerrainBlocked(x, y) && !fenceBlocks(index, x, y, owner));
}

/** A* gives up after this many cells: an unreachable target used to flood the whole map (~500 ms steps). */
const ROUTE_MAX_EXPANSIONS = 6000;

/** A shared route for simulation and packet interpolation. Failed routes stop,
 * rather than reverting to a straight line through an obstacle. */
export function surfaceRoute(surface: SurfaceObstacles, from: Vec2, target: Vec2, owner?: string): Vec2[] | null {
  let goal = target;
  for (const f of obstacleIndex(surface.buildings).foot) if (insideBuilding(goal.x, goal.y, f)) goal = outsideBuilding(goal, f);
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
  const visited = new Uint8Array(count); let found = -1, expansions = 0;
  while (heap.length) {
    const id = pop(); if (visited[id]) continue; visited[id] = 1;
    if (++expansions > ROUTE_MAX_EXPANSIONS) return null;
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
