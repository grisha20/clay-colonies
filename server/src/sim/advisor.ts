import type { Advice, BuildingType, ResourceKind, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
import { territoryDiscs } from "../../../shared/territory";
import type { ColonyRuntime, World } from "./world";

/**
 * The tribe mother speaks up when something needs the player, like the advisor
 * in Stronghold: crowded camp, hunger, dying fire, no clay to mold, missing
 * workshop, a building site short of a resource, danger at camp or at the lake.
 * Advice is state based (shown while the cause lasts) and, once it clears, the
 * same key stays quiet for ADVICE_COOLDOWN ticks so it cannot flicker or spam.
 */
export const ADVICE_EVERY = 100;
export const ADVICE_COOLDOWN = 1200;
const MAX_ADVICE = 4;
const RESOURCE_NAMES: Record<ResourceKind, string> = { clay: "глины", wood: "дерева", stone: "камня" };
const ORDER: Record<Advice["severity"], number> = { danger: 0, warn: 1, info: 2 };

const clearedAt = new WeakMap<ColonyRuntime, Map<string, number>>();
/** Recent totals of deaths, one per advisor pass (to tell "the tribe melts"). */
const lossHistory = new WeakMap<ColonyRuntime, number[]>();
const LOSS_WINDOW = 12;
const CAUSE_NAMES: Record<string, string> = { water: "в воде", rain: "под дождём", shot: "от водяных выстрелов", fight: "в бою", hunger: "от голода", creature: "от зверей" };

type Raw = Omit<Advice, "since">;

export function collectAdvice(world: World, runtime: ColonyRuntime): Raw[] {
  const c = runtime.colony, camp = runtime.surfaceEntrance;
  const ants = runtime.ants.filter(a => a.state !== "dead");
  const population = ants.length;
  const own = world.surface.buildings.filter(b => b.colonyId === runtime.id);
  const count = (type: BuildingType, builtOnly = false) => own.filter(b => b.type === type && (!builtOnly || b.stage === "built")).length;
  const out: Raw[] = [];

  if (!c.queenAlive) out.push({ key: "mother", severity: "danger", text: "Праматерь погибла — новых жителей не будет" });
  // The tribe melts: many deaths in the last ~1200 ticks, with the main cause.
  const history = lossHistory.get(runtime) ?? [];
  const deaths = c.deaths ?? {};
  const total = Object.values(deaths).reduce((sum, n) => sum + n, 0);
  const lost = history.length ? total - history[0] : 0;
  if (lost >= 5) {
    const main = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    out.push({ key: "losses", severity: "danger", text: `Племя тает: погибло ${lost} за короткое время, больше всего ${CAUSE_NAMES[main] ?? ""}`.trim() });
  }
  const enemy = world.enemies.find(e => e.hp > 0 && e.type !== "lakeMonster" && Math.hypot(e.pos.x - camp.x, e.pos.y - camp.y) < 28);
  if (enemy) out.push({ key: "enemy", severity: "danger", text: "Враг у лагеря — стража, к костру!", pos: { ...enemy.pos } });
  const monster = world.enemies.find(e => e.hp > 0 && e.type === "lakeMonster" && ants.some(a => Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) < 10));
  if (monster) out.push({ key: "monster", severity: "danger", text: "У берега чудище — наши слишком близко к воде", pos: { ...monster.pos } });

  if (c.food < 5) out.push({ key: "hunger", severity: "danger", text: "Голод! Еды почти не осталось", pos: { ...camp } });
  else if (c.food < Math.max(18, population * 1.5)) out.push({ key: "food", severity: "warn", text: "Еды мало — нужно больше рук на сборе и рыбалке", pos: { ...camp } });

  if (c.fire < CONFIG.fireLowThreshold) out.push({ key: "fire", severity: "warn", text: "Костёр гаснет — несите дрова", pos: { ...camp } });

  if (c.queenAlive && population >= c.nestCapacity) {
    if (count("hut") < CONFIG.maxHutsPerColony) out.push({ key: "huts", severity: "warn", text: "Нам тесно — поставь ещё хижину", pos: { ...camp } });
    else {
      const small = own.find(b => b.type === "hut" && b.stage === "built" && (b.level ?? 1) < 2);
      if (small) out.push({ key: "house", severity: "warn", text: "Лагерь полон — улучши хижину до дома рода (особая глина)", pos: { ...small.pos } });
      else out.push({ key: "full", severity: "info", text: "Все хижины — дома рода: племя выросло до предела" });
    }
  } else if (c.queenAlive && !c.growthPaused && c.clay < CONFIG.newResidentClayCost + (c.clayReserve ?? 0)) {
    const clay = nearest(world.surface.resourceNodes.filter(n => n.kind === "clay" && n.amount > 0).map(n => n.pos), camp);
    out.push({ key: "clay", severity: "warn", text: "Глины нет — новых лепить не из чего", pos: clay ? { ...clay } : undefined });
  }

  if (!count("workshop") && world.tick > 1500) out.push({ key: "workshop", severity: "warn", text: "Нужна мастерская — без неё не будет топоров и кирок", pos: { ...camp } });

  const raw = ants.filter(a => !a.fired).length;
  if (count("workshop", true) && !count("kiln") && raw >= 10 && world.tick > 4000)
    out.push({ key: "kiln", severity: "warn", text: `Сырых жителей ${raw} — поставь печь, обожжённым дождь не страшен`, pos: { ...camp } });
  else if (count("kiln", true) && raw > 0 && !c.firingPaused && c.wood < CONFIG.kilnWoodPerFiring + CONFIG.kilnWoodReserve)
    out.push({ key: "kiln-wood", severity: "info", text: "Печь остыла — для обжига нужны дрова" });

  const site = own.find(b => b.stage !== "built" && b.type !== "wall" && b.type !== "gate" && missing(b.cost, b.delivered, c) !== undefined);
  if (site) {
    const res = missing(site.cost, site.delivered, c)!;
    out.push({ key: `site-${res}`, severity: "info", text: `На стройку не хватает ${RESOURCE_NAMES[res]}`, pos: { ...site.pos } });
  }

  // Springs of special clay: the idol ritual feeds on it.
  const springs = world.surface.springs ?? [];
  if (springs.length) {
    const discs = territoryDiscs(world.surface).filter(d => d.owner === runtime.id);
    const gap = (p: Vec2) => Math.min(...discs.map(d => Math.hypot(p.x - d.x, p.y - d.y) - d.r));
    const free = springs.filter(s => !s.holder).sort((a, b) => gap(a.pos) - gap(b.pos))[0];
    if (!springs.some(s => s.holder === runtime.id) && free && gap(free.pos) < 40)
      out.push({ key: "spring", severity: "info", text: "Рядом ничей источник особой глины — поставь тотем в его сторону", pos: { ...free.pos } });
    const lost = springs.find(s => s.holder && s.holder !== runtime.id);
    if (lost && count("idol") && (c.specialClay ?? 0) < 1)
      out.push({ key: "spring-enemy", severity: "warn", text: "Соседи держат источник — ритуалу Идола нужна особая глина", pos: { ...lost.pos } });
  }

  // Rival guards shoot water: answer with water shooting and fired guards.
  if (!c.waterWeapons && world.colonies.some(r => r.id !== runtime.id && r.colony.waterWeapons) && count("workshop", true))
    out.push({ key: "water-guns", severity: "warn", text: "Соседи стреляют водой — обучи стражу водяной стрельбе; обожжённые держат удар" });
  // War over the land.
  const besieged = own.find(b => b.type === "totem" && b.stage === "built" &&
    world.colonies.some(r => r.id !== runtime.id && r.ants.some(a => a.state !== "dead" && a.job === "guard" && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 8)));
  if (besieged) out.push({ key: "siege", severity: "danger", text: "Соседи осаждают тотем — поставь пост обороны рядом с ним", pos: { ...besieged.pos } });
  const dom = world.session.dominance;
  if (dom && dom.holder !== runtime.id) {
    const left = Math.max(0, (dom.required ?? CONFIG.dominanceTicks) - (world.tick - dom.since));
    const target = (world.surface.springs ?? []).find(s => s.holder === dom.holder);
    out.push({ key: "dominance", severity: "danger", text: `Соседи держат ${dom.count ?? CONFIG.dominanceSprings} источника — через ${Math.ceil(left / 600)} ч. игры они победят. Осади их тотем постом обороны`, pos: target ? { ...target.pos } : undefined });
  }
  if (world.weather.bigRainActive && (world.weather.bigRainAt ?? CONFIG.bigRainAtTicks) >= CONFIG.bigRainAtTicks) out.push({ key: "finale", severity: "warn", text: "Великий ливень! Держите костёр живым — по окончании победит сильнейшее племя" });

  if (world.weather.state === "warning") {
    const rawCount = ants.filter(a => !a.fired).length;
    out.push({ key: "rain", severity: rawCount ? "warn" : "info", text: rawCount ? `Тучи собираются — ${rawCount} сырых жителей размокнут без крыши` : "Тучи собираются — скоро дождь" });
  }
  return out;
}

