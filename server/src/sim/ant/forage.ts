import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { resourceNodeTool, resourceNodeYield, type Ant, type Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { activeFoodTarget } from "../foodMemory";
import type { World } from "../world";
import { randomHeading } from "../world";
import { distance, isWithinRadius, normalize, numericAntId } from "./utils";
import {
  applyForbidZones,
  applySpiderAvoidance,
  applySeparation,
  applyWallAvoidance,
  clampToSurface,
  isDugPos,
  moveSurfaceToward,
  moveUndergroundToward,
  surfaceMoveSpeed,
  tryCrossLayer
} from "./movement";
import {
  canUseStorageMeal,
  hasAvailableSurfaceFood,
  isColonyStarving
} from "./colony-state";
import { hasDugRoom } from "./brood";
import { addFoodStock, foodKindForSource, isFoodCarryKind } from "../foodStock";
import { nearestDropPoint } from "../building";
import { surfacePointOpen, surfaceRoute } from "../../../../shared/surfaceNavigation";
import { taskApproach } from "../taskAccess";

export type SurfaceFoodTarget = {
  source: { id: string; pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" };
  list: Array<{ id: string; pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" }>;
  index: number;
};

function foodPriority(source: SurfaceFoodTarget["source"], starving: boolean): number {
  const kind = source.kind ?? "food";
  if (kind === "spiderCarcass") {
    return 1.2;
  }
  if (kind === "food") {
    return 1;
  }
  if (kind === "carrion") {
    return starving ? 0.72 : 0.38;
  }
  return starving ? 0.55 : 0.18;
}

function shouldReturnToNestDuringSearch(world: World, ant: Ant): boolean {
  if (ant.carrying > 0) {
    return false;
  }

  const seed = numericAntId(ant.id) + (ant.colonyId === "colony-2" ? 23 : 0);
  const distFromEntrance = distance(ant.pos, world.surface.entrance);
  const searchTicks = 620 + (seed % 360);
  const checkTicks = 150 + ((seed * 7) % 120);
  const cycleTicks = searchTicks + checkTicks;
  const shiftedTick = world.tick + seed * 41;
  const phase = shiftedTick % cycleTicks;
  const cycle = Math.floor(shiftedTick / cycleTicks);
  const nearEdge =
    ant.pos.x < 10 ||
    ant.pos.x > world.surface.width - 10 ||
    ant.pos.y < 10 ||
    ant.pos.y > world.surface.height - 10;
  const maxReach = Math.hypot(world.surface.width, world.surface.height) * 0.55;
  const excursionLimit = Math.min(
    maxReach,
    70 + (seed % 35) + (cycle % 7) * 34 + Math.min(90, world.tick * 0.012)
  );

  return (
    (phase >= searchTicks && distFromEntrance > 9) ||
    (nearEdge && distFromEntrance > 35) ||
    distFromEntrance > excursionLimit
  );
}

export function scoutDirection(world: World, ant: Ant): Vec2 {
  const seed = numericAntId(ant.id) + (ant.colonyId === "colony-2" ? 19 : 0);
  const sectorAngle = (seed * 2.399963229728653) % (Math.PI * 2);
  const sector = { x: Math.cos(sectorAngle), y: Math.sin(sectorAngle) };
  const fromEntrance = { x: ant.pos.x - world.surface.entrance.x, y: ant.pos.y - world.surface.entrance.y };
  const currentRadius = Math.max(0.01, Math.hypot(fromEntrance.x, fromEntrance.y));
  const radial = { x: fromEntrance.x / currentRadius, y: fromEntrance.y / currentRadius };
  const wave = {
    x: Math.cos(world.tick * 0.023 + seed * 0.71),
    y: Math.sin(world.tick * 0.017 + seed * 1.13)
  };
  if (shouldReturnToNestDuringSearch(world, ant)) {
    return normalize({
      x: world.surface.entrance.x - ant.pos.x + wave.x * 4,
      y: world.surface.entrance.y - ant.pos.y + wave.y * 4
    });
  }
  const edgeMargin = 8;
  const edge = {
    x: ant.pos.x < edgeMargin ? 1 : ant.pos.x > world.surface.width - edgeMargin ? -1 : 0,
    y: ant.pos.y < edgeMargin ? 1 : ant.pos.y > world.surface.height - edgeMargin ? -1 : 0
  };
  const outwardWeight = currentRadius < 10 ? 1.8 : 0.65;
  const lateralSign = seed % 2 === 0 ? 1 : -1;
  const lateral = { x: -radial.y * lateralSign, y: radial.x * lateralSign };
  // Зона добычи: разведчики заметно чаще прочёсывают нарисованную игроком зону.
  const zoneCenter = world.zoneSets?.harvest.size ? world.zoneSets.harvestCenter : null;
  const zonePull = zoneCenter
    ? normalize({ x: zoneCenter.x - ant.pos.x, y: zoneCenter.y - ant.pos.y })
    : { x: 0, y: 0 };
  return normalize({
    x: sector.x * 1.05 + radial.x * outwardWeight + lateral.x * 0.18 + wave.x * 0.7 + edge.x * 1.4 + zonePull.x * 1.1,
    y: sector.y * 1.05 + radial.y * outwardWeight + lateral.y * 0.18 + wave.y * 0.7 + edge.y * 1.4 + zonePull.y * 1.1
  });
}

export function nearestAvailableFood(world: World, ant: Ant): SurfaceFoodTarget | null {
  let nearest: SurfaceFoodTarget | null = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  const starving = isColonyStarving(world);

  for (const list of [world.surface.foodSources, world.surface.carrion]) {
    list.forEach((source, index) => {
      if (source.amount <= 0 || isWaterAt(source.pos.x, source.pos.y)) {
        return;
      }

      const sourceDistance = distance(ant.pos, source.pos);
      const score = sourceDistance / Math.max(0.05, foodPriority(source, starving));
      if (score < nearestScore) {
        nearestScore = score;
        nearest = { source, list, index };
      }
    });
  }

  return nearest;
}

export function pickupFoodIfReached(world: World, ant: Ant, target: SurfaceFoodTarget): boolean {
  const source = target.list[target.index];
  if (!source || source.amount <= 0 || !isWithinRadius(ant.pos, source.pos, CONFIG.foodPickupRadius)) {
    return false;
  }

  const amount = Math.min(source.amount, Math.max(0, ant.strength));
  source.amount = Math.max(0, source.amount - amount);
  ant.energy = CONFIG.maxEnergy;
  ant.carrying = amount;
  ant.carryKind = foodKindForSource(source);
  if (
    ant.forageRole === "scout" ||
    !world.colony.activeFoodTargetId ||
    ant.knownActiveFoodTargetId !== world.colony.activeFoodTargetId
  ) {
    ant.foundFoodSourceId = source.id;
    ant.foundFoodTrail = [...(ant.scoutTrail ?? []), { ...source.pos }];
  }
  ant.state = "carry";
  return true;
}

export function moveHungryToFood(world: World, ant: Ant): boolean {
  const food = nearestVisibleFood(world, ant);
  if (!food) {
    return false;
  }

  if (pickupFoodIfReached(world, ant, food)) {
    return true;
  }

  ant.state = "search";
  ant.job = "forage";
  moveSurfaceToward(world, ant, food.source.pos, !isColonyStarving(world));
  return true;
}

export function moveHungryHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "forage";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

export function moveNurseHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "nurse";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

export function moveDiggerHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "dig";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

function moveSearchingLegacy(world: World, ant: Ant): void {
  ant.job = "forage";
  const speed = surfaceMoveSpeed(world, ant);
  const food = nearestAvailableFood(world, ant);
  if (food && pickupFoodIfReached(world, ant, food)) {
    return;
  }

  const isSuper = food && food.source.kind === "spiderCarcass";
  const approachRange = isSuper ? CONFIG.superFoodDirectApproachRange : CONFIG.foodDirectApproachRange;

  if (food && isWithinRadius(ant.pos, food.source.pos, approachRange)) {
    ant.state = "search";
    moveSurfaceToward(world, ant, food.source.pos, false);
    return;
  }

  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  // Проверяем, есть ли вообще еда на карте
  const foodAvailable = hasAvailableSurfaceFood(world);

  // Если еды нет, градиент феромонов еды не учитываем (чистая разведка)
  const gradient = profiler.measure("stepAnt.surface.pheromoneDirection", () =>
    foodAvailable
      ? world.pheromones.food.sampleGradient(ant.pos.x, ant.pos.y)
      : { x: 0, y: 0, strength: 0 }
  );

  const density = profiler.measure("stepAnt.surface.pheromoneDirection", () =>
    foodAvailable
      ? world.pheromones.food.getInterpolated(ant.pos.x, ant.pos.y)
      : 0
  );

  const jitter = randomHeading();
  const gradientPower = Math.min(2.5, gradient.strength) * CONFIG.pheromoneGradientWeight;
  const nearestFood = food?.source ?? null;
  const nearestFoodDistance = nearestFood ? distance(ant.pos, nearestFood.pos) : Number.POSITIVE_INFINITY;
  const sightRadius = isSuper ? CONFIG.superFoodSightRadius : CONFIG.antFoodSightRadius;
  const directFood =
    nearestFood && nearestFoodDistance <= sightRadius
      ? normalize({ x: nearestFood.pos.x - ant.pos.x, y: nearestFood.pos.y - ant.pos.y })
      : null;

  // Если не видим еду напрямую, но стоим на сильном феромоне — увеличиваем блуждание (локальный поиск)
  const wanderWeight = directFood
    ? world.directives.forageWander * 0.35
    : world.directives.forageWander * (1.0 + Math.min(3.0, density / 4.0));
  const scout = foodAvailable ? null : scoutDirection(world, ant);

  // Вычисляем желаемое направление на основе внешних сил
  const desired = normalize({
    x:
      gradient.x * gradientPower +
      (directFood?.x ?? 0) * 1.4 +
      (scout?.x ?? 0) * 1.35 +
      jitter.x * wanderWeight,
    y:
      gradient.y * gradientPower +
      (directFood?.y ?? 0) * 1.4 +
      (scout?.y ?? 0) * 1.35 +
      jitter.y * wanderWeight
  });

  const safeDesired = isColonyStarving(world)
    ? desired
    : profiler.measure("stepAnt.surface.spiderAvoid", () => applySpiderAvoidance(world, ant.pos, desired, speed));
  const zonedSafeDesired = applyWallAvoidance(world, ant, applyForbidZones(world, ant, safeDesired));
  const finalDesired = profiler.measure("stepAnt.surface.separation", () => applySeparation(world, ant, zonedSafeDesired));

  // Плавная интерполяция к желаемому вектору
  let k = 0.18;
  if (directFood && nearestFoodDistance < 4.0) {
    k = 0.18 + (1.0 - 0.18) * (1.0 - nearestFoodDistance / 4.0);
  }

  const finalDirection = normalize({
    x: ant.heading.x * (1 - k) + finalDesired.x * k,
    y: ant.heading.y * (1 - k) + finalDesired.y * k
  });

  profiler.measure("stepAnt.surface.move", () => {
    ant.heading = finalDirection;
    ant.pos.x += finalDirection.x * speed;
    ant.pos.y += finalDirection.y * speed;
    clampToSurface(ant, world);
  });
}

function nearestVisibleFood(world: World, ant: Ant): SurfaceFoodTarget | null {
  let nearest: SurfaceFoodTarget | null = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  const starving = isColonyStarving(world);
  for (const list of [world.surface.foodSources, world.surface.carrion]) {
    list.forEach((source, index) => {
      if (source.amount <= 0 || isWaterAt(source.pos.x, source.pos.y)) {
        return;
      }
      const isSuper = source.kind === "spiderCarcass";
      const sightRadius = isSuper ? CONFIG.superFoodSightRadius : CONFIG.antFoodSightRadius;
      const sourceDistance = distance(ant.pos, source.pos);
      if (sourceDistance > sightRadius) {
        return;
      }
      const score = sourceDistance / Math.max(0.05, foodPriority(source, starving));
      if (score < nearestScore) {
        nearestScore = score;
        nearest = { source, list, index };
      }
    });
  }
  return nearest;
}

const scoutGoals = new WeakMap<Ant, { pos: Vec2; until: number }>();
function moveScoutSearching(world: World, ant: Ant): void {
  const food = nearestVisibleFood(world, ant);
  if (food && pickupFoodIfReached(world, ant, food)) {
    ant.foundFoodTrail = [...(ant.scoutTrail ?? []), { ...food.source.pos }];
    return;
  }

  if (food) {
    scoutGoals.delete(ant);
    ant.state = "search";
    moveSurfaceToward(world, ant, food.source.pos, !isColonyStarving(world));
    return;
  }

  if (shouldReturnToNestDuringSearch(world, ant)) {
    scoutGoals.delete(ant);
    moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world));
    rememberScoutTrail(world, ant); return;
  }
  let goal = scoutGoals.get(ant);
  if (!goal || world.tick >= goal.until || world.tick < goal.until - 300 || distance(ant.pos, goal.pos) < 2 || !surfacePointOpen(world.surface, goal.pos, ant.colonyId)) {
    scoutGoals.delete(ant); goal = undefined;
    const direction = scoutDirection(world, ant), angle = Math.atan2(direction.y, direction.x);
    // Stable survey points use the same gate/corner/water rules as jobs.
    // Try a small fan only when choosing a point, never a new search each tick.
    for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const pos = { x: Math.max(2, Math.min(world.surface.width - 2, ant.pos.x + Math.cos(angle + turn) * 36)), y: Math.max(2, Math.min(world.surface.height - 2, ant.pos.y + Math.sin(angle + turn) * 36)) };
      if (distance(ant.pos, pos) > 8 && surfacePointOpen(world.surface, pos, ant.colonyId) && surfaceRoute(world.surface, ant.pos, pos, ant.colonyId)) {
        goal = { pos, until: world.tick + 300 }; scoutGoals.set(ant, goal); break;
      }
    }
  }
  if (goal) moveSurfaceToward(world, ant, goal.pos, !isColonyStarving(world));
  rememberScoutTrail(world, ant);
}

