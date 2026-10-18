import type { Building, Vec2 } from "./types";

export type BuildingFootprint = { x: number; y: number; rx: number; ry: number };
export function buildingFootprint(building: Building): BuildingFootprint | null {
  if (building.stage !== "built" || building.type === "wall" || building.type === "gate") return null;
  const shape = building.type === "hut" ? [4, 2.3, 0.5] : building.type === "workshop" ? [4.6, 2.6, 0.6] : building.type === "storage" ? [3.4, 2.1, 0.6] : [1.8, 1, 0];
  return { x: building.pos.x, y: building.pos.y + shape[2], rx: shape[0], ry: shape[1] };
}
export function insideBuilding(x: number, y: number, f: BuildingFootprint): boolean {
  return ((x - f.x) / f.rx) ** 2 + ((y - f.y) / f.ry) ** 2 < 1;
}
export function crossesBuilding(from: Vec2, to: Vec2, f: BuildingFootprint): boolean {
  const x = (from.x - f.x) / f.rx, y = (from.y - f.y) / f.ry;
  const dx = (to.x - from.x) / f.rx, dy = (to.y - from.y) / f.ry;
  const len = dx * dx + dy * dy, t = len ? Math.max(0, Math.min(1, -(x * dx + y * dy) / len)) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 < 1;
}
export function outsideBuilding(pos: Vec2, f: BuildingFootprint): Vec2 {
  const x = (pos.x - f.x) / f.rx, y = (pos.y - f.y) / f.ry, len = Math.hypot(x, y);
  return len > 0.0001 ? { x: f.x + x / len * (f.rx + 0.15), y: f.y + y / len * (f.ry + 0.15) } : { x: f.x, y: f.y + f.ry + 0.15 };
}
export function buildingServicePoint(building: Building): Vec2 {
  const f = buildingFootprint(building);
  return f ? { x: f.x, y: f.y + f.ry + 0.6 } : building.pos;
}

/** Local waypoints around convex foundations, without a per-resident planner. */
export function buildingRouteTarget(buildings: Building[], from: Vec2, target: Vec2): Vec2 {
  const solids = buildings.map(buildingFootprint).filter((f): f is BuildingFootprint => !!f);
  const inside = solids.find(f => insideBuilding(target.x, target.y, f));
  const goal = inside ? outsideBuilding(target, inside) : target;
  const blocker = solids.filter(f => !insideBuilding(from.x, from.y, f) && crossesBuilding(from, goal, f))
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  if (!blocker) return goal;
  const candidates: Vec2[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) candidates.push({ x: blocker.x + sx * (blocker.rx + 0.8), y: blocker.y + sy * (blocker.ry + 0.8) });
  return candidates.filter(p => Math.hypot(p.x - from.x, p.y - from.y) > 0.6 && !solids.some(f => crossesBuilding(from, p, f)))
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) + Math.hypot(a.x - goal.x, a.y - goal.y) - Math.hypot(b.x - from.x, b.y - from.y) - Math.hypot(b.x - goal.x, b.y - goal.y))[0] ?? from;
}
