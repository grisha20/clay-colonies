import type { Building, Vec2 } from "./types";
import { buildingFootprint, insideBuilding } from "./buildingGeometry";
import { insideHearth } from "./campGeometry";
import { isWaterAt } from "./surfaceTerrain";

/** Ordered, spaced drying places. The first two belong to the decorative royals. */
export function campShelterPoints(camp: Vec2, buildings: Building[], width: number, height: number, colonyId: string, fireRadius = 11): Vec2[] {
  const foundations = buildings.map(buildingFootprint).filter((f): f is NonNullable<typeof f> => !!f);
  const walls = buildings.filter(b => b.stage === "built" && (b.type === "wall" || b.type === "gate") && !(b.type === "gate" && b.colonyId === colonyId));
  const points: Vec2[] = [];
  for (const [radius, count] of [[5.5, 12], [8.3, 18], [10.8, 23]]) {
    if (radius > fireRadius) continue;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI / 2 + i * Math.PI * 2 / count;
      const p = { x: camp.x + Math.cos(angle) * radius, y: camp.y + Math.sin(angle) * radius };
      if (p.x < 1.5 || p.y < 1.5 || p.x > width - 1.5 || p.y > height - 1.5 || isWaterAt(p.x, p.y) || insideHearth(p.x, p.y, camp)) continue;
      if (foundations.some(f => insideBuilding(p.x, p.y, { ...f, rx: f.rx + 0.6, ry: f.ry + 0.6 }))) continue;
      if (walls.some(b => Math.abs(b.pos.x - p.x) < 1.8 && Math.abs(b.pos.y - p.y) < 1.8)) continue;
      points.push(p);
    }
  }
  return points;
}
