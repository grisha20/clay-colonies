import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorldSnapshot } from "../../../shared/types";
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-jitter-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, colonyWorldView, growFoodSources, worldFromSnapshot, toSnapshot } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { updateWorldSurfaceCache, updateTickCache } = await import("../sim/cache");
const { moveSearching } = await import("../sim/ant/forage");
const { stepAnt } = await import("../sim/ant/step");
const { moveToSafety } = await import("../sim/ant/defense");
const { createSpider, updateEnemies } = await import("../sim/enemy");
const { CONFIG } = await import("../config");
const { taskMotionReport } = await import("../sim/taskProgress");
const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
function fresh() {
  const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  const w = createWorld(g, { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }, structuredClone(g));
  w.surface.buildings = []; w.surface.foodSources = []; w.surface.carrion = []; w.enemies = []; w.weather.state = "clear"; w.tick = 100;
  w.colonies[0].colony.food = 1000;
  return w;
}
let passed = 0;
const originalRandom = Math.random;
let seed = 181541;
Math.random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }
try {
  check("Разведчик у края карты возвращается в лагерь, не пересекает границу возврата туда-сюда", () => {
    const w=fresh(),c=w.colonies[0],a=c.ants[0],view=colonyWorldView(w,c);
    a.pos={x:9,y:240};a.heading={x:-1,y:0};a.job="forage";a.forageRole="scout";a.carrying=0;
    let arrived=false,flips=0,previous={x:0,y:0};
    for(let i=0;i<160;i++) {
      w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);const before={...a.pos};moveSearching(view,a);
      const delta={x:a.pos.x-before.x,y:a.pos.y-before.y};if(delta.x*previous.x+delta.y*previous.y<-.1)flips++;previous=delta;
      if(distance(a.pos,c.surfaceEntrance)<=8){arrived=true;break;}
    }
    assert.ok(arrived,JSON.stringify(a.pos));assert.ok(flips<4,`flips=${flips}`);
  });
  check("Здоровый сборщик не получает случайный приказ домой между шагами к еде", () => {
    const w=fresh(),c=w.colonies[0],a=c.ants[0],view=colonyWorldView(w,c),random=Math.random;
    const food={id:"test-food",kind:"food" as const,pos:{x:160,y:240},amount:100};w.surface.foodSources.push(food);
    c.colony.activeFoodTargetId=food.id;view.directives.activeTarget=0;
    for(const worker of c.ants){worker.job="forage";worker.state="search";worker.forageRole="forager";worker.carrying=0;}
    a.knownActiveFoodTargetId=food.id;a.pos={x:130,y:240};a.heading={x:1,y:0};a.energy=CONFIG.maxEnergy;
    try {Math.random=()=>0;for(let i=0;i<40&&a.carrying===0;i++){w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);stepAnt(view,a);}}
    finally {Math.random=random;}
    assert.ok(a.carrying>0,JSON.stringify({pos:a.pos,state:a.state}));
  });
  check("Разведчик отмечается в лагере один раз за цикл и не топчется у радиуса девяти единиц",()=>{
    const w=fresh(),c=w.colonies[0],a=c.ants[0],view=colonyWorldView(w,c);w.tick=360;
    a.id="ant-7";a.pos={x:130,y:240};a.heading={x:-1,y:0};a.forageRole="scout";a.job="forage";a.carrying=0;
    let flips=0,delta={x:0,y:0};
    for(let i=0;i<100;i++){w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);const prev={...a.pos};moveSearching(view,a);const d={x:a.pos.x-prev.x,y:a.pos.y-prev.y};if(d.x*delta.x+d.y*delta.y<-.1)flips++;delta=d;}
    assert.ok(flips<4,`flips=${flips}`);assert.ok(distance(a.pos,c.surfaceEntrance)>20,JSON.stringify(a.pos));
  });
  check("Носильщики расходятся от паука у костра и останавливаются в безопасности с грузом", () => {
    const w=fresh(),c=w.colonies[0],camp=c.surfaceEntrance,view=colonyWorldView(w,c),enemy=createSpider();
    enemy.pos={x:camp.x-1,y:camp.y};enemy.raid=true;w.enemies=[enemy];view.enemies=w.enemies;
    const workers=c.ants.slice(0,4);workers.forEach((a,i)=>{a.pos={x:camp.x+9,y:camp.y+3+i*.25};a.heading={x:-1,y:0};a.carrying=1;a.carryKind="wood";a.job="harvest";});
    const metrics=workers.map(()=>({flips:0,delta:{x:0,y:0}}));
    for(let t=0;t<100;t++) {w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);
      workers.forEach((a,i)=>{const before={...a.pos};assert.equal(moveToSafety(view,a),true);const delta={x:a.pos.x-before.x,y:a.pos.y-before.y};if(delta.x*metrics[i].delta.x+delta.y*metrics[i].delta.y<-.1)metrics[i].flips++;metrics[i].delta=delta;});
    }
    workers.forEach((a,i)=>{assert.ok(distance(a.pos,enemy.pos)>16,JSON.stringify(a.pos));assert.equal(a.carrying,1);assert.ok(metrics[i].flips<4,JSON.stringify(metrics[i]));});
    assert.ok(distance(workers[0].pos,workers[3].pos)>2);
    enemy.hp=0;assert.equal(moveToSafety(view,workers[0]),false);
  });
  check("После гибели паука мясо сохраняется при загрузке и не растёт как ягоды",()=>{
    const w=fresh(),enemy=createSpider();enemy.hp=0;enemy.raid=true;enemy.pos={x:140,y:240};w.enemies=[enemy];
    updateWorldSurfaceCache(w);updateTickCache(w);updateEnemies(w);
    const carcass=w.surface.foodSources.find(f=>f.kind==="spiderCarcass");assert.ok(carcass);assert.equal(carcass.amount,CONFIG.spiderCarcassFood);
    carcass.amount=10;w.surface.foodSources.push({id:"berry",kind:"food",amount:10,pos:{x:160,y:240}});w.tick=CONFIG.foodGrowEveryTicks;growFoodSources(w);
    assert.equal(w.surface.foodSources.find(f=>f.kind==="spiderCarcass")?.amount,10);assert.ok(w.surface.foodSources.find(f=>f.id==="berry")!.amount>10);
    const restored=worldFromSnapshot(JSON.parse(JSON.stringify(toSnapshot(w,false))),w.genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    assert.equal(restored.surface.foodSources.find(f=>f.kind==="spiderCarcass")?.amount,10);
  });
  if(process.argv[2]) {
    const saved=JSON.parse(await readFile(path.resolve(process.argv[2]),"utf8")) as WorldSnapshot;
    for(const c of saved.colonies)if(!c.ants.length)c.ants=saved.ants.filter(a=>a.colonyId===c.id);
    check("Копия партии: разведчики перестают колебаться на границе дальности",()=>{
      const base=fresh(),w=worldFromSnapshot(saved,base.genomeState,base.spiderGenomeState,base.colonies[1].genomeState);
      const views=w.colonies.map(c=>colonyWorldView(w,c));
      const tracked=w.ants.filter(a=>["ant-577","ant-564","ant-559","ant-543","ant-547","ant-524","ant-537","ant-573"].includes(a.id));assert.equal(tracked.length,8);
      const metrics=new Map(tracked.map(a=>[a.id,{flips:0,delta:{x:0,y:0},start:{...a.pos}}]));
      for(let t=0;t<120;t++){w.tick++;updateWorldSurfaceCache(w);for(const view of views){view.tick=w.tick;updateTickCache(view);for(const a of view.ants){const prev={...a.pos};stepAnt(view,a);if(process.env.JITTER_TRACE&&a.id===process.env.JITTER_TRACE&&t>=30&&t<40)console.log(JSON.stringify({t,pos:a.pos,role:a.forageRole,state:a.state,job:a.job,energy:a.energy,cargo:a.carrying,kind:a.carryKind,known:a.knownActiveFoodTargetId,motion:taskMotionReport(a)}));const m=metrics.get(a.id);if(m){const d={x:a.pos.x-prev.x,y:a.pos.y-prev.y};if(d.x*m.delta.x+d.y*m.delta.y<-.1)m.flips++;m.delta=d;}}}}
      for(const a of tracked){const m=metrics.get(a.id)!;console.log(`  ${a.id}: flips=${m.flips}, offset=${distance(a.pos,m.start).toFixed(1)}`);assert.ok(m.flips<8,`${a.id}: ${m.flips} flips`);}
    });
  }
  console.log(`${passed} jitter scenarios passed.`);
} finally {Math.random=originalRandom;await rm(temp,{recursive:true,force:true});}
