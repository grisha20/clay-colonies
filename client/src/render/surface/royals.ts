import type { Ant, Vec2, WorldSnapshot } from "../../../../shared/types";
import { buildingFootprint, buildingServicePoint, insideBuilding, crossesBuilding, outsideBuilding } from "../../../../shared/buildingGeometry";
import { insideHearth, crossesHearth } from "../../../../shared/campGeometry";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { dayCycle } from "../../../../shared/dayCycle";
import { campShelterPoints } from "../../../../shared/campShelter";
import { fenceCellCenters } from "../../../../shared/fenceGeometry";

export function royalKind(ant: Ant): "king" | "queen" | null { return ant.id.startsWith("royal-king-") ? "king" : ant.id.startsWith("royal-queen-") ? "queen" : null; }
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
type RoutePlan = { key: string; route: Vec2[]; path: (a: Vec2, b: Vec2) => Vec2[] };
type Walker = { pos: Vec2; heading: Vec2; tick: number; index: number; wait: number; safe: string; returnPath: Vec2[] };

/** Small local grid, rebuilt only when the estate's permanent obstacles change. */
function estatePlan(world: WorldSnapshot, colonyId: string, camp: Vec2, key: string): RoutePlan {
  const solids = world.surface.buildings.map(buildingFootprint).filter((f): f is NonNullable<typeof f> => !!f);
  const walls = new Set(world.surface.buildings.filter(b => b.stage === "built" && (b.type === "wall" || b.type === "gate") && !(b.type === "gate" && b.colonyId === colonyId)).flatMap(fenceCellCenters).map(p => `${Math.floor(p.x / 2)},${Math.floor(p.y / 2)}`));
  const open = (p: Vec2) => p.x > 1 && p.y > 1 && p.x < world.surface.width - 1 && p.y < world.surface.height - 1 && !isWaterAt(p.x, p.y) && !walls.has(`${Math.floor(p.x / 2)},${Math.floor(p.y / 2)}`) && !world.surface.entrances.some(c => insideHearth(p.x, p.y, c)) && !solids.some(f => insideBuilding(p.x, p.y, f));
  const clear = (a: Vec2, b: Vec2) => {
    if (solids.some(f => crossesBuilding(a, b, f)) || world.surface.entrances.some(c => crossesHearth(a.x, a.y, b.x, b.y, c))) return false;
    const n = Math.max(1, Math.ceil(distance(a, b) * 2));
    for (let i = 0; i <= n; i++) if (!open({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n })) return false;
    return true;
  };
  const nodes: Vec2[] = [], lookup = new Map<string, number>();
  for (let y = -23; y <= 23; y++) for (let x = -23; x <= 23; x++) {
    const p = { x: camp.x + x, y: camp.y + y };
    if (open(p)) { lookup.set(`${p.x},${p.y}`, nodes.length); nodes.push(p); }
  }
  const nearest = (p: Vec2) => nodes.reduce((best, n, i) => distance(n, p) < distance(nodes[best], p) ? i : best, 0);
  const path = (a: Vec2, b: Vec2): Vec2[] => {
    if (!nodes.length) return [];
    const start = nearest(a), end = nearest(b), previous = new Map<number, number>([[start, -1]]), queue = [start];
    if (distance(a, nodes[start]) > 0.1 && !clear(a, nodes[start])) return [];
    for (let head = 0; head < queue.length && !previous.has(end); head++) {
      const current = queue[head], p = nodes[current];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const index = lookup.get(`${p.x + dx},${p.y + dy}`);
        if (index !== undefined && !previous.has(index) && clear(p, nodes[index])) { previous.set(index, current); queue.push(index); }
      }
    }
    if (!previous.has(end)) return [];
    const raw: Vec2[] = [];
    for (let i = end; i !== -1; i = previous.get(i)!) raw.push(nodes[i]);
    raw.reverse(); const smooth: Vec2[] = []; let last = a;
    for (let i = 0; i < raw.length;) {
      let far = raw.length - 1; while (far > i && !clear(last, raw[far])) far--;
      smooth.push(raw[far]); last = raw[far]; i = far + 1;
    }
    return smooth;
  };
  const stops = [[-7, 3], [-17, 1], [-17, -15], [0, -18], [17, -15], [17, 1], [7, 5], [0, 7]].map(([x, y]) => ({ x: camp.x + x, y: camp.y + y })).filter(open);
  const route: Vec2[] = [];
  if (stops.length) {
    route.push(stops[0]);
    for (let i = 1; i <= stops.length; i++) route.push(...path(route[route.length - 1], stops[i % stops.length]));
  }
  return { key, route, path };
}

