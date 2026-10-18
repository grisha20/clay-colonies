import type { Ant, Enemy, Vec2 } from "../../../shared/types";
import { LAKE_DEFINITIONS, isWaterAt, lakeIdAt, type LakeId } from "../../../shared/surfaceTerrain";
import { dayCycle } from "../../../shared/dayCycle";
import { CONFIG } from "../config";
import { calculateSurfacePath } from "./ant/movement";
import { isWallBlockedAt, resolveSurfaceCollision, damageBuilding, wallCellIndexAt } from "./building";
import { dropCarriedFood } from "./ant/combat";
import { logEvent } from "./session";
import { addFoodSource, type World } from "./world";
import { buildingRouteTarget, buildingFootprint, insideBuilding, crossesBuilding, outsideBuilding } from "../../../shared/buildingGeometry";

const routes = new WeakMap<Enemy, { target: Vec2; points: Vec2[]; until: number }>();
const foundationRoutes = new WeakMap<Enemy, { target: Vec2; point: Vec2 }>();
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function nearestDryPosition(world: World, point: Vec2): Vec2 | null {
  for (let radius = 0; radius <= 48; radius += 2) {
    for (let i = 0; i < 16; i++) {
      const p = { x: point.x + Math.cos(i * Math.PI / 8) * radius, y: point.y + Math.sin(i * Math.PI / 8) * radius };
      if (p.x > 2 && p.y > 2 && p.x < world.surface.width - 2 && p.y < world.surface.height - 2 && !isWaterAt(p.x, p.y) && !isWallBlockedAt(world, p.x, p.y)) return p;
    }
  }
  return null;
}

/** Creatures use the same lake bypass as residents and cannot pass through walls.
 * A raiding spider damages the actual obstructing segment before moving. */
export function moveCreature(world: World, enemy: Enemy, target: Vec2, speed: number, breakWalls = false): void {
  let next = target;
  if (enemy.type !== "lakeMonster") {
    let route = routes.get(enemy);
    if (!route || world.tick >= route.until || dist(route.target, target) > 4) {
      route = { target: { ...target }, points: calculateSurfacePath(world, enemy.pos, target, "enemy") ?? [], until: world.tick + 40 };
      routes.set(enemy, route);
    }
    while (route.points.length && dist(enemy.pos, route.points[0]) < 1.5) route.points.shift();
    next = route.points[0] ?? target;
  }
  let foundationRoute = foundationRoutes.get(enemy);
  if (foundationRoute && (dist(foundationRoute.target, next) > 0.2 || dist(enemy.pos, foundationRoute.point) < 1.2)) { foundationRoutes.delete(enemy); foundationRoute = undefined; }
  const aim = foundationRoute?.point ?? buildingRouteTarget(world.surface.buildings, enemy.pos, next);
  if (!foundationRoute && dist(aim, next) > 0.1 && dist(aim, enemy.pos) > 0.1) foundationRoutes.set(enemy, { target: { ...next }, point: aim });
  next = aim;
  const d = dist(enemy.pos, next);
  if (d < 0.01) return;
  const step = Math.min(speed, d);
  const candidate = { x: enemy.pos.x + (next.x - enemy.pos.x) / d * step, y: enemy.pos.y + (next.y - enemy.pos.y) / d * step };
  if (breakWalls) {
    const cell = wallCellIndexAt(candidate.x, candidate.y);
    const wall = world.surface.buildings.find(b => b.stage === "built" && (b.type === "wall" || b.type === "gate") && wallCellIndexAt(b.pos.x, b.pos.y) === cell);
    if (wall) { damageBuilding(world, wall, CONFIG.raidBuildingDamage); return; }
  }
  if (enemy.type !== "lakeMonster" && isWaterAt(candidate.x, candidate.y)) return;
  const before = { ...enemy.pos };
  enemy.pos.x = Math.max(1, Math.min(world.surface.width - 1, candidate.x));
  enemy.pos.y = Math.max(1, Math.min(world.surface.height - 1, candidate.y));
  if (enemy.type === "lakeMonster") {
    const inside = world.surface.buildings.map(buildingFootprint).find(f => f && insideBuilding(before.x, before.y, f));
    if (inside) enemy.pos = outsideBuilding(enemy.pos, inside);
    else if (isWallBlockedAt(world, enemy.pos.x, enemy.pos.y) || world.surface.buildings.some(b => { const f = buildingFootprint(b); return f && crossesBuilding(before, enemy.pos, f); })) enemy.pos = before;
  } else resolveSurfaceCollision(world, enemy.pos, before.x, before.y);
}

export function createLakeMonster(world: World, lakeId: LakeId): Enemy {
  const lake = LAKE_DEFINITIONS.find(l => l.id === lakeId)!;
  const vertex = lake.outline[(world.session.nextCreatureId * 3) % lake.outline.length];
  let home: Vec2 = { ...vertex };
  outer: for (let r = 2; r <= 12; r += 2) for (let i = 0; i < 16; i++) {
    const p = { x: vertex.x + Math.cos(i * Math.PI / 8) * r, y: vertex.y + Math.sin(i * Math.PI / 8) * r };
    if (lakeIdAt(p.x, p.y) === lakeId) { home = p; break outer; }
  }
  return { id: `lake-${world.session.nextCreatureId++}`, type: "lakeMonster", lakeId, pos: { ...home }, lair: home,
    hp: CONFIG.lakeMonsterHp, maxHp: CONFIG.lakeMonsterHp, hunger: 0, carrying: 0, hoard: 0, sprintLeft: 0, tiredLeft: 0 };
}

export function createBeetle(world: World, home: Vec2): Enemy {
  return { id: `beetle-${world.session.nextCreatureId++}`, type: "beetle", pos: { ...home }, lair: { ...home },
    hp: CONFIG.beetleHp, maxHp: CONFIG.beetleHp, hunger: 0, carrying: 0, hoard: 0, sprintLeft: 0, tiredLeft: 0 };
}

