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
};

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
let activeTerrain: SurfaceTerrainData = LEGACY_TERRAIN;
let activeBounds: LakeBounds[] = boundsFor(LEGACY_TERRAIN);
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

function sameTerrain(a: SurfaceTerrainData, b: SurfaceTerrainData): boolean {
  if (a === b) return true;
  if (a.seed !== b.seed || a.lakes.length !== b.lakes.length) return false;
  return a.lakes.every((lake, i) => {
    const other = b.lakes[i];
    return lake.id === other.id && lake.outline.length === other.outline.length &&
      lake.outline.every((p, j) => p.x === other.outline[j].x && p.y === other.outline[j].y);
  });
}

/** Installs the terrain of the world being simulated or displayed. Missing terrain means the legacy map. */
export function setSurfaceTerrain(terrain: SurfaceTerrainData | undefined | null): void {
  const next = terrain && Array.isArray(terrain.lakes) ? terrain : LEGACY_TERRAIN;
  if (sameTerrain(next, activeTerrain)) return;
  activeTerrain = next;
  activeBounds = boundsFor(next);
  revision += 1;
}

export function getSurfaceTerrain(): SurfaceTerrainData {
  return activeTerrain;
}

/** Bumps whenever the active terrain changes; derived caches compare against it. */
export function surfaceTerrainRevision(): number {
  return revision;
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
