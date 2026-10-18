import type { BuildingType, Vec2 } from "../../../shared/types";
import { isWaterAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { placePointBuilding, paintWallCells, wallCellIndexAt } from "./building";
import type { World } from "./world";
import { trainWaterWeapons } from "./session";

/** One settlement-level planner. It pays normal costs through normal workers. */
export function updateSettlementAI(world: World): void {
  if (world.tick % 100 !== 0) return;
  for (const [index, runtime] of world.colonies.entries()) {
    if (index === (world.session.playerColonyIndex ?? 0) || !runtime.ants.length) continue;
    const c = runtime.colony, camp = runtime.surfaceEntrance, population = runtime.ants.length;
    const buildings = world.surface.buildings.filter(b => b.colonyId === c.id);
    const built = (type: BuildingType) => buildings.filter(b => b.type === type && b.stage === "built").length;
    const threat = world.enemies.some(e => e.hp > 0 && Math.hypot(e.pos.x - camp.x, e.pos.y - camp.y) < 28);
    c.alarm = threat;
    c.growthPaused = false;
    c.clayReserve = population < 14 ? 0 : 6;
    const foodLow = c.food < Math.max(18, population * 1.5);
    c.priorities = {
      clay: foodLow ? 1 : c.clay < 45 ? 3 : 1,
      wood: c.wood < 30 ? 2 : 1,
      stone: built("workshop") && c.stone < 24 ? 2 : 0,
      build: foodLow ? 1 : 3,
      guard: threat ? Math.min(5, Math.floor(population / 4)) : population >= 15 ? 2 : 1,
      fish: !foodLow && built("workshop") && c.rods > 0 && population >= 20 ? 1 : 0
    };
    if (threat || world.weather.state !== "clear") continue;
    if (built("workshop") && c.wood >= 16 && c.stone >= 12 && world.tick > 12000) trainWaterWeapons(world, index);
    // Choose an unobstructed front; post is inside the fort and not in water.
    const rival = world.colonies[world.session.playerColonyIndex ?? 0]?.surfaceEntrance;
    const sign = rival && rival.x < camp.x ? -1 : 1;
    c.defensePost = { x: camp.x + sign * 9, y: camp.y + 5 };
    if (buildings.some(b => b.stage !== "built" && b.type !== "wall" && b.type !== "gate")) continue;
    let type: "hut" | "storage" | "workshop" | "idol" | undefined;
    if (!built("workshop")) type = "workshop";
    else if (built("hut") < Math.min(CONFIG.maxHutsPerColony, 3 + Math.floor(world.tick / 9000)) && (population >= 10 + built("hut") * 4 || world.tick >= 4000 && built("hut") < 3)) type = "hut";
    else if (built("storage") < 2 && population >= 20 && world.tick > 6000) type = "storage";
    else if (!built("idol") && world.tick > CONFIG.matchMinTicks / 2 && c.clay > 35 && c.stone > 10) type = "idol";
    if (type) {
      const offsets: Vec2[] = [{ x: 0, y: -19 }, { x: -23, y: -8 }, { x: 23, y: -8 }, { x: -15, y: 14 }, { x: 15, y: 14 }, { x: 0, y: 24 }, { x: -23, y: 7 }, { x: 23, y: 7 }, { x: -12, y: -22 }, { x: 12, y: -22 }];
      for (const p of offsets) if (placePointBuilding(world, index, type, camp.x + p.x, camp.y + p.y)) break;
      continue;
    }
    if (world.tick < 6000 || c.clay < 10 || buildings.filter(b => b.stage !== "built").length >= 4) continue;
    // Short palisades with three-cell gates. They never seal the workers in.
    const wallCells: number[] = [], gateCells: number[] = [];
    for (let offset = -18; offset <= 18; offset += 2) {
      for (const dy of [-26, 28]) {
        const p = { x: camp.x + offset, y: camp.y + dy };
        if (isWaterAt(p.x, p.y)) continue;
        (Math.abs(offset) <= 2 ? gateCells : wallCells).push(wallCellIndexAt(p.x, p.y));
      }
    }
    const occupied = new Set(buildings.filter(b => b.type === "wall" || b.type === "gate").map(b => wallCellIndexAt(b.pos.x, b.pos.y)));
    const gates = gateCells.filter(cell => !occupied.has(cell)).slice(0, 2);
    if (gates.length) paintWallCells(world, index, gates, "gate");
    else paintWallCells(world, index, wallCells.filter(cell => !occupied.has(cell)).slice(0, 2));
  }
}
