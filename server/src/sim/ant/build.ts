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

export function releaseBuilder(ant: Ant): void {
  ant.job = "forage";
  ant.buildTargetId = undefined;
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

export function neededResource(building: Building): { kind: "clay" | "wood"; amount: number } | null {
  const clayLeft = building.cost.clay - building.delivered.clay;
  if (clayLeft > 0.01) {
    return { kind: "clay", amount: clayLeft };
  }
  const woodLeft = building.cost.wood - building.delivered.wood;
  if (woodLeft > 0.01) {
    return { kind: "wood", amount: woodLeft };
  }
  return null;
}

export function moveBuilding(world: World, ant: Ant): boolean {
  const building = findBuildTarget(world, ant);
  if (!building || building.stage === "built") {
    releaseBuilder(ant);
    return false;
  }

  // Голодный строитель подкрепляется у лагеря; без еды на складе — бросает стройку.
  if (ant.energy < CONFIG.lowEnergyThreshold && ant.carrying <= 0) {
    if (isWithinRadius(ant.pos, world.surface.entrance, 5)) {
      if (world.colony.food >= CONFIG.workerMealCost) {
        world.colony.food -= CONFIG.workerMealCost;
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

  // Несём материал на площадку.
  if (ant.carrying > 0 && (ant.carryKind === "clay" || ant.carryKind === "wood")) {
    if (isWithinRadius(ant.pos, building.pos, CONFIG.buildingDeliverRadius)) {
      const kind = ant.carryKind;
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
      const stock = needed.kind === "clay" ? world.colony.clay : world.colony.wood;
      const amount = Math.min(stock, Math.max(0.5, ant.strength * 2), needed.amount);
      if (amount >= 0.5) {
        if (needed.kind === "clay") {
          world.colony.clay -= amount;
        } else {
          world.colony.wood -= amount;
        }
        ant.carrying = amount;
        ant.carryKind = needed.kind;
        ant.state = "carry";
        return true;
      }
      // Склад пуст: ждём у лагеря, спрос на ресурс уже поднят (economy).
      ant.state = "idle";
      return true;
    }
    ant.state = "search";
    moveSurfaceToward(world, ant, world.surface.entrance, true, false);
    return true;
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
