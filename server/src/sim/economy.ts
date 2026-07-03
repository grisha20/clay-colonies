// Экономика Clayfolk: простой "спрос" племени на глину и дерево.
// Ум на уровне племени: пока запас ниже цели, несколько свободных рабочих
// назначаются сборщиками (job = "harvest") на ближайшие узлы ресурсов.
// Никакого генома: цели заданы константами конфига (позже их заменят приоритеты игрока).
import type { Ant, Building, ResourceKind, ResourceNode } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "./world";
import { zoneIndexAt } from "./zones";

function reserveTarget(kind: ResourceKind): number {
  if (kind === "clay") {
    return CONFIG.clayReserveTarget;
  }
  if (kind === "wood") {
    return CONFIG.woodReserveTarget;
  }
  return CONFIG.stoneReserveTarget;
}

export function colonyStock(world: World, kind: ResourceKind): number {
  if (kind === "clay") {
    return world.colony.clay;
  }
  if (kind === "wood") {
    return world.colony.wood;
  }
  return world.colony.stone;
}

export function colonyWantsResource(world: World, kind: ResourceKind): boolean {
  return colonyStock(world, kind) < reserveTarget(kind) + demandFromBuildings(world, kind);
}

// Недостроенные здания повышают спрос племени на свои ресурсы.
function demandFromBuildings(world: World, kind: ResourceKind): number {
  let demand = 0;
  for (const building of world.surface.buildings) {
    if (building.colonyId !== world.colony.id || building.stage === "built") {
      continue;
    }
    demand += Math.max(0, building.cost[kind] - building.delivered[kind]);
  }
  return demand;
}

function nodeById(world: World, id?: string): ResourceNode | undefined {
  if (!id) {
    return undefined;
  }
  return world.surface.resourceNodes.find((node) => node.id === id);
}

export function assignHarvestJobs(world: World): void {
  const live = world.ants.filter((ant) => ant.state !== "dead");
  const economyReady =
    live.length >= CONFIG.harvestMinWorkers && world.colony.food >= CONFIG.harvestMinFood;

  // Учёт текущих сборщиков и освобождение лишних.
  const counts: Record<ResourceKind, number> = { clay: 0, wood: 0, stone: 0 };
  for (const ant of live) {
    if (ant.job !== "harvest") {
      continue;
    }
    const node = nodeById(world, ant.harvestNodeId);
    const kind: ResourceKind | undefined =
      node?.kind ?? (ant.carryKind && ant.carryKind !== "food" ? ant.carryKind : undefined);
    const stillWanted = kind ? colonyWantsResource(world, kind) : false;

    if ((!economyReady || !stillWanted || (!node && ant.carrying <= 0)) && ant.carrying <= 0) {
      ant.job = "forage";
      ant.harvestNodeId = undefined;
      ant.carryKind = undefined;
      continue;
    }
    if (kind) {
      counts[kind] += 1;
    }
  }

  if (!economyReady) {
    return;
  }

  for (const kind of ["clay", "wood", "stone"] as const) {
    if (!colonyWantsResource(world, kind)) {
      continue;
    }
    let nodes = world.surface.resourceNodes.filter((node) => node.kind === kind && node.amount > 0);
    if (nodes.length === 0) {
      continue;
    }
    // Зона добычи: если внутри зоны есть узлы этого ресурса, берём только их.
    const harvest = world.zoneSets?.harvest;
    if (harvest && harvest.size > 0) {
      const inZone = nodes.filter((node) => harvest.has(zoneIndexAt(node.pos.x, node.pos.y)));
      if (inZone.length > 0) {
        nodes = inZone;
      }
    }
    // Большая стройка ускоряет добычу: до +2 сборщиков при высоком спросе строек.
    const buildingDemand = demandFromBuildings(world, kind);
    const harvesterCap =
      CONFIG.maxHarvestersPerResource + (buildingDemand > 10 ? 1 : 0) + (buildingDemand > 30 ? 1 : 0);
    let need = harvesterCap - counts[kind];
    for (const ant of live) {
      if (need <= 0) {
        break;
      }
      if (
        ant.job !== "forage" ||
        ant.forageRole === "scout" ||
        ant.carrying > 0 ||
        ant.carryingDebris ||
        ant.state === "fight" ||
        ant.state === "return"
      ) {
        continue;
      }

      let best: ResourceNode | null = null;
      let bestDistanceSq = Number.POSITIVE_INFINITY;
      for (const node of nodes) {
        const dx = node.pos.x - ant.pos.x;
        const dy = node.pos.y - ant.pos.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = node;
        }
      }
      if (!best) {
        break;
      }

      ant.job = "harvest";
      ant.harvestNodeId = best.id;
      ant.forageRole = undefined;
      need -= 1;
    }
  }
}