function moveAlongFoodTrail(world: World, ant: Ant, targetPos: Vec2, towardFood: boolean): void {
  // Knowledge selects food; motion shares dry, obstacle-aware routes with other jobs.
  moveSurfaceToward(world, ant, towardFood ? targetPos : world.surface.entrance, !isColonyStarving(world), false);
}

function rememberScoutTrail(world: World, ant: Ant): void {
  if (ant.forageRole !== "scout" || ant.layer !== "surface" || ant.carrying > 0) {
    return;
  }
  const trail = ant.scoutTrail ?? [{ ...world.surface.entrance }];
  const last = trail[trail.length - 1];
  if (!last || distance(last, ant.pos) >= 2.5) {
    trail.push({ ...ant.pos });
  }
  ant.scoutTrail = trail.slice(-80);
}

function moveForagerSearching(world: World, ant: Ant): void {
  const target = activeFoodTarget(world);
  if (!target) {
    moveScoutSearching(world, ant);
    return;
  }
  if (ant.knownActiveFoodTargetId !== target.source.id) {
    if (distance(ant.pos, world.surface.entrance) <= 8 || ant.state === "return") {
      ant.knownActiveFoodTargetId = target.source.id;
    } else {
      moveScoutSearching(world, ant);
      return;
    }
  }

  if (pickupFoodIfReached(world, ant, target)) {
    return;
  }

  ant.state = "search";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit * 0.75);
  moveAlongFoodTrail(world, ant, target.source.pos, true);
}

