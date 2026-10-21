// Печь обжига: сырые глиняные жители становятся обожжёнными.
// Свободная печь зовёт ближайшего сырого жителя без ноши (с еды или без
// дела), когда у племени есть дрова, не идёт дождь и нет тревоги. Житель
// стоит у печи; обжиг идёт, только пока он рядом (дождь уводит его под
// крышу — прогресс ждёт). Дрова списываются при первом подходе. Пауза
// останавливает всё: житель уходит работать, прогресс и дрова сохраняются,
// после снятия паузы он возвращается и дожигается.
// Обожжённый не размокает под дождём, в воде растворяется медленнее и
// крепче в бою (ant/step.ts, water.ts, fired в Ant).
import type { Ant, Building } from "../../../shared/types";
import { buildingServicePoint } from "../../../shared/buildingGeometry";
import { CONFIG } from "../config";
import type { World } from "./world";
import { logEvent } from "./session";
import { moveSurfaceToward } from "./ant/movement";

const AT_KILN = 1.4;

function kilnFor(world: World, ant: Ant): Building | undefined {
  if (!ant.kilnId) return undefined;
  const kiln = world.surface.buildings.find(b => b.id === ant.kilnId);
  return kiln && kiln.stage === "built" && kiln.firing?.antId === ant.id ? kiln : undefined;
}

/** Free hands for firing: alive, raw, not carrying, not captured, food or idle job. */
export function canBeFired(ant: Ant): boolean {
  return ant.state !== "dead" && !ant.fired && !ant.kilnId && !ant.capturedBy && ant.carrying <= 0 &&
    (ant.job === "forage" || ant.job === "idle" || ant.job === undefined);
}

export function updateKilns(world: World): void {
  for (const runtime of world.colonies) {
    const c = runtime.colony;
    const kilns = world.surface.buildings.filter(b => b.type === "kiln" && b.stage === "built" && b.colonyId === runtime.id);
    for (const kiln of kilns) {
      const firing = kiln.firing;
      if (firing && c.firingPaused) {
        // Pause: the resident goes back to work, nothing burns. A paid firing
        // keeps its progress for the same resident; an unpaid call is dropped.
        const ant = runtime.ants.find(a => a.id === firing.antId);
        if (ant && ant.kilnId === kiln.id) ant.kilnId = undefined;
        if (!firing.paid) kiln.firing = undefined;
        continue;
      }
      if (firing) {
        const ant = runtime.ants.find(a => a.id === firing.antId);
        if (ant && firing.paid && ant.kilnId !== kiln.id && ant.state !== "dead" && !ant.capturedBy) {
          // Resuming after a pause: call the same resident back to finish.
          ant.kilnId = kiln.id;
        }
        const timedOut = !firing.paid && world.tick - firing.calledAt > CONFIG.kilnCallTimeoutTicks;
        if (!ant || ant.state === "dead" || ant.capturedBy || timedOut) {
          if (ant) ant.kilnId = undefined;
          kiln.firing = undefined;
          continue;
        }
        const service = buildingServicePoint(kiln);
        if (Math.hypot(ant.pos.x - service.x, ant.pos.y - service.y) > AT_KILN + 0.4) continue;
        if (!firing.paid) {
          if (c.wood < CONFIG.kilnWoodPerFiring) { ant.kilnId = undefined; kiln.firing = undefined; continue; }
          c.wood -= CONFIG.kilnWoodPerFiring;
          firing.paid = true;
        }
        firing.progress += 1;
        if (firing.progress >= CONFIG.kilnFiringTicks) {
          ant.fired = true;
          ant.strength += CONFIG.firedStrengthBonus;
          ant.kilnId = undefined;
          kiln.firing = undefined;
          c.firedTotal = (c.firedTotal ?? 0) + 1;
          if (c.firedTotal === 1 || c.firedTotal % 5 === 0) logEvent(world, c.firedTotal === 1 ? "Первый житель обожжён: дождь ему не страшен." : `Обожжено жителей: ${c.firedTotal}.`, kiln.pos);
        }
        continue;
      }
      if (c.firingPaused || c.alarm || world.weather.state === "rain") continue;
      if (c.wood < CONFIG.kilnWoodPerFiring + CONFIG.kilnWoodReserve) continue;
      const service = buildingServicePoint(kiln);
      let best: Ant | undefined, bestD = Infinity;
      for (const ant of runtime.ants) {
        if (!canBeFired(ant)) continue;
        const d = Math.hypot(ant.pos.x - service.x, ant.pos.y - service.y);
        if (d < bestD) { bestD = d; best = ant; }
      }
      if (!best) continue;
      best.kilnId = kiln.id;
      kiln.firing = { antId: best.id, progress: 0, calledAt: world.tick, paid: false };
    }
  }
}

/** The called resident walks to the kiln and stands at its mouth. */
export function moveToKiln(world: World, ant: Ant): boolean {
  if (!ant.kilnId) return false;
  const kiln = kilnFor(world, ant);
  if (!kiln) { ant.kilnId = undefined; return false; }
  const service = buildingServicePoint(kiln);
  const d = Math.hypot(ant.pos.x - service.x, ant.pos.y - service.y);
  if (d > AT_KILN) {
    ant.state = "search";
    moveSurfaceToward(world, ant, service, true, false);
  } else {
    ant.state = "idle";
    const k = Math.max(0.01, Math.hypot(kiln.pos.x - ant.pos.x, kiln.pos.y - ant.pos.y));
    ant.heading = { x: (kiln.pos.x - ant.pos.x) / k, y: (kiln.pos.y - ant.pos.y) / k };
  }
  return true;
}

export function rawResidents(runtime: { ants: Ant[] }): number {
  return runtime.ants.filter(a => a.state !== "dead" && !a.fired).length;
}
