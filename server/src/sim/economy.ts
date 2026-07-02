// Экономика Clayfolk: простой "спрос" племени на глину и дерево.
// Ум на уровне племени: пока запас ниже цели, несколько свободных рабочих
// назначаются сборщиками (job = "harvest") на ближайшие узлы ресурсов.
// Никакого генома: цели заданы константами конфига (позже их заменят приоритеты игрока).
import type { ResourceKind, ResourceNode } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "./world";
import { zoneIndexAt } from "./zones";

export function colonyWantsResource(world: World, kind: ResourceKind): boolean {
  const target = kind === "clay" ? CONFIG.clayReserveTarget : CONFIG.woodReserveTarget;
  const stock = kind === "clay" ? world.colony.clay : world.colony.wood;
  return stock < target + demandFromBuildings(world, kind);
}

// Задел под Фазу 4: недостроенные здания повышают спрос на свои ресурсы.
function demandFromBuildings(_world: World, _kind: ResourceKind): number {
  return 0;
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
  const counts: Record<ResourceKind, number> = { clay: 0, wood: 0 };
  for (const ant of live) {
    if (ant.job !== "harvest") {
      continue;
    }
    const node = nodeById(world, ant.harvestNodeId);
    const kind: ResourceKind | undefined =
      node?.kind ?? (ant.carryKind === "clay" || ant.carryKind === "wood" ? ant.carryKind : undefined);
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

  for (const kind of ["clay", "wood"] as const) {
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
