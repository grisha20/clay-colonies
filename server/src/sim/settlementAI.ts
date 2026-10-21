import type { Building, BuildingType, Vec2 } from "../../../shared/types";
import { isWaterAt, isTerrainBlockedAt } from "../../../shared/surfaceTerrain";
import { CONFIG } from "../config";
import { placePointBuilding, placeGate, paintWallCells, wallCellIndexAt, isSurfaceBlockedAt } from "./building";
import type { World } from "./world";
import { trainWaterWeapons } from "./session";
import { fenceCellCenters } from "../../../shared/fenceGeometry";
import { pointBuildingPlacement } from "../../../shared/buildingPlacement";
import { buildingServicePoint } from "../../../shared/buildingGeometry";
import { placementAccessWarning } from "../../../shared/placementAccess";
import { taskApproach } from "./taskAccess";
import { colonyWorldView } from "./world";

const inaccessibleSince = new WeakMap<Building, number>();

function settlementSites(world:World,index:number,type:"hut"|"storage"|"workshop"|"idol"):Vec2[] {
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
export function updateSettlementAI(world: World): void {
  if (world.tick % 100 !== 0) return;
  for (const [index, runtime] of world.colonies.entries()) {
    if (index === (world.session.playerColonyIndex ?? 0) || !runtime.ants.length) continue;
    const c = runtime.colony, camp = runtime.surfaceEntrance, population = runtime.ants.length;
    let buildings = world.surface.buildings.filter(b => b.colonyId === c.id);
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
    const postCandidates=[{x:camp.x+sign*9,y:camp.y+5},...buildings.filter(b=>b.type==="gate"&&b.stage==="built").map(b=>({x:b.pos.x,y:b.pos.y+(b.pos.y<camp.y?4:-4)})),{x:camp.x,y:camp.y+5}];
    c.defensePost=postCandidates.find(p=>!isSurfaceBlockedAt(world,p.x,p.y,runtime.id)&&taskApproach(scoped,p))??c.defensePost;
    if (reachablePending) continue;
    let type: "hut" | "storage" | "workshop" | "idol" | undefined;
    if (!built("workshop")) type = "workshop";
    else if (built("hut") < Math.min(CONFIG.maxHutsPerColony, 3 + Math.floor(world.tick / 9000)) && (population >= 10 + built("hut") * 4 || world.tick >= 4000 && built("hut") < 3)) type = "hut";
    else if (built("storage") < 2 && population >= 20 && world.tick > 6000) type = "storage";
    else if (!built("idol") && world.tick > CONFIG.matchMinTicks / 2 && c.clay > 35 && c.stone > 10) type = "idol";
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
