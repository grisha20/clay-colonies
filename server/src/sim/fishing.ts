import type { Ant, Fish, FishSpecies, Vec2 } from "../../../shared/types";
import {
  LAKE_DEFINITIONS,
  SURFACE_TERRAIN_CELL_SIZE,
  lakeFieldAt,
  lakeIdAt
} from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { isSurfaceBlockedAt, nearestDropPoint } from "./building";
import { isWithinRadius } from "./ant/utils";
import { zoneIndexAt } from "./zones";
import type { World } from "./world";
import { moveSurfaceToward } from "./ant/movement";
import { addFoodStock } from "./foodStock";

type FishingSpot = { lakeId: Fish["lakeId"]; stand: Vec2; lure: Vec2 };

const SPECIES: readonly FishSpecies[] = ["gold", "blue", "silver", "red"];
const spotCache = new Map<string, FishingSpot[]>();

function seededUnit(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function spawnPoint(lakeId: Fish["lakeId"], salt: number): Vec2 {
  const lake = LAKE_DEFINITIONS.find((item) => item.id === lakeId)!;
  const minX = Math.min(...lake.outline.map((point) => point.x));
  const maxX = Math.max(...lake.outline.map((point) => point.x));
  const minY = Math.min(...lake.outline.map((point) => point.y));
  const maxY = Math.max(...lake.outline.map((point) => point.y));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const x = minX + seededUnit(lake.seed + salt * 97 + attempt * 31) * (maxX - minX);
    const y = minY + seededUnit(lake.seed + salt * 193 + attempt * 47) * (maxY - minY);
    if (lakeIdAt(x, y) === lakeId && lakeFieldAt(x, y) > 0.2) {
      return { x, y };
    }
  }
  const center = lake.outline.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: center.x / lake.outline.length, y: center.y / lake.outline.length };
}

export function createInitialFishPopulation(): Fish[] {
  const fish: Fish[] = [];
  for (const lake of LAKE_DEFINITIONS) {
    for (let index = 0; index < CONFIG.fishPerLake; index += 1) {
      const angle = seededUnit(lake.seed + index * 13) * Math.PI * 2;
      fish.push({
        id: `fish-${lake.id}-${index + 1}`,
        lakeId: lake.id,
        species: SPECIES[index % SPECIES.length],
        state: "swim",
        pos: spawnPoint(lake.id, index + 1),
        heading: { x: Math.cos(angle), y: Math.sin(angle) }
      });
    }
  }
  return fish;
}

function activeFisher(world: World, id: string | undefined): Ant | undefined {
  if (!id) {
    return undefined;
  }
  return world.ants.find(
    (ant) => ant.id === id && ant.state !== "dead" && ant.job === "fish" && ant.fishingTargetId !== undefined
  );
}

function moveFishToward(fish: Fish, target: Vec2, speed: number): void {
  const dx = target.x - fish.pos.x;
  const dy = target.y - fish.pos.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.001) {
    return;
  }
  const heading = { x: dx / distance, y: dy / distance };
  const step = Math.min(distance, speed);
  const next = { x: fish.pos.x + heading.x * step, y: fish.pos.y + heading.y * step };
  if (lakeIdAt(next.x, next.y) === fish.lakeId && lakeFieldAt(next.x, next.y) > 0.04) {
    fish.pos = next;
    fish.heading = heading;
  }
}

function normalizedHeading(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function rotatedHeading(heading: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: heading.x * cos - heading.y * sin, y: heading.x * sin + heading.y * cos };
}

function turnFishToward(fish: Fish, desired: Vec2, blend: number = CONFIG.fishTurnBlend): void {
  fish.heading = normalizedHeading(
    fish.heading.x * (1 - blend) + desired.x * blend,
    fish.heading.y * (1 - blend) + desired.y * blend
  );
}

function deeperWaterHeading(fish: Fish): Vec2 {
  let best = fish.heading;
  let bestDepth = -Number.POSITIVE_INFINITY;
  // Probe a broad fan around the current course. The depth field is shared by
  // all fish, so shoreline avoidance stays cheap and deterministic.
  for (let step = -4; step <= 4; step += 1) {
    const candidate = rotatedHeading(fish.heading, step * Math.PI / 4);
    const x = fish.pos.x + candidate.x * CONFIG.fishShoreLookAhead;
    const y = fish.pos.y + candidate.y * CONFIG.fishShoreLookAhead;
    const depth = lakeIdAt(x, y) === fish.lakeId ? lakeFieldAt(x, y) : -1;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = candidate;
    }
  }
  return best;
}

