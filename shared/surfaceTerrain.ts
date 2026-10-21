export const SURFACE_TERRAIN_CELL_SIZE = 4;
// Physics stays on a cheap 4×4 grid; visual shoreline samples twice as densely.
export const LAKE_RENDER_CELL_SIZE = 1;

/** Lake identity. Legacy worlds use "north"/"south"; generated worlds use any id. */
export type LakeId = string;

export type LakeDefinition = {
  id: LakeId;
  seed: number;
  /** Clockwise world-space contour copied from map markup. */
  outline: readonly { x: number; y: number }[];
};

/**
 * Surface terrain is world data (saved and broadcast in surface.terrain). Shared
 * predicates read the active terrain, set once per loaded world on the server and
 * per received snapshot on clients. Worlds saved before terrain existed use
 * LEGACY_TERRAIN, so old matches continue on the map they started on.
 */
export type SurfaceTerrainData = {
  version: 1;
  seed: number;
  lakes: readonly LakeDefinition[];
  /** Rocky massifs: impassable for walkers and builders, like water. */
  mountains?: readonly MountainDefinition[];
  /** Rolling hills: walkable, only shape the ground height. */
  hills?: readonly HillDefinition[];
  /** Camp (hearth) of each colony, in colony order. Absent: legacy camps. */
  camps?: readonly { x: number; y: number }[];
  /** Quarry sites for ensureResourceDeposits. Absent: legacy site list. */
  depositSites?: readonly DepositSite[];
  /** Woodland areas filled with trees at world creation. Absent: legacy random groves. */
  forests?: readonly ForestDefinition[];
};

export type DepositSite = { id: string; kind: "clay" | "stone"; x: number; y: number };
export type ForestDefinition = { x: number; y: number; radius: number; density: number };

/** Camps of the authored map (CONFIG.surfaceEntrance / surfaceEntranceB). */
export const LEGACY_CAMPS: readonly { x: number; y: number }[] = [{ x: 120, y: 240 }, { x: 360, y: 240 }];

export type MountainDefinition = {
  id: string;
  /** Clockwise world-space footprint of the impassable rock. */
  outline: readonly { x: number; y: number }[];
  /** Peak height in world units above the meadow (visual). */
  height: number;
};

export type HillDefinition = { x: number; y: number; radius: number; height: number };

// Two deliberately authored, connected contours. Internal blue marker lines were
// hatching; only the outer blue outlines define shoreline geometry.
const LEGACY_LAKES: readonly LakeDefinition[] = [
  {
    id: "north",
    seed: 1701,
    outline: [
      { x: 180, y: 128 }, { x: 208, y: 128 }, { x: 208, y: 116 },
      { x: 220, y: 116 }, { x: 220, y: 104 }, { x: 248, y: 104 },
      { x: 248, y: 112 }, { x: 264, y: 112 }, { x: 264, y: 128 },
      { x: 284, y: 128 }, { x: 284, y: 156 },
      { x: 264, y: 156 }, { x: 264, y: 176 }, { x: 248, y: 176 },
      { x: 248, y: 160 }, { x: 232, y: 160 }, { x: 232, y: 176 },
      { x: 208, y: 176 }, { x: 208, y: 160 }, { x: 180, y: 160 }
    ]
  },
  {
    id: "south",
    seed: 2903,
    outline: [
      { x: 164, y: 348 }, { x: 200, y: 348 }, { x: 200, y: 324 },
      { x: 208, y: 324 }, { x: 208, y: 312 }, { x: 228, y: 312 },
      { x: 228, y: 336 }, { x: 244, y: 336 }, { x: 244, y: 340 },
      { x: 256, y: 340 }, { x: 256, y: 312 },
      { x: 280, y: 312 }, { x: 280, y: 336 }, { x: 300, y: 336 },
      { x: 300, y: 340 }, { x: 312, y: 340 }, { x: 312, y: 348 },
      { x: 316, y: 348 }, { x: 316, y: 364 }, { x: 312, y: 364 },
      { x: 312, y: 372 }, { x: 292, y: 372 }, { x: 292, y: 396 },
      { x: 280, y: 396 }, { x: 280, y: 408 }, { x: 268, y: 408 }, { x: 268, y: 432 },
      { x: 240, y: 432 }, { x: 240, y: 420 }, { x: 216, y: 420 },
      { x: 216, y: 408 }, { x: 184, y: 408 }, { x: 184, y: 400 },
      { x: 176, y: 400 }, { x: 176, y: 392 }, { x: 172, y: 392 },
      { x: 172, y: 380 }, { x: 164, y: 380 }
    ]
  }
];

export const LEGACY_TERRAIN: SurfaceTerrainData = { version: 1, seed: 0, lakes: LEGACY_LAKES };

