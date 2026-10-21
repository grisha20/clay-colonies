import type { SessionState, Vec2 } from "../../../shared/types";
import { dayCycle } from "../../../shared/dayCycle";
import { CONFIG } from "../config";
import { createWorkerAnt, syncWorldLegacyFields, type World } from "./world";
import { createSpider } from "./enemy";
import { isWaterAt, lakeDefinitions, type LakeId } from "../../../shared/surfaceTerrain";

export function createSession(tick = 0): SessionState {
  return {
    mode: "match", speed: 1, status: "playing", reason: "", dangersEnabled: true, playerColonyIndex: 0, startedAt: tick,
    raid: { phase: "peace", at: tick + CONFIG.raidFirstAt, until: 0, count: 0, targetColonyId: "colony-1" },
    lakes: Object.fromEntries(lakeDefinitions().map((lake) => [lake.id, { swallowed: 0, nextSpawnAt: tick + CONFIG.lakeMonsterSpawnTicks }])),
    nextBeetlesAt: tick, nextCreatureId: 1, idolProgress: 0,
    stats: { born: 0, lost: 0, rescued: 0, raidsSurvived: 0 }, events: []
  };
}

/** Per-lake threat state; lakes of a generated or migrated world get an entry on first use. */
export function lakeSession(world: World, id: LakeId): SessionState["lakes"][LakeId] {
  return world.session.lakes[id] ??= { swallowed: 0, nextSpawnAt: world.tick + CONFIG.lakeMonsterSpawnTicks };
}

export function logEvent(world: World, text: string, pos?: Vec2): void {
  world.session.events.push({ tick: world.tick, text, pos: pos ? { ...pos } : undefined });
  if (world.session.events.length > 12) world.session.events.shift();
}

export function trainWaterWeapons(world: World, colonyIndex: number): boolean {
  const runtime = world.colonies[colonyIndex];
  if (!runtime || runtime.colony.waterWeapons || world.session.status !== "playing") return false;
  const c = runtime.colony;
  if (!world.surface.buildings.some(b => b.colonyId === c.id && b.type === "workshop" && b.stage === "built")) return false;
  if (c.wood < CONFIG.waterTrainingCost.wood || c.stone < CONFIG.waterTrainingCost.stone) return false;
  c.wood -= CONFIG.waterTrainingCost.wood;
  c.stone -= CONFIG.waterTrainingCost.stone;
  c.waterWeapons = true;
  logEvent(world, "Стража обучена водяной стрельбе. Пустые ёмкости пополняют у озера.", runtime.surfaceEntrance);
  return true;
}

/** Explicit sandbox helper requested for checking water combat without waiting
 * for workshop progression. Reuses a guard, so toggling cannot duplicate units. */
export function prepareSandboxGuard(world: World, colonyIndex: number): void {
  if (world.session.mode !== "sandbox") return;
  const c = world.colonies[colonyIndex];
  if (!c) return;
  let guard = c.ants.find(a => a.job === "guard" && a.state !== "dead" && !a.capturedBy);
  if (!guard) {
    guard = createWorkerAnt(c.surfaceEntrance, "surface", c.id);
    guard.job = "guard";
    guard.pos = { ...c.surfaceEntrance };
    c.ants.push(guard);
  }
  c.colony.waterWeapons = true;
  c.colony.priorities.guard = Math.max(1, c.colony.priorities.guard);
  guard.pos = { ...c.surfaceEntrance };
  guard.waterAmmo = CONFIG.waterAmmoCapacity;
  guard.nextShotAt = 0;
  syncWorldLegacyFields(world);
  logEvent(world, "Песочница: водомёт у лагеря готов к проверке. Пост можно перенести к угрозе.", c.surfaceEntrance);
}

export function updateRaids(world: World): void {
  if (!world.session.dangersEnabled) return;
  const raid = world.session.raid;
  if (raid.phase === "peace" && world.tick >= raid.at - CONFIG.raidWarningTicks) {
    raid.phase = "warning";
    raid.targetColonyId = world.colonies[raid.count % world.colonies.length].id;
    logEvent(world, "Приближается паук! Подготовьте стены и включите тревогу.", world.colonies.find(c => c.id === raid.targetColonyId)?.surfaceEntrance);
  }
  if (raid.phase === "warning" && world.tick >= raid.at) {
    raid.phase = "attack";
    raid.until = world.tick + CONFIG.raidDurationTicks;
    const home = world.colonies.find(c => c.id === raid.targetColonyId)!.surfaceEntrance;
    const spider = createSpider();
    const direction = raid.count % 2 === 0 ? 1 : -1;
    spider.pos = { x: home.x + direction * 62, y: home.y };
    if (isWaterAt(spider.pos.x, spider.pos.y)) spider.pos = { x: home.x, y: home.y + 60 };
    spider.lair = { ...spider.pos };
    spider.raid = true;
    spider.targetColonyId = raid.targetColonyId;
    world.enemies.push(spider);
    logEvent(world, "Набег начался!", spider.pos);
  }
  if (raid.phase === "attack" && (world.tick >= raid.until || !world.enemies.some(e => e.raid && e.hp > 0))) {
    const fled = world.enemies.some(e => e.raid && e.hp > 0);
    world.enemies = world.enemies.filter(e => !e.raid);
    raid.phase = "peace";
    raid.count += 1;
    raid.at = world.tick + CONFIG.raidEveryTicks;
    world.session.stats.raidsSurvived += 1;
    logEvent(world, fled ? "Паук отступил. Время чинить поселение." : "Набег отбит!", world.colonies[0].surfaceEntrance);
  }
}

export function updateOutcome(world: World): void {
  const s = world.session;
  if (s.mode === "sandbox" || s.status !== "playing") return;
  const primary = world.colonies[s.playerColonyIndex ?? 0];
  if (!primary?.ants.some(a => a.state !== "dead")) {
    finish(world, "defeat", `Племя ${(s.playerColonyIndex ?? 0) === 0 ? "A" : "Б"} потеряло всех жителей`);
    return;
  }
  const idol = world.surface.buildings.some(b => b.colonyId === primary.id && b.type === "idol" && b.stage === "built");
  if (idol && primary.colony.fire >= 0.35) s.idolProgress = Math.min(CONFIG.idolRitualTicks, s.idolProgress + 1);
  const elapsed = world.tick - (s.startedAt ?? 0);
  if (elapsed >= CONFIG.matchMinTicks && world.objectives.some(o => o.victory && o.done)) {
    const id = world.objectives.find(o => o.victory && o.done)!.id;
    finish(world, "victory", id === "win-idol" ? "Ритуал Идола завершён" : id === "win-spider" ? "Паук повержен" : "Племя пережило Большой дождь");
  } else if (elapsed >= CONFIG.matchMaxTicks) {
    finish(world, "victory", "Три часа пройдены: племя выжило и сохранило поселение");
  }
}

function finish(world: World, status: "victory" | "defeat", reason: string): void {
  world.session.status = status;
  world.session.reason = reason;
  world.session.endedAt = world.tick;
  logEvent(world, reason);
}

export function announceDusk(world: World): void {
  if (dayCycle(world.tick).phase === "dusk" && dayCycle(world.tick - 1).phase !== "dusk") {
    logEvent(world, "Смеркается. Ночью жуки утаскивают одиноких жителей. Вернитесь к костру.");
  }
}
