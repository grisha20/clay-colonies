import type { Ant } from "../../../shared/types";
import { isWaterAt } from "../../../shared/surfaceTerrain";
import { computeDirectives, updateFitness } from "../ai/controller";
import { CONFIG } from "../config";
import { stepAnt, clearDeadAntPaths } from "./ant";
import { clearDeadPanic, triggerPanicAround } from "./ant/combat";
import { updateTickCache, updateWorldSurfaceCache } from "./cache";
import { profiler } from "../utils/profiler";
import { updateEnemies } from "./enemy";
import { assignBuildJobs, assignGuardJobs, assignHarvestJobs } from "./economy";
import { updateObjectives } from "./objectives";
import { updateWeather } from "./weather";
import { assignForageRoles, updateColonyFoodMemory } from "./foodMemory";
import { assignFishingJobs, updateFishPopulation } from "./fishing";
import {
  addAntCorpse,
  addClayRemains,
  cleanupResourceNodes,
  respawnResourceNodes,
  colonyWorldView,
  createWorkerAnt,
  growFoodSources,
  randomHeading,
  respawnCarrion,
  updateResourceNodeGrowth,
  syncColonyStatsForRuntime,
  syncWorldLegacyFields,
  type ColonyRuntime,
  type World
} from "./world";
import { consumeFoodStock } from "./foodStock";
import { updateRaids, updateOutcome, announceDusk } from "./session";
import { updateWildlife } from "./wildlife";
import { updateSettlementAI } from "./settlementAI";
import { updateAdvisor } from "./advisor";
import { updateKilns } from "./kiln";
import { updateSprings } from "./springs";
import { updateSiege } from "./siege";

let scentOffsets: { dx: number; dy: number; falloff: number }[] | null = null;
type ToolKind = "axe" | "pick" | "rod";
const toolCraftProgress = new WeakMap<ColonyRuntime["colony"], { ticks: number; next: ToolKind }>();

function getScentOffsets(radius: number): { dx: number; dy: number; falloff: number }[] {
  if (scentOffsets) {
    return scentOffsets;
  }
  scentOffsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        scentOffsets.push({ dx, dy, falloff: 1 - distance / radius });
      }
    }
  }
  return scentOffsets;
}

function scentFoodSources(world: World): void {
  const offsets = getScentOffsets(CONFIG.foodSourceScentRadius);

  for (const source of [...world.surface.foodSources, ...world.surface.carrion]) {
    if (source.amount <= 0) {
      continue;
    }
    const kind = source.kind ?? (source.id.startsWith("carrion-") ? "carrion" : "food");
    const scentMultiplier =
      kind === "antCorpse" ? CONFIG.antCorpseScentMultiplier : kind === "carrion" ? CONFIG.carrionScentMultiplier : 1;
    const sx = Math.floor(source.pos.x);
    const sy = Math.floor(source.pos.y);
    for (const offset of offsets) {
      world.pheromones.food.add(
        sx + offset.dx,
        sy + offset.dy,
        CONFIG.foodSourceScent * offset.falloff * 5 * scentMultiplier
      );
    }
  }
}

/** Why a resident died, judged from what is left on it. */
export function deathCause(ant: Ant): string {
  const washed = (ant.dissolved ?? 0) >= 1 || (ant.waterExposure ?? 0) >= CONFIG.waterExposureDeathTicks;
  if (washed) return isWaterAt(ant.pos.x, ant.pos.y) || ant.capturedBy ? "water" : "rain";
  if (ant.capturedBy) return "creature";
  if (ant.energy <= 0) return ant.state === "dead" && ant.melee ? "fight" : "hunger";
  return "creature";
}

function removeDeadAndSyncSurface(world: World, colony: ColonyRuntime): void {
  for (const ant of colony.ants) {
    if (ant.state === "dead") {
      const cause = deathCause(ant);
      colony.colony.deaths = { ...(colony.colony.deaths ?? {}), [cause]: (colony.colony.deaths?.[cause] ?? 0) + 1 };
      const scoped = colonyWorldView(world, colony);
      if ((ant.dissolved ?? 0) < 1) addAntCorpse(scoped, ant);
      addClayRemains(scoped, ant);
      triggerPanicAround(scoped, ant.pos);
      world.session.stats.lost += 1;
    }
  }
  colony.ants = colony.ants.filter((ant) => ant.state !== "dead");
  colony.underground.ants = [];
}