// Стража: пока жив паук и племя достаточно большое, двое дежурят у лагеря.
export function assignGuardJobs(world: World): void {
  const live = world.ants.filter((ant) => ant.state !== "dead");
  const spiderAlive = world.enemies.some((enemy) => enemy.type === "spider" && enemy.hp > 0);
  const wantGuards = spiderAlive && live.length >= CONFIG.guardMinWorkers ? CONFIG.guardCount : 0;

  let guards = 0;
  for (const ant of live) {
    if (ant.job !== "guard") {
      continue;
    }
    if (guards >= wantGuards) {
      ant.job = "forage";
      continue;
    }
    guards += 1;
  }

  if (guards >= wantGuards) {
    return;
  }

  // Новобранцы: свободные фуражиры, ближайшие к лагерю.
  const entrance = world.surface.entrance;
  const candidates = live
    .filter((ant) => isFreeForAssignment(ant))
    .sort((a, b) => {
      const da = (a.pos.x - entrance.x) ** 2 + (a.pos.y - entrance.y) ** 2;
      const db = (b.pos.x - entrance.x) ** 2 + (b.pos.y - entrance.y) ** 2;
      return da - db;
    });
  for (const ant of candidates) {
    if (guards >= wantGuards) {
      break;
    }
    ant.job = "guard";
    ant.forageRole = undefined;
    guards += 1;
  }
}

function isFreeForAssignment(ant: Ant): boolean {
  return (
    ant.job === "forage" &&
    ant.forageRole !== "scout" &&
    ant.carrying <= 0 &&
    !ant.carryingDebris &&
    ant.state !== "fight" &&
    ant.state !== "return"
  );
}

// Ресурс достижим, если он есть на складе или остались узлы на карте.
function resourceObtainable(world: World, kind: ResourceKind): boolean {
  if (colonyStock(world, kind) >= 0.5) {
    return true;
  }
  return world.surface.resourceNodes.some((node) => node.kind === kind && node.amount > 0);
}

// Первый недостающий ресурс площадки (дублирует ant/build.neededResource, чтобы не плодить импорт-циклы).
function siteNeededKind(building: Building): ResourceKind | null {
  for (const kind of ["clay", "wood", "stone"] as const) {
    if (building.cost[kind] - building.delivered[kind] > 0.01) {
      return kind;
    }
  }
  return null;
}

// Назначение строителей: до maxBuildersPerSite на площадку, maxActiveBuilders всего.
export function assignBuildJobs(world: World): void {
  const live = world.ants.filter((ant) => ant.state !== "dead");
  const entrance = world.surface.entrance;
  // Приоритет: точечные постройки (хижина/склад) раньше стен; ближние раньше дальних.
  const sites = world.surface.buildings
    .filter((building) => building.colonyId === world.colony.id && building.stage !== "built")
    .filter((building) => {
      // Не гоняем строителей к площадке, чей ресурс сейчас недостижим.
      const kind = siteNeededKind(building);
      return kind === null || resourceObtainable(world, kind);
    })
    .sort((a, b) => {
      const priorityA = a.type === "wall" ? 1 : 0;
      const priorityB = b.type === "wall" ? 1 : 0;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const distanceA = (a.pos.x - entrance.x) ** 2 + (a.pos.y - entrance.y) ** 2;
      const distanceB = (b.pos.x - entrance.x) ** 2 + (b.pos.y - entrance.y) ** 2;
      return distanceA - distanceB;
    });
  const buildReady = world.colony.food >= CONFIG.buildMinFood;

  const perSite = new Map<string, number>();
  let totalBuilders = 0;
  for (const ant of live) {
    if (ant.job !== "build") {
      continue;
    }
    const site = sites.find((building) => building.id === ant.buildTargetId);
    if (!site || !buildReady) {
      if (ant.carrying <= 0) {
        ant.job = "forage";
        ant.buildTargetId = undefined;
        ant.carryKind = undefined;
        continue;
      }
    }
    if (site) {
      perSite.set(site.id, (perSite.get(site.id) ?? 0) + 1);
    }
    totalBuilders += 1;
  }

  if (!buildReady || sites.length === 0) {
    return;
  }

  // Ёмкость: при большом фронте работ строителей больше (до 6).
  const capacity = Math.min(
    sites.length * CONFIG.maxBuildersPerSite,
    sites.length >= 4 ? 6 : CONFIG.maxActiveBuilders
  );

  // Раздача по кругу: каждый проход даёт по одному строителю на площадку,
  // чтобы куча стен не морила хижину и склад голодом.
  for (let pass = 0; pass < CONFIG.maxBuildersPerSite; pass += 1) {
    for (const site of sites) {
      if (totalBuilders >= capacity) {
        return;
      }
      const assigned = perSite.get(site.id) ?? 0;
      if (assigned > pass) {
        continue;
      }
      let best: Ant | null = null;
      let bestDistanceSq = Number.POSITIVE_INFINITY;
      for (const ant of live) {
        if (!isFreeForAssignment(ant)) {
          continue;
        }
        const dx = ant.pos.x - site.pos.x;
        const dy = ant.pos.y - site.pos.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = ant;
        }
      }
      if (!best) {
        return;
      }
      best.job = "build";
      best.buildTargetId = site.id;
      best.forageRole = undefined;
      perSite.set(site.id, assigned + 1);
      totalBuilders += 1;
    }
  }
}

type BuildingList = Building[];
export type { BuildingList };