export class RoyalWalk {
  private plans = new Map<string, RoutePlan>();
  private walkers = new Map<string, Walker>();
  private lastTick = -1;
  private lastTime?: number;
  private displayTick = 0;
  update(world: WorldSnapshot, nowMs?: number): Ant[] {
    if (world.tick < this.lastTick) { this.plans.clear(); this.walkers.clear(); this.lastTime = undefined; }
    // Royals have no server positions to interpolate. Advance their route on
    // presentation frames, capped one packet ahead so a lost connection stops them.
    if (nowMs === undefined) this.displayTick = world.tick;
    else {
      const dt = this.lastTime === undefined ? 0 : Math.max(0, Math.min(0.05, (nowMs - this.lastTime) / 1000));
      if (this.lastTime === undefined) this.displayTick = world.tick;
      if (world.session.status === "playing" && world.session.speed) {
        this.displayTick = Math.min(world.tick + world.session.speed, this.displayTick + dt * 10 * world.session.speed);
      }
      this.lastTime = nowMs;
    }
    this.lastTick = world.tick;
    const result: Ant[] = [];
    for (const [index, c] of world.colonies.entries()) {
      const camp = world.surface.entrances[index]; if (!camp) continue;
      const key = `${camp.x},${camp.y}:${world.surface.buildings.filter(b => b.stage === "built").map(b => `${b.id},${b.pos.x},${b.pos.y},${b.type},${b.colonyId},${b.gateAxis},${b.gateSpan}`).join("|")}`;
      let plan = this.plans.get(c.id);
      if (plan?.key !== key) {
        plan = estatePlan(world, c.id, camp, key); this.plans.set(c.id, plan);
        for (const role of ["king", "queen"]) {
          const walker = this.walkers.get(`royal-${role}-${c.id}`); if (!walker || !plan.route.length) continue;
          for (const b of world.surface.buildings) { const f = buildingFootprint(b); if (f && insideBuilding(walker.pos.x, walker.pos.y, f)) walker.pos = outsideBuilding(walker.pos, f); }
          walker.index = plan.route.reduce((best, p, i) => distance(p, walker.pos) < distance(plan!.route[best], walker.pos) ? i : best, 0);
          walker.returnPath = plan.path(walker.pos, plan.route[walker.index]);
          walker.wait = walker.returnPath.length ? 0 : Infinity; walker.safe = "";
        }
      }
      if (plan.route.length < 2) continue;
      const rain = world.weather?.state === "warning" || world.weather?.state === "rain";
      const unsafe = rain ? `rain-${(c.colony.fire ?? 0) > 0.05}` : c.colony.alarm || dayCycle(world.tick).darkness > 0.75 || world.enemies.some(e => e.hp > 0 && distance(e.pos, camp) < 22) ? "danger" : "";
      for (const [roleIndex, role] of ["king", "queen"].entries()) {
        const id = `royal-${role}-${c.id}`; let walker = this.walkers.get(id);
        if (!walker) {
          const start = roleIndex ? Math.floor(plan.route.length / 2) : 0;
          walker = { pos: { ...plan.route[start] }, heading: { x: 0, y: 1 }, tick: this.displayTick, index: (start + 1) % plan.route.length, wait: roleIndex * 2, safe: "", returnPath: [] }; this.walkers.set(id, walker);
        }
        if (unsafe !== walker.safe) {
          walker.safe = unsafe;
          walker.wait = 0;
          if (unsafe) {
            const homes = world.surface.buildings.filter(b => b.colonyId === c.id && b.type === "hut" && b.stage === "built");
            const home = homes[roleIndex % Math.max(1, homes.length)];
            const dryPlace = rain && (c.colony.fire ?? 0) > 0.05 ? campShelterPoints(camp, world.surface.buildings, world.surface.width, world.surface.height, c.id)[roleIndex] : undefined;
            walker.returnPath = plan.path(walker.pos, dryPlace ?? (home ? buildingServicePoint(home) : { x: camp.x + (roleIndex ? 5 : -5), y: camp.y + 5 }));
          } else {
            walker.index = plan.route.reduce((best, p, i) => distance(p, walker!.pos) < distance(plan!.route[best], walker!.pos) ? i : best, 0);
            walker.returnPath = plan.path(walker.pos, plan.route[walker.index]);
            if (!walker.returnPath.length && distance(walker.pos, plan.route[walker.index]) > 0.1) walker.wait = Infinity;
          }
        }
        let budget = world.session.speed && world.session.status === "playing" ? Math.min(500, Math.max(0, this.displayTick - walker.tick)) * 0.22 : 0;
        walker.tick = this.displayTick;
        while (budget > 0.0001) {
          if (walker.wait > 0) { const used = Math.min(budget, walker.wait); walker.wait -= used; budget -= used; continue; }
          const target = walker.returnPath[0] ?? (walker.safe ? null : plan.route[walker.index]); if (!target) break;
          const length = distance(walker.pos, target), used = Math.min(length, budget);
          if (length > 0.0001) { walker.heading = { x: (target.x - walker.pos.x) / length, y: (target.y - walker.pos.y) / length }; walker.pos.x += walker.heading.x * used; walker.pos.y += walker.heading.y * used; }
          budget -= used;
          if (length <= used + 0.0001) { if (walker.returnPath.length) walker.returnPath.shift(); else { walker.index = (walker.index + 1) % plan.route.length; walker.wait = 3; } }
        }
        result.push({ id, colonyId: c.id, role: "worker", layer: "surface", job: "idle", state: "idle", strength: 1, energy: 100, carrying: 0, pos: { ...walker.pos }, heading: { ...walker.heading } });
      }
    }
    return result;
  }
}
export const royalWalk = new RoyalWalk();
