// Осада тотемов: стражники племени, стоящие вплотную к чужому достроенному
// тотему, ломают его. Игрок осаждает, поставив пост обороны рядом с тотемом
// соседей; защищает — поставив пост у своего (стража бьёт чужаков у поста).
// Разрушенный тотем снимает землю, и источник может перейти к соседям.
import type { Building } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "./world";
import { damageBuilding } from "./building";
import { logEvent } from "./session";

export function totemAttackers(world: World, totem: Building) {
  return world.colonies.filter(c => c.id !== totem.colonyId).flatMap(c => c.ants).filter(a =>
    a.state !== "dead" && !a.capturedBy && a.job === "guard" && Math.hypot(a.pos.x - totem.pos.x, a.pos.y - totem.pos.y) <= CONFIG.siegeRange);
}

export function updateSiege(world: World): void {
  const totems = world.surface.buildings.filter(b => b.type === "totem" && b.stage === "built");
  for (const totem of totems) {
    const attackers = totemAttackers(world, totem);
    if (!attackers.length) continue;
    const before = world.surface.buildings.length;
    damageBuilding(world, totem, attackers.reduce((sum, a) => sum + CONFIG.siegeDamagePerGuard * a.strength, 0));
    if (world.surface.buildings.length < before) {
      const tribe = world.colonies.findIndex(c => c.id === totem.colonyId) === 1 ? "B" : "A";
      logEvent(world, `Тотем племени ${tribe} разрушен осадой.`, totem.pos);
    }
  }
}