// Живой костёр: ест дрова; без дров гаснет; с дровами разгорается обратно.
function updateCampfire(world: World, colony: ColonyRuntime): void {
  if (world.tick % CONFIG.fireWoodEveryTicks !== 0) {
    return;
  }
  const rainMult = world.weather.state === "rain" ? CONFIG.rainFireDecayMult : 1;
  if (colony.colony.wood >= CONFIG.fireWoodCost) {
    colony.colony.wood -= CONFIG.fireWoodCost;
    // В дождь дрова греют хуже.
    colony.colony.fire = Math.min(1, colony.colony.fire + CONFIG.fireRecover / rainMult);
  } else {
    colony.colony.fire = Math.max(0, colony.colony.fire - CONFIG.fireDecay * rainMult);
  }
}

function updateWorkshops(world: World, colony: ColonyRuntime): void {
  const workshopCount = world.surface.buildings.filter(
    (building) => building.colonyId === colony.id && building.type === "workshop" && building.stage === "built"
  ).length;
  if (workshopCount <= 0) {
    toolCraftProgress.delete(colony.colony);
    return;
  }
  const progress = toolCraftProgress.get(colony.colony) ?? { ticks: 0, next: colony.colony.axes <= 0 ? "axe" : colony.colony.picks <= 0 ? "pick" : "rod" };
  // Caps grow with the tribe: three tools for a whole village starved it of wood.
  const extra = Math.floor(colony.ants.filter(a => a.state !== "dead").length / CONFIG.toolCapPerResidents);
  const maxAxes = CONFIG.maxAxes + extra, maxPicks = CONFIG.maxPicks + extra;
  const wantsAxe = colony.colony.axes < maxAxes;
  const wantsPick = colony.colony.picks < maxPicks;
  const wantsRod = colony.colony.rods < CONFIG.maxRods;
  if (!wantsAxe && !wantsPick && !wantsRod) {
    progress.ticks = 0;
    toolCraftProgress.set(colony.colony, progress);
    return;
  }
  const order: ToolKind[] = ["axe", "pick", "rod"];
  const wanted = (tool: ToolKind): boolean => tool === "axe" ? wantsAxe : tool === "pick" ? wantsPick : wantsRod;
  let next = progress.next;
  for (let offset = 0; offset < order.length && !wanted(next); offset += 1) {
    next = order[(order.indexOf(next) + 1) % order.length];
  }
  const cost = next === "axe" ? CONFIG.axeCost : next === "pick" ? CONFIG.pickCost : CONFIG.rodCost;
  if (colony.colony.wood < cost.wood || colony.colony.stone < cost.stone) {
    progress.next = next;
    progress.ticks = 0;
    toolCraftProgress.set(colony.colony, progress);
    return;
  }
  progress.ticks += workshopCount;
  progress.next = next;
  if (progress.ticks >= CONFIG.toolCraftTicks) {
    colony.colony.wood -= cost.wood;
    colony.colony.stone -= cost.stone;
    if (next === "axe") {
      colony.colony.axes = Math.min(maxAxes, colony.colony.axes + 1);
      progress.next = "pick";
    } else if (next === "pick") {
      colony.colony.picks = Math.min(maxPicks, colony.colony.picks + 1);
      progress.next = "rod";
    } else {
      colony.colony.rods = Math.min(CONFIG.maxRods, colony.colony.rods + 1);
      progress.next = "axe";
    }
    progress.ticks = 0;
  }
  toolCraftProgress.set(colony.colony, progress);
}

