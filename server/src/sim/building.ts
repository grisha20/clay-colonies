// Постройки Clayfolk: хижина (точкой) и стена (кистью).
// Площадка (site) -> доставка ресурсов со склада лагеря -> стройка (inProgress) -> готово (built).
// Готовые стены блокируют движение через сетку клеток WALL_CELL_SIZE x WALL_CELL_SIZE.
import { WALL_CELL_SIZE, type Building, type BuildingType, type Vec2 } from "../../../shared/types";
import { isWaterAt, lakeFieldAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
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
    const dx = pos.x - building.pos.x;
    const dy = pos.y - building.pos.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = building.pos;
    }
  }
  return best;
}

function tooCloseToEntrance(world: World, pos: Vec2): boolean {
  for (const entrance of world.surface.entrances ?? [world.surface.entrance]) {
    const dx = pos.x - entrance.x;
    const dy = pos.y - entrance.y;
    if (dx * dx + dy * dy < CONFIG.buildingEntranceMargin * CONFIG.buildingEntranceMargin) {
      return true;
    }
  }
  return false;
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
  if (tooCloseToEntrance(world, pos)) {
    return false;
  }
  if (isWaterAt(pos.x, pos.y)) {
    return false;
  }
  const sameType = world.surface.buildings.filter(
    (item) => item.colonyId === colony.id && item.type === type
  );
  const limit =
    type === "hut"
      ? CONFIG.maxHutsPerColony
      : type === "idol"
        ? CONFIG.maxIdolsPerColony
        : type === "workshop"
          ? CONFIG.maxWorkshopsPerColony
          : CONFIG.maxStoragesPerColony;
  if (sameType.length >= limit) {
    return false;
  }
  // Не ставить точечную постройку вплотную к другой постройке.
  for (const item of world.surface.buildings) {
    const dx = item.pos.x - pos.x;
    const dy = item.pos.y - pos.y;
    if (dx * dx + dy * dy < 8 * 8) {
      return false;
    }
  }
  world.surface.buildings.push(createBuilding(colony.id, type, pos));
  return true;
}

export function placeHut(world: World, colonyIndex: number, x: number, y: number): boolean {
  return placePointBuilding(world, colonyIndex, "hut", x, y);
}

const MAX_WALL_CELLS_PER_COMMAND = 512;

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
      .map((item) => wallCellIndexAt(item.pos.x, item.pos.y))
  );
  let segments = world.surface.buildings.filter(
    (item) => item.colonyId === colony.id && (item.type === "wall" || item.type === "gate")
  ).length;

  for (const cell of cells.slice(0, MAX_WALL_CELLS_PER_COMMAND)) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= limit) {
      continue;
    }
    if (occupied.has(cell) || segments >= CONFIG.maxWallSegmentsPerColony) {
      continue;
    }
    const pos = wallCellCenter(cell);
    if (tooCloseToEntrance(world, pos) || isWaterAt(pos.x, pos.y)) {
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
    return !cellSet.has(wallCellIndexAt(item.pos.x, item.pos.y));
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
      const cell = wallCellIndexAt(building.pos.x, building.pos.y);
      world.wallBlocked.add(cell);
      if (building.type === "gate") {
        world.gateOwner.set(cell, building.colonyId);
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
  return isWaterAt(x, y) || isWallBlockedAt(world, x, y, colonyId);
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

export function resolveSurfaceCollision(
  world: World,
  pos: Vec2,
  prevX: number,
  prevY: number,
  colonyId?: string
): void {
  if (!isSurfaceBlockedAt(world, pos.x, pos.y, colonyId)) {
    return;
  }
  // Old snapshots can place an actor in a cell that later became water. Let it
  // move only toward shallower water; the previous rule allowed unrestricted
  // movement once an actor had crossed the shoreline by even one pixel.
  if (isSurfaceBlockedAt(world, prevX, prevY, colonyId)) {
    if (isWaterAt(prevX, prevY) && lakeFieldAt(pos.x, pos.y) < lakeFieldAt(prevX, prevY)) {
      return;
    }
    pos.x = prevX;
    pos.y = prevY;
    return;
  }
  if (!isSurfaceBlockedAt(world, pos.x, prevY, colonyId)) {
    pos.y = prevY;
    return;
  }
  if (!isSurfaceBlockedAt(world, prevX, pos.y, colonyId)) {
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
