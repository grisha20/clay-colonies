import type { DepositSite, ForestDefinition, HillDefinition, LakeDefinition, MountainDefinition, SurfaceTerrainData } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { LEGACY_CAMPS } from "../../../shared/surfaceTerrain";

// Random world layout for a new match. Everything is derived from one seed so
// a world can be regenerated, compared and debugged. The layout is data
// (surface.terrain): the simulation and both clients only read it.
//
// Rules of a fair, readable map:
// - the two tribes start in opposite corners;
// - lakes are organic ponds, mountains are impassable rocky ridges, hills are
//   walkable bumps; none of them touch a camp;
// - each camp has a clay and a stone quarry at the same walking distance;
// - both camps can reach each other, every quarry and every forest on foot.

type P = { x: number; y: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = CONFIG.mapWidth;
const H = CONFIG.mapHeight;
const round1 = (v: number) => Math.round(v * 10) / 10;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function insidePolygon(p: P, outline: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[i], b = outline[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Wobbly closed outline around a centre: an ellipse with a few harmonics. */
function blob(rand: () => number, c: P, rx: number, ry: number, angle: number, points: number, wobble: number): P[] {
  const k1 = 2 + Math.floor(rand() * 2), k2 = 4 + Math.floor(rand() * 3);
  const p1 = rand() * Math.PI * 2, p2 = rand() * Math.PI * 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const out: P[] = [];
  for (let i = 0; i < points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    const r = 1 + wobble * (0.65 * Math.sin(k1 * a + p1) + 0.35 * Math.sin(k2 * a + p2));
    const lx = Math.cos(a) * rx * r, ly = Math.sin(a) * ry * r;
    out.push({ x: round1(c.x + lx * cos - ly * sin), y: round1(c.y + lx * sin + ly * cos) });
  }
  return out;
}

function radiusOf(outline: readonly P[], c: P): number {
  return Math.max(...outline.map((p) => dist(p, c)));
}

type Blocker = { c: P; r: number; outline: P[] };

export type GeneratedLayout = { terrain: SurfaceTerrainData; attempts: number };

export function generateTerrain(seed: number): GeneratedLayout {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const terrain = tryGenerate(seed, attempt);
    if (terrain) return { terrain: { ...terrain, springs: springSites(terrain, seed) }, attempts: attempt + 1 };
  }
  throw new Error(`terrain generation failed for seed ${seed}`);
}

function tryGenerate(seed: number, attempt: number): SurfaceTerrainData | null {
  const rand = mulberry32((seed ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
  const range = (a: number, b: number) => a + rand() * (b - a);

  // 1. Camps in opposite corners (which diagonal is random).
  const inset = () => range(78, 98);
  const diagonal = rand() < 0.5;
  const a: P = { x: round1(inset()), y: round1(diagonal ? inset() : H - inset()) };
  const b: P = { x: round1(W - inset()), y: round1(diagonal ? H - inset() : inset()) };
  const camps = rand() < 0.5 ? [a, b] : [b, a];

  const blockers: Blocker[] = [];
  const clearOf = (c: P, r: number, gap: number) =>
    blockers.every((o) => dist(o.c, c) > o.r + r + gap) && camps.every((camp) => dist(camp, c) > r + 48) &&
    c.x - r > 14 && c.y - r > 14 && c.x + r < W - 14 && c.y + r < H - 14;

  // 2. Mountain ridges: 3–4 long rocky massifs.
  const mountains: MountainDefinition[] = [];
  const mountainCount = 3 + Math.floor(rand() * 2);
  for (let i = 0, tries = 0; i < mountainCount && tries < 200; tries += 1) {
    const c = { x: range(40, W - 40), y: range(40, H - 40) };
    const length = range(30, 56), width = range(10, 17);
    const outline = blob(rand, c, length, width, rand() * Math.PI, 26, 0.22);
    const r = radiusOf(outline, c);
    if (!clearOf(c, r, 20)) continue;
    mountains.push({ id: `mountain-${i + 1}`, outline, height: round1(range(9, 15)) });
    blockers.push({ c, r, outline });
    i += 1;
  }

  // 3. Lakes: 2–4 organic ponds.
  const lakes: LakeDefinition[] = [];
  const lakeCount = 2 + Math.floor(rand() * 3);
  for (let i = 0, tries = 0; i < lakeCount && tries < 200; tries += 1) {
    const c = { x: range(40, W - 40), y: range(40, H - 40) };
    const rx = range(16, 34), ry = rx * range(0.6, 0.95);
    const outline = blob(rand, c, rx, ry, rand() * Math.PI, 32, 0.16);
    const r = radiusOf(outline, c);
    if (!clearOf(c, r, 18)) continue;
    lakes.push({ id: `lake-${i + 1}`, seed: Math.floor(rand() * 100000), outline });
    blockers.push({ c, r, outline });
    i += 1;
  }
  if (lakes.length < 2 || mountains.length < 2) return null;

  // 4. Quarries: each camp gets clay and stone at the same distance, plus
  // contested sites in the middle and remote rich ones.
  const depositSites: DepositSite[] = [];
  const siteFree = (p: P) =>
    p.x > 22 && p.y > 22 && p.x < W - 22 && p.y < H - 22 &&
    blockers.every((o) => dist(o.c, p) > o.r + 16) && camps.every((c) => dist(c, p) > 32) &&
    depositSites.every((d) => dist(d, p) > 30);
  const towardCentre = (c: P) => Math.atan2(H / 2 - c.y, W / 2 - c.x);
  const spread = range(0.7, 1.0);
  const distanceFromCamp = range(40, 48);
  for (const [index, camp] of camps.entries()) {
    const base = towardCentre(camp);
    for (const [kind, side] of [["clay", -1], ["stone", 1]] as const) {
      let placed = false;
      for (let k = 0; k < 24 && !placed; k += 1) {
        const ang = base + side * spread + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.12;
        const p = { x: round1(camp.x + Math.cos(ang) * distanceFromCamp), y: round1(camp.y + Math.sin(ang) * distanceFromCamp) };
        if (siteFree(p)) { depositSites.push({ id: `${kind}-${index === 0 ? "a" : "b"}`, kind, x: p.x, y: p.y }); placed = true; }
      }
      if (!placed) return null;
    }
  }
  const extra: Array<[string, "clay" | "stone"]> = [["clay-central", "clay"], ["stone-central", "stone"], ["stone-remote", "stone"], ["clay-remote", "clay"]];
  for (const [id, kind] of extra) {
    for (let k = 0; k < 120; k += 1) {
      const central = id.endsWith("central");
      const p = central
        ? { x: round1(W / 2 + range(-70, 70)), y: round1(H / 2 + range(-70, 70)) }
        : { x: round1(range(30, W - 30)), y: round1(range(30, H - 30)) };
      if (!central && camps.some((c) => dist(c, p) < 120)) continue;
      if (siteFree(p)) { depositSites.push({ id, kind, x: p.x, y: p.y }); break; }
    }
  }

  // 5. Forests: big woods plus groves; camps keep an open clearing.
  const forests: ForestDefinition[] = [];
  const forestFree = (c: P, r: number) => camps.every((camp) => dist(camp, c) > r + 22) && blockers.every((o) => !insidePolygon(c, o.outline) && dist(o.c, c) > o.r * 0.5) &&
    depositSites.every((d) => dist(d, c) > r * 0.6 + 14);
  for (let i = 0, tries = 0; i < 7 && tries < 400; tries += 1) {
    const c = { x: range(30, W - 30), y: range(30, H - 30) }, r = range(26, 46);
    if (!forestFree(c, r) || forests.some((f) => dist(f, c) < f.radius + r * 0.6)) continue;
    forests.push({ x: round1(c.x), y: round1(c.y), radius: round1(r), density: 0.007 });
    i += 1;
  }
  for (let i = 0, tries = 0; i < 12 && tries < 400; tries += 1) {
    const c = { x: range(20, W - 20), y: range(20, H - 20) }, r = range(8, 15);
    if (!forestFree(c, r)) continue;
    forests.push({ x: round1(c.x), y: round1(c.y), radius: round1(r), density: 0.022 });
    i += 1;
  }

  // 6. Hills: walkable swells, kept off camps and away from water.
  const hills: HillDefinition[] = [];
  for (let i = 0, tries = 0; i < 9 && tries < 300; tries += 1) {
    const c = { x: range(20, W - 20), y: range(20, H - 20) }, r = range(28, 60);
    if (camps.some((camp) => dist(camp, c) < r + 18)) continue;
    if (lakes.some((l) => { const lc = l.outline.reduce((s, p) => ({ x: s.x + p.x / l.outline.length, y: s.y + p.y / l.outline.length }), { x: 0, y: 0 }); return dist(lc, c) < radiusOf(l.outline, lc) + r + 6; })) continue;
    if (depositSites.some((d) => dist(d, c) < r * 0.7)) continue;
    hills.push({ x: round1(c.x), y: round1(c.y), radius: round1(r), height: round1(range(2, 5.5)) });
    i += 1;
  }

  const terrain: SurfaceTerrainData = { version: 1, seed, lakes, mountains, hills, camps, depositSites, forests };
  return reachable(terrain) ? terrain : null;
}

/**
 * Sources of special clay, placed after the map is accepted with their own
 * random stream (the map itself does not change): a "home" pair — one 85-115
 * from each camp, mirrored through the map centre so neither tribe is luckier,
 * reachable with one or two totems — and a contested one near the centre.
 * Clear of water, rock and quarries, on the walkable region.
 */
export function springSites(terrain: SurfaceTerrainData, seed: number): { x: number; y: number }[] {
  const rand = mulberry32((seed ^ 0x5eed5) >>> 0);
  const camps = terrain.camps ?? LEGACY_CAMPS;
  const outlines = [...terrain.lakes.map((l) => l.outline), ...(terrain.mountains ?? []).map((m) => m.outline)];
  const walk = walkableFrom(terrain, camps[0]);
  const ok = (p: P, taken: P[]) =>
    p.x > 30 && p.y > 30 && p.x < W - 30 && p.y < H - 30 && walk.reach(p) &&
    Array.from({ length: 8 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 4) * 8, y: p.y + Math.sin(i * Math.PI / 4) * 8 })).every((q) => outlines.every((o) => !insidePolygon(q, o))) &&
    !outlines.some((o) => insidePolygon(p, o)) &&
    camps.every((c) => dist(c, p) > 80) &&
    (terrain.depositSites ?? []).every((d) => dist(d, p) > 20) &&
    taken.every((t) => dist(t, p) > 60);
  const out: P[] = [];
  const [a, b] = camps;
  const home = (p: P, c: P) => dist(p, c) >= 85 && dist(p, c) <= 115;
  for (let k = 0; k < 600 && out.length < 2; k += 1) {
    const ang = Math.atan2(H / 2 - a.y, W / 2 - a.x) + (rand() - 0.5) * 2.2, r = 85 + rand() * 30;
    const p = { x: round1(a.x + Math.cos(ang) * r), y: round1(a.y + Math.sin(ang) * r) };
    const q = { x: round1(W - p.x), y: round1(H - p.y) };
    if (b && !home(q, b)) continue;
    if (ok(p, out) && ok(q, [...out, p])) out.push(p, q);
  }
  for (let k = 0; k < 300 && out.length < 3; k += 1) {
    const p = { x: round1(W / 2 + (rand() - 0.5) * 120), y: round1(H / 2 + (rand() - 0.5) * 120) };
    if (ok(p, out)) out.push(p);
  }
  return out;
}

function walkableFrom(terrain: SurfaceTerrainData, from: P): { reach: (p: P) => boolean } {
  const cell = 4, cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
  const blocked = new Uint8Array(cw * ch);
  const outlines = [...terrain.lakes.map((l) => l.outline), ...(terrain.mountains ?? []).map((m) => m.outline)];
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) {
    const p = { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
    if (p.x < 2 || p.y < 2 || p.x > W - 2 || p.y > H - 2 || outlines.some((o) => insidePolygon(p, o))) blocked[y * cw + x] = 1;
  }
  const idx = (p: P) => Math.floor(p.y / cell) * cw + Math.floor(p.x / cell);
  const seen = new Uint8Array(cw * ch);
  const start = idx(from);
  if (!blocked[start]) {
    seen[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head], x = i % cw, y = Math.floor(i / cw);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx;
        if (!seen[n] && !blocked[n]) { seen[n] = 1; queue.push(n); }
      }
    }
  }
  return { reach: (p: P) => seen[idx(p)] === 1 };
}

/** Flood fill on a 4-unit grid: camps, quarries and forests must share one walkable region. */
function reachable(terrain: SurfaceTerrainData): boolean {
  const cell = 4, cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
  const blocked = new Uint8Array(cw * ch);
  const outlines = [...terrain.lakes.map((l) => l.outline), ...(terrain.mountains ?? []).map((m) => m.outline)];
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) {
    const p = { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
    if (p.x < 2 || p.y < 2 || p.x > W - 2 || p.y > H - 2 || outlines.some((o) => insidePolygon(p, o))) blocked[y * cw + x] = 1;
  }
  const idx = (p: P) => Math.floor(p.y / cell) * cw + Math.floor(p.x / cell);
  const start = idx(terrain.camps![0]);
  if (blocked[start]) return false;
  const seen = new Uint8Array(cw * ch); seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head], x = i % cw, y = Math.floor(i / cw);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const n = ny * cw + nx;
      if (!seen[n] && !blocked[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  const targets: P[] = [...terrain.camps!, ...(terrain.depositSites ?? []), ...(terrain.forests ?? [])];
  return targets.every((t) => seen[idx(t)] === 1);
}
