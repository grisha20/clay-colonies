import type { Ant } from "../../../shared/types";
import { CONFIG } from "../config";
import type { ColonyRuntime, World } from "./world";
import { logEvent } from "./session";

/**
 * Warriors: a guard initiated with special clay and a spear becomes a warrior
 * for good — stronger blows (strength), harder to hurt (damage taken × factor),
 * a little quicker. A tribe has room for 1 + one per CONFIG.warriorsPerResidents
 * residents. The mother initiates on her own when the tribe is threatened or
 * the special clay piles up; the player can do it with a button.
 */

/** Damage that actually lands on this resident. */
export function damageTaken(ant: Ant, amount: number): number {
  return ant.warrior ? amount * CONFIG.warriorDamageTaken : amount;
}

export function warriorCap(runtime: ColonyRuntime): number {
  const alive = runtime.ants.filter(a => a.state !== "dead").length;
  return 1 + Math.floor(alive / CONFIG.warriorsPerResidents);
}

/** Why an initiation cannot happen now (null: it can). */
export function warriorRefusal(runtime: ColonyRuntime): string | null {
  const c = runtime.colony;
  if (runtime.ants.filter(a => a.state !== "dead" && a.warrior).length >= warriorCap(runtime)) return "Воинов столько, сколько племя может прокормить";
  if ((c.specialClay ?? 0) < CONFIG.warriorCost.specialClay) return `Нужно ${CONFIG.warriorCost.specialClay} особой глины`;
  if ((c.spears ?? 0) < CONFIG.warriorCost.spears) return "Нужно копьё из мастерской";
  if (!runtime.ants.some(a => a.state !== "dead" && !a.capturedBy && !a.warrior && a.job === "guard")) return "Нет стражника для посвящения";
  return null;
}

/** Initiates the guard nearest the hearth. Returns the new warrior, or undefined. */
export function initiateWarrior(world: World, colonyIndex: number): Ant | undefined {
  const runtime = world.colonies[colonyIndex];
  if (!runtime || world.session.status !== "playing" || warriorRefusal(runtime)) return undefined;
  const c = runtime.colony, home = runtime.surfaceEntrance;
  const guard = runtime.ants
    .filter(a => a.state !== "dead" && !a.capturedBy && !a.warrior && a.job === "guard")
    .sort((a, b) => Math.hypot(a.pos.x - home.x, a.pos.y - home.y) - Math.hypot(b.pos.x - home.x, b.pos.y - home.y))[0];
  c.specialClay = (c.specialClay ?? 0) - CONFIG.warriorCost.specialClay;
  c.spears = (c.spears ?? 0) - CONFIG.warriorCost.spears;
  guard.warrior = true;
  guard.strength += CONFIG.warriorStrengthBonus;
  logEvent(world, "Стражник прошёл посвящение — у племени новый воин.", guard.pos);
  return guard;
}
