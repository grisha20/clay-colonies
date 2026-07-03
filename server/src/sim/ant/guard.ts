// Охранник (job = "guard"): простой автомат — держится у лагеря,
// а если паук подходит к поселению, выдвигается навстречу.
// Сам бой ведёт общая логика moveFighting (мобинг/оборона) в combat.ts.
import type { Ant } from "../../../../shared/types";
import { CONFIG } from "../../config";
import type { World } from "../world";
import { moveSurfaceToward } from "./movement";
import { distance, isWithinRadius } from "./utils";

export function moveGuarding(world: World, ant: Ant): boolean {
  const entrance = world.surface.entrance;
  const spider = world.enemies.find((enemy) => enemy.type === "spider" && enemy.hp > 0);

  // Паук близко к лагерю: идём навстречу (бой подхватит moveFighting).
  if (spider && isWithinRadius(spider.pos, entrance, CONFIG.guardEngageRadius)) {
    ant.state = "search";
    moveSurfaceToward(world, ant, spider.pos, false);
    return true;
  }

  // Патруль: не отходить от лагеря дальше guardPatrolRadius.
  const distanceToHome = distance(ant.pos, entrance);
  if (distanceToHome > CONFIG.guardPatrolRadius) {
    ant.state = "search";
    moveSurfaceToward(world, ant, entrance, true, false);
    return true;
  }

  // Лёгкое топтание на посту: медленный дрейф по кругу вокруг лагеря.
  const angle = Math.atan2(ant.pos.y - entrance.y, ant.pos.x - entrance.x) + 0.25;
  const radius = Math.max(6, distanceToHome);
  const post = {
    x: entrance.x + Math.cos(angle) * radius,
    y: entrance.y + Math.sin(angle) * radius
  };
  ant.state = "idle";
  moveSurfaceToward(world, ant, post, true);
  return true;
}