type LakeBounds = { lake: LakeDefinition; minX: number; minY: number; maxX: number; maxY: number };
type MountainBounds = { mountain: MountainDefinition; minX: number; minY: number; maxX: number; maxY: number };
let activeTerrain: SurfaceTerrainData = LEGACY_TERRAIN;
let activeBounds: LakeBounds[] = boundsFor(LEGACY_TERRAIN);
let mountainBounds: MountainBounds[] = [];
let revision = 0;

function boundsFor(terrain: SurfaceTerrainData): LakeBounds[] {
  return terrain.lakes.map((lake) => ({
    lake,
    minX: Math.min(...lake.outline.map((p) => p.x)),
    minY: Math.min(...lake.outline.map((p) => p.y)),
    maxX: Math.max(...lake.outline.map((p) => p.x)),
    maxY: Math.max(...lake.outline.map((p) => p.y))
  }));
}

function mountainBoundsFor(terrain: SurfaceTerrainData): MountainBounds[] {
  return (terrain.mountains ?? []).map((mountain) => ({
    mountain,
    minX: Math.min(...mountain.outline.map((p) => p.x)),
    minY: Math.min(...mountain.outline.map((p) => p.y)),
    maxX: Math.max(...mountain.outline.map((p) => p.x)),
    maxY: Math.max(...mountain.outline.map((p) => p.y))
  }));
}

function sameOutline(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  return a.length === b.length && a.every((p, j) => p.x === b[j].x && p.y === b[j].y);
}

function sameTerrain(a: SurfaceTerrainData, b: SurfaceTerrainData): boolean {
  if (a === b) return true;
  const am = a.mountains ?? [], bm = b.mountains ?? [], ah = a.hills ?? [], bh = b.hills ?? [];
  if (a.seed !== b.seed || a.lakes.length !== b.lakes.length || am.length !== bm.length || ah.length !== bh.length) return false;
  return a.lakes.every((lake, i) => lake.id === b.lakes[i].id && sameOutline(lake.outline, b.lakes[i].outline)) &&
    am.every((m, i) => m.id === bm[i].id && m.height === bm[i].height && sameOutline(m.outline, bm[i].outline)) &&
    ah.every((h, i) => h.x === bh[i].x && h.y === bh[i].y && h.radius === bh[i].radius && h.height === bh[i].height) &&
    JSON.stringify([a.camps, a.depositSites, a.forests]) === JSON.stringify([b.camps, b.depositSites, b.forests]);
}

/** Installs the terrain of the world being simulated or displayed. Missing terrain means the legacy map. */
export function setSurfaceTerrain(terrain: SurfaceTerrainData | undefined | null): void {
  const next = terrain && Array.isArray(terrain.lakes) ? terrain : LEGACY_TERRAIN;
  if (sameTerrain(next, activeTerrain)) return;
  activeTerrain = next;
  activeBounds = boundsFor(next);
  mountainBounds = mountainBoundsFor(next);
  revision += 1;
}

export function getSurfaceTerrain(): SurfaceTerrainData {
  return activeTerrain;
}

/** Bumps whenever the active terrain changes; derived caches compare against it. */
export function surfaceTerrainRevision(): number {
  return revision;
}

/** Hearth positions of the active world, colony order. */
export function campPositions(): readonly { x: number; y: number }[] {
  return activeTerrain.camps?.length ? activeTerrain.camps : LEGACY_CAMPS;
}