/** Advances visible fish and restores caught individuals after their own cooldown. */
export function updateFishPopulation(world: World): void {
  for (let index = 0; index < world.surface.fish.length; index += 1) {
    const fish = world.surface.fish[index];
    if (fish.state === "respawning") {
      if ((fish.respawnAt ?? Number.POSITIVE_INFINITY) <= world.tick) {
        fish.state = "swim";
        fish.pos = spawnPoint(fish.lakeId, world.tick + index * 17);
        const angle = seededUnit(world.tick + index * 101) * Math.PI * 2;
        fish.heading = { x: Math.cos(angle), y: Math.sin(angle) };
        fish.respawnAt = undefined;
      }
      continue;
    }

    const fisher = activeFisher(world, fish.targetAntId);
    if (fish.targetAntId && (!fisher || fisher.fishingTargetId !== fish.id)) {
      fish.targetAntId = undefined;
      fish.lurePos = undefined;
      fish.state = "swim";
    }

    if (fish.state === "lured" && fish.lurePos && fisher) {
      moveFishToward(fish, fish.lurePos, CONFIG.fishLureSpeed);
      continue;
    }

    if ((world.tick + index * 29) % CONFIG.fishTurnEveryTicks === 0) {
      const wander = (seededUnit(world.tick + index * 997) * 2 - 1) * CONFIG.fishWanderAngle;
      turnFishToward(fish, rotatedHeading(fish.heading, wander));
    }
    if ((world.tick + index * 7) % 10 === 0) {
      const lookAhead = {
        x: fish.pos.x + fish.heading.x * CONFIG.fishShoreLookAhead,
        y: fish.pos.y + fish.heading.y * CONFIG.fishShoreLookAhead
      };
      if (lakeIdAt(lookAhead.x, lookAhead.y) !== fish.lakeId || lakeFieldAt(lookAhead.x, lookAhead.y) < 0.14) {
        turnFishToward(fish, deeperWaterHeading(fish));
      }
    }
    const next = {
      x: fish.pos.x + fish.heading.x * CONFIG.fishSwimSpeed,
      y: fish.pos.y + fish.heading.y * CONFIG.fishSwimSpeed
    };
    if (lakeIdAt(next.x, next.y) === fish.lakeId && lakeFieldAt(next.x, next.y) > 0.08) {
      fish.pos = next;
    } else {
      turnFishToward(fish, deeperWaterHeading(fish), 0.28);
    }
  }
}

function fishingSpots(world: World): FishingSpot[] {
  const key = `${world.surface.width}x${world.surface.height}`;
  const cached = spotCache.get(key);
  if (cached) {
    return cached;
  }
  const spots: FishingSpot[] = [];
  const cell = SURFACE_TERRAIN_CELL_SIZE;
  const directions = [
    { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }
  ];
  for (let y = cell / 2; y < world.surface.height; y += cell) {
    for (let x = cell / 2; x < world.surface.width; x += cell) {
      const lakeId = lakeIdAt(x, y);
      if (!lakeId) {
        continue;
      }
      for (const direction of directions) {
        const stand = { x: x + direction.x * cell, y: y + direction.y * cell };
        if (
          stand.x < 0 || stand.y < 0 || stand.x >= world.surface.width || stand.y >= world.surface.height ||
          lakeIdAt(stand.x, stand.y)
        ) {
          continue;
        }
        // Place both points close to the common cell edge: the fisher remains dry and the float remains wet.
        const lure = { x: x + direction.x * cell * 0.22, y: y + direction.y * cell * 0.22 };
        const dry = { x: x + direction.x * cell * 0.78, y: y + direction.y * cell * 0.78 };
        if (lakeIdAt(lure.x, lure.y) === lakeId && !lakeIdAt(dry.x, dry.y)) {
          spots.push({ lakeId, stand: dry, lure });
        }
      }
    }
  }
  spotCache.set(key, spots);
  return spots;
}

function releaseFish(world: World, ant: Ant): void {
  const target = world.surface.fish.find((fish) => fish.id === ant.fishingTargetId);
  if (target?.targetAntId === ant.id && target.state !== "respawning") {
    target.targetAntId = undefined;
    target.lurePos = undefined;
    target.state = "swim";
  }
  ant.fishingTargetId = undefined;
  ant.fishingStandPos = undefined;
  ant.fishingLurePos = undefined;
  ant.fishingTicks = 0;
}

function fallbackToForaging(world: World, ant: Ant): void {
  releaseFish(world, ant);
  ant.job = "forage";
  ant.forageRole = "forager";
  ant.state = "search";
}

function foragersLeft(world: World): number {
  return world.ants.filter(
    (ant) => ant.state !== "dead" && ant.job === "forage" && ant.forageRole !== "scout"
  ).length;
}

function validSpot(world: World, spot: FishingSpot): boolean {
  return (
    !isSurfaceBlockedAt(world, spot.stand.x, spot.stand.y, world.colony.id) &&
    !world.zoneSets?.forbid.has(zoneIndexAt(spot.stand.x, spot.stand.y))
  );
}