function missing(cost: Record<ResourceKind, number>, delivered: Record<ResourceKind, number>, stock: Record<ResourceKind, number>): ResourceKind | undefined {
  return (["wood", "clay", "stone"] as ResourceKind[]).find(r => cost[r] - delivered[r] > 0 && stock[r] < cost[r] - delivered[r]);
}

function nearest(points: Vec2[], to: Vec2): Vec2 | undefined {
  let best: Vec2 | undefined, d = Infinity;
  for (const p of points) {
    const dd = Math.hypot(p.x - to.x, p.y - to.y);
    if (dd < d) { d = dd; best = p; }
  }
  return best;
}

export function updateAdvisor(world: World): void {
  if (world.tick % ADVICE_EVERY !== 0) return;
  for (const runtime of world.colonies) {
    const history = lossHistory.get(runtime) ?? [];
    history.push(Object.values(runtime.colony.deaths ?? {}).reduce((sum, n) => sum + n, 0));
    if (history.length > LOSS_WINDOW) history.shift();
    lossHistory.set(runtime, history);
    const c = runtime.colony;
    const previous = new Map((c.advice ?? []).map(a => [a.key, a]));
    const cleared = clearedAt.get(runtime) ?? new Map<string, number>();
    clearedAt.set(runtime, cleared);
    const next: Advice[] = [];
    for (const raw of collectAdvice(world, runtime)) {
      const old = previous.get(raw.key);
      if (old) { next.push({ ...raw, since: old.since }); continue; }
      const quietUntil = (cleared.get(raw.key) ?? -Infinity) + ADVICE_COOLDOWN;
      if (raw.severity !== "danger" && world.tick < quietUntil) continue;
      next.push({ ...raw, since: world.tick });
    }
    for (const key of previous.keys()) if (!next.some(a => a.key === key)) cleared.set(key, world.tick);
    next.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.since - a.since);
    c.advice = next.slice(0, MAX_ADVICE);
  }
}
