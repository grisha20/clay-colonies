// Зоны игрока: зона добычи (harvest) и зона запрета (forbid).
// Хранение: массивы индексов клеток в colony.zones (для снапшота/клиента)
// + быстрые Set в ColonyRuntime.zoneSets (для проверок в горячем цикле).
// Клетка зоны = ZONE_CELL_SIZE x ZONE_CELL_SIZE мировых единиц.
import { ZONE_CELL_SIZE, type Vec2, type ZoneType } from "../../../shared/types";
import { CONFIG } from "../config";
import type { ColonyRuntime, World } from "./world";

export type ZoneSets = {
  harvest: Set<number>;
  forbid: Set<number>;
  harvestCenter: Vec2 | null;
};

export function zoneGridWidth(): number {
  return Math.ceil(CONFIG.mapWidth / ZONE_CELL_SIZE);
}

export function zoneGridHeight(): number {
  return Math.ceil(CONFIG.mapHeight / ZONE_CELL_SIZE);
}

export function zoneIndexAt(x: number, y: number): number {
  const cx = Math.max(0, Math.min(zoneGridWidth() - 1, Math.floor(x / ZONE_CELL_SIZE)));
  const cy = Math.max(0, Math.min(zoneGridHeight() - 1, Math.floor(y / ZONE_CELL_SIZE)));
  return cy * zoneGridWidth() + cx;
}

export function zoneCellCenter(index: number): Vec2 {
  const width = zoneGridWidth();
  const cx = index % width;
  const cy = Math.floor(index / width);
  return {
    x: cx * ZONE_CELL_SIZE + ZONE_CELL_SIZE / 2,
    y: cy * ZONE_CELL_SIZE + ZONE_CELL_SIZE / 2
  };
}

export function createZoneSets(): ZoneSets {
  return { harvest: new Set(), forbid: new Set(), harvestCenter: null };
}

function ensureColonyZones(colony: ColonyRuntime): NonNullable<ColonyRuntime["colony"]["zones"]> {
  if (!colony.colony.zones) {
    colony.colony.zones = { version: 1, harvest: [], forbid: [] };
  }
  return colony.colony.zones;
}

function recomputeHarvestCenter(sets: ZoneSets): void {
  if (sets.harvest.size === 0) {
    sets.harvestCenter = null;
    return;
  }
  let sumX = 0;
  let sumY = 0;
  for (const index of sets.harvest) {
    const center = zoneCellCenter(index);
    sumX += center.x;
    sumY += center.y;
  }
  sets.harvestCenter = { x: sumX / sets.harvest.size, y: sumY / sets.harvest.size };
}

function syncArraysFromSets(colony: ColonyRuntime): void {
  const zones = ensureColonyZones(colony);
  zones.harvest = [...colony.zoneSets.harvest].sort((a, b) => a - b);
  zones.forbid = [...colony.zoneSets.forbid].sort((a, b) => a - b);
  zones.version += 1;
  recomputeHarvestCenter(colony.zoneSets);
}

export function rebuildZoneSetsFromColony(colony: ColonyRuntime): void {
  colony.zoneSets.harvest = new Set(colony.colony.zones?.harvest ?? []);
  colony.zoneSets.forbid = new Set(colony.colony.zones?.forbid ?? []);
  recomputeHarvestCenter(colony.zoneSets);
}

const MAX_CELLS_PER_COMMAND = 4096;

function sanitizeCells(cells: number[]): number[] {
  const limit = zoneGridWidth() * zoneGridHeight();
  const result: number[] = [];
  for (const cell of cells.slice(0, MAX_CELLS_PER_COMMAND)) {
    if (Number.isInteger(cell) && cell >= 0 && cell < limit) {
      result.push(cell);
    }
  }
  return result;
}

export function paintColonyZone(world: World, colonyIndex: number, zone: ZoneType, cells: number[]): void {
  const colony = world.colonies[colonyIndex];
  if (!colony) {
    return;
  }
  let changed = false;
  const target = zone === "harvest" ? colony.zoneSets.harvest : colony.zoneSets.forbid;
  const other = zone === "harvest" ? colony.zoneSets.forbid : colony.zoneSets.harvest;
  for (const cell of sanitizeCells(cells)) {
    if (!target.has(cell)) {
      target.add(cell);
      other.delete(cell); // клетка не может быть и добычей, и запретом
      changed = true;
    }
  }
  if (changed) {
    syncArraysFromSets(colony);
  }
}

export function eraseColonyZone(world: World, colonyIndex: number, cells: number[]): void {
  const colony = world.colonies[colonyIndex];
  if (!colony) {
    return;
  }
  let changed = false;
  for (const cell of sanitizeCells(cells)) {
    if (colony.zoneSets.harvest.delete(cell)) {
      changed = true;
    }
    if (colony.zoneSets.forbid.delete(cell)) {
      changed = true;
    }
  }
  if (changed) {
    syncArraysFromSets(colony);
  }
}
