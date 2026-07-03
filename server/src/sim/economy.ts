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
    let need = CONFIG.maxHarvestersPerResource - counts[kind];
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

// Назначение строителей: до maxBuildersPerSite на площадку, maxActiveBuilders всего.
export function assignBuildJobs(world: World): void {
  const live = world.ants.filter((ant) => ant.state !== "dead");
  const sites = world.surface.buildings.filter(
    (building) => building.colonyId === world.colony.id && building.stage !== "built"
  );
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

  for (const site of sites) {
    if (totalBuilders >= CONFIG.maxActiveBuilders) {
      break;
    }
    let assigned = perSite.get(site.id) ?? 0;
    while (assigned < CONFIG.maxBuildersPerSite && totalBuilders < CONFIG.maxActiveBuilders) {
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
      assigned += 1;
      totalBuilders += 1;
    }
  }
}

type BuildingList = Building[];
export type { BuildingList };
