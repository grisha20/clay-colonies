import { WALL_CELL_SIZE, type Building, type ResourceDeposit, type Vec2 } from "./types";
import { fenceCellCenters } from "./fenceGeometry";
import { DEPOSIT_RX, DEPOSIT_RY } from "./resourceDeposits";
import { buildingFootprint } from "./buildingGeometry";
import { isWaterAt, isMountainAt } from "./surfaceTerrain";
import { territoryPlacement } from "./territory";

/** Buildings and fences keep clear of a special clay spring. */
export const SPRING_CLEARANCE = 6;

/** Free walkway kept between a new foundation and other foundations or fences. */
export const PLACEMENT_GAP = 1;

/**
 * Spacing by real foundation sizes: a walkway of PLACEMENT_GAP round the new
 * footprint, and a fence cell (2×2) may not come closer than that either. The
 * old rule kept 8 units from the centre of any building, and every 2-unit
 * fence section counted as one, which left almost no room inside a fenced camp.
 */
export function buildingSpacing(buildings: Building[], f: { x: number; y: number; rx: number; ry: number }): string | null {
  for (const b of buildings) {
    if (b.type === "wall" || b.type === "gate") {
      const reachX = f.rx + WALL_CELL_SIZE / 2 + PLACEMENT_GAP, reachY = f.ry + WALL_CELL_SIZE / 2 + PLACEMENT_GAP;
      if (fenceCellCenters(b).some(c => ((c.x - f.x) / reachX) ** 2 + ((c.y - f.y) / reachY) ** 2 < 1)) return "Слишком близко к ограде";
      continue;
    }
    const o = buildingFootprint({ ...b, stage: "built" });
    if (!o) continue;
    if (((o.x - f.x) / (f.rx + o.rx + PLACEMENT_GAP)) ** 2 + ((o.y - f.y) / (f.ry + o.ry + PLACEMENT_GAP)) ** 2 < 1) return "Слишком близко к другой постройке";
  }
  return null;
}

export type PointBuilding ="hut" | "storage" | "workshop" | "idol" | "kiln" | "totem";
export const POINT_BUILDING_LIMITS = { hut: 8, storage: 6, workshop: 2, idol: 1, kiln: 2, totem: 8 };
export function pointBuildingPlacement(surface: { width: number; height: number; entrances: Vec2[]; buildings: Building[]; deposits?: ResourceDeposit[]; springs?: { pos: Vec2 }[] }, owner: string, type: PointBuilding, pos: Vec2, limit = POINT_BUILDING_LIMITS[type], entranceMargin = 7): string | null {
  if (pos.x < 2 || pos.y < 2 || pos.x > surface.width - 2 || pos.y > surface.height - 2) return "За границей карты";
  if (surface.entrances.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < entranceMargin)) return "Слишком близко к костру";
  const f = buildingFootprint({ type, pos, stage: "built" } as Building)!;
  if (surface.deposits?.some(d => ((f.x-d.pos.x)/(DEPOSIT_RX+f.rx+1))**2+((f.y-d.pos.y)/(DEPOSIT_RY+f.ry+1))**2<=1)) return "Рабочая площадка карьера";
  const rim = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8).map(a => ({ x: f.x + Math.cos(a) * (f.rx + 0.6), y: f.y + Math.sin(a) * (f.ry + 0.6) }));
  if (isWaterAt(pos.x, pos.y) || rim.some(p => isWaterAt(p.x, p.y))) return "Основание попадает в воду";
  if (isMountainAt(pos.x, pos.y) || rim.some(p => isMountainAt(p.x, p.y))) return "Основание упирается в скалы";
  if (surface.buildings.filter(b => b.colonyId === owner && b.type === type).length >= limit) return "Достигнут предел этих построек";
  const near = buildingSpacing(surface.buildings, f);
  if (near) return near;
  if (surface.springs?.some(s => Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) < SPRING_CLEARANCE + f.rx)) return "Здесь бьёт источник особой глины";
  return territoryPlacement(surface, owner, pos);
}
