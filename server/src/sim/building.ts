// Постройки Clayfolk: хижина (точкой) и стена (кистью).
// Площадка (site) -> доставка ресурсов со склада лагеря -> стройка (inProgress) -> готово (built).
// Готовые стены блокируют движение через сетку клеток WALL_CELL_SIZE x WALL_CELL_SIZE.
import { WALL_CELL_SIZE, type Building, type BuildingType, type Vec2 } from "../../../shared/types";
import { isWaterAt, lakeFieldAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { insideHearth, crossesHearth, outsideHearth } from "../../../shared/campGeometry";
import { buildingFootprint, insideBuilding, crossesBuilding, outsideBuilding, buildingServicePoint } from "../../../shared/buildingGeometry";
import { pointBuildingPlacement } from "../../../shared/buildingPlacement";
import { fenceCellCenters, fencePlacement, gatePlacement, GATE_SPAN, snapFencePosition, type GateAxis } from "../../../shared/fenceGeometry";
import type { World } from "./world";

let nextBuildingId = 1;

export function syncBuildingIdCounter(buildings: Building[]): void {
  for (const building of buildings) {
    const numeric = Number(building.id.replace("bld-", ""));
    if (Number.isFinite(numeric)) {
      nextBuildingId = Math.max(nextBuildingId, numeric + 1);
    }
  }
}

export function wallGridWidth(): number {
  return Math.ceil(CONFIG.mapWidth / WALL_CELL_SIZE);
}

export function wallGridHeight(): number {
  return Math.ceil(CONFIG.mapHeight / WALL_CELL_SIZE);
}

export function wallCellIndexAt(x: number, y: number): number {
  const cx = Math.max(0, Math.min(wallGridWidth() - 1, Math.floor(x / WALL_CELL_SIZE)));
  const cy = Math.max(0, Math.min(wallGridHeight() - 1, Math.floor(y / WALL_CELL_SIZE)));
  return cy * wallGridWidth() + cx;
}

export function wallCellCenter(index: number): Vec2 {
  const width = wallGridWidth();
  return {
    x: (index % width) * WALL_CELL_SIZE + WALL_CELL_SIZE / 2,
    y: Math.floor(index / width) * WALL_CELL_SIZE + WALL_CELL_SIZE / 2
  };
}

function buildingCost(type: BuildingType): { clay: number; wood: number; stone: number } {
  if (type === "hut") {
    return { ...CONFIG.hutCost };
  }
  if (type === "storage") {
    return { ...CONFIG.storageCost };
  }
  if (type === "workshop") {
    return { ...CONFIG.workshopCost };
  }
  if (type === "idol") {
    return { ...CONFIG.idolCost };
  }
  if (type === "gate") {
    return { ...CONFIG.gateCost };
  }
  return { ...CONFIG.wallCost };
}

function buildingMaxHp(type: BuildingType): number {
  if (type === "hut") {
    return CONFIG.hutMaxHp;
  }
  if (type === "storage") {
    return CONFIG.storageMaxHp;
  }
  if (type === "workshop") {
    return CONFIG.workshopMaxHp;
  }
  if (type === "idol") {
    return CONFIG.idolMaxHp;
  }
  if (type === "gate") {
    return CONFIG.gateMaxHp;
  }
  return CONFIG.wallMaxHp;
}

export function buildRatePerTick(type: BuildingType): number {
  if (type === "hut") {
    return 1 / CONFIG.hutBuildTicks;
  }
  if (type === "storage") {
    return 1 / CONFIG.storageBuildTicks;
  }
  if (type === "workshop") {
    return 1 / CONFIG.workshopBuildTicks;
  }
  if (type === "idol") {
    return 1 / CONFIG.idolBuildTicks;
  }
  if (type === "gate") {
    return 1 / CONFIG.gateBuildTicks;
  }
  return 1 / CONFIG.wallBuildTicks;
}

// Ближайшая точка сдачи ресурсов: вход в лагерь или ДОСТРОЕННЫЙ склад племени.
export function nearestDropPoint(world: World, pos: Vec2): Vec2 {
  let best = world.surface.entrance;
  let bestDistanceSq =
    (pos.x - best.x) * (pos.x - best.x) + (pos.y - best.y) * (pos.y - best.y);
  for (const building of world.surface.buildings) {
    if (building.type !== "storage" || building.stage !== "built" || building.colonyId !== world.colony.id) {
      continue;
    }
    const service = buildingServicePoint(building);
    const dx = pos.x - service.x;
    const dy = pos.y - service.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = service;
    }
  }
  return best;
}