export function moveSearching(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  if (ant.forageRole === "scout") {
    moveScoutSearching(world, ant);
    return;
  }

  moveForagerSearching(world, ant);
}

export function moveCarrying(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit);

  // Фуражир без отчёта разведчика может сдать еду в ближайший склад.
  // Разведчик и носитель отчёта всегда идут к входу: там регистрируется знание о еде.
  if (ant.forageRole !== "scout" && !ant.foundFoodSourceId && isFoodCarryKind(ant.carryKind)) {
    const drop = nearestDropPoint(world, ant.pos);
    const dropIsEntrance = drop.x === world.surface.entrance.x && drop.y === world.surface.entrance.y;
    if (!dropIsEntrance) {
      if (isWithinRadius(ant.pos, drop, CONFIG.dropPointRadius)) {
        addFoodStock(world.colony, ant.carryKind === "meat" ? "meat" : ant.carryKind === "fish" ? "fish" : "fruit", ant.carrying);
        world.fitness.totalFoodDeposited += ant.carrying;
        ant.carrying = 0;
        ant.carryKind = undefined;
        ant.state = "search";
        return;
      }
      ant.state = "carry";
      moveSurfaceToward(world, ant, drop, !isColonyStarving(world), false);
      return;
    }
  }

  const target = ant.forageRole === "forager" ? activeFoodTarget(world) : null;
  if (target) {
    moveAlongFoodTrail(world, ant, target.source.pos, false);
  } else {
    moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  }
  tryCrossLayer(world, ant);
}

