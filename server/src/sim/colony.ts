import type { Colony } from "../../../shared/types";
import { CONFIG } from "../config";

export function createColony(
  id: string,
  foundedTick: number,
  generation: number,
  generationsRun: number,
  bestFitness: number,
  spiderGeneration: number,
  spiderGenerationsRun: number
): Colony {
  return {
    id,
    foundedTick,
    knownFood: [],
    activeFoodTargetId: undefined,
    food: CONFIG.startingFoodStorage,
    population: {
      workers: CONFIG.startingWorkers,
      scouts: CONFIG.startingScouts,
      nurses: 0,
      eggs: 0,
      larvae: 0
    },
    queenAlive: true,
    queenStress: 0,
    queenAge: 0,
    reproductionCooldown: CONFIG.broodLayCooldownTicks,
    princesses: 0,
    nestCapacity: CONFIG.maxPopulation,
    detailLevel: "full",
    generation,
    generationsRun,
    bestFitness,
    spiderGeneration,
    spiderGenerationsRun
  };
}

export function syncColonyStats(
  colony: Colony,
  workerCount: number,
  scoutCount: number,
  nurseCount: number,
  eggCount: number,
  larvaCount: number,
  foodStorage: number,
  queenAlive: boolean,
  queenStress: number,
  queenAge: number,
  reproductionCooldown: number,
  princessCount: number,
  bestFitness: number,
  spiderGeneration: number,
  generationsRun: number,
  spiderGenerationsRun: number
): void {
  colony.food = foodStorage;
  colony.population.workers = workerCount;
  colony.population.scouts = scoutCount;
  colony.population.nurses = nurseCount;
  colony.population.eggs = eggCount;
  colony.population.larvae = larvaCount;
  colony.queenAlive = queenAlive;
  colony.queenStress = queenStress;
  colony.queenAge = queenAge;
  colony.reproductionCooldown = reproductionCooldown;
  colony.princesses = princessCount;
  colony.bestFitness = bestFitness;
  colony.spiderGeneration = spiderGeneration;
  colony.generationsRun = generationsRun;
  colony.spiderGenerationsRun = spiderGenerationsRun;
}
