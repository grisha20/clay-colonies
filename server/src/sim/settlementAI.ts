import type { Building, BuildingType, Vec2 } from "../../../shared/types";
import { isWaterAt, isTerrainBlockedAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { placePointBuilding, placeGate, paintWallCells, wallCellIndexAt, isSurfaceBlockedAt, upgradeHut } from "./building";
import type { ColonyRuntime, World } from "./world";
import { trainWaterWeapons } from "./session";
import { fenceCellCenters } from "../../../shared/fenceGeometry";
import { pointBuildingPlacement } from "../../../shared/buildingPlacement";
import { buildingServicePoint } from "../../../shared/buildingGeometry";
import { placementAccessWarning } from "../../../shared/placementAccess";
import { taskApproach } from "./taskAccess";
import { colonyWorldView } from "./world";
import { territoryDiscs, TOTEM_TERRITORY_RADIUS } from "../../../shared/territory";
import { logEvent } from "./session";

const inaccessibleSince = new WeakMap<Building, number>();

/**
 * Next totem toward the nearest spring this tribe does not hold (free ones
 * first): a step from the own land disc closest to it, near that disc's edge,
 * so a chain of totems walks the border out to the spring.
 */
export function totemSite(world: World, index: number): Vec2 | undefined {
  const runtime = world.colonies[index], owner = runtime.id;
  const springs = (world.surface.springs ?? []).filter(s => s.holder !== owner);
  if (!springs.length) return undefined;
  const discs = territoryDiscs(world.surface).filter(d => d.owner === owner);
  const gap = (p: Vec2) => Math.min(...discs.map(d => Math.hypot(p.x - d.x, p.y - d.y) - d.r));
  const target = [...springs].sort((a, b) => (a.holder ? 1 : 0) - (b.holder ? 1 : 0) || gap(a.pos) - gap(b.pos))[0];
  if (gap(target.pos) > 90) return undefined;
  const from = [...discs].sort((a, b) => Math.hypot(target.pos.x - a.x, target.pos.y - a.y) - a.r - (Math.hypot(target.pos.x - b.x, target.pos.y - b.y) - b.r))[0];
  const base = Math.atan2(target.pos.y - from.y, target.pos.x - from.x);
  const scoped = colonyWorldView(world, runtime);
  for (const back of [5, 9, 13, 17]) for (const turn of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8]) {
    const s = from.r - back, a = base + turn;
    const p = { x: Math.round(from.x + Math.cos(a) * s), y: Math.round(from.y + Math.sin(a) * s) };
    if (pointBuildingPlacement(world.surface, owner, "totem", p)) continue;
    const plan = { type: "totem", pos: p, colonyId: owner, id: "ai-plan", stage: "built" } as Building;
    if (!taskApproach(scoped, buildingServicePoint(plan), 2)) continue;
    return p;
  }
  return undefined;
}

function settlementSites(world:World,index:number,type:"hut"|"storage"|"workshop"|"idol"|"kiln"):Vec2[] {
  const runtime=world.colonies[index],camp=runtime.surfaceEntrance,scoped=colonyWorldView(world,runtime),rival=world.colonies[world.session.playerColonyIndex??0]?.surfaceEntrance;
  const candidates:Vec2[]=[];
  for(const radius of [18,26,34,42,50])for(let i=0;i<16;i++){
    const angle=i*Math.PI/8+(index%2)*Math.PI/16,pos={x:Math.round(camp.x+Math.cos(angle)*radius),y:Math.round(camp.y+Math.sin(angle)*radius)};
    if(pointBuildingPlacement(world.surface,runtime.id,type,pos))continue;
    if(world.surface.resourceNodes.some(n=>n.amount>0&&Math.hypot(n.pos.x-pos.x,n.pos.y-pos.y)<5))continue;
    const plan={type,pos,colonyId:runtime.id,id:"ai-plan",stage:"built"} as Building;
    if(!taskApproach(scoped,buildingServicePoint(plan),2))continue;
    candidates.push(pos);
  }
  const score=(p:Vec2)=>{
    const enemyDistance=rival?Math.hypot(p.x-rival.x,p.y-rival.y):0;
    const useful=type==="storage"?Math.min(60,...world.surface.resourceNodes.filter(n=>n.amount>0).map(n=>Math.hypot(n.pos.x-p.x,n.pos.y-p.y))):0;
    return Math.hypot(p.x-camp.x,p.y-camp.y)+useful*.4-enemyDistance*.025;
  };
  return candidates.sort((a,b)=>score(a)-score(b));
}

