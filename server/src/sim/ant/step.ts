import type { Ant } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { resolveSurfaceCollision } from "../building";
import type { World } from "../world";
import { moveBuilding } from "./build";
import { moveGuarding } from "./guard";
import { tryCrossLayer, updateStuckTracking } from "./movement";
import { canUseStorageMeal } from "./colony-state";
import { handleEnemyColonyCombat, moveFighting, movePanicking } from "./combat";
import {
  moveCarrying,
  moveHarvestCarrying,
  moveHarvesting,
  moveHungryHome,
  moveHungryToFood,
  moveSearching
} from "./forage";
import { moveFishing, releaseFish } from "../fishing";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { consumeFoodStock } from "../foodStock";
import { dissolveAnt } from "../water";
import { moveDefending, moveToSafety } from "./defense";
import { moveToRainShelter } from "./shelter";
import { isSheltered } from "../weather";

export { clearDeadAntPaths } from "./movement";

export function updateWaterExposure(ant: Ant, world?: World): boolean {
  if (isWaterAt(ant.pos.x, ant.pos.y)) {
    dissolveAnt(ant, CONFIG.waterExposurePerTick, world);
    return ant.state === "dead";
  }
  if (world?.weather.state === "rain" && !isSheltered(world, ant.pos)) {
    ant.waterExposure = Math.min(CONFIG.waterExposureDeathTicks, (ant.waterExposure ?? 0) + CONFIG.rainExposurePerTick);
    if (ant.waterExposure >= CONFIG.rainErosionWetness) dissolveAnt(ant, CONFIG.rainErosionPerTick, world);
    return ant.state === "dead";
  }
  const byFire = world && (world.colony.fire ?? 0) > 0.05 && Math.hypot(ant.pos.x - world.surface.entrance.x, ant.pos.y - world.surface.entrance.y) <= CONFIG.rainShelterFireRadius;
  const drying = world?.weather.state === "rain" && !byFire ? CONFIG.rainHutDryingPerTick : CONFIG.waterDryingPerTick;
  ant.waterExposure = Math.max(0, (ant.waterExposure ?? 0) - drying);
  return false;
}

export function stepSurface(world: World, ant: Ant): void {
  const hadCast=ant.job==="fish"||!!ant.fishingTargetId;
  if (moveToSafety(world, ant) || moveToRainShelter(world, ant) || moveDefending(world, ant)) {if(hadCast)releaseFish(world,ant);return;}
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

  // Settlement assignment already controls the workforce. The legacy random
  // recall fought the food route, reversing healthy workers every few ticks.
  if (ant.state === "return") {
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
  if (ant.capturedBy) { if(ant.fishingTargetId)releaseFish(world,ant);updateWaterExposure(ant, world); return; }
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
  if (updateWaterExposure(ant, world)) {
    return;
  }
  updateStuckTracking(world, ant);
}
