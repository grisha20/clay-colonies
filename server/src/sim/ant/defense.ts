import type { Ant, Vec2 } from "../../../../shared/types";
import { isWaterAt, lakeDefinitions, surfaceTerrainRevision, isTerrainBlockedAt } from "../../../../shared/surfaceTerrain";
import { CONFIG } from "../../config";
import type { World } from "../world";
import { isWallBlockedAt, isSurfaceBlockedAt, nearestDropPoint } from "../building";
import { surfaceRoute } from "../../../../shared/surfaceNavigation";
import { moveSurfaceToward, tryCrossLayer } from "./movement";
import { dissolveAnt } from "../water";
import { consumeFoodStock } from "../foodStock";
import { markMelee, settleMeleePosition } from "../melee";
import { campShelterPoints } from "../../../../shared/campShelter";
import { taskApproach } from "../taskAccess";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const refuges = new WeakMap<Ant, { enemyId: string; origin: Vec2; goal: Vec2; until: number }>();
let shorePoints: Vec2[] | undefined;
let shoreRevision = -1;
function waterBanks(): Vec2[] {
  if (shorePoints && shoreRevision === surfaceTerrainRevision()) return shorePoints;
  shoreRevision = surfaceTerrainRevision();
  shorePoints = [];
  for (const lake of lakeDefinitions()) {
    for (let j = 0; j < lake.outline.length; j++) {
      const a = lake.outline[j], b = lake.outline[(j + 1) % lake.outline.length];
      const length = dist(a, b);
      for (let offset = 0; offset < length; offset += 6) {
        const center = { x: a.x + (b.x - a.x) * offset / length, y: a.y + (b.y - a.y) * offset / length };
        for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
          const p = { x: center.x + dir.x * 3, y: center.y + dir.y * 3 };
          if (!isWaterAt(p.x, p.y) && isWaterAt(center.x - dir.x, center.y - dir.y)) shorePoints.push(p);
        }
      }
    }
  }
  return shorePoints;
}

export function shotIsClear(world: World, a: Vec2, b: Vec2): boolean {
  const length = dist(a, b);
  for (let t = 1; t < length; t += 0.7) {
    if (isWallBlockedAt(world, a.x + (b.x - a.x) * t / length, a.y + (b.y - a.y) * t / length, world.colony.id)) return false;
  }
  return true;
}