/** One settlement-level planner. It pays normal costs through normal workers. */
export function enemyNearCamp(world: World, runtime: ColonyRuntime): boolean {
  const camp = runtime.surfaceEntrance;
  return world.enemies.some(e => e.hp > 0 && Math.hypot(e.pos.x - camp.x, e.pos.y - camp.y) < 28);
}

/** Player turned the alarm on or off by hand: the mother leaves it alone. */
export function noteManualAlarm(runtime: ColonyRuntime): void {
  runtime.colony.alarmByMother = false;
}

/**
 * Daily tribe logic of the mother: who does what, how much clay to keep before
 * molding new residents and when to sound the alarm. AI tribes always run it;
 * the player's tribe runs it while `autoManage` («Праматерь решает») is on.
 * Building and expansion stay with the player.
 */
function runTribeLogic(world: World, runtime: ColonyRuntime, isPlayer: boolean): void {
  const c = runtime.colony, population = runtime.ants.length;
  const built = (type: BuildingType) => world.surface.buildings.filter(b => b.colonyId === c.id && b.type === type && b.stage === "built").length;
  const threat = enemyNearCamp(world, runtime);
  if (!isPlayer) c.alarm = threat;
  else if (threat && !c.alarm) { c.alarm = true; c.alarmByMother = true; }
  else if (!threat && c.alarm && c.alarmByMother) { c.alarm = false; c.alarmByMother = false; }
  c.growthPaused = false;
  c.clayReserve = population < 14 ? 0 : 6;
  // Work in proportion to the tribe and its needs (a fixed small table left
  // a 47-strong tribe with two woodcutters, no fire and 1500 food).
  const foodLow = c.food < Math.max(18, population * 1.5);
  const foodRich = c.food > population * 20;
  const fireLow = c.fire < 0.6 || c.wood < 6;
  const sites = world.surface.buildings.filter(b => b.colonyId === c.id && b.stage !== "built");
  const siteNeedsWood = sites.some(b => b.cost.wood > b.delivered.wood);
  // Firing burns wood: hold it while the hearth or a building site needs it, or when hungry.
  c.firingPaused = foodLow || fireLow || (siteNeedsWood && c.wood < 12);
  const atWar = !isPlayer && !!c.war;
  const share = (f: number) => Math.max(1, Math.round(population * f));
  const scale = foodLow ? 0.5 : 1;
  c.priorities = {
    clay: Math.round((c.clay < 40 ? share(0.12) : c.clay < 120 ? share(0.05) : 1) * scale),
    wood: Math.round((c.wood < 40 || siteNeedsWood ? share(0.2) + (fireLow ? 2 : 0) : share(0.08)) * (fireLow ? 1 : scale)),
    stone: built("workshop") ? Math.round((c.stone < 30 ? share(0.08) : c.stone < 80 ? share(0.03) : 0) * scale) : 0,
    build: foodLow ? 1 : sites.length ? Math.min(8, share(0.1) + 1) : 1,
    guard: atWar ? Math.max(CONFIG.aiWarMinGuards, Math.floor(population / 3)) : threat ? Math.min(5, Math.floor(population / 4)) : population >= 15 ? 2 : 1,
    fish: !foodRich && built("workshop") && c.rods > 0 && population >= 12 ? Math.min(c.rods, share(0.08)) : 0
  };
}

/** Rival totem worth besieging: the player's built totem nearest a spring it holds or blocks. */
function warTarget(world: World, index: number): Building | undefined {
  const me = world.colonies[index], player = world.colonies[world.session.playerColonyIndex ?? 0];
  if (!player || player.id === me.id) return undefined;
  const springs = world.surface.springs ?? [];
  const totems = world.surface.buildings.filter(b => b.colonyId === player.id && b.type === "totem" && b.stage === "built");
  const score = (t: Building) => Math.min(...springs.filter(s => s.holder !== me.id).map(s => Math.hypot(s.pos.x - t.pos.x, s.pos.y - t.pos.y)), Infinity);
  return totems.filter(t => score(t) < TOTEM_TERRITORY_RADIUS + 6).sort((a, b) => score(a) - score(b))[0];
}

