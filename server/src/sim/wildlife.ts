import { lakePoints as waterPoints, lakeLineOpen as waterSegment, lakeRoute } from "../../../shared/lakeNavigation";
import { lakeLilyPads } from "../../../shared/lakeHabitat";
import { fenceContains } from "../../../shared/fenceGeometry";
import { amphibianLineOpen, amphibianRoute, lakeShorePortals, nearLakeShore } from "../../../shared/amphibianNavigation";
import { surfaceGeometryKey } from "../../../shared/surfaceAccess";
import { surfacePointOpen } from "../../../shared/surfaceNavigation";
import type { Ant, Enemy, Vec2 } from "../../../shared/types";
import { isWaterAt, lakeDefinitions, lakeIdAt, type LakeId, isTerrainBlockedAt } from "../../../shared/surfaceTerrain";
import { dayCycle } from "../../../shared/dayCycle";
import { CONFIG } from "../config";
import { calculateSurfacePath } from "./ant/movement";
import { isWallBlockedAt, resolveSurfaceCollision, damageBuilding } from "./building";
import { dropCarriedFood } from "./ant/combat";
import { lakeSession, logEvent } from "./session";
import { addFoodSource, type World } from "./world";
import { buildingRouteTarget, buildingFootprint, insideBuilding, crossesBuilding, outsideBuilding } from "../../../shared/buildingGeometry";

const routes = new WeakMap<Enemy, { target: Vec2; points: Vec2[]; until: number; blocked?: boolean }>();
const foundationRoutes = new WeakMap<Enemy, { target: Vec2; point: Vec2 }>();
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const swimPlans = new WeakMap<Enemy, { target: Vec2; points: Vec2[] }>();
const patrols = new WeakMap<Enemy, { target: Vec2; until: number }>();
const amphibianPlans=new WeakMap<Enemy,{target:Vec2;points:Vec2[];until:number;geometry:string}>();
function moveAmphibian(world:World,enemy:Enemy,target:Vec2,speed:number):void {
  const id=enemy.lakeId!;let plan=amphibianPlans.get(enemy);const geometry=surfaceGeometryKey(world.surface);
  if(!plan||dist(plan.target,target)>1||world.tick>=plan.until||plan.geometry!==geometry||plan.points[0]&&!amphibianLineOpen(world.surface,enemy.pos,plan.points[0],id)){
    plan={target:{...target},points:amphibianRoute(world.surface,enemy.pos,target,id)??[],until:world.tick+120,geometry};amphibianPlans.set(enemy,plan);
  }
  while(plan.points.length>1&&dist(enemy.pos,plan.points[0])<.2&&amphibianLineOpen(world.surface,enemy.pos,plan.points[1],id))plan.points.shift();
  const next=plan.points[0];if(!next)return;const d=dist(enemy.pos,next);if(!d)return;
  const amount=Math.min(d,speed),candidate={x:enemy.pos.x+(next.x-enemy.pos.x)/d*amount,y:enemy.pos.y+(next.y-enemy.pos.y)/d*amount};
  if(amphibianLineOpen(world.surface,enemy.pos,candidate,id))enemy.pos=candidate;
}
function swim(world: World, enemy: Enemy, target: Vec2, speed: number): void {
  const id = enemy.lakeId!, points = waterPoints(id);
  if (lakeIdAt(enemy.pos.x, enemy.pos.y) !== id) {
    moveAmphibian(world,enemy,target,speed);return;
  }
  let goal = target;
  if (lakeIdAt(target.x, target.y) !== id) {
    goal = points.reduce((a, b) => dist(b, target) < dist(a, target) ? b : a);
    const n = Math.max(1, Math.ceil(dist(target, enemy.pos) * 4));
    for (let i = 1; i <= n; i++) {
      const p = { x: target.x + (enemy.pos.x - target.x) * i / n, y: target.y + (enemy.pos.y - target.y) * i / n };
      if (lakeIdAt(p.x, p.y) === id) { goal = p; break; }
    }
  }
  let plan = swimPlans.get(enemy);
  if (!plan || dist(plan.target, goal) > 3 || (dist(enemy.pos, plan.target) < 0.7 && dist(enemy.pos, goal) > 0.5)) {
    const route = lakeRoute(id, enemy.pos, goal) ?? [];
    plan = { target: { ...goal }, points: route }; swimPlans.set(enemy, plan);
  }
  while (plan.points.length > 1 && dist(enemy.pos, plan.points[0]) < 0.7) plan.points.shift();
  const next = plan.points[0]; if (!next) return;
  const d = dist(enemy.pos, next), amount = Math.min(d, speed);
  if (!d) return;
  const candidate = { x: enemy.pos.x + (next.x - enemy.pos.x) / d * amount, y: enemy.pos.y + (next.y - enemy.pos.y) / d * amount };
  if (waterSegment(enemy.pos, candidate, id)) enemy.pos = candidate;
}