function releaseCaptive(world: World, enemy: Enemy): void {
  const ant = world.ants.find(a => a.id === enemy.captiveId);
  if (ant && ant.state !== "dead") {
    const dry = nearestDryPosition(world, ant.pos);
    if (dry) ant.pos = dry;
    ant.capturedBy = undefined;
    ant.rescuedUntil = world.tick + 100;
    ant.state = "return";
    world.session.stats.rescued += 1;
    logEvent(world, "Житель освобождён!", ant.pos);
  }
  enemy.captiveId = undefined;
}

function targetFor(world: World, enemy: Enemy): Ant | undefined {
  const range = enemy.type === "lakeMonster" ? CONFIG.lakeMonsterRange : 38;
  return world.ants.filter(a => a.state !== "dead" && !a.capturedBy && (a.rescuedUntil ?? 0) <= world.tick && dist(a.pos, enemy.pos) <= range &&
    (enemy.type !== "lakeMonster" || dist(a.pos, enemy.lair) <= 42) &&
    !world.colonies.some(c => c.colony.fire > 0.35 && dist(a.pos, c.surfaceEntrance) < 8))
    .sort((a, b) => dist(a.pos, enemy.pos) - dist(b.pos, enemy.pos))[0];
}

export function updateWildlife(world: World): void {
  if (!world.session.dangersEnabled) return;
  for (const lake of LAKE_DEFINITIONS) {
    const state = world.session.lakes[lake.id];
    const cap = Math.min(CONFIG.lakeMonsterMaxPerLake, 1 + Math.floor(state.swallowed / 2));
    if (world.tick >= state.nextSpawnAt) {
      state.nextSpawnAt = world.tick + CONFIG.lakeMonsterSpawnTicks;
      if (world.enemies.filter(e => e.type === "lakeMonster" && e.lakeId === lake.id && e.hp > 0).length < cap) {
        const monster = createLakeMonster(world, lake.id);
        world.enemies.push(monster);
        logEvent(world, `${lake.id === "north" ? "Северное" : "Южное"} озеро: у берега замечен похититель.`, monster.pos);
      }
    }
  }
  const night = dayCycle(world.tick).phase === "night";
  if (night && world.tick >= world.session.nextBeetlesAt) {
    world.session.nextBeetlesAt = world.tick + 900;
    const cap = Math.min(6, 2 + Math.floor(world.tick / 6000));
    if (world.enemies.filter(e => e.type === "beetle").length < cap) {
      const c = world.colonies[world.session.nextCreatureId % world.colonies.length];
      const p = nearestDryPosition(world, { x: c.surfaceEntrance.x + (world.session.nextCreatureId % 2 ? 1 : -1) * 55, y: c.surfaceEntrance.y + 24 });
      if (p) world.enemies.push(createBeetle(world, p));
    }
  }
  const remove = new Set<string>();
  for (const enemy of world.enemies) {
    if (enemy.type === "spider") continue;
    if (enemy.hp <= 0 || (enemy.type === "beetle" && !night)) {
      releaseCaptive(world, enemy);
      if (enemy.hp <= 0) addFoodSource(world, enemy.pos.x, enemy.pos.y, 8, "carrion");
      remove.add(enemy.id);
      continue;
    }
    const captive = world.ants.find(a => a.id === enemy.captiveId);
    if (enemy.captiveId && (!captive || captive.state === "dead")) {
      if (captive && enemy.type === "lakeMonster" && isWaterAt(captive.pos.x, captive.pos.y)) {
        world.session.lakes[enemy.lakeId!].swallowed += 1;
        logEvent(world, "Озеро поглотило жителя. Озёрная угроза растёт.", enemy.pos);
      }
      if (captive) captive.capturedBy = undefined;
      enemy.captiveId = undefined;
      enemy.nextGrabAt = world.tick + 200;
    } else if (captive) {
      moveCreature(world, enemy, enemy.lair, enemy.type === "lakeMonster" ? CONFIG.lakeMonsterDragSpeed : CONFIG.beetleDragSpeed);
      captive.pos = { ...enemy.pos };
      captive.heading = { x: Math.cos(world.tick * 0.4), y: Math.sin(world.tick * 0.4) };
      if (enemy.type === "beetle" && dist(enemy.pos, enemy.lair) < 3 && world.tick >= (enemy.nextGrabAt ?? 0)) captive.state = "dead";
      continue;
    }
    const target = targetFor(world, enemy);
    if (target) {
      moveCreature(world, enemy, target.pos, enemy.type === "lakeMonster" ? CONFIG.lakeMonsterSpeed : CONFIG.beetleSpeed);
      if (dist(enemy.pos, target.pos) < 1.8 && world.tick >= (enemy.nextGrabAt ?? 0)) {
        // No capture through a wall, gate or shoreline obstacle.
        const mid = { x: (target.pos.x + enemy.pos.x) / 2, y: (target.pos.y + enemy.pos.y) / 2 };
        if (!isWallBlockedAt(world, mid.x, mid.y)) {
          dropCarriedFood(world, target);
          target.capturedBy = enemy.id;
          target.state = "idle";
          enemy.captiveId = target.id;
          enemy.nextGrabAt = world.tick + CONFIG.captiveKillTicks;
          logEvent(world, enemy.type === "lakeMonster" ? "Монстр тащит жителя в озеро! Стража может его спасти." : "Жук укатил жителя! Перехватите его стражей.", target.pos);
        }
      }
    } else moveCreature(world, enemy, enemy.lair, 0.25);
  }
  world.enemies = world.enemies.filter(e => !remove.has(e.id));
}
