import type { Ant, Colony, Vec2 } from "../../../../shared/types";
import { campShelterPoints } from "../../../../shared/campShelter";
import { CONFIG } from "../../config";
import { isSurfaceBlockedAt } from "../building";
import { isSheltered } from "../weather";
import type { World } from "../world";
import { moveSurfaceToward, tryCrossLayer } from "./movement";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
type Places = { key: string; points: Vec2[]; assigned: Map<string, Vec2>; tick: number };
const places = new WeakMap<Colony, Places>();

/** Remains stable through deaths/births; no new persistent job or save format. */
export function rainShelterPoint(world: World, ant: Ant): Vec2 | undefined {
  const camp = world.surface.entrance, fire = (world.colony.fire ?? 0) > 0.05;
  const key = `${fire}:${camp.x},${camp.y}:${world.surface.buildings.map(b => `${b.id},${b.stage},${b.pos.x},${b.pos.y}`).join("|")}`;
  let entry = places.get(world.colony);
  if (!entry || entry.key !== key) {
    let points = campShelterPoints(camp, world.surface.buildings, world.surface.width, world.surface.height, ant.colonyId, CONFIG.rainShelterFireRadius - 1).slice(2);
    if (!fire) {
      const huts = world.surface.buildings.filter(b => b.type === "hut" && b.stage === "built" && b.colonyId === ant.colonyId).flatMap(b =>
        Array.from({ length: 10 }, (_, i) => { const angle = i * Math.PI / 5; return { x: b.pos.x + Math.cos(angle) * 4.8, y: b.pos.y + Math.sin(angle) * 4.8 }; }))
        .filter(p => isSheltered(world, p) && !isSurfaceBlockedAt(world, p.x, p.y, ant.colonyId));
      if (huts.length) points = huts;
    }
    entry = { key, points, assigned: new Map(), tick: -1 }; places.set(world.colony, entry);
  }
  if (entry.tick !== world.tick) {
    const live = new Set(world.ants.filter(a => a.state !== "dead").map(a => a.id));
    for (const id of entry.assigned.keys()) if (!live.has(id)) entry.assigned.delete(id);
    entry.tick = world.tick;
  }
  const assigned = entry.assigned.get(ant.id); if (assigned) return assigned;
  const occupied = new Set([...entry.assigned.values()]);
  const point = entry.points.find(p => !occupied.has(p)) ?? entry.points[entry.assigned.size % entry.points.length];
  if (point) entry.assigned.set(ant.id, point);
  return point;
}

export function moveToRainShelter(world: World, ant: Ant): boolean {
  const weather = world.weather.state;
  // Fired residents shrug off rain; only wet ones (from a lake) still dry by the fire.
  if ((weather === "clear" || ant.fired) && (ant.waterExposure ?? 0) <= 0) {
    if (ant.state === "idle" && ant.carrying > 0) ant.state = "carry";
    return false;
  }
  // Combat and escaping a nearby captor take precedence over weather.
  const post = world.colony.defensePost ?? world.surface.entrance;
  if (world.enemies.some(e => e.hp > 0 && (dist(e.pos, ant.pos) < 11 || ant.job === "guard" && dist(e.pos, post) < CONFIG.guardEngageRadius))) return false;
  // Only fired guards hold a post against rival guards in the rain: raw clay
  // standing there dissolves (playtest 22.10: 164 of 170 deaths were rain at sieges).
  if (ant.job === "guard" && ant.fired && world.tick >= CONFIG.colonyGraceTicks && world.colonies.some(c => c.id !== ant.colonyId && c.ants.some(a => a.state !== "dead" && !a.capturedBy && dist(a.pos, post) < 20))) return false;
  if (ant.carrying > 0 && ant.job !== "build") {
    // Unload food/fuel on the way in; construction cargo remains reserved.
    // Use the existing camp delivery, retaining the suspended profession.
    const job = ant.job; ant.job = "forage"; ant.state = "carry";
    const delivered = tryCrossLayer(world, ant); ant.job = job;
    if (delivered) ant.caughtFishSpecies = undefined;
    else moveSurfaceToward(world, ant, world.surface.entrance, true, false);
    return true;
  }
  const target = rainShelterPoint(world, ant) ?? world.surface.entrance;
  const distance = dist(ant.pos, target);
  ant.state = ant.carrying > 0 ? "carry" : "return";
  if (distance > 0.35) moveSurfaceToward(world, ant, target, true, false);
  else {
    // Stop completely instead of orbiting or overshooting the assigned place.
    ant.state = "idle";
    const d = dist(ant.pos, world.surface.entrance);
    ant.heading = { x: (world.surface.entrance.x - ant.pos.x) / Math.max(0.01, d), y: (world.surface.entrance.y - ant.pos.y) / Math.max(0.01, d) };
  }
  return true;
}
