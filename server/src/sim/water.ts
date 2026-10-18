import type { Ant } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "./world";
import { isWaterAt } from "../../../shared/surfaceTerrain";

/** Permanent loss of clay; drying removes wetness but cannot restore lost mass. */
export function dissolveAnt(ant: Ant, ticks: number, world?: World): void {
  if (ant.state === "dead") return;
  const before = ant.dissolved ?? 0;
  ant.dissolved = Math.min(1, before + ticks / CONFIG.waterExposureDeathTicks);
  ant.waterExposure = Math.min(CONFIG.waterExposureDeathTicks, (ant.waterExposure ?? 0) + ticks);
  const clay = (ant.dissolved - before) * CONFIG.deadClayAmount;
  if (world && clay > 0 && !isWaterAt(ant.pos.x, ant.pos.y)) {
    const node = world.surface.resourceNodes.find(n => n.kind === "clay" && n.id.startsWith("wash-") && Math.hypot(n.pos.x - ant.pos.x, n.pos.y - ant.pos.y) < 2);
    if (node) { node.amount += clay; node.maxAmount += clay; }
    else world.surface.resourceNodes.push({ id: `wash-${ant.id}-${world.tick}`, kind: "clay", pos: { ...ant.pos }, amount: clay, maxAmount: clay, hitsPerUnit: CONFIG.clayHitsPerUnit });
  }
  if (ant.dissolved >= 1 || (ant.waterExposure ?? 0) >= CONFIG.waterExposureDeathTicks) ant.state = "dead";
}