function updateSurfaceRoyalPair(world: World, colony: ColonyRuntime): void {
  colony.colony.queenAge += 1;
  colony.colony.queenStress = 0;
  colony.colony.princesses = 0;

  if (!colony.colony.queenAlive || colony.colony.growthPaused || colony.colony.alarm || colony.ants.length === 0) {
    return;
  }

  colony.colony.reproductionCooldown = Math.max(0, (colony.colony.reproductionCooldown ?? CONFIG.broodLayCooldownTicks) - 1);
  // Лимит населения: базовая доля мира + бонус за достроенные хижины племени.
  // A house of the clan (level 2) holds twice the residents of a hut.
  const hutPlaces = world.surface.buildings
    .filter((building) => building.colonyId === colony.id && building.type === "hut" && building.stage === "built")
    .reduce((sum, hut) => sum + CONFIG.hutPopulationBonus * ((hut.level ?? 1) >= 2 ? CONFIG.houseLevelPopulation : 1), 0);
  const perColonyCap =
    Math.floor(CONFIG.maxPopulation / Math.max(1, world.colonies.length)) +
    hutPlaces;
  colony.colony.nestCapacity = perColonyCap;
  if (colony.ants.length >= perColonyCap) {
    return;
  }
  if (colony.colony.reproductionCooldown > 0 || colony.colony.food < CONFIG.queenMinFoodReserve + CONFIG.eggCost) {
    return;
  }
  // «Глина — это всё»: нового жителя лепят из глины.
  if (colony.colony.clay < CONFIG.newResidentClayCost + (colony.colony.clayReserve ?? 0)) {
    return;
  }

  colony.colony.clay -= CONFIG.newResidentClayCost;
  consumeFoodStock(colony.colony, CONFIG.eggCost);
  colony.colony.reproductionCooldown = CONFIG.broodLayCooldownTicks;
  const ant = createWorkerAnt(colony.surfaceEntrance, "surface", colony.id);
  ant.job = "forage";
  ant.forageRole = Math.random() < 0.2 ? "scout" : "forager";
  ant.heading = randomHeading();
  ant.pos = {
    x: colony.surfaceEntrance.x + (Math.random() - 0.5) * CONFIG.campSpawnRadius,
    y: colony.surfaceEntrance.y + (Math.random() - 0.5) * CONFIG.campSpawnRadius
  };
  colony.ants.push(ant);
  world.session.stats.born += 1;
}

export function step(world: World): void {
  if (world.session.status !== "playing") return;
  world.tick += 1;
  announceDusk(world);
  updateRaids(world);
  updateSettlementAI(world);
  updateAdvisor(world);
  updateKilns(world);
  updateSprings(world);
  updateSiege(world);

  profiler.measure("phase.weather", () => updateWeather(world));
  profiler.measure("phase.resources", () => {
    respawnCarrion(world);
    growFoodSources(world);
    cleanupResourceNodes(world);
    respawnResourceNodes(world);
    updateResourceNodeGrowth(world);
    updateFishPopulation(world);
  });
  if (world.tick % 5 === 0) {
    profiler.measure("phase.scentFoodSources", () => scentFoodSources(world));
  }

  profiler.measure("phase.colonies.step", () => {
    for (const colony of world.colonies) {
      const scopedWorld = colonyWorldView(world, colony);
      if (world.tick % 10 === 0) {
        updateColonyFoodMemory(scopedWorld);
      }
      colony.directives = computeDirectives(scopedWorld, colony.genomeState.current);
      assignForageRoles(scopedWorld);
      // Shelter suspends work; don't replace assignments while everyone waits.
      if (world.weather.state === "clear") {
        assignHarvestJobs(scopedWorld);
        assignBuildJobs(scopedWorld);
        assignGuardJobs(scopedWorld);
        assignFishingJobs(scopedWorld);
      }
      updateTickCache(scopedWorld);
      profiler.measure("stepAnt", () => {
        for (const ant of colony.ants) {
          stepAnt(scopedWorld, ant);
        }
      });
    }
  });

  syncWorldLegacyFields(world);
  profiler.measure("phase.updateWorldSurfaceCache", () => updateWorldSurfaceCache(world));
  profiler.measure("phase.updateEnemies", () => updateEnemies(world));
  updateWildlife(world);

  profiler.measure("phase.colonies.after", () => {
    for (const colony of world.colonies) {
      const scopedWorld = colonyWorldView(world, colony);
      removeDeadAndSyncSurface(world, colony);
      updateFitness(scopedWorld);
      updateCampfire(world, colony);
      updateWorkshops(world, colony);
      updateSurfaceRoyalPair(world, colony);
      syncColonyStatsForRuntime(colony);
    }
  });

  if (world.tick % 4 === 0) {
    const evap4 = Math.pow(CONFIG.pheromoneEvaporation, 4);
    const diff4 = Math.min(0.9, CONFIG.pheromoneDiffusion * 3.5);
    for (const colony of world.colonies) {
      profiler.measure("pheromone.diffuse", () => {
        colony.homePheromone.evaporateAndDiffuse(evap4, diff4);
      });
    }
    profiler.measure("pheromone.diffuse", () => {
      world.pheromones.food.evaporateAndDiffuse(evap4, diff4);
    });
  }

  if (world.tick % 10 === 0) {
    updateObjectives(world);
  }
  updateOutcome(world);

  if (world.tick % 500 === 0) {
    const activeIds = new Set(world.ants.map((ant) => ant.id));
    clearDeadAntPaths(activeIds);
    clearDeadPanic(activeIds);
  }

  syncWorldLegacyFields(world);
}
