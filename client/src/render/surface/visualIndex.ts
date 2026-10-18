import type { WorldSnapshot } from "../../../../shared/types";

let previous: WorldSnapshot | undefined;
let cached: ReturnType<typeof build>;
function build(world: WorldSnapshot) {
  return {
    nodes: new Map(world.surface.resourceNodes.map(n => [n.id, n])),
    buildings: new Map(world.surface.buildings.map(b => [b.id, b])),
    colonies: new Map(world.colonies.map(c => [c.id, c.colony])),
    enemies: new Map(world.enemies.map(e => [e.id, e]))
  };
}
/** One index per render snapshot; interpolated actor positions remain live. */
export function visualIndex(world: WorldSnapshot) {
  if (world !== previous) { previous = world; cached = build(world); }
  return cached;
}