function createBuilding(colonyId: string, type: BuildingType, pos: Vec2): Building {
  const building: Building = {
    id: `bld-${nextBuildingId}`,
    colonyId,
    type,
    stage: "site",
    pos,
    cost: buildingCost(type),
    delivered: { clay: 0, wood: 0, stone: 0 },
    progress: 0,
    hp: 0,
    maxHp: buildingMaxHp(type)
  };
  nextBuildingId += 1;
  return building;
}

export function placePointBuilding(
  world: World,
  colonyIndex: number,
  type: "hut" | "storage" | "idol" | "workshop",
  x: number,
  y: number
): boolean {
  const colony = world.colonies[colonyIndex];
  if (!colony) {
    return false;
  }
  const pos = {
    x: Math.max(2, Math.min(CONFIG.mapWidth - 2, x)),
    y: Math.max(2, Math.min(CONFIG.mapHeight - 2, y))
  };
  const limit =
    type === "hut"
      ? CONFIG.maxHutsPerColony
      : type === "idol"
        ? CONFIG.maxIdolsPerColony
        : type === "workshop"
          ? CONFIG.maxWorkshopsPerColony
          : CONFIG.maxStoragesPerColony;
  if (pointBuildingPlacement(world.surface, colony.id, type, pos, limit, CONFIG.buildingEntranceMargin)) return false;
  world.surface.buildings.push(createBuilding(colony.id, type, pos));
  return true;
}

export function placeHut(world: World, colonyIndex: number, x: number, y: number): boolean {
  return placePointBuilding(world, colonyIndex, "hut", x, y);
}

const MAX_WALL_CELLS_PER_COMMAND = 512;

export function placeGate(world: World, colonyIndex: number, x: number, y: number, axis: GateAxis): boolean {
  const colony = world.colonies[colonyIndex];
  if (!colony) return false;
  const pos = snapFencePosition({ x, y });
  if (gatePlacement(world.surface, colony.id, pos, axis, CONFIG.buildingEntranceMargin)) return false;
  const gate = createBuilding(colony.id, "gate", pos);
  gate.gateAxis = axis; gate.gateSpan = GATE_SPAN;
  for (const kind of ["clay", "wood", "stone"] as const) gate.cost[kind] *= GATE_SPAN;
  gate.maxHp *= GATE_SPAN;
  const occupied = new Set(fenceCellCenters(gate).map(p => wallCellIndexAt(p.x, p.y)));
  const retained = world.surface.buildings.filter(b => !(b.type === "wall" && b.colonyId === colony.id && occupied.has(wallCellIndexAt(b.pos.x, b.pos.y))));
  const segments = retained.filter(b => b.colonyId === colony.id && (b.type === "wall" || b.type === "gate")).reduce((n, b) => n + fenceCellCenters(b).length, 0);
  if (segments + GATE_SPAN > CONFIG.maxWallSegmentsPerColony) return false;
  world.surface.buildings = [...retained, gate];
  rebuildWallBlocked(world);
  return true;
}

export function paintWallCells(
  world: World,
  colonyIndex: number,
  cells: number[],
  type: "wall" | "gate" = "wall"
): void {
  const colony = world.colonies[colonyIndex];
  if (!colony) {
    return;
  }
  const limit = wallGridWidth() * wallGridHeight();
  const occupied = new Set(
    world.surface.buildings
      .filter((item) => item.type === "wall" || item.type === "gate")
      .flatMap((item) => fenceCellCenters(item).map(p => wallCellIndexAt(p.x, p.y)))
  );
  let segments = world.surface.buildings.filter(
    (item) => item.colonyId === colony.id && (item.type === "wall" || item.type === "gate")
  ).reduce((n, b) => n + fenceCellCenters(b).length, 0);

  for (const cell of cells.slice(0, MAX_WALL_CELLS_PER_COMMAND)) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= limit) {
      continue;
    }
    if (occupied.has(cell) || segments >= CONFIG.maxWallSegmentsPerColony) {
      continue;
    }
    const pos = wallCellCenter(cell);
    if (fencePlacement(world.surface, colony.id, pos, false, CONFIG.buildingEntranceMargin)) {
      continue;
    }
    world.surface.buildings.push(createBuilding(colony.id, type, pos));
    occupied.add(cell);
    segments += 1;
  }
}