export function moveDefending(world: World, ant: Ant): boolean {
  if (ant.job !== "guard" || ant.carrying > 0) return false;
  const post = world.colony.defensePost ?? world.surface.entrance;
  if (ant.energy < CONFIG.refuelEnergyThreshold) {
    // Eat at the nearest own storage or the hearth: a storage by the border
    // feeds a far post without the long walk home.
    const kitchen = nearestDropPoint(world, ant.pos);
    if (dist(ant.pos, kitchen) > 4) moveSurfaceToward(world, ant, kitchen, true, false);
    else if (world.colony.food >= CONFIG.workerMealCost) { consumeFoodStock(world.colony, CONFIG.workerMealCost); ant.energy = CONFIG.maxEnergy; }
    ant.state = "return";
    return true;
  }
  const target = world.enemies.filter(e => e.hp > 0 && dist(e.pos, post) < CONFIG.guardEngageRadius && dist(e.pos, ant.pos) < CONFIG.waterShotRange)
    .sort((a, b) => Number(!!b.captiveId) - Number(!!a.captiveId) || dist(a.pos, ant.pos) - dist(b.pos, ant.pos))[0];
  const intruder = world.colonies.filter(c => c.id !== ant.colonyId).flatMap(c => c.ants).find(a => a.state !== "dead" && !a.capturedBy && dist(a.pos, post) < 20 && dist(a.pos, ant.pos) <= CONFIG.waterShotRange && world.tick >= CONFIG.colonyGraceTicks);
  const water = !!world.colony.waterWeapons;
  // Without water weapons guards still fight rival guards at their post hand to
  // hand (a siege of a totem is decided here); peaceful passers-by are left alone.
  const rivalGuard = water || world.tick < CONFIG.colonyGraceTicks ? undefined : world.colonies.filter(c => c.id !== ant.colonyId).flatMap(c => c.ants)
    .filter(a => a.state !== "dead" && !a.capturedBy && a.job === "guard" && dist(a.pos, post) < 20 && dist(a.pos, ant.pos) <= CONFIG.waterShotRange)
    .sort((a, b) => dist(a.pos, ant.pos) - dist(b.pos, ant.pos))[0];
  if (water && (ant.waterAmmo ?? 0) <= 0) {
    ant.refillPos ??= waterBanks().filter(p => !isWallBlockedAt(world, p.x, p.y, ant.colonyId))
      .sort((a, b) => dist(a, ant.pos) - dist(b, ant.pos))[0];
    ant.state = "search";
    if (ant.refillPos) {
      if (dist(ant.pos, ant.refillPos) > 1.8) { ant.waterRefillTicks = 0; moveSurfaceToward(world, ant, ant.refillPos, true, false); }
      else {
        ant.waterRefillTicks = (ant.waterRefillTicks ?? 0) + 1;
        if (ant.waterRefillTicks >= CONFIG.waterRefillTicks) {
          ant.waterAmmo = CONFIG.waterAmmoCapacity;
          ant.waterRefillTicks = 0;
          ant.refillPos = undefined;
        }
      }
    }
    return true;
  }
  if (target || (water && intruder) || rivalGuard) {
    const enemy = target ?? intruder!;
    const distance = dist(ant.pos, enemy.pos);
    ant.heading = { x: (enemy.pos.x - ant.pos.x) / Math.max(0.01, distance), y: (enemy.pos.y - ant.pos.y) / Math.max(0.01, distance) };
    ant.state = "idle";
    if (water) {
      if (world.tick >= (ant.nextShotAt ?? 0) && shotIsClear(world, ant.pos, enemy.pos)) {
        ant.nextShotAt = world.tick + CONFIG.waterShotEveryTicks;
        ant.waterAmmo = (ant.waterAmmo ?? 0) - 1;
        ant.shot = { from: { ...ant.pos }, to: { ...enemy.pos }, until: world.tick + 5 };
        if (target) { target.hp -= CONFIG.waterShotDamage * ant.strength; target.lastHitColonyId = ant.colonyId; }
        else {
          // Fired clay holds a water shot like it holds lake water.
          dissolveAnt(intruder!, CONFIG.waterShotExposure * (intruder!.fired ? CONFIG.firedWaterFactor : 1), world);
          intruder!.shotAt = world.tick;
        }
      }
    } else if (target) {
      if (distance <= 4 && shotIsClear(world, ant.pos, target.pos)) {
        settleMeleePosition(world, ant, target.pos);
        ant.state = "fight";
        if (markMelee(ant, target.pos, world.tick)) { target.hp -= 22 * ant.strength; target.lastHitColonyId = ant.colonyId; }
      } else if (dist(target.pos, post) < CONFIG.guardEngageRadius) moveSurfaceToward(world, ant, target.pos, false);
    } else if (rivalGuard) {
      if (distance <= 1.6) {
        settleMeleePosition(world, ant, rivalGuard.pos, 1.6);
        ant.state = "fight";
        if (markMelee(ant, rivalGuard.pos, world.tick)) {
          rivalGuard.energy -= CONFIG.guardMeleeDamage * ant.strength;
          if (rivalGuard.energy <= 0) rivalGuard.state = "dead";
        }
      } else moveSurfaceToward(world, ant, rivalGuard.pos, false);
    }
    return true;
  }
  ant.state = "idle";
  let idlePost = post, arrival = 2;
  const hearth = world.surface.entrances.find(camp => dist(post, camp) < 4);
  if (hearth) {
    // A camp-centred order means guard the hearth, not stand at its centre.
    // Share the spaced outer ring used for shelter; two royal places stay free.
    const peers = world.ants.filter(a => a.job === "guard" && a.state !== "dead" && !a.capturedBy);
    const ordinal = Math.max(0, peers.findIndex(a => a.id === ant.id));
    const slots = campShelterPoints(hearth, world.surface.buildings, world.surface.width, world.surface.height, ant.colonyId, 6).slice(2)
      .filter(p => !!taskApproach(world, p, .15));
    if (!slots.length) return true;
    idlePost = slots[ordinal % slots.length]; arrival = .15;
  }
  if (dist(ant.pos, idlePost) > arrival) moveSurfaceToward(world, ant, idlePost, true, false);
  return true;
}

