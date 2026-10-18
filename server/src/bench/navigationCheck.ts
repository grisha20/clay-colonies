import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Ant, Building, Vec2, WorldSnapshot } from "../../../shared/types";
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-navigation-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, colonyWorldView, worldFromSnapshot } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { moveSurfaceToward, updateStuckTracking, clearDeadAntPaths } = await import("../sim/ant/movement");
const { rebuildWallBlocked, resolveSurfaceCollision, isWallBlockedAt, completeBuilding } = await import("../sim/building");
const { updateWorldSurfaceCache, updateTickCache } = await import("../sim/cache");
const { surfaceRoute, surfaceLineOpen } = await import("../../../shared/surfaceNavigation");
const { CONFIG } = await import("../config");
const { stepAnt } = await import("../sim/ant/step");
const { moveSearching } = await import("../sim/ant/forage");
const { taskApproach } = await import("../sim/taskAccess");
const { assignBuildJobs, assignHarvestJobs } = await import("../sim/economy");
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x-b.x,a.y-b.y);
function fence(x:number,y:number,type:Building["type"]="wall"):Building {
  return {id:`fence-${x}-${y}`,type,colonyId:"colony-1",pos:{x,y},stage:"built",progress:1,cost:{clay:0,wood:0,stone:0},delivered:{clay:0,wood:0,stone:0},hp:100,maxHp:100,...(type==="gate"?{gateSpan:3,gateAxis:"horizontal" as const}:{})};
}
function fresh() {
  clearDeadAntPaths(new Set());
  const g={current:randomGenome(),best:null,bestFitness:0,archive:[],generationsRun:0};
  const w=createWorld(g,{current:randomSpiderGenome(),best:null,bestFitness:0,archive:[],generationsRun:0},structuredClone(g));
  w.surface.buildings=[]; w.surface.entrances=[]; w.enemies=[]; w.weather.state="clear";
  for(let x=91;x<=151;x+=2) {
    if(x<119||x>123) w.surface.buildings.push(fence(x,215));
    if(x<129||x>133) w.surface.buildings.push(fence(x,265));
  }
  for(let y=217;y<=263;y+=2) for(const x of [91,151]) w.surface.buildings.push(fence(x,y));
  w.surface.buildings.push(fence(121,215,"gate"),fence(131,265,"gate"));
  w.colonies[0].ants=w.colonies[0].ants.slice(0,1); w.colonies[1].ants=[];
  rebuildWallBlocked(w); return w;
}
function travel(w:ReturnType<typeof fresh>, a:Ant, goal:Vec2, budget:number, strict=true) {
  const scoped=colonyWorldView(w,w.colonies[0]); let ticks=0, blocked=0;
  for(;ticks<budget&&dist(a.pos,goal)>0.7;ticks++) {
    w.tick++; scoped.tick=w.tick; updateWorldSurfaceCache(w); updateTickCache(scoped);
    const prev={...a.pos}; moveSurfaceToward(scoped,a,goal,false); resolveSurfaceCollision(scoped,a.pos,prev.x,prev.y,a.colonyId); updateStuckTracking(scoped,a);
    if(dist(prev,a.pos)<0.01) blocked++;
    if(strict) assert.equal(isWallBlockedAt(w,a.pos.x,a.pos.y,a.colonyId),false);
  }
  return {ticks,blocked,distance:dist(a.pos,goal),pos:{...a.pos}};
}
let failures=0,passed=0;
function check(name:string,run:()=>void) { try {run();passed++;console.log(`PASS  ${name}`);}catch(e){failures++;console.error(`FAIL  ${name}: ${(e as Error).message}`);} }
try {
  check("Доступность: замкнутая ограда не назначает работу снаружи; открытие ворот восстанавливает доступ",()=>{
    const w=fresh(),c=w.colonies[0],scoped=colonyWorldView(w,c);
    for(const gate of w.surface.buildings.filter(b=>b.type==="gate")){w.surface.buildings=w.surface.buildings.filter(b=>b.id!==gate.id);for(const dx of [-2,0,2])w.surface.buildings.push(fence(gate.pos.x+dx,gate.pos.y));}
    scoped.surface.buildings=w.surface.buildings;
    rebuildWallBlocked(w);
    const target={x:170,y:240};assert.equal(taskApproach(scoped,target,1.6),undefined);
    const site={...fence(170,240),id:"closed-site",type:"hut" as const,stage:"site" as const};w.surface.buildings.push(site);
    c.colony.food=100;c.colony.priorities.build=4;c.colony.priorities.clay=4;
    w.surface.resourceNodes=[{...w.surface.resourceNodes[0],id:"closed-clay",kind:"clay",pos:target,amount:100}];
    for(const a of c.ants){a.pos={x:120,y:240};a.job="forage";a.forageRole="forager";a.state="search";a.carrying=0;}
    assignBuildJobs(scoped);assignHarvestJobs(scoped);assert.ok(c.ants.every(a=>a.job!=="build"&&a.job!=="harvest"));
    w.surface.buildings=w.surface.buildings.filter(b=>!(b.type==="wall"&&b.pos.y===215&&[119,121,123].includes(b.pos.x)));w.surface.buildings.push(fence(121,215,"gate"));
    // Scoped views share a building array until the world replaces it.
    scoped.surface.buildings=w.surface.buildings;rebuildWallBlocked(w);
    assert.ok(taskApproach(scoped,target,1.6));
  });
  check("Разведчик без видимой еды выходит из огороженного лагеря через общий маршрут",()=>{
    const w=fresh(),c=w.colonies[0],a=c.ants[0],scoped=colonyWorldView(w,c);
    w.surface.foodSources=[];w.surface.carrion=[];a.pos={x:120,y:240};a.state="search";a.job="forage";a.forageRole="scout";a.carrying=0;
    let outside=false;
    for(let t=0;t<240;t++) {w.tick++;scoped.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(scoped);const prev={...a.pos};moveSearching(scoped,a);resolveSurfaceCollision(scoped,a.pos,prev.x,prev.y,a.colonyId);assert.equal(isWallBlockedAt(w,a.pos.x,a.pos.y,a.colonyId),false);if(a.pos.x<90||a.pos.x>152||a.pos.y<214||a.pos.y>266){outside=true;break;}}
    assert.ok(outside,JSON.stringify(a.pos));
  });
  if(process.argv[2]) {
    const snapshot=JSON.parse(await readFile(path.resolve(process.argv[2]),"utf8")) as WorldSnapshot;
    // Network captures keep actors at the top level, durable saves per colony.
    for(const c of snapshot.colonies) if(!c.ants.length)c.ants=snapshot.ants.filter(a=>a.colonyId===c.id);
    check("Копия живой партии: реальные застрявшие носильщики сдают груз, рыбак уходит от ограды",()=>{
      const base=fresh(),w=worldFromSnapshot(snapshot,base.genomeState,base.spiderGenomeState,base.colonies[1].genomeState),c=w.colonies[0];
      const scoped=colonyWorldView(w,c),tracked=c.ants.filter(a=>["ant-422","ant-452","ant-463","ant-486","ant-500","ant-504","ant-515"].includes(a.id));
      assert.equal(tracked.length,7);
      const stats=new Map(tracked.map(a=>[a.id,{start:{...a.pos},cargo:a.carrying,delivered:false,maxOffset:0}]));
      for(let t=0;t<240;t++) {
        w.tick++;scoped.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(scoped);
        for(const a of c.ants)stepAnt(scoped,a);
        for(const a of tracked) {const s=stats.get(a.id)!;s.maxOffset=Math.max(s.maxOffset,dist(a.pos,s.start));if(a.carrying<s.cargo)s.delivered=true;}
      }
      for(const a of tracked) {
        const s=stats.get(a.id)!;console.log(`  ${a.id}: offset=${s.maxOffset.toFixed(1)}, delivered=${s.delivered}, job=${a.job}`);
        assert.ok(s.maxOffset>4,`${a.id} still oscillates`);
        if(s.cargo>0)assert.ok(s.delivered,`${a.id} failed to unload cargo`);
      }
    });
  }
  check("Ступенчатая ограда из партии: носильщики и рыбак не ходят между двумя точками у угла",()=>{
    const coords = [[147,255],[147,253],[147,251],[147,249],[147,247],[145,255],[145,257],[143,257],[143,259],[141,259],[139,261],[137,261],[137,263],[127,263],[125,263],[123,263],[121,263],[119,263],[117,263],[111,263],[109,263],[107,263],[105,263],[103,263],[101,263],[101,261],[99,261],[97,261],[95,259],[95,223],[95,221],[97,221],[99,221],[101,221],[103,219],[105,219],[107,219],[109,219],[111,217],[113,217],[121,217],[121,219],[123,219],[125,219],[127,219],[127,221],[129,221],[131,221],[133,223],[135,223],[137,223],[139,225],[141,225],[143,225],[143,227],[145,227],[147,227],[147,229],[149,229],[149,231],[149,233],[151,237],[151,239],[151,241],[151,243],[149,245],[147,245]];
    const cases = [
      {pos:{x:141,y:261},heading:{x:-0.4028573608125523,y:0.9152627747478563},goal:{x:120,y:252}},
      {pos:{x:151,y:245},heading:{x:0.7071067811862217,y:0.7071067811868734},goal:{x:120,y:240}},
      {pos:{x:109,y:217},heading:{x:-0.7071067811865767,y:-0.7071067811865185},goal:{x:120,y:240}},
      {pos:{x:136.34351324442682,y:224.18053362499916},heading:{x:-0.6252254814982655,y:-0.7804441666674574},goal:{x:182,y:161.12}}
    ];
    for(const sample of cases) {
      const w=fresh(),a=w.colonies[0].ants[0];w.surface.buildings=coords.map(([x,y])=>fence(x,y));
      for(const x of [129,131,133,135]){const gate=fence(x,263,"gate");delete gate.gateSpan;delete gate.gateAxis;w.surface.buildings.push(gate);}
      w.surface.buildings.push(fence(117,217,"gate"));rebuildWallBlocked(w);
      a.pos={...sample.pos};a.heading={...sample.heading};a.state="carry";a.carrying=1;a.carryKind="wood";
      const result=travel(w,a,sample.goal,240);assert.ok(result.distance<0.7,JSON.stringify({sample,...result}));
    }
  });
  check("Вход и выход через широкие ворота: путь достигается без долгого блуждания у углов",()=>{
    for(const [from,to] of [[{x:95,y:219},{x:85,y:211}],[{x:145,y:219},{x:159,y:223}],[{x:109,y:221},{x:109,y:205}],[{x:119,y:259},{x:119,y:277}]] as [Vec2,Vec2][]) for(const reverse of [false,true]) {
      const w=fresh(),a=w.colonies[0].ants[0]; a.pos={...(reverse?to:from)}; const goal=reverse?from:to; a.heading={x:-1,y:0}; a.state="carry";a.carrying=1;a.carryKind="wood";
      const route=surfaceRoute(w.surface,a.pos,goal,a.colonyId);assert.ok(route);
      let length=0,p=a.pos;for(const q of route){length+=dist(p,q);p=q;}
      const result=travel(w,a,goal,Math.ceil(length/CONFIG.workerSurfaceSpeed*1.9)+50);
      assert.ok(result.distance<0.7,JSON.stringify({from,goal,...result})); assert.ok(result.blocked<25,JSON.stringify(result));
    }
  });
  check("Достройка забора под жителем: выходит за 10 тиков, сохраняя груз и профессию",()=>{
    const w=fresh(),a=w.colonies[0].ants[0];a.pos={x:119.3,y:265.2};a.state="carry";a.job="harvest";a.carrying=2;a.carryKind="wood";
    const goal={x:120,y:245};travel(w,a,goal,10,false);
    assert.equal(isWallBlockedAt(w,a.pos.x,a.pos.y,a.colonyId),false,JSON.stringify(a.pos));
    assert.equal(a.carrying,2);assert.equal(a.carryKind,"wood");assert.equal(a.job,"harvest");
  });
  check("Поворот на 180°: житель сразу следует новой цели, а не идёт от неё",()=>{
    const w=fresh(),a=w.colonies[0].ants[0];a.pos={x:115,y:240};a.heading={x:-1,y:0};a.state="search";
    const result=travel(w,a,{x:135,y:240},Math.ceil(20/CONFIG.workerSurfaceSpeed)+15);
    assert.ok(result.distance<0.7,JSON.stringify(result));
  });
  check("Короткий отрезок у угла: маршрут и коллизия одинаково запрещают срез клетки",()=>{
    const w=fresh();w.surface.buildings=[fence(121,265)];rebuildWallBlocked(w);
    const from={x:119.9,y:264.12},to={x:120.12,y:263.9};
    assert.equal(surfaceLineOpen(w.surface,from,to,"colony-1"),false);
    const moved={...to};resolveSurfaceCollision(w,moved,from.x,from.y,"colony-1");assert.notDeepEqual(moved,to);
  });
  check("Старые узкие ворота: житель заходит и выходит без ударов о боковые клетки",()=>{
    const w=fresh(),a=w.colonies[0].ants[0];
    const gate=w.surface.buildings.find(b=>b.type==="gate"&&b.pos.y===215)!;delete gate.gateSpan;delete gate.gateAxis;
    w.surface.buildings.push(fence(119,215),fence(123,215));rebuildWallBlocked(w);
    a.pos={x:111,y:221};a.heading={x:0,y:1};a.state="carry";
    for(const goal of [{x:111,y:207},{x:111,y:221}]) {const result=travel(w,a,goal,100);assert.ok(result.distance<0.7,JSON.stringify(result));assert.ok(result.blocked<10);}
  });
  check("Встречные потоки с грузом: все проходят ворота, никого не выдавливает в ограду",()=>{
    const w=fresh(),c=w.colonies[0],base=c.ants[0];
    c.ants=Array.from({length:24},(_,i)=>({...structuredClone(base),id:`traffic-${i}`,pos:{x:113+(i%6)*2.4,y:i<12?221+Math.floor(i/6)*1.4:209-Math.floor((i-12)/6)*1.4},heading:{x:0,y:i<12?-1:1},state:"carry",carrying:1,carryKind:"wood"}));
    const goals=new Map(c.ants.map((a,i)=>[a.id,{x:a.pos.x,y:i<12?205:225}]));
    const scoped=colonyWorldView(w,c),arrived=new Set<string>();
    for(let t=0;t<180&&arrived.size<c.ants.length;t++) {
      w.tick++;scoped.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(scoped);
      for(const a of c.ants) {
        if(arrived.has(a.id))continue;
        const prev={...a.pos},goal=goals.get(a.id)!;moveSurfaceToward(scoped,a,goal,false);resolveSurfaceCollision(scoped,a.pos,prev.x,prev.y,a.colonyId);updateStuckTracking(scoped,a);
        assert.equal(isWallBlockedAt(w,a.pos.x,a.pos.y,a.colonyId),false);
        assert.equal(a.carrying,1);if(dist(a.pos,goal)<0.9)arrived.add(a.id);
      }
    }
    assert.equal(arrived.size,c.ants.length,JSON.stringify(c.ants.filter(a=>!arrived.has(a.id)).map(a=>({id:a.id,pos:a.pos,goal:goals.get(a.id)}))));
  });
  check("Изменение ограды на ходу: новый маршрут ведёт к оставшимся воротам",()=>{
    const w=fresh(),a=w.colonies[0].ants[0];a.pos={x:121,y:222};a.heading={x:0,y:-1};a.state="search";
    travel(w,a,{x:121,y:203},3);
    w.surface.buildings=w.surface.buildings.filter(b=>b.type!=="gate"||b.pos.y!==215);
    for(const x of [119,121,123]) {const b=fence(x,215);b.stage="site";w.surface.buildings.push(b);completeBuilding(w,b);}
    const result=travel(w,a,{x:121,y:203},600);
    assert.ok(result.distance<0.7,JSON.stringify(result));
  });
} finally {await rm(temp,{recursive:true,force:true});}
console.log(`${passed} passed, ${failures} failed.`);assert.equal(failures,0);
