import { lakePoints, lakeLineOpen } from "./lakeNavigation";
import { lakeFieldAt, surfaceTerrainRevision, type LakeId } from "./surfaceTerrain";
import type { Enemy, Vec2 } from "./types";

const pads = new Map<LakeId, Vec2[]>();
let padsRevision = -1;
/** Shared deterministic habitat: clients and saved creatures use the same pads. */
export function lakeLilyPads(id: LakeId): Vec2[] {
  if (padsRevision !== surfaceTerrainRevision()) { pads.clear(); padsRevision = surfaceTerrainRevision(); }
  let result = pads.get(id); if (result) return result;
  result = [];
  for (const point of lakePoints(id)) {
    if (lakeFieldAt(point.x, point.y) < 0.35 || result.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 22)) continue;
    if (![0, 1, 2, 3].every(i => lakeLineOpen(point, { x: point.x + Math.cos(i * Math.PI / 2) * 4, y: point.y + Math.sin(i * Math.PI / 2) * 4 }, id))) continue;
    result.push(point); if (result.length === 7) break;
  }
  pads.set(id, result); return result;
}
export function lakeMonsterResting(enemy: Enemy, tick: number): boolean {
  if (enemy.type !== "lakeMonster" || !enemy.lakeId || enemy.captiveId || (enemy.lakeRestUntil ?? 0) <= tick) return false;
  const pad = lakeLilyPads(enemy.lakeId)[enemy.lakePadIndex ?? -1];
  return !!pad && Math.hypot(pad.x - enemy.pos.x, pad.y - enemy.pos.y) < 0.8;
}