export function ensureLakeResidents(world: World): void {
  for (const lake of lakeDefinitions()) if (!world.enemies.some(e => e.type === "lakeMonster" && e.lakeId === lake.id)) {
    world.enemies.push(createLakeMonster(world, lake.id));
    lakeSession(world, lake.id).nextSpawnAt = world.tick + CONFIG.lakeMonsterSpawnTicks;
  }
}

export function nearestDryPosition(world: World, point: Vec2): Vec2 | null {
  for (let radius = 0; radius <= 48; radius += 2) {
    for (let i = 0; i < 16; i++) {
      const p = { x: point.x + Math.cos(i * Math.PI / 8) * radius, y: point.y + Math.sin(i * Math.PI / 8) * radius };
      if (p.x > 2 && p.y > 2 && p.x < world.surface.width - 2 && p.y < world.surface.height - 2 && !isTerrainBlockedAt(p.x, p.y) && !isWallBlockedAt(world, p.x, p.y)) return p;
    }
  }
  return null;
}

/** Creatures use the same lake bypass as residents and cannot pass through walls.
 * A raiding spider damages the actual obstructing segment before moving. */
export function moveCreature(world: World, enemy: Enemy, target: Vec2, speed: number, breakWalls = false): void {
  if (enemy.type === "lakeMonster") { moveAmphibian(world, enemy, target, speed); return; }
  let next = target;
  // Raiders walk around fences and lone gates like anyone else; they only
  // smash through when the camp is closed off (no route at all).
  let smash = false;
  {
    let route = routes.get(enemy);
    if (!route || world.tick >= route.until || dist(route.target, target) > 4) {
      const points = calculateSurfacePath(world, enemy.pos, target, "enemy");
      route = { target: { ...target }, points: points ?? [], until: world.tick + 40, blocked: points === null };
      routes.set(enemy, route);
    }
    while (route.points.length && dist(enemy.pos, route.points[0]) < 1.5) route.points.shift();
    next = route.points[0] ?? target;
    smash = breakWalls && !!route.blocked;
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
  if (smash) {
    const wall = world.surface.buildings.find(b => b.stage === "built" && (b.type === "wall" || b.type === "gate") && fenceContains(b, candidate));
    if (wall) {
      damageBuilding(world, wall, CONFIG.raidBuildingDamage);
      enemy.attackAt = world.tick; enemy.attackPos = { ...wall.pos };
      return;
    }
  }
  if (isTerrainBlockedAt(candidate.x, candidate.y)) return;
  const before = { ...enemy.pos };
  enemy.pos.x = Math.max(1, Math.min(world.surface.width - 1, candidate.x));
  enemy.pos.y = Math.max(1, Math.min(world.surface.height - 1, candidate.y));
  resolveSurfaceCollision(world, enemy.pos, before.x, before.y);
}

export function createLakeMonster(world: World, lakeId: LakeId): Enemy {
  const vertex = waterPoints(lakeId)[(world.session.nextCreatureId * 37) % waterPoints(lakeId).length];
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
    (enemy.type!=="lakeMonster"||nearLakeShore(a.pos,enemy.lakeId!)) &&
    !world.colonies.some(c => c.colony.fire > 0.35 && dist(a.pos, c.surfaceEntrance) < 8))
    .sort((a, b) => dist(a.pos, enemy.pos) - dist(b.pos, enemy.pos))[0];
}

