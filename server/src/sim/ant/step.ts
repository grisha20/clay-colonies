import type { Ant } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { resolveWallCollision } from "../building";
import type { World } from "../world";
import { isWithinRadius } from "./utils";
import { moveBuilding } from "./build";
import { moveGuarding } from "./guard";
import { tryCrossLayer } from "./movement";
import { canUseStorageMeal, shouldReturnFromSurface } from "./colony-state";
import { handleEnemyColonyCombat, moveFighting } from "./combat";
import {
  moveCarrying,
  moveHarvestCarrying,
  moveHarvesting,
  moveHungryHome,
  moveHungryToFood,
  moveSearching,
  moveCarryingDebris,
  moveSearchingDebris,
  nearestAvailableFood
} from "./forage";

export { clearDeadAntPaths } from "./movement";

export function stepSurface(world: World, ant: Ant): void {
  if (
    (ant.forageRole === "scout" || (ant.forageRole === "forager" && !!world.colony.activeFoodTargetId)) &&
    ant.state === "return" &&
    ant.carrying <= 0 &&
    ant.energy >= CONFIG.lowEnergyThreshold
  ) {
    ant.state = "search";
  }

  if ((ant.state === "return" || ant.state === "carry" || ant.carrying > 0) && tryCrossLayer(world, ant)) {
    return;
  }

  if ((ant.surfaceExitCooldown ?? 0) > 0) {
    ant.surfaceExitCooldown = Math.max(0, (ant.surfaceExitCooldown ?? 0) - 1);
  }

  if (profiler.measure("stepAnt.surface.combat", () => handleEnemyColonyCombat(world, ant))) {
    return;
  }

  if (ant.job === "build" && moveBuilding(world, ant)) {
    return;
  }

  if (ant.state === "carry") {
    if (ant.carryKind && ant.carryKind !== "food") {
      moveHarvestCarrying(world, ant);
      return;
    }
    moveCarrying(world, ant);
    return;
  }

  if (ant.carryingDebris) {
    moveCarryingDebris(world, ant);
    return;
  }

  if (profiler.measure("stepAnt.surface.combat", () => moveFighting(world, ant))) {
    return;
  }

  if (ant.state === "return" || (ant.forageRole !== "scout" && shouldReturnFromSurface(world, ant))) {
    moveHungryHome(world, ant);
    return;
  }

  const refuelThreshold = ant.forageRole === "scout" ? CONFIG.lowEnergyThreshold : world.directives.refuelThreshold;

  if (ant.energy < CONFIG.lowEnergyThreshold && canUseStorageMeal(world, true)) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.energy < refuelThreshold && moveHungryToFood(world, ant)) {
    return;
  }

  if (ant.energy < refuelThreshold && canUseStorageMeal(world)) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.job === "guard" && ant.carrying <= 0 && moveGuarding(world, ant)) {
    return;
  }

  if (ant.job === "harvest" && moveHarvesting(world, ant)) {
    return;
  }

  if (ant.job === "idle" && moveSearchingDebris(world, ant)) {
    return;
  }

  if (ant.carrying <= 0 && !ant.carryingDebris) {
    const food = nearestAvailableFood(world, ant);
    const hasCloseFood = food && isWithinRadius(ant.pos, food.source.pos, CONFIG.antFoodSightRadius);
    if (!hasCloseFood && world.ants.length > 10 && world.colony.food > 20 && Math.random() < 0.0003) {
      ant.job = "idle";
      if (moveSearchingDebris(world, ant)) {
        return;
      }
    }
  }

  ant.state = "search";
  ant.job = ant.job === "idle" ? "idle" : "forage";
  moveSearching(world, ant);
}

export function stepAnt(world: World, ant: Ant): void {
  if (ant.state === "dead") {
    return;
  }

  ant.layer = "surface";
  ant.energy -= CONFIG.energyDrainPerTick;

  if (ant.energy <= 0) {
    if (canUseStorageMeal(world, true)) {
      world.colony.food -= CONFIG.workerMealCost;
      ant.energy = CONFIG.maxEnergy;
      ant.state = "search";
    } else {
      ant.state = "dead";
      return;
    }
  }

  const prevX = ant.pos.x;
  const prevY = ant.pos.y;
  stepSurface(world, ant);
  // Достроенные стены непроходимы: скольжение вдоль стены или откат.
  resolveWallCollision(world, ant.pos, prevX, prevY);
}
