import type { Ant, Vec2 } from "../../../shared/types";
import type { World } from "./world";
import { isSurfaceBlockedAt } from "./building";

/** Stop fighters occupying one point, including residents from old saves. */
export function settleMeleePosition(world: World, ant: Ant, target: Vec2, reach = 4): void {
  const seed = Number(ant.id.replace(/\D/g, "")) * 2.39996;
  const dx = ant.pos.x - target.x, dy = ant.pos.y - target.y, length = Math.hypot(dx, dy);
  let x = length < reach * 0.72 ? (length > 0.01 ? dx / length : Math.cos(seed)) * 0.7 : 0;
  let y = length < reach * 0.72 ? (length > 0.01 ? dy / length : Math.sin(seed)) * 0.7 : 0;
  for (const other of world.ants) {
    if (other.id === ant.id || other.state === "dead" || other.capturedBy || other.layer !== "surface") continue;
    const vx = ant.pos.x - other.pos.x, vy = ant.pos.y - other.pos.y, d = Math.hypot(vx, vy);
    if (d < 2.2) { const weight = (2.2 - d) / 2.2; x += (d > 0.01 ? vx / d : Math.cos(seed)) * weight; y += (d > 0.01 ? vy / d : Math.sin(seed)) * weight; }
  }
  const sum = Math.hypot(x, y); if (sum < 0.01) return;
  const pos = { x: ant.pos.x + x / sum * 0.32, y: ant.pos.y + y / sum * 0.32 };
  if (Math.hypot(pos.x - target.x, pos.y - target.y) < reach && !isSurfaceBlockedAt(world, pos.x, pos.y, ant.colonyId)) ant.pos = pos;
}

/** A short authoritative strike signal; never restarts on every combat tick. */
export function markMelee(ant: Ant, target: Vec2, tick: number): boolean {
  if (ant.state === "dead" || ant.capturedBy || ant.carrying > 0 || tick < (ant.melee?.until ?? -4) + 4) return false;
  ant.melee = { to: { ...target }, until: tick + 6 };
  return true;
}
