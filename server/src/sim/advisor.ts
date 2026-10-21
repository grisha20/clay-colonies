import type { Advice, BuildingType, ResourceKind, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
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

type Raw = Omit<Advice, "since">;

export function collectAdvice(world: World, runtime: ColonyRuntime): Raw[] {
  const c = runtime.colony, camp = runtime.surfaceEntrance;
  const ants = runtime.ants.filter(a => a.state !== "dead");
  const population = ants.length;
  const own = world.surface.buildings.filter(b => b.colonyId === runtime.id);
  const count = (type: BuildingType, builtOnly = false) => own.filter(b => b.type === type && (!builtOnly || b.stage === "built")).length;
  const out: Raw[] = [];

  if (!c.queenAlive) out.push({ key: "mother", severity: "danger", text: "Праматерь погибла — новых жителей не будет" });
  const enemy = world.enemies.find(e => e.hp > 0 && e.type !== "lakeMonster" && Math.hypot(e.pos.x - camp.x, e.pos.y - camp.y) < 28);
  if (enemy) out.push({ key: "enemy", severity: "danger", text: "Враг у лагеря — стража, к костру!", pos: { ...enemy.pos } });
  const monster = world.enemies.find(e => e.hp > 0 && e.type === "lakeMonster" && ants.some(a => Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) < 10));
  if (monster) out.push({ key: "monster", severity: "danger", text: "У берега чудище — наши слишком близко к воде", pos: { ...monster.pos } });

  if (c.food < 5) out.push({ key: "hunger", severity: "danger", text: "Голод! Еды почти не осталось", pos: { ...camp } });
  else if (c.food < Math.max(18, population * 1.5)) out.push({ key: "food", severity: "warn", text: "Еды мало — нужно больше рук на сборе и рыбалке", pos: { ...camp } });

  if (c.fire < CONFIG.fireLowThreshold) out.push({ key: "fire", severity: "warn", text: "Костёр гаснет — несите дрова", pos: { ...camp } });

  if (c.queenAlive && population >= c.nestCapacity) {
    if (count("hut") < CONFIG.maxHutsPerColony) out.push({ key: "huts", severity: "warn", text: "Нам тесно — поставь ещё хижину", pos: { ...camp } });
    else out.push({ key: "full", severity: "info", text: "Лагерь полон — больше хижин здесь не поставить" });
  } else if (c.queenAlive && !c.growthPaused && c.clay < CONFIG.newResidentClayCost + (c.clayReserve ?? 0)) {
    const clay = nearest(world.surface.resourceNodes.filter(n => n.kind === "clay" && n.amount > 0).map(n => n.pos), camp);
    out.push({ key: "clay", severity: "warn", text: "Глины нет — новых лепить не из чего", pos: clay ? { ...clay } : undefined });
  }

  if (!count("workshop") && world.tick > 1500) out.push({ key: "workshop", severity: "warn", text: "Нужна мастерская — без неё не будет топоров и кирок", pos: { ...camp } });

  const site = own.find(b => b.stage !== "built" && b.type !== "wall" && b.type !== "gate" && missing(b.cost, b.delivered, c) !== undefined);
  if (site) {
    const res = missing(site.cost, site.delivered, c)!;
    out.push({ key: `site-${res}`, severity: "info", text: `На стройку не хватает ${RESOURCE_NAMES[res]}`, pos: { ...site.pos } });
  }

  if (world.weather.state === "warning") out.push({ key: "rain", severity: "info", text: "Тучи собираются — скоро дождь" });
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
