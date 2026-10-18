import type { Building, ResourceDeposit, Vec2 } from "./types";
import { DEPOSIT_RX, DEPOSIT_RY } from "./resourceDeposits";
import { buildingFootprint } from "./buildingGeometry";
import { isWaterAt } from "./surfaceTerrain";

export type PointBuilding = "hut" | "storage" | "workshop" | "idol";
export const POINT_BUILDING_LIMITS = { hut: 8, storage: 6, workshop: 2, idol: 1 };
export function pointBuildingPlacement(surface: { width: number; height: number; entrances: Vec2[]; buildings: Building[]; deposits?: ResourceDeposit[] }, owner: string, type: PointBuilding, pos: Vec2, limit = POINT_BUILDING_LIMITS[type], entranceMargin = 7): string | null {
  if (pos.x < 2 || pos.y < 2 || pos.x > surface.width - 2 || pos.y > surface.height - 2) return "За границей карты";
  if (surface.entrances.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < entranceMargin)) return "Слишком близко к костру";
  const f = buildingFootprint({ type, pos, stage: "built" } as Building)!;
  if (surface.deposits?.some(d => ((f.x-d.pos.x)/(DEPOSIT_RX+f.rx+1))**2+((f.y-d.pos.y)/(DEPOSIT_RY+f.ry+1))**2<=1)) return "Рабочая площадка карьера";
  if (isWaterAt(pos.x, pos.y) || Array.from({ length: 16 }, (_, i) => i * Math.PI / 8).some(a => isWaterAt(f.x + Math.cos(a) * (f.rx + 0.6), f.y + Math.sin(a) * (f.ry + 0.6)))) return "Основание попадает в воду";
  if (surface.buildings.filter(b => b.colonyId === owner && b.type === type).length >= limit) return "Достигнут предел этих построек";
  if (surface.buildings.some(b => Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < 8)) return "Слишком близко к другой постройке";
  return null;
}