/**
 * War of an AI tribe: when stronger, it moves its defence post next to a
 * player's totem by a spring and sends more guards; they break the totem
 * (siege.ts). Gives up after aiWarMaxTicks, then rests. True while at war.
 */
export function updateWar(world: World, index: number): boolean {
  const runtime = world.colonies[index], c = runtime.colony;
  const player = world.colonies[world.session.playerColonyIndex ?? 0];
  if (!c.war) {
    if (!player || world.tick < CONFIG.aiWarAfterTicks || world.tick < (c.warCooldownUntil ?? 0)) return false;
    // Enough people to field the war party (guards are raised once at war).
    const alive = (r: typeof runtime) => r.ants.filter(a => a.state !== "dead").length;
    // The player is about to win by the springs: go to war whatever the numbers.
    const leader = world.session.dominance?.holder === player.id;
    if (leader ? alive(runtime) < CONFIG.aiWarLeaderMinAlive : alive(runtime) < CONFIG.aiWarMinGuards * 3 || alive(runtime) < alive(player) * 0.8) return false;
    const target = warTarget(world, index);
    if (!target) return false;
    c.war = { targetId: target.id, since: world.tick };
    logEvent(world, "Соседи идут осаждать тотем у источника!", target.pos);
  }
  const target = world.surface.buildings.find(b => b.id === c.war!.targetId && b.stage === "built");
  if (!target || world.tick - c.war.since > CONFIG.aiWarMaxTicks) {
    c.war = undefined;
    c.warCooldownUntil = world.tick + CONFIG.aiWarCooldownTicks;
    return false;
  }
  // Post right next to the totem, on the side facing home, so guards stand in siege range.
  const camp = runtime.surfaceEntrance, base = Math.atan2(camp.y - target.pos.y, camp.x - target.pos.x);
  for (const back of [2.2, 2.8, 1.6]) for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0, Math.PI]) {
    const p = { x: target.pos.x + Math.cos(base + turn) * back, y: target.pos.y + Math.sin(base + turn) * back };
    if (!isSurfaceBlockedAt(world, p.x, p.y, runtime.id)) { c.defensePost = p; return true; }
  }
  return true;
}

