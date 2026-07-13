import type { Ant } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { resolveSurfaceCollision } from "../building";
import type { World } from "../world";
import { moveBuilding } from "./build";
import { moveGuarding } from "./guard";
import { tryCrossLayer, updateStuckTracking } from "./movement";
import { canUseStorageMeal, shouldReturnFromSurface } from "./colony-state";
import { handleEnemyColonyCombat, moveFighting, movePanicking } from "./combat";
import {
  moveCarrying,
  moveHarvestCarrying,
  moveHarvesting,
  moveHungryHome,
  moveHungryToFood,
  moveSearching
} from "./forage";
import { moveFishing } from "../fishing";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { consumeFoodStock } from "../foodStock";

export { clearDeadAntPaths } from "./movement";

export function updateWaterExposure(ant: Ant): boolean {
  if (isWaterAt(ant.pos.x, ant.pos.y)) {
    ant.waterExposure = (ant.waterExposure ?? 0) + CONFIG.waterExposurePerTick;
    if (ant.waterExposure >= CONFIG.waterExposureDeathTicks) {
      ant.state = "dead";
      return true;
    }
    return false;
  }
  ant.waterExposure = Math.max(0, (ant.waterExposure ?? 0) - CONFIG.waterDryingPerTick);
  return false;
}

export function stepSurface(world: World, ant: Ant): void {
  if (
    (ant.forageRole === "scout" || (ant.forageRole === "forager" && !!world.colony.activeFoodTargetId)) &&
    ant.state === "return" &&
    ant.carrying <= 0 &&
    ant.energy >= CONFIG.lowEnergyThreshold
  ) {
    ant.state = "search";
  }

  if (ant.carryKind !== "fish" && (ant.state === "return" || ant.state === "carry" || ant.carrying > 0) && tryCrossLayer(world, ant)) {
    return;
  }

  if ((ant.surfaceExitCooldown ?? 0) > 0) {
    ant.surfaceExitCooldown = Math.max(0, (ant.surfaceExitCooldown ?? 0) - 1);
  }

  if (profiler.measure("stepAnt.surface.combat", () => handleEnemyColonyCombat(world, ant))) {
    return;
  }

  if (movePanicking(world, ant)) {
    return;
  }

  if (ant.job === "build" && moveBuilding(world, ant)) {
    return;
  }

  if (ant.job === "fish" && moveFishing(world, ant)) {
    return;
  }

  if (ant.state === "carry") {
    if (ant.carryKind === "clay" || ant.carryKind === "wood" || ant.carryKind === "stone") {
      moveHarvestCarrying(world, ant);
      return;
    }
    moveCarrying(world, ant);
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
      consumeFoodStock(world.colony, CONFIG.workerMealCost);
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
  resolveSurfaceCollision(world, ant.pos, prevX, prevY, ant.colonyId);
  if (updateWaterExposure(ant)) {
    return;
  }
  updateStuckTracking(world, ant);
}
