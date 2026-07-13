// Строитель (job = "build"): берёт глину/дерево со склада лагеря, несёт на площадку,
// затем стоит рядом и строит. Простой конечный автомат без собственного "ума":
// назначение и снятие строителей решает племя (sim/economy.ts).
import type { Ant, Building } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { completeBuilding, buildRatePerTick } from "../building";
import type { World } from "../world";
import { isColonyStarving } from "./colony-state";
import { moveSurfaceToward } from "./movement";
import { isWithinRadius } from "./utils";
import { consumeFoodStock } from "../foodStock";

const builderWaitTicks = new Map<string, number>();

export function releaseBuilder(ant: Ant): void {
  ant.job = "forage";
  ant.buildTargetId = undefined;
  builderWaitTicks.delete(ant.id);
  if (ant.carrying <= 0) {
    ant.carryKind = undefined;
  }
}

function findBuildTarget(world: World, ant: Ant): Building | undefined {
  if (!ant.buildTargetId) {
    return undefined;
  }
  return world.surface.buildings.find(
    (building) => building.id === ant.buildTargetId && building.colonyId === world.colony.id
  );
}

// Сколько глины нужно на починку размытой дождём постройки.
export function repairClayNeeded(building: Building): number {
  if (building.stage !== "built" || building.hp >= building.maxHp - 0.01) {
    return 0;
  }
  return (building.maxHp - building.hp) / CONFIG.wallRepairHpPerClay;
}

export function neededResource(building: Building): { kind: "clay" | "wood" | "stone"; amount: number } | null {
  if (building.stage === "built") {
    const repair = repairClayNeeded(building);
    return repair > 0.05 ? { kind: "clay", amount: repair } : null;
  }
  for (const kind of ["clay", "wood", "stone"] as const) {
    const left = building.cost[kind] - building.delivered[kind];
    if (left > 0.01) {
      return { kind, amount: left };
    }
  }
  return null;
}

export function moveBuilding(world: World, ant: Ant): boolean {
  const building = findBuildTarget(world, ant);
  if (!building || (building.stage === "built" && repairClayNeeded(building) <= 0.05 && ant.carrying <= 0)) {
    releaseBuilder(ant);
    return false;
  }

  // Голодный строитель подкрепляется у лагеря; без еды на складе — бросает стройку.
  if (ant.energy < CONFIG.lowEnergyThreshold && ant.carrying <= 0) {
    if (isWithinRadius(ant.pos, world.surface.entrance, 5)) {
      if (world.colony.food >= CONFIG.workerMealCost) {
        consumeFoodStock(world.colony, CONFIG.workerMealCost);
        ant.energy = CONFIG.maxEnergy;
      } else {
        releaseBuilder(ant);
        return false;
      }
    } else {
      ant.state = "search";
      moveSurfaceToward(world, ant, world.surface.entrance, true, false);
      return true;
    }
  }

  // Несём материал на площадку (или глину на починку размытой стены).
  if (ant.carrying > 0 && (ant.carryKind === "clay" || ant.carryKind === "wood" || ant.carryKind === "stone")) {
    if (isWithinRadius(ant.pos, building.pos, CONFIG.buildingDeliverRadius)) {
      const kind = ant.carryKind;
      if (building.stage === "built") {
        // Починка: глина размазывается по стене сразу.
        if (kind === "clay") {
          building.hp = Math.min(building.maxHp, building.hp + ant.carrying * CONFIG.wallRepairHpPerClay);
        }
        ant.carrying = 0;
        ant.carryKind = undefined;
        return true;
      }
      building.delivered[kind] = Math.min(building.cost[kind], building.delivered[kind] + ant.carrying);
      ant.carrying = 0;
      ant.carryKind = undefined;
      return true;
    }
    ant.state = "carry";
    moveSurfaceToward(world, ant, building.pos, !isColonyStarving(world));
    return true;
  }

  const needed = neededResource(building);
  if (needed) {
    // Забираем ресурс со склада лагеря.
    if (isWithinRadius(ant.pos, world.surface.entrance, 5)) {
      const stock =
        needed.kind === "clay" ? world.colony.clay : needed.kind === "wood" ? world.colony.wood : world.colony.stone;
      const amount = Math.min(stock, Math.max(0.5, ant.strength * 2), needed.amount);
      if (amount >= 0.5) {
        if (needed.kind === "clay") {
          world.colony.clay -= amount;
        } else if (needed.kind === "wood") {
          world.colony.wood -= amount;
        } else {
          world.colony.stone -= amount;
        }
        ant.carrying = amount;
        ant.carryKind = needed.kind;
        ant.state = "carry";
        return true;
      }
      // Склад пуст: недолго ждём у лагеря (спрос уже поднят), потом идём работать.
      const waited = (builderWaitTicks.get(ant.id) ?? 0) + 1;
      if (waited > 600) {
        releaseBuilder(ant);
        return false;
      }
      builderWaitTicks.set(ant.id, waited);
      ant.state = "idle";
      return true;
    }
    ant.state = "search";
    moveSurfaceToward(world, ant, world.surface.entrance, true, false);
    return true;
  }

  builderWaitTicks.delete(ant.id);

  if (building.stage === "built") {
    // Починка закончена (или нечего нести) — свободен.
    releaseBuilder(ant);
    return false;
  }

  // Всё доставлено: строим.
  if (isWithinRadius(ant.pos, building.pos, CONFIG.buildRadius)) {
    building.stage = "inProgress";
    building.progress += buildRatePerTick(building.type);
    ant.state = "idle";
    if (building.progress >= 1) {
      completeBuilding(world, building);
      releaseBuilder(ant);
    }
    return true;
  }

  ant.state = "search";
  moveSurfaceToward(world, ant, building.pos, !isColonyStarving(world));
  return true;
}