function assignTarget(world: World, ant: Ant, fish: Fish): boolean {
  let best: FishingSpot | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const spot of fishingSpots(world)) {
    if (spot.lakeId !== fish.lakeId || !validSpot(world, spot)) {
      continue;
    }
    const occupied = world.ants.some(
      (other) => other.id !== ant.id && other.job === "fish" && other.fishingStandPos && isWithinRadius(other.fishingStandPos, spot.stand, 2)
    );
    if (occupied) {
      continue;
    }
    const score = Math.hypot(ant.pos.x - spot.stand.x, ant.pos.y - spot.stand.y) +
      Math.hypot(fish.pos.x - spot.lure.x, fish.pos.y - spot.lure.y) * 0.3;
    if (score < bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  if (!best) {
    return false;
  }
  ant.job = "fish";
  ant.forageRole = undefined;
  ant.fishingTargetId = fish.id;
  ant.fishingStandPos = { ...best.stand };
  ant.fishingLurePos = { ...best.lure };
  ant.fishingTicks = 0;
  fish.targetAntId = ant.id;
  return true;
}

/** Assigns rods and targets; an exhausted population immediately releases fishers to food gathering. */
export function assignFishingJobs(world: World): void {
  const wanted = Math.max(0, Math.min(40, Math.floor(world.colony.priorities?.fish ?? 0)));
  const cap = Math.min(wanted, world.colony.rods ?? 0);
  const active = world.ants.filter((ant) => ant.state !== "dead" && ant.job === "fish");
  let retained = 0;
  for (const ant of active) {
    if (ant.carryKind === "fish" && ant.carrying > 0) {
      retained += 1;
      continue;
    }
    const target = world.surface.fish.find(
      (fish) => fish.id === ant.fishingTargetId && fish.state !== "respawning" && fish.targetAntId === ant.id
    );
    if (retained >= cap || !target) {
      fallbackToForaging(world, ant);
    } else {
      retained += 1;
    }
  }

  if (retained >= cap) {
    return;
  }
  const availableFish = world.surface.fish.filter(
    (fish) => fish.state === "swim" && !fish.targetAntId
  );
  if (availableFish.length === 0) {
    return;
  }
  const candidates = world.ants.filter(
    (ant) =>
      ant.state !== "dead" && ant.job === "forage" && ant.forageRole !== "scout" && ant.carrying <= 0 &&
      ant.state !== "fight" && ant.state !== "return"
  );
  for (const ant of candidates) {
    if (retained >= cap || availableFish.length === 0 || foragersLeft(world) <= CONFIG.minForagers) {
      break;
    }
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < availableFish.length; index += 1) {
      const fish = availableFish[index];
      const distance = (ant.pos.x - fish.pos.x) ** 2 + (ant.pos.y - fish.pos.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && assignTarget(world, ant, availableFish[bestIndex])) {
      availableFish.splice(bestIndex, 1);
      retained += 1;
    }
  }
}

function deliverFish(world: World, ant: Ant): void {
  const drop = nearestDropPoint(world, ant.pos);
  if (isWithinRadius(ant.pos, drop, CONFIG.dropPointRadius)) {
    addFoodStock(world.colony, "fish", ant.carrying);
    ant.carrying = 0;
    ant.carryKind = undefined;
    ant.caughtFishSpecies = undefined;
    fallbackToForaging(world, ant);
    return;
  }
  ant.state = "carry";
  moveSurfaceToward(world, ant, drop, true, false);
}

/** Returns true while the fishing job owns this ant's movement/action. */
export function moveFishing(world: World, ant: Ant): boolean {
  if (ant.job !== "fish") {
    return false;
  }
  if (ant.carryKind === "fish" && ant.carrying > 0) {
    deliverFish(world, ant);
    return true;
  }
  const fish = world.surface.fish.find(
    (candidate) => candidate.id === ant.fishingTargetId && candidate.state !== "respawning" && candidate.targetAntId === ant.id
  );
  if (!fish || !ant.fishingStandPos || !ant.fishingLurePos) {
    fallbackToForaging(world, ant);
    return false;
  }
  if (!isWithinRadius(ant.pos, ant.fishingStandPos, CONFIG.fishingStandRadius)) {
    ant.state = "search";
    moveSurfaceToward(world, ant, ant.fishingStandPos, true, false);
    return true;
  }

  ant.state = "idle";
  const dx = ant.fishingLurePos.x - ant.pos.x;
  const dy = ant.fishingLurePos.y - ant.pos.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  ant.heading = { x: dx / distance, y: dy / distance };
  ant.fishingTicks = (ant.fishingTicks ?? 0) + 1;
  fish.state = "lured";
  fish.lurePos = { ...ant.fishingLurePos };

  if ((ant.fishingTicks ?? 0) < CONFIG.fishingMinCastTicks || !isWithinRadius(fish.pos, ant.fishingLurePos, CONFIG.fishingBiteRadius)) {
    return true;
  }

  const respawnRange = Math.max(0, CONFIG.fishRespawnMaxTicks - CONFIG.fishRespawnMinTicks);
  fish.state = "respawning";
  fish.respawnAt = world.tick + CONFIG.fishRespawnMinTicks + Math.floor(seededUnit(world.tick + fish.id.length * 37) * respawnRange);
  fish.targetAntId = undefined;
  fish.lurePos = undefined;
  ant.carrying = CONFIG.fishFoodYield;
  ant.carryKind = "fish";
  ant.caughtFishSpecies = fish.species;
  ant.state = "carry";
  ant.fishingTargetId = undefined;
  ant.fishingStandPos = undefined;
  ant.fishingLurePos = undefined;
  ant.fishingTicks = 0;
  return true;
}