export function eraseBuildCells(world: World, colonyIndex: number, cells: number[]): void {
  const colony = world.colonies[colonyIndex];
  if (!colony) {
    return;
  }
  const cellSet = new Set(cells.slice(0, MAX_WALL_CELLS_PER_COMMAND));
  const before = world.surface.buildings.length;
  world.surface.buildings = world.surface.buildings.filter((item) => {
    if (item.colonyId !== colony.id) {
      return true;
    }
    return !fenceCellCenters(item).some(p => cellSet.has(wallCellIndexAt(p.x, p.y)));
  });
  if (world.surface.buildings.length !== before) {
    rebuildWallBlocked(world);
  }
}

export function completeBuilding(world: World, building: Building): void {
  building.stage = "built";
  building.progress = 1;
  building.hp = building.maxHp;
  if (building.type === "wall" || building.type === "gate") {
    rebuildWallBlocked(world);
  }
}

export function rebuildWallBlocked(world: World): void {
  world.wallBlocked.clear();
  world.gateOwner.clear();
  for (const building of world.surface.buildings) {
    if (building.stage !== "built") {
      continue;
    }
    if (building.type === "wall" || building.type === "gate") {
      for (const p of fenceCellCenters(building)) {
        const cell = wallCellIndexAt(p.x, p.y);
        world.wallBlocked.add(cell);
        if (building.type === "gate") world.gateOwner.set(cell, building.colonyId);
      }
    }
  }
}

export function isWallBlockedAt(world: World, x: number, y: number, colonyId?: string): boolean {
  if (world.wallBlocked.size === 0) {
    return false;
  }
  const cell = wallCellIndexAt(x, y);
  if (!world.wallBlocked.has(cell)) {
    return false;
  }
  // Ворота: свои жители проходят, чужие и паук — нет.
  return !(colonyId && world.gateOwner.get(cell) === colonyId);
}

/** All permanent surface blockers. Keep water and constructed obstacles in one API. */
export function isSurfaceBlockedAt(world: World, x: number, y: number, colonyId?: string): boolean {
  if (x < 0 || y < 0 || x >= CONFIG.mapWidth || y >= CONFIG.mapHeight) {
    return true;
  }
  return isWaterAt(x, y) || isWallBlockedAt(world, x, y, colonyId) ||
    world.surface.entrances.some(camp => insideHearth(x, y, camp)) ||
    world.surface.buildings.some(b => { const f = buildingFootprint(b); return f && insideBuilding(x, y, f); });
}

// Разрешение столкновения со стеной: откат на свободную ось (скольжение вдоль стены).
// Если предыдущая позиция сама в стене (стену достроили над агентом) — не мешаем выбраться.
export function resolveWallCollision(
  world: World,
  pos: Vec2,
  prevX: number,
  prevY: number,
  colonyId?: string
): void {
  if (world.wallBlocked.size === 0 || !isWallBlockedAt(world, pos.x, pos.y, colonyId)) {
    return;
  }
  if (isWallBlockedAt(world, prevX, prevY, colonyId)) {
    return;
  }
  if (!isWallBlockedAt(world, pos.x, prevY, colonyId)) {
    pos.y = prevY;
    return;
  }
  if (!isWallBlockedAt(world, prevX, pos.y, colonyId)) {
    pos.x = prevX;
    return;
  }
  pos.x = prevX;
  pos.y = prevY;
}