export function updateWildlife(world: World): void {
  if (!world.session.dangersEnabled) return;
  for (const lake of lakeDefinitions()) {
    const state = lakeSession(world, lake.id);
    const cap = Math.min(CONFIG.lakeMonsterMaxPerLake, 1 + Math.floor(state.swallowed / 2));
    if (world.tick >= state.nextSpawnAt) {
      state.nextSpawnAt = world.tick + CONFIG.lakeMonsterSpawnTicks;
      if (world.enemies.filter(e => e.type === "lakeMonster" && e.lakeId === lake.id && e.hp > 0).length < cap) {
        const monster = createLakeMonster(world, lake.id);
        const safe = waterPoints(lake.id).filter(p => !world.ants.some(a => a.state !== "dead" && dist(a.pos, p) < 35));
        if (safe.length) { monster.pos = { ...safe[(world.session.nextCreatureId * 19) % safe.length] }; monster.lair = { ...monster.pos }; world.enemies.push(monster); logEvent(world, "В глубине озера появилось потомство водного монстра.", monster.pos); }
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
      if (enemy.type === "lakeMonster") lakeSession(world, enemy.lakeId!).nextSpawnAt = world.tick + CONFIG.lakeMonsterSpawnTicks * 4;
      remove.add(enemy.id);
      continue;
    }
    const captive = world.ants.find(a => a.id === enemy.captiveId);
    if (enemy.captiveId && (!captive || captive.state === "dead")) {
      if (captive && enemy.type === "lakeMonster" && isWaterAt(captive.pos.x, captive.pos.y)) {
        lakeSession(world, enemy.lakeId!).swallowed += 1;
        logEvent(world, "Озеро поглотило жителя. Озёрная угроза растёт.", enemy.pos);
      }
      if (captive) captive.capturedBy = undefined;
      enemy.captiveId = undefined;
      enemy.nextGrabAt = world.tick + 200;
    } else if (captive) {
      if (enemy.type === "lakeMonster") { enemy.lakeRestUntil = 0; enemy.lakePadIndex = undefined; enemy.lakeShoreUntil=0;enemy.lakeShoreTarget=undefined; }
      moveCreature(world, enemy, enemy.lair, enemy.type === "lakeMonster" ? CONFIG.lakeMonsterDragSpeed : CONFIG.beetleDragSpeed);
      captive.pos = { ...enemy.pos };
      captive.heading = { x: Math.cos(world.tick * 0.4), y: Math.sin(world.tick * 0.4) };
      if (enemy.type === "beetle" && dist(enemy.pos, enemy.lair) < 3 && world.tick >= (enemy.nextGrabAt ?? 0)) captive.state = "dead";
      continue;
    }
    const target = targetFor(world, enemy);
    if (target) {
      if (enemy.type === "lakeMonster") { enemy.lakeRestUntil = 0; enemy.lakePadIndex = undefined; enemy.lakeNextRestAt = world.tick + 300; }
      moveCreature(world, enemy, target.pos, enemy.type === "lakeMonster" ? CONFIG.lakeMonsterSpeed : CONFIG.beetleSpeed);
      if (dist(enemy.pos, target.pos) < (enemy.type === "lakeMonster" ? 3 : 1.8) && world.tick >= (enemy.nextGrabAt ?? 0)) {
        // No capture through a wall, gate or shoreline obstacle.
        const mid = { x: (target.pos.x + enemy.pos.x) / 2, y: (target.pos.y + enemy.pos.y) / 2 };
        if (!isWallBlockedAt(world, mid.x, mid.y) && (enemy.type!=="lakeMonster"||amphibianLineOpen(world.surface,enemy.pos,target.pos,enemy.lakeId!))) {
          dropCarriedFood(world, target);
          target.capturedBy = enemy.id;
          target.state = "idle";
          enemy.captiveId = target.id;
          enemy.nextGrabAt = world.tick + CONFIG.captiveKillTicks;
          logEvent(world, enemy.type === "lakeMonster" ? "Монстр тащит жителя в озеро! Стража может его спасти." : "Жук укатил жителя! Перехватите его стражей.", target.pos);
        }
      }
    } else if (enemy.type === "lakeMonster") {
      enemy.hunger += 1;
      if ((enemy.lakeRestUntil ?? 0) > world.tick) continue;
      enemy.lakeNextShoreAt??=world.tick+300;
      if((enemy.lakeShoreUntil??0)>world.tick&&enemy.lakeShoreTarget){
        if(dist(enemy.pos,enemy.lakeShoreTarget)<.7&&world.tick%60===0){
          const nearby=lakeShorePortals(enemy.lakeId!).filter(p=>dist(p.land,enemy.pos)>5&&dist(p.land,enemy.pos)<15&&surfacePointOpen(world.surface,p.land,"enemy")&&amphibianLineOpen(world.surface,enemy.pos,p.land,enemy.lakeId!));
          if(nearby.length)enemy.lakeShoreTarget={...nearby[Math.floor(world.tick/60)%nearby.length].land};
        }
        moveAmphibian(world,enemy,enemy.lakeShoreTarget,.28);continue;
      }
      if(!isWaterAt(enemy.pos.x,enemy.pos.y)){moveAmphibian(world,enemy,enemy.lair,CONFIG.lakeMonsterDragSpeed);continue;}
      if(world.tick>=enemy.lakeNextShoreAt&&enemy.hunger<450){
        const portal=lakeShorePortals(enemy.lakeId!).filter(p=>surfacePointOpen(world.surface,p.land,"enemy")&&amphibianLineOpen(world.surface,p.water,p.land,enemy.lakeId!)).sort((a,b)=>dist(a.water,enemy.pos)-dist(b.water,enemy.pos))[0];
        enemy.lakeNextShoreAt=world.tick+960;
        if(portal){enemy.lakeShoreUntil=world.tick+360;enemy.lakeShoreTarget={...portal.land};enemy.lakePadIndex=undefined;moveAmphibian(world,enemy,portal.land,.28);continue;}
      }
      enemy.lakeNextRestAt ??= world.tick + 150;
      if (world.tick >= enemy.lakeNextRestAt && enemy.hunger < 450) {
        const pads = lakeLilyPads(enemy.lakeId!);
        if (pads.length) {
          enemy.lakePadIndex ??= pads.reduce((best, p, i) => dist(p, enemy.pos) < dist(pads[best], enemy.pos) ? i : best, 0);
          const pad = pads[enemy.lakePadIndex];
          if (pad) {
            swim(world, enemy, pad, 0.16);
            if (dist(enemy.pos, pad) < 0.5) {
              enemy.pos = { ...pad }; enemy.lakeRestUntil = world.tick + 180;
              enemy.lakeNextRestAt = enemy.lakeRestUntil + 600;
            }
            continue;
          }
        }
      }
      enemy.lakePadIndex = undefined;
      const fish = enemy.hunger > 450 ? world.surface.fish.filter(f => f.state !== "respawning" && f.lakeId === enemy.lakeId).sort((a, b) => dist(a.pos, enemy.pos) - dist(b.pos, enemy.pos))[0] : undefined;
      if (fish) {
        swim(world, enemy, fish.pos, 0.22);
        if (dist(fish.pos, enemy.pos) < 1.6) { fish.state = "respawning"; fish.respawnAt = world.tick + CONFIG.fishRespawnMinTicks; fish.targetAntId = undefined; fish.lurePos = undefined; enemy.hunger = 0; enemy.lakeNextRestAt = world.tick + 60; enemy.hp = Math.min(enemy.maxHp, enemy.hp + 8); }
      } else {
        let patrol = patrols.get(enemy);
        if (!patrol || world.tick >= patrol.until || dist(enemy.pos, patrol.target) < 1) {
          const all = waterPoints(enemy.lakeId!);
          const nearShore = all.filter(p => [[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dy]) => !isWaterAt(p.x + dx, p.y + dy)));
          const points = Math.floor(world.tick / 600) % 2 && nearShore.length ? nearShore : all;
          const target = points[(Math.floor(world.tick / 10) * 13 + Number(enemy.id.replace(/\D/g, "")) * 31) % points.length];
          patrol = { target, until: world.tick + 600 }; patrols.set(enemy, patrol);
        }
        swim(world, enemy, patrol.target, 0.16);
      }
    } else moveCreature(world, enemy, enemy.lair, 0.25);
  }
  world.enemies = world.enemies.filter(e => !remove.has(e.id));
}
