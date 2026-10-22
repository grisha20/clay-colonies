import type { Ant, GameAnimal, GameAnimalKind, Surface, Vec2 } from "../../../shared/types";
import { isMountainAt, isTerrainBlockedAt, isWaterAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { tickCache } from "./cache";
import type { World } from "./world";
import { nearestDropPoint } from "./building";
import { addFoodStock } from "./foodStock";
import { moveSurfaceToward } from "./ant/movement";

/**
 * Game of the meadows and hunters. Deer graze in small herds (the wild
 * corners first, then open meadows away from the camps), hares alone. Any
 * resident coming close makes them bolt for a while; they keep to their range
 * and come back after a kill. A hunter (job "hunt", one spear each) stalks the
 * nearest game, throws its spear within CONFIG.spearRange — nearer throws hit
 * more often — and carries the meat to a store.
 *
 * Game is not an Enemy: residents do not fear it and alarms ignore it.
 */

const scratch: Ant[] = [];

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function open(surface: Surface, p: Vec2, margin = 0): boolean {
  if (p.x < 8 || p.y < 8 || p.x > surface.width - 8 || p.y > surface.height - 8) return false;
  for (const [dx, dy] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
    if (isWaterAt(p.x + dx, p.y + dy) || isMountainAt(p.x + dx, p.y + dy) || isTerrainBlockedAt(p.x + dx, p.y + dy)) return false;
  }
  return true;
}

/** Herds of deer and lone hares for a fresh world (deterministic per terrain seed). */
export function createAnimals(surface: Surface): GameAnimal[] {
  const rand = rng((surface.terrain?.seed ?? 1) * 7919 + 17);
  const camps = surface.entrances;
  const farFromCamps = (p: Vec2, d: number) => camps.every(c => Math.hypot(c.x - p.x, c.y - p.y) > d);
  const homes: Vec2[] = [];
  // Wild corners (no camp near) first: an expedition there pays.
  for (const corner of [{ x: 72, y: 72 }, { x: surface.width - 72, y: 72 }, { x: 72, y: surface.height - 72 }, { x: surface.width - 72, y: surface.height - 72 }]) {
    if (homes.length >= CONFIG.deerHerds || !farFromCamps(corner, 150)) continue;
    for (let k = 0; k < 40; k++) {
      const p = { x: corner.x + (rand() - 0.5) * 50, y: corner.y + (rand() - 0.5) * 50 };
      if (open(surface, p, 4)) { homes.push(p); break; }
    }
  }
  for (let k = 0; k < 400 && homes.length < CONFIG.deerHerds; k++) {
    const p = { x: 30 + rand() * (surface.width - 60), y: 30 + rand() * (surface.height - 60) };
    if (open(surface, p, 4) && farFromCamps(p, 75) && homes.every(h => Math.hypot(h.x - p.x, h.y - p.y) > 80)) homes.push(p);
  }
  const animals: GameAnimal[] = [];
  const add = (kind: GameAnimalKind, home: Vec2, n: number) => {
    let pos = { ...home };
    for (let k = 0; k < 20; k++) {
      const p = { x: home.x + (rand() - 0.5) * 10, y: home.y + (rand() - 0.5) * 10 };
      if (open(surface, p)) { pos = p; break; }
    }
    const a = rand() * Math.PI * 2;
    animals.push({ id: `${kind}-${n}`, kind, pos, heading: { x: Math.cos(a), y: Math.sin(a) }, hp: kind === "deer" ? CONFIG.deerHp : CONFIG.hareHp, state: "graze", home: { ...home } });
  };
  let n = 1;
  for (const home of homes) for (let i = 0; i < CONFIG.deerPerHerd; i++) add("deer", home, n++);
  for (let k = 0, hares = 0; k < 400 && hares < CONFIG.hares; k++) {
    const p = { x: 30 + rand() * (surface.width - 60), y: 30 + rand() * (surface.height - 60) };
    if (open(surface, p, 2) && farFromCamps(p, 50)) { add("hare", p, n++); hares++; }
  }
  return animals;
}

function step(surface: Surface, a: GameAnimal, heading: Vec2, speed: number): void {
  // Turn away from water, rocks and the map edge instead of walking into them.
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0, Math.PI]) {
    const angle = Math.atan2(heading.y, heading.x) + turn;
    const next = { x: a.pos.x + Math.cos(angle) * speed, y: a.pos.y + Math.sin(angle) * speed };
    if (open(surface, next)) {
      a.pos = next;
      a.heading = { x: Math.cos(angle), y: Math.sin(angle) };
      return;
    }
  }
}