/** Alarm and visible danger take precedence over ordinary jobs. Cargo is kept. */
export function moveToSafety(world: World, ant: Ant): boolean {
  if (ant.job === "guard") return false;
  let refuge = refuges.get(ant);
  const rememberedId = refuge?.enemyId;
  const remembered = rememberedId && world.enemies.find(e => e.id === rememberedId && e.hp > 0);
  const home = world.surface.entrance;
  // A lake monster still in the water only scares from close by (it grabs at
  // the shore); one that came out on land is as dangerous as anything else.
  const scareRadius = (e: { type: string; pos: Vec2 }) => e.type === "lakeMonster" && isWaterAt(e.pos.x, e.pos.y) ? CONFIG.lakeMonsterScareRadius : 11;
  const danger = world.enemies.find(e => e.hp > 0 && dist(e.pos, ant.pos) < scareRadius(e)) ??
    (remembered && (world.tick < refuge!.until || dist(remembered.pos, home) < 14) ? remembered : undefined);
  if (!danger) { refuges.delete(ant); refuge = undefined; }
  if (!world.colony.alarm && !danger && (ant.rescuedUntil ?? 0) <= world.tick) return false;
  // A spider at the hearth is a call to arms, alarm or not: hands without cargo
  // and with strength left defend the mother; the rest take cover. During a
  // raid more of them rally than for a stray spider.
  if (danger?.type === "spider" && ant.carrying <= 0 && ant.energy > CONFIG.refuelEnergyThreshold &&
      (danger.raid || world.ants.filter(a => a.state !== "dead").length > 10) &&
      dist(danger.pos, world.surface.entrance) < CONFIG.guardEngageRadius &&
      (ant.state === "fight" || world.ants.filter(a => a.state === "fight" && a.job !== "guard").length < CONFIG.defenseMaxHelpers * (danger.raid ? 2 : 1))) return false;
  tryCrossLayer(world, ant);
  ant.state = ant.carrying > 0 ? "carry" : "return";
  if (danger) {
    if (!refuge || refuge.enemyId !== danger.id || dist(refuge.origin, danger.pos) > 4 || isSurfaceBlockedAt(world, refuge.goal.x, refuge.goal.y, ant.colonyId)) {
      const seed = Number(ant.id.replace(/\D/g, "")) || 1;
      const angle = Math.atan2(ant.pos.y - danger.pos.y, ant.pos.x - danger.pos.x) + (seed % 7 - 3) * 0.12;
      refuge = undefined;
      refuges.delete(ant);
      for (const turn of [0, .4, -.4, .8, -.8, 1.3, -1.3, Math.PI]) {
        const goal = { x: danger.pos.x + Math.cos(angle + turn) * 18, y: danger.pos.y + Math.sin(angle + turn) * 18 };
        if (dist(goal, home) >= 7 && !isSurfaceBlockedAt(world, goal.x, goal.y, ant.colonyId) && surfaceRoute(world.surface, ant.pos, goal, ant.colonyId)) {
          refuge = { enemyId: danger.id, origin: { ...danger.pos }, goal, until: world.tick + 80 };
          refuges.set(ant, refuge); break;
        }
      }
    }
    if (refuge) {
      // Hold a safe destination while the hearth is under attack. The old
      // 9-unit threshold alternated homeward and outward steps every tick.
      if (dist(ant.pos, refuge.goal) > .6) moveSurfaceToward(world, ant, refuge.goal, false, false);
      else ant.state = "idle";
      return true;
    }
  }
  if (dist(ant.pos, home) > 4 || danger && dist(danger.pos, home) < 10) {
    if (danger && dist(ant.pos, danger.pos) < 9) {
      const dx = ant.pos.x - danger.pos.x, dy = ant.pos.y - danger.pos.y;
      const d = Math.hypot(dx, dy), side = Number(ant.id.replace(/\D/g, "")) % 2 ? 1 : -1;
      const away = { x: ant.pos.x + (d > 0.01 ? dx / d : side) * 10, y: ant.pos.y + (d > 0.01 ? dy / d : 0.4) * 10 };
      if (!isTerrainBlockedAt(away.x, away.y) && !isWallBlockedAt(world, away.x, away.y, ant.colonyId)) {
        const escapeLength = dist(ant.pos, away);
        ant.heading = { x: (away.x - ant.pos.x) / escapeLength, y: (away.y - ant.pos.y) / escapeLength };
        moveSurfaceToward(world, ant, away, false, false);
        return true;
      }
    }
    moveSurfaceToward(world, ant, home, true, false);
  }
  return true;
}