// Traverse every crossed 2x2 cell, including short diagonal corner cuts.
// Endpoint-only collision lets actors cross a solid corner and emerge in a
// free cell within a single step. Water boundaries use the same aligned grid.
function surfaceSegmentClear(world: World, fromX: number, fromY: number, toX: number, toY: number, colonyId?: string): boolean {
  if (isSurfaceBlockedAt(world, toX, toY, colonyId)) return false;
  if (world.surface.entrances.some(camp => crossesHearth(fromX, fromY, toX, toY, camp))) return false;
  if (world.surface.buildings.some(b => { const f = buildingFootprint(b); return f && crossesBuilding({ x: fromX, y: fromY }, { x: toX, y: toY }, f); })) return false;
  let x = Math.floor(fromX / WALL_CELL_SIZE), y = Math.floor(fromY / WALL_CELL_SIZE);
  const endX = Math.floor(toX / WALL_CELL_SIZE), endY = Math.floor(toY / WALL_CELL_SIZE);
  const dx = toX - fromX, dy = toY - fromY, stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx ? WALL_CELL_SIZE / Math.abs(dx) : Infinity;
  const deltaY = dy ? WALL_CELL_SIZE / Math.abs(dy) : Infinity;
  let crossX = dx ? ((x + Number(dx > 0)) * WALL_CELL_SIZE - fromX) / dx : Infinity;
  let crossY = dy ? ((y + Number(dy > 0)) * WALL_CELL_SIZE - fromY) / dy : Infinity;
  while (x !== endX || y !== endY) {
    if (crossX < crossY) { x += stepX; crossX += deltaX; }
    else if (crossY < crossX) { y += stepY; crossY += deltaY; }
    else { x += stepX; y += stepY; crossX += deltaX; crossY += deltaY; }
    // Hearths have exact elliptical footprints, not the wall grid's cells.
    const cx = (x + 0.5) * WALL_CELL_SIZE, cy = (y + 0.5) * WALL_CELL_SIZE;
    if (isWaterAt(cx, cy) || isWallBlockedAt(world, cx, cy, colonyId)) return false;
  }
  return true;
}

export function resolveSurfaceCollision(
  world: World,
  pos: Vec2,
  prevX: number,
  prevY: number,
  colonyId?: string
): void {
  const foundation = world.surface.buildings.map(buildingFootprint).find(f => f && insideBuilding(prevX, prevY, f));
  if (foundation) {
    if (!isSurfaceBlockedAt(world, pos.x, pos.y, colonyId)) return;
    const exit = outsideBuilding(pos, foundation);
    if (!isSurfaceBlockedAt(world, exit.x, exit.y, colonyId)) { pos.x = exit.x; pos.y = exit.y; }
    return;
  }
  const hearth = world.surface.entrances.find(camp => insideHearth(prevX, prevY, camp));
  if (hearth) {
    if (!isSurfaceBlockedAt(world, pos.x, pos.y, colonyId)) return;
    // Existing saves and freshly spawned residents can start inside the old
    // walkable centre. Place them just outside, preserving cargo and jobs.
    const exit = outsideHearth(pos, hearth);
    if (!isSurfaceBlockedAt(world, exit.x, exit.y, colonyId)) { pos.x = exit.x; pos.y = exit.y; }
    return;
  }
  // Old snapshots can place an actor in a cell that later became water. Let it
  // move only toward shallower water; the previous rule allowed unrestricted
  // movement once an actor had crossed the shoreline by even one pixel.
  if (isSurfaceBlockedAt(world, prevX, prevY, colonyId)) {
    if (!isSurfaceBlockedAt(world, pos.x, pos.y, colonyId) || (isWaterAt(prevX, prevY) && lakeFieldAt(pos.x, pos.y) < lakeFieldAt(prevX, prevY))) {
      return;
    }
    pos.x = prevX;
    pos.y = prevY;
    return;
  }
  if (surfaceSegmentClear(world, prevX, prevY, pos.x, pos.y, colonyId)) return;
  if (surfaceSegmentClear(world, prevX, prevY, pos.x, prevY, colonyId)) {
    pos.y = prevY;
    return;
  }
  if (surfaceSegmentClear(world, prevX, prevY, prevX, pos.y, colonyId)) {
    pos.x = prevX;
    return;
  }
  pos.x = prevX;
  pos.y = prevY;
}

// Урон постройкам (пока используется как задел: стены может ломать паук/враг).
export function damageBuilding(world: World, building: Building, amount: number): void {
  if (building.stage !== "built") {
    return;
  }
  building.hp -= amount;
  if (building.hp <= 0) {
    world.surface.buildings = world.surface.buildings.filter((item) => item.id !== building.id);
    if (building.type === "wall" || building.type === "gate") {
      rebuildWallBlocked(world);
    }
  }
}
