import type { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import type { ViewBounds } from "../types";
import { actorMotion, residentScale } from "./motion";
import { isWaterAt } from "../../../../shared/surfaceTerrain";

export type FootMark = { id: string; x: number; y: number; angle: number; size: number; at: number };
export class FootprintTrail {
  marks: FootMark[] = [];
  private steps = new Map<string, { phase: number; x: number; y: number; seen: number }>();
  reset(): void { this.marks = []; this.steps.clear(); }
  sample(id: string, x: number, y: number, angle: number, phase: number, size: number, time: number, enabled: boolean): void {
    const step = Math.floor(phase / Math.PI), old = this.steps.get(id);
    this.steps.set(id, { phase: step, x, y, seen: time });
    if (!enabled || !old || old.phase === step || Math.hypot(x - old.x, y - old.y) > 8) return;
    const side = step % 2 ? 1 : -1;
    this.marks.push({ id, x: x - Math.sin(angle) * 0.3 * side * size, y: y + Math.cos(angle) * 0.3 * side * size, angle, size, at: time });
    let count = 0;
    for (let i = this.marks.length - 1; i >= 0; i--) if (this.marks[i].id === id && ++count > 5) { this.marks.splice(i, 1); break; }
    if (this.marks.length > 800) this.marks.splice(0, this.marks.length - 800);
  }
  expire(time: number): void {
    this.marks = this.marks.filter(p => time - p.at < 3.5);
    for (const [id, p] of this.steps) if (time - p.seen > 4) this.steps.delete(id);
  }
}
const trails = new WeakMap<Graphics, { trail: FootprintTrail; tick: number; time: number }>();
export function footprintCount(g: Graphics): number { return trails.get(g)?.trail.marks.length ?? 0; }
export function updateFootprints(g: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  let state = trails.get(g); if (!state) { state = { trail: new FootprintTrail(), tick: world.tick, time: actorMotion.time }; trails.set(g, state); }
  if (world.tick < state.tick || actorMotion.time < state.time) state.trail.reset(); state.tick = world.tick; state.time = actorMotion.time;
  const time = actorMotion.time;
  for (const ant of world.ants) {
    const p = ant.pos, visible = p.x > bounds.left - 2 && p.x < bounds.right + 2 && p.y > bounds.top - 2 && p.y < bounds.bottom + 2;
    if (ant.layer !== "surface" || !visible) continue;
    const pose = actorMotion.resident(ant);
    state.trail.sample(ant.id, p.x, p.y, pose.angle, pose.phase, residentScale(ant) / 1.85, time,
      pose.walk > 0.2 && !ant.capturedBy && ant.state !== "dead" && !isWaterAt(p.x, p.y));
  }
  state.trail.expire(time); g.clear();
  for (const mark of state.trail.marks) {
    if (mark.x < bounds.left || mark.x > bounds.right || mark.y < bounds.top || mark.y > bounds.bottom) continue;
    const alpha = (1 - (time - mark.at) / 3.5) * 0.23, x = mark.x * cell, y = mark.y * cell;
    // Tiny sole and toe impressions, drawn in one ground batch with no sprites.
    g.ellipse(x, y, 1.8 * mark.size, 0.8 * mark.size).fill({ color: 0x69503a, alpha });
    g.ellipse(x + Math.cos(mark.angle) * 1.2 * mark.size, y + Math.sin(mark.angle) * 0.7 * mark.size, 1.1 * mark.size, 0.65 * mark.size).fill({ color: 0x69503a, alpha: alpha * 0.6 });
  }
}
