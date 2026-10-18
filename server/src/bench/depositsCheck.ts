import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureResourceDeposits, depositRemaining, DEPOSIT_RX, DEPOSIT_RY } from "../../../shared/resourceDeposits";
import { isWaterAt } from "../../../shared/surfaceTerrain";
import { surfacePointOpen } from "../../../shared/surfaceNavigation";
import { pointBuildingPlacement } from "../../../shared/buildingPlacement";
import { fencePlacement } from "../../../shared/fenceGeometry";
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-deposits-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, toSnapshot, worldFromSnapshot, colonyWorldView, createWorkerAnt, syncWorldLegacyFields } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { assignHarvestJobs } = await import("../sim/economy");
const { moveHarvesting } = await import("../sim/ant/forage");
const { updateTickCache, updateWorldSurfaceCache } = await import("../sim/cache");
let passed = 0;
function fresh() { const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }; return createWorld(g, { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }, structuredClone(g)); }
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }
try {
  check("8 крупных залежей, равный близкий доступ обоим племенам, площадки и рабочие места на суше", () => {
    const w = fresh(), ds = w.surface.deposits!;
    assert.equal(ds.length, 8); assert.equal(ds.filter(d => d.kind === "clay").length, 4);
    for (const d of ds) {
      const nodes = w.surface.resourceNodes.filter(n => n.depositId === d.id);
      assert.equal(nodes.length, 6); assert.equal(depositRemaining(w.surface, d.id), d.capacity);
      for (let i=0;i<24;i++) assert.equal(isWaterAt(d.pos.x+Math.cos(i*Math.PI/12)*DEPOSIT_RX,d.pos.y+Math.sin(i*Math.PI/12)*DEPOSIT_RY),false);
      for (const n of nodes) assert.ok(surfacePointOpen(w.surface,n.pos,"colony-1"));
    }
    for (const kind of ["clay", "stone"] as const) {
      const distances=w.colonies.map(c=>Math.min(...ds.filter(d=>d.kind===kind).map(d=>Math.hypot(c.surfaceEntrance.x-d.pos.x,c.surfaceEntrance.y-d.pos.y))));
      assert.ok(Math.abs(distances[0]-distances[1])<1e-8); assert.ok(distances[0]<50);
    }
  });
  check("Миграция v20 добавляет карьеры без сброса жителей, старых узлов, зданий и назначений", () => {
    const w=fresh();w.tick=12345;
    const a=w.colonies[0].ants[0], node=w.surface.resourceNodes.find(n=>!n.depositId)!;
    a.job="harvest";a.harvestNodeId=node.id;
    const snap=structuredClone(toSnapshot(w,false)); snap.snapshotVersion=20;delete snap.surface.deposits;
    snap.surface.resourceNodes=snap.surface.resourceNodes.filter(n=>!n.depositId);
    const loaded=worldFromSnapshot(snap,w.colonies[0].genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    assert.equal(loaded.tick,12345);assert.equal(loaded.surface.deposits!.length,8);
    assert.deepEqual(loaded.surface.buildings,snap.surface.buildings);
    assert.deepEqual(loaded.ants.map(a=>a.id),snap.ants.map(a=>a.id));
    assert.equal(loaded.ants.find(x=>x.id===a.id)!.harvestNodeId,node.id);
    for(const old of snap.surface.resourceNodes)assert.equal(loaded.surface.resourceNodes.find(n=>n.id===old.id)!.amount,old.amount);
  });
  check("Запас конечен: добыча сохраняется, полностью истощённый карьер не заполняется загрузкой", () => {
    const w=fresh(),d=w.surface.deposits![0];
    w.surface.resourceNodes.find(n=>n.depositId===d.id)!.amount-=17;
    let loaded=worldFromSnapshot(toSnapshot(w,false),w.colonies[0].genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    assert.equal(depositRemaining(loaded.surface,d.id),d.capacity-17);
    loaded.surface.resourceNodes=loaded.surface.resourceNodes.filter(n=>n.depositId!==d.id);
    loaded=worldFromSnapshot(toSnapshot(loaded,false),w.colonies[0].genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    ensureResourceDeposits(loaded.surface);
    assert.equal(loaded.surface.deposits!.length,8);assert.equal(depositRemaining(loaded.surface,d.id),0);
  });
  check("Здания и забор не перекрывают рабочее дно, но жители могут войти в открытый карьер", () => {
    const w=fresh(),d=w.surface.deposits![0];
    assert.equal(pointBuildingPlacement(w.surface,"colony-1","storage",d.pos),"Рабочая площадка карьера");
    assert.equal(fencePlacement(w.surface,"colony-1",d.pos),"Рабочая площадка карьера");
    assert.ok(surfacePointOpen(w.surface,d.pos,"colony-1"));
  });
  for (const index of [0,1]) for (const kind of ["clay","stone"] as const) check(`Племя ${index+1}, ${kind}: шесть разных мест, работа, конечный расход и доставка`,()=>{
    const w=fresh(),c=w.colonies[index],camp=c.surfaceEntrance;
    const d=w.surface.deposits!.filter(d=>d.kind===kind).sort((a,b)=>Math.hypot(a.pos.x-camp.x,a.pos.y-camp.y)-Math.hypot(b.pos.x-camp.x,b.pos.y-camp.y))[0];
    w.surface.resourceNodes=w.surface.resourceNodes.filter(n=>n.depositId===d.id);w.enemies=[];w.weather.state="clear";
    c.ants=Array.from({length:20},(_,i)=>{const a=createWorkerAnt(camp,"surface",c.id);a.pos={x:camp.x,y:camp.y+5+i*.1};a.job="forage";a.forageRole="forager";return a;});
    c.colony.food=300;c.colony.priorities={clay:kind==="clay"?6:0,wood:0,stone:kind==="stone"?6:0,build:0,guard:0,fish:0};c.colony.picks=0;
    syncWorldLegacyFields(w);const view=colonyWorldView(w,c);
    if(kind==="stone"){assignHarvestJobs(view);assert.equal(c.ants.filter(a=>a.job==="harvest").length,0);c.colony.picks=6;}
    assignHarvestJobs(view);const workers=c.ants.filter(a=>a.job==="harvest");
    assert.equal(workers.length,6);assert.equal(new Set(workers.map(a=>a.harvestNodeId)).size,6);
    const initial=c.colony[kind],worked=new Set<string>();
    for(let t=0;t<700;t++){
      w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);
      for(const a of workers){moveHarvesting(view,a);if(a.state==="idle"&&a.carrying<=0){worked.add(a.harvestNodeId!);const n=w.surface.resourceNodes.find(n=>n.id===a.harvestNodeId)!;assert.ok(Math.hypot(a.pos.x-n.pos.x,a.pos.y-n.pos.y)<=.35);}}
    }
    assert.equal(worked.size,6);assert.ok(c.colony[kind]>initial,"delivered to camp");
    assert.ok(Math.abs(d.capacity-depositRemaining(w.surface,d.id)-(c.colony[kind]-initial)-workers.reduce((sum,a)=>sum+a.carrying,0))<1e-6,"material conserved");
  });
  console.log(`${passed} deposit scenarios passed.`);
} finally { await rm(temp,{recursive:true,force:true}); }
