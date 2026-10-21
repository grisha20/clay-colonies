// Источники особой глины: точки на карте, которыми владеет племя, на чьей
// земле они оказались (shared/territory.ts). Владелец раз в
// CONFIG.springYieldTicks получает единицу особой глины — она питает ритуал
// Идола. Смена владельца попадает в журнал событий.
import type { ClaySpring, Vec2 } from "../../../shared/types";
import { territoryDiscs, territoryOwnerAt } from "../../../shared/territory";
import { CONFIG } from "../config";
import type { World } from "./world";
import { logEvent } from "./session";

export const SPRING_EVERY = 100;

export function createSprings(sites: readonly Vec2[] | undefined): ClaySpring[] {
  return (sites ?? []).map((p, i) => ({ id: `spring-${i + 1}`, pos: { x: p.x, y: p.y }, progress: 0 }));
}

function tribeName(world: World, colonyId: string): string {
  const index = world.colonies.findIndex(c => c.id === colonyId);
  return index === 1 ? "B" : "A";
}

export function updateSprings(world: World): void {
  const springs = world.surface.springs;
  if (!springs?.length || world.tick % SPRING_EVERY !== 0) return;
  const discs = territoryDiscs(world.surface);
  for (const spring of springs) {
    const holder = territoryOwnerAt(discs, spring.pos);
    if (holder !== spring.holder) {
      if (holder) logEvent(world, `Племя ${tribeName(world, holder)} заняло источник особой глины.`, spring.pos);
      else if (spring.holder) logEvent(world, `Источник особой глины остался без хозяев.`, spring.pos);
      spring.holder = holder;
      spring.progress = 0;
    }
    if (!holder) continue;
    spring.progress += SPRING_EVERY;
    if (spring.progress >= CONFIG.springYieldTicks) {
      spring.progress -= CONFIG.springYieldTicks;
      const colony = world.colonies.find(c => c.id === holder)?.colony;
      if (colony) colony.specialClay = (colony.specialClay ?? 0) + 1;
    }
  }
}

export function springsHeldBy(world: World, colonyId: string): number {
  return (world.surface.springs ?? []).filter(s => s.holder === colonyId).length;
}