export function nearestCamp(p: { x: number; y: number }): { x: number; y: number } {
  let best = campPositions()[0];
  for (const camp of campPositions()) if (Math.hypot(camp.x - p.x, camp.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = camp;
  return best;
}

export function lakeDefinitions(): readonly LakeDefinition[] {
  return activeTerrain.lakes;
}

export function lakeDefinition(id: LakeId): LakeDefinition | undefined {
  return activeTerrain.lakes.find((lake) => lake.id === id);
}

function isInsidePolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq <= 0.0001 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

/** Positive is water. Zero is shoreline. Values are stable on server and client. */
export function lakeFieldAt(x: number, y: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  let signed = -Number.POSITIVE_INFINITY;
  for (const lake of activeTerrain.lakes) {
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < lake.outline.length; i += 1) {
      distance = Math.min(distance, distanceToSegment(x, y, lake.outline[i], lake.outline[(i + 1) % lake.outline.length]));
    }
    const inside = isInsidePolygon(x, y, lake.outline);
    const field = (inside ? distance : -distance) / 18;
    if (Math.abs(field) < nearest) {
      nearest = Math.abs(field);
      signed = field;
    }
  }
  return signed;
}

export function isWaterAt(x: number, y: number): boolean {
  // Water membership only needs the polygon test. Calling lakeFieldAt here used
  // to recompute the distance to every shoreline segment for every actor tick.
  return lakeIdAt(x, y) !== null;
}

/** Stable authored-lake identity used by fishing, rendering and future map generation. */
export function lakeIdAt(x: number, y: number): LakeId | null {
  for (const b of activeBounds) {
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    if (isInsidePolygon(x, y, b.lake.outline)) {
      return b.lake.id;
    }
  }
  return null;
}

export function mountainIdAt(x: number, y: number): string | null {
  for (const b of mountainBounds) {
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    if (isInsidePolygon(x, y, b.mountain.outline)) return b.mountain.id;
  }
  return null;
}

export function isMountainAt(x: number, y: number): boolean {
  return mountainIdAt(x, y) !== null;
}

/** Ground nobody can walk or build on: water and rock massifs. Use isWaterAt for water-only rules. */
export function isTerrainBlockedAt(x: number, y: number): boolean {
  return lakeIdAt(x, y) !== null || mountainIdAt(x, y) !== null;
}

/** Distance from (x, y) to a polygon outline (unsigned). */
function outlineDistance(x: number, y: number, outline: readonly { x: number; y: number }[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < outline.length; i += 1) distance = Math.min(distance, distanceToSegment(x, y, outline[i], outline[(i + 1) % outline.length]));
  return distance;
}

export const MOUNTAIN_FOOT = 5;

/**
 * Visual ground height in world units. Hills are smooth bumps; mountains rise
 * from a short foot slope outside their outline to their peak inside. Gameplay
 * never reads it (hills are walkable, mountains are blocked by isMountainAt).
 * Clients port this formula (godot/scripts/world/surface_terrain.gd).
 */
export function heightAt(x: number, y: number): number {
  let h = 0;
  for (const hill of activeTerrain.hills ?? []) {
    const d2 = ((x - hill.x) ** 2 + (y - hill.y) ** 2) / (hill.radius * hill.radius);
    if (d2 < 1) h += hill.height * (1 - d2) * (1 - d2);
  }
  for (const b of mountainBounds) {
    if (x < b.minX - MOUNTAIN_FOOT || x > b.maxX + MOUNTAIN_FOOT || y < b.minY - MOUNTAIN_FOOT || y > b.maxY + MOUNTAIN_FOOT) continue;
    const d = outlineDistance(x, y, b.mountain.outline);
    const inside = isInsidePolygon(x, y, b.mountain.outline);
    const t = inside ? Math.min(1, 0.25 + d / 10) : Math.max(0, 0.25 * (1 - d / MOUNTAIN_FOOT));
    h = Math.max(h, b.mountain.height * t * t * (3 - 2 * t));
  }
  return h;
}

export function isDeepWaterAt(x: number, y: number): boolean {
  return lakeFieldAt(x, y) > 0.43;
}

export function isLakeShoreAt(x: number, y: number): boolean {
  const field = lakeFieldAt(x, y);
  return field >= -0.2 && field <= 0.24;
}

export function terrainCellIndexAt(x: number, y: number, width: number): number {
  const cellsWide = Math.ceil(width / SURFACE_TERRAIN_CELL_SIZE);
  return Math.floor(y / SURFACE_TERRAIN_CELL_SIZE) * cellsWide + Math.floor(x / SURFACE_TERRAIN_CELL_SIZE);
}

export function buildWaterGrid(width: number, height: number): Uint8Array {
  const cellsWide = Math.ceil(width / SURFACE_TERRAIN_CELL_SIZE);
  const cellsHigh = Math.ceil(height / SURFACE_TERRAIN_CELL_SIZE);
  const grid = new Uint8Array(cellsWide * cellsHigh);
  for (let y = 0; y < cellsHigh; y += 1) {
    for (let x = 0; x < cellsWide; x += 1) {
      const worldX = (x + 0.5) * SURFACE_TERRAIN_CELL_SIZE;
      const worldY = (y + 0.5) * SURFACE_TERRAIN_CELL_SIZE;
      if (isWaterAt(worldX, worldY)) {
        grid[y * cellsWide + x] = 1;
      }
    }
  }
  return grid;
}

export function isWaterGridCell(grid: Uint8Array, width: number, x: number, y: number): boolean {
  const cellsWide = Math.ceil(width / SURFACE_TERRAIN_CELL_SIZE);
  const cellX = Math.floor(x / SURFACE_TERRAIN_CELL_SIZE);
  const cellY = Math.floor(y / SURFACE_TERRAIN_CELL_SIZE);
  if (cellX < 0 || cellY < 0 || cellX >= cellsWide) {
    return false;
  }
  return grid[cellY * cellsWide + cellX] === 1;
}
