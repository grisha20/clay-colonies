import { WALL_CELL_SIZE, type Building, type ResourceDeposit, type Vec2 } from "./types";
import { depositContains } from "./resourceDeposits";
import { buildingFootprint, insideBuilding } from "./buildingGeometry";
import { isWaterAt } from "./surfaceTerrain";

export type GateAxis = "horizontal" | "vertical";
export type FenceSurface = { width: number; height: number; entrances: Vec2[]; buildings: Building[]; deposits?: ResourceDeposit[] };
export const GATE_SPAN = 3;
export function fenceCellCenters(b: Pick<Building, "pos" | "type" | "gateAxis" | "gateSpan">): Vec2[] {
  const count = b.type === "gate" && b.gateSpan === GATE_SPAN ? GATE_SPAN : 1;
  return Array.from({ length: count }, (_, i) => ({
    x: b.pos.x + (b.gateAxis !== "vertical" ? (i - (count - 1) / 2) * WALL_CELL_SIZE : 0),
    y: b.pos.y + (b.gateAxis === "vertical" ? (i - (count - 1) / 2) * WALL_CELL_SIZE : 0)
  }));
}
export function fenceContains(b: Building, p: Vec2): boolean {
  const dx = Math.floor(p.x / WALL_CELL_SIZE) - Math.floor(b.pos.x / WALL_CELL_SIZE);
  const dy = Math.floor(p.y / WALL_CELL_SIZE) - Math.floor(b.pos.y / WALL_CELL_SIZE);
  if (b.type !== "gate" || b.gateSpan !== GATE_SPAN) return dx === 0 && dy === 0;
  return b.gateAxis === "vertical" ? dx === 0 && Math.abs(dy) <= 1 : dy === 0 && Math.abs(dx) <= 1;
}
export function snapFencePosition(p: Vec2): Vec2 {
  return { x: (Math.floor(p.x / WALL_CELL_SIZE) + 0.5) * WALL_CELL_SIZE, y: (Math.floor(p.y / WALL_CELL_SIZE) + 0.5) * WALL_CELL_SIZE };
}
/** Same rules on both sides of the socket; only own wall cells may be replaced. */
export function fencePlacement(surface: FenceSurface, owner: string, pos: Vec2, replaceOwnWall = false, entranceMargin = 7): string | null {
  const half = WALL_CELL_SIZE / 2;
  if (pos.x < half || pos.y < half || pos.x > surface.width - half || pos.y > surface.height - half) return "За границей карты";
  if (surface.entrances.some(e => Math.hypot(e.x - pos.x, e.y - pos.y) < entranceMargin)) return "Слишком близко к костру";
  if (surface.deposits?.some(d => depositContains(d, pos, 1.5))) return "Рабочая площадка карьера";
  if ([-0.85, 0, 0.85].some(dx => [-0.85, 0, 0.85].some(dy => isWaterAt(pos.x + dx, pos.y + dy)))) return "Основание попадает в воду";
  for (const b of surface.buildings) {
    if (b.type === "wall" || b.type === "gate") {
      if (fenceContains(b, pos) && !(replaceOwnWall && b.type === "wall" && b.colonyId === owner)) return "Место уже занято";
    } else {
      const f = buildingFootprint({ ...b, stage: "built" });
      if (f && insideBuilding(pos.x, pos.y, { ...f, rx: f.rx + half, ry: f.ry + half })) return "Слишком близко к зданию";
    }
  }
  return null;
}
export function gatePlacement(surface: FenceSurface, owner: string, pos: Vec2, axis: GateAxis, entranceMargin = 7): string | null {
  for (const p of fenceCellCenters({ type: "gate", pos: snapFencePosition(pos), gateAxis: axis, gateSpan: GATE_SPAN })) {
    const reason = fencePlacement(surface, owner, p, true, entranceMargin);
    if (reason) return reason;
  }
  return null;
}
