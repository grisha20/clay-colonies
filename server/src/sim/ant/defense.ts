import type { Ant, Vec2 } from "../../../../shared/types";
import { LAKE_DEFINITIONS, isWaterAt } from "../../../../shared/surfaceTerrain";
import { CONFIG } from "../../config";
import type { World } from "../world";
import { isWallBlockedAt, isSurfaceBlockedAt } from "../building";
import { surfaceRoute } from "../../../../shared/surfaceNavigation";
import { moveSurfaceToward, tryCrossLayer } from "./movement";
import { dissolveAnt } from "../water";
import { consumeFoodStock } from "../foodStock";
import { markMelee, settleMeleePosition } from "../melee";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const refuges = new WeakMap<Ant, { enemyId: string; origin: Vec2; goal: Vec2; until: number }>();
let shorePoints: Vec2[] | undefined;
function waterBanks(): Vec2[] {
  if (shorePoints) return shorePoints;
  shorePoints = [];
  for (const lake of LAKE_DEFINITIONS) {
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
    if (dist(ant.pos, world.surface.entrance) > 4) moveSurfaceToward(world, ant, world.surface.entrance, true, false);
    else if (world.colony.food >= CONFIG.workerMealCost) { consumeFoodStock(world.colony, CONFIG.workerMealCost); ant.energy = CONFIG.maxEnergy; }
    ant.state = "return";
    return true;
  }
  const target = world.enemies.filter(e => e.hp > 0 && dist(e.pos, post) < CONFIG.guardEngageRadius && dist(e.pos, ant.pos) < CONFIG.waterShotRange)
    .sort((a, b) => Number(!!b.captiveId) - Number(!!a.captiveId) || dist(a.pos, ant.pos) - dist(b.pos, ant.pos))[0];
  const intruder = world.colonies.filter(c => c.id !== ant.colonyId).flatMap(c => c.ants).find(a => a.state !== "dead" && !a.capturedBy && dist(a.pos, post) < 20 && dist(a.pos, ant.pos) <= CONFIG.waterShotRange && world.tick >= CONFIG.colonyGraceTicks);
  const water = !!world.colony.waterWeapons;
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
  if (target || (water && intruder)) {
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
        else dissolveAnt(intruder!, CONFIG.waterShotExposure, world);
      }
    } else if (target) {
      if (distance <= 4 && shotIsClear(world, ant.pos, target.pos)) {
        settleMeleePosition(world, ant, target.pos);
        ant.state = "fight";
        if (markMelee(ant, target.pos, world.tick)) { target.hp -= 22 * ant.strength; target.lastHitColonyId = ant.colonyId; }
      } else if (dist(target.pos, post) < CONFIG.guardEngageRadius) moveSurfaceToward(world, ant, target.pos, false);
    }
    return true;
  }
  ant.state = "idle";
  if (dist(ant.pos, post) > 2) moveSurfaceToward(world, ant, post, true, false);
  return true;
}

/** Alarm and visible danger take precedence over ordinary jobs. Cargo is kept. */
export function moveToSafety(world: World, ant: Ant): boolean {
  if (ant.job === "guard") return false;
  let refuge = refuges.get(ant);
  const rememberedId = refuge?.enemyId;
  const remembered = rememberedId && world.enemies.find(e => e.id === rememberedId && e.hp > 0);
  const home = world.surface.entrance;
  const danger = world.enemies.find(e => e.hp > 0 && dist(e.pos, ant.pos) < 11) ??
    (remembered && (world.tick < refuge!.until || dist(remembered.pos, home) < 14) ? remembered : undefined);
  if (!danger) { refuges.delete(ant); refuge = undefined; }
  if (!world.colony.alarm && !danger && (ant.rescuedUntil ?? 0) <= world.tick) return false;
  if (!world.colony.alarm && danger?.type === "spider" && ant.carrying <= 0 &&
      (danger.raid || world.ants.filter(a => a.state !== "dead").length > 10) &&
      dist(danger.pos, world.surface.entrance) < CONFIG.guardEngageRadius &&
      (ant.state === "fight" || world.ants.filter(a => a.state === "fight" && a.job !== "guard").length < CONFIG.defenseMaxHelpers)) return false;
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
      if (!isWaterAt(away.x, away.y) && !isWallBlockedAt(world, away.x, away.y, ant.colonyId)) {
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