export function nearestUndergroundCarrion(world: World, ant: Ant): { index: number; pos: Vec2 } | null {
  let nearest: { index: number; pos: Vec2 } | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  world.underground.carrion.forEach((source, index) => {
    if (source.amount <= 0 || !isDugPos(world, source.pos)) {
      return;
    }
    const sourceDistance = distance(ant.pos, source.pos);
    if (sourceDistance < nearestDistance) {
      nearestDistance = sourceDistance;
      nearest = { index, pos: source.pos };
    }
  });
  return nearest;
}

export function collectUndergroundCarrion(world: World, ant: Ant): boolean {
  if (ant.state !== "idle" || ant.carrying > 0 || !hasDugRoom(world, "storage")) {
    return false;
  }

  const carrion = nearestUndergroundCarrion(world, ant);
  if (!carrion) {
    return false;
  }

  const source = world.underground.carrion[carrion.index];
  if (!source || source.amount <= 0) {
    return false;
  }

  ant.job = "forage";
  if (distance(ant.pos, source.pos) > CONFIG.foodPickupRadius) {
    ant.state = "idle";
    moveUndergroundToward(world, ant, source.pos);
    return true;
  }

  const amount = Math.min(source.amount, Math.max(0.35, ant.strength));
  source.amount = Math.max(0, source.amount - amount);
  ant.carrying = amount;
  ant.carryKind = "meat";
  ant.state = "deposit";
  return true;
}