export function updateSettlementAI(world: World): void {
  if (world.tick % 100 !== 0) return;
  for (const [index, runtime] of world.colonies.entries()) {
    if (!runtime.ants.length) continue;
    const isPlayer = index === (world.session.playerColonyIndex ?? 0);
    if (isPlayer) {
      if (runtime.colony.autoManage) runTribeLogic(world, runtime, true);
      continue;
    }
    runTribeLogic(world, runtime, false);
    // War is decided in any weather (fired guards do not fear rain).
    const atWar = updateWar(world, index);
    const c = runtime.colony, camp = runtime.surfaceEntrance, population = runtime.ants.length;
    let buildings = world.surface.buildings.filter(b => b.colonyId === c.id);
    const built = (type: BuildingType) => buildings.filter(b => b.type === type && b.stage === "built").length;
    const threat = c.alarm;
    if (threat || world.weather.state !== "clear") continue;
    if (built("workshop") && c.wood >= 16 && c.stone >= 12 && world.tick > 12000) trainWaterWeapons(world, index);
    // Choose an unobstructed front; post is inside the fort and not in water.
    const rival = world.colonies[world.session.playerColonyIndex ?? 0]?.surfaceEntrance;
    const sign = rival && rival.x < camp.x ? -1 : 1;
    const scoped=colonyWorldView(world,runtime);
    // A sealed empty blueprint must not stop the whole settlement. Delivered
    // resources stay on their site; only untouched plans can be safely replaced.
    const pending = buildings.filter(b => b.stage !== "built" && b.type !== "wall" && b.type !== "gate");
    let reachablePending = false;
    for (const site of pending) {
      if (taskApproach(scoped, buildingServicePoint(site), 2)) {
        inaccessibleSince.delete(site); reachablePending = true; continue;
      }
      const since = inaccessibleSince.get(site) ?? world.tick;
      inaccessibleSince.set(site, since);
      if (world.tick - since >= 300 && site.progress === 0 && Object.values(site.delivered).every(amount => amount === 0)) {
        world.surface.buildings = world.surface.buildings.filter(b => b !== site);
        scoped.surface.buildings = world.surface.buildings;
      }
    }
    buildings = world.surface.buildings.filter(b => b.colonyId === c.id);
    if (atWar) continue;
    const postCandidates=[{x:camp.x+sign*9,y:camp.y+5},...buildings.filter(b=>b.type==="gate"&&b.stage==="built").map(b=>({x:b.pos.x,y:b.pos.y+(b.pos.y<camp.y?4:-4)})),{x:camp.x,y:camp.y+5}];
    c.defensePost=postCandidates.find(p=>!isSurfaceBlockedAt(world,p.x,p.y,runtime.id)&&taskApproach(scoped,p))??c.defensePost;
    if (reachablePending) continue;
    let type: "hut" | "storage" | "workshop" | "idol" | "kiln" | undefined;
    if (!built("workshop")) type = "workshop";
    else if (built("hut") < Math.min(CONFIG.maxHutsPerColony, 3 + Math.floor(world.tick / 9000)) && (population >= 10 + built("hut") * 4 || world.tick >= 4000 && built("hut") < 3)) type = "hut";
    else if (built("storage") < 2 && population >= 20 && world.tick > 6000) type = "storage";
    else if (!built("kiln") && population >= 14 && world.tick > 5000 && c.stone >= 6) type = "kiln";
    else if (!built("idol") && world.tick > CONFIG.matchMinTicks / 2 && c.clay > 35 && c.stone > 10) type = "idol";
    // Houses of the clan once the huts are maxed and special clay allows.
    const smallHut = buildings.find(b => b.type === "hut" && b.stage === "built" && (b.level ?? 1) < 2);
    if (smallHut && built("hut") >= CONFIG.maxHutsPerColony && upgradeHut(world, index, smallHut.id)) continue;
    const pendingTotem = buildings.some(b => b.type === "totem" && b.stage !== "built");
    if (!type && built("workshop") && !pendingTotem && built("totem") < CONFIG.maxTotemsPerColony && world.tick > 3000 && c.clay >= 14 && c.wood >= 8 && c.stone >= 4) {
      const site = totemSite(world, index);
      if (site && placePointBuilding(world, index, "totem", site.x, site.y)) continue;
    }
    if (type) {
      for (const p of settlementSites(world,index,type)) if (!placementAccessWarning(world.surface,runtime.id,[{type,pos:p,colonyId:runtime.id,id:"ai-plan",stage:"built"} as Building])&&placePointBuilding(world, index, type, p.x, p.y)) break;
      continue;
    }
    if (world.tick < 6000 || c.clay < 10 || buildings.filter(b => b.stage !== "built").length >= 4) continue;
    // Short palisades with three-cell gates. They never seal the workers in.
    const wallCells: number[] = [], gateCells: number[] = [];
    for (let offset = -18; offset <= 18; offset += 2) {
      for (const dy of [-26, 28]) {
        const p = { x: camp.x + offset, y: camp.y + dy };
        if (isTerrainBlockedAt(p.x, p.y)) continue;
        (Math.abs(offset) <= 2 ? gateCells : wallCells).push(wallCellIndexAt(p.x, p.y));
      }
    }
    const occupied = new Set(buildings.filter(b => b.type === "wall" || b.type === "gate").flatMap(fenceCellCenters).map(p => wallCellIndexAt(p.x, p.y)));
    let plannedGate=false;
    for(const dy of [-26,28]) {
      const pos={x:camp.x,y:camp.y+dy};
      if(!buildings.some(b=>b.type==="gate"&&Math.hypot(b.pos.x-pos.x,b.pos.y-pos.y)<5)&&placeGate(world,index,pos.x,pos.y,"horizontal")){plannedGate=true;break;}
    }
    if(!plannedGate)paintWallCells(world,index,wallCells.filter(cell=>!occupied.has(cell)).slice(0,2));
  }
}