/** Grazing, bolting from residents, respawning after a kill. */
export function updateAnimals(world: World): void {
  const surface = world.surface;
  if (!surface.animals) surface.animals = createAnimals(surface);
  for (const a of surface.animals) {
    if (a.state === "dead") {
      if ((a.respawnAt ?? Infinity) <= world.tick) {
        a.state = "graze"; a.pos = { ...a.home }; a.hp = a.kind === "deer" ? CONFIG.deerHp : CONFIG.hareHp; a.respawnAt = undefined;
      }
      continue;
    }
    const fleeRadius = a.kind === "deer" ? CONFIG.deerFleeRadius : CONFIG.hareFleeRadius;
    let threat: Ant | undefined, threatDist: number = fleeRadius;
    for (const ant of tickCache.worldSurfaceAntGrid.queryInto(a.pos, fleeRadius, scratch)) {
      const d = Math.hypot(ant.pos.x - a.pos.x, ant.pos.y - a.pos.y);
      if (ant.state !== "dead" && d < threatDist) { threat = ant; threatDist = d; }
    }
    if (threat) { a.state = "flee"; a.fleeUntil = world.tick + CONFIG.animalFleeTicks; a.heading = norm({ x: a.pos.x - threat.pos.x, y: a.pos.y - threat.pos.y }, a.heading); }
    if (a.state === "flee" && (a.fleeUntil ?? 0) > world.tick) {
      step(surface, a, a.heading, a.kind === "deer" ? CONFIG.deerFleeSpeed : CONFIG.hareFleeSpeed);
      continue;
    }
    a.state = "graze";
    // Wander slowly, drifting back home when it strays out of its range.
    const away = Math.hypot(a.pos.x - a.home.x, a.pos.y - a.home.y);
    const wobble = Math.sin(world.tick * 0.013 + a.id.length * 1.7 + a.home.x) * 0.5;
    let h = { x: Math.cos(Math.atan2(a.heading.y, a.heading.x) + wobble * 0.05), y: Math.sin(Math.atan2(a.heading.y, a.heading.x) + wobble * 0.05) };
    if (away > CONFIG.animalRange) h = norm({ x: a.home.x - a.pos.x, y: a.home.y - a.pos.y }, h);
    // Graze in bursts: stand still part of the time.
    if (Math.sin(world.tick * 0.021 + a.home.y + a.id.charCodeAt(a.id.length - 1)) > 0.2) step(surface, a, h, CONFIG.animalGrazeSpeed);
    else a.heading = h;
  }
}

function norm(v: Vec2, fallback: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-6 ? { x: v.x / l, y: v.y / l } : fallback;
}

function hash01(text: string, tick: number): number {
  let h = 2166136261 ^ tick;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function liveGame(world: World): GameAnimal[] {
  const home = world.surface.entrance;
  return (world.surface.animals ?? []).filter(a => a.state !== "dead" && Math.hypot(a.pos.x - home.x, a.pos.y - home.y) <= CONFIG.huntRange);
}

/** Hunters: as many as the hunt priority asks, at most one per spear. */
export function assignHuntJobs(world: World): void {
  const live = world.ants.filter(a => a.state !== "dead" && !a.capturedBy);
  const cap = Math.min(Math.max(0, Math.floor(world.colony.priorities?.hunt ?? 0)), world.colony.spears ?? 0, liveGame(world).length > 0 ? 99 : 0);
  let hunters = 0;
  for (const ant of live) {
    if (ant.job !== "hunt") continue;
    if (hunters >= cap && !(ant.carryKind === "meat" && ant.carrying > 0)) { ant.job = "forage"; ant.forageRole = "forager"; ant.huntTargetId = undefined; continue; }
    hunters += 1;
  }
  const foragers = () => live.filter(a => a.job === "forage" && a.forageRole !== "scout").length;
  for (const ant of live) {
    if (hunters >= cap || foragers() <= CONFIG.minForagers) break;
    if (ant.job !== "forage" || ant.forageRole === "scout" || ant.carrying > 0 || ant.state === "fight" || ant.state === "return" || ant.warrior) continue;
    ant.job = "hunt"; ant.forageRole = undefined; ant.huntTargetId = undefined;
    hunters += 1;
  }
}

/** Returns true while the hunt owns the hunter's movement this tick. */
export function moveHunting(world: World, ant: Ant): boolean {
  if (ant.job !== "hunt") return false;
  if (ant.carryKind === "meat" && ant.carrying > 0) {
    const drop = nearestDropPoint(world, ant.pos);
    if (Math.hypot(ant.pos.x - drop.x, ant.pos.y - drop.y) <= CONFIG.dropPointRadius) {
      addFoodStock(world.colony, "meat", ant.carrying);
      ant.carrying = 0; ant.carryKind = undefined; ant.state = "search";
      return true;
    }
    ant.state = "carry";
    moveSurfaceToward(world, ant, drop, true, false);
    return true;
  }
  const game = liveGame(world);
  let target = game.find(a => a.id === ant.huntTargetId);
  if (!target) {
    // Nearest game; a deer is worth a slightly longer walk than a hare.
    target = game.map(a => ({ a, s: Math.hypot(a.pos.x - ant.pos.x, a.pos.y - ant.pos.y) * (a.kind === "deer" ? 0.8 : 1) })).sort((x, y) => x.s - y.s)[0]?.a;
    ant.huntTargetId = target?.id;
  }
  if (!target) return false;
  const d = Math.hypot(target.pos.x - ant.pos.x, target.pos.y - ant.pos.y);
  if (d <= CONFIG.spearRange) {
    ant.heading = norm({ x: target.pos.x - ant.pos.x, y: target.pos.y - ant.pos.y }, ant.heading ?? { x: 1, y: 0 });
    ant.state = "idle";
    if (world.tick - (ant.huntThrowAt ?? -1e9) >= CONFIG.spearCooldownTicks) {
      ant.huntThrowAt = world.tick;
      const chance = CONFIG.spearHitNear + (CONFIG.spearHitFar - CONFIG.spearHitNear) * Math.min(1, d / CONFIG.spearRange);
      if (hash01(ant.id + target.id, world.tick) < chance) {
        target.hp -= 1; target.hitAt = world.tick;
        if (target.hp <= 0) {
          target.state = "dead"; target.respawnAt = world.tick + CONFIG.animalRespawnTicks;
          ant.carrying = target.kind === "deer" ? CONFIG.deerMeat : CONFIG.hareMeat;
          ant.carryKind = "meat"; ant.state = "carry"; ant.huntTargetId = undefined;
        }
      }
    }
    return true;
  }
  ant.state = "search";
  moveSurfaceToward(world, ant, target.pos, true, false);
  return true;
}