// Сборщик несёт глину/дерево/камень в ближайшую точку сдачи (вход или склад).
export function moveHarvestCarrying(world: World, ant: Ant): void {
  ant.job = "harvest";
  const target = nearestDropPoint(world, ant.pos);
  if (isWithinRadius(ant.pos, target, CONFIG.dropPointRadius)) {
    const kind = ant.carryKind;
    if (kind === "clay") {
      world.colony.clay += ant.carrying;
    } else if (kind === "wood") {
      world.colony.wood += ant.carrying;
    } else if (kind === "stone") {
      world.colony.stone += ant.carrying;
    }
    ant.carrying = 0;
    ant.carryKind = undefined;
    ant.state = "search";
    return;
  }
  ant.state = "carry";
  moveSurfaceToward(world, ant, target, !isColonyStarving(world), false);
}

// Один шаг сборщика ресурса: дойти до узла, взять кусок, отнести к лагерю.
export function moveHarvesting(world: World, ant: Ant): boolean {
  if (ant.carrying > 0 && (ant.carryKind === "clay" || ant.carryKind === "wood" || ant.carryKind === "stone")) {
    ant.state = "carry";
    moveHarvestCarrying(world, ant);
    return true;
  }

  const node = world.surface.resourceNodes.find(
    (item) => item.id === ant.harvestNodeId && item.amount > 0 && !isWaterAt(item.pos.x, item.pos.y)
  );
  if (!node) {
    ant.job = "forage";
    ant.harvestNodeId = undefined;
    ant.harvestHits = 0;
    return false;
  }

  const requiredTool = resourceNodeTool(node.kind);
  if (
    (node.kind === "tree" && node.growth === "sapling") ||
    (requiredTool === "axe" && world.colony.axes <= 0) ||
    (requiredTool === "pick" && world.colony.picks <= 0)
  ) {
    ant.job = "forage";
    ant.harvestNodeId = undefined;
    ant.harvestHits = 0;
    return false;
  }

  if (isWithinRadius(ant.pos, node.pos, CONFIG.resourcePickupRadius)) {
    ant.harvestHits = (ant.harvestHits ?? 0) + 1;
    ant.state = "idle";
    if (ant.harvestHits < CONFIG.harvestHitTicks * node.hitsPerUnit) {
      return true;
    }
    ant.harvestHits = 0;
    const amount = Math.min(node.amount, Math.max(0.5, Math.min(1, ant.strength)));
    node.amount = Math.max(0, node.amount - amount);
    ant.carrying = amount;
    ant.carryKind = resourceNodeYield(node.kind);
    ant.state = "carry";
    return true;
  }

  ant.state = "search";
  ant.harvestHits = 0;
  const approach=taskApproach(world,node.pos,CONFIG.resourcePickupRadius);
  if(!approach){ant.job="forage";ant.harvestNodeId=undefined;return false;}
  moveSurfaceToward(world, ant, approach, !isColonyStarving(world));
  return true;
}
