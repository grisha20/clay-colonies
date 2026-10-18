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
const { assignForageRoles } = await import("../sim/foodMemory");
const { step } = await import("../sim/step");
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
  check("Резервные рабочие A и Б не получают маршрут сборщика без назначения роли",()=>{
    for(const index of [0,1]) {
      const w=fresh(),c=w.colonies[index],camp=c.surfaceEntrance,base=c.ants[0];
      c.ants=Array.from({length:28},(_,i)=>({...structuredClone(base),id:`ant-${100+i}`,colonyId:c.id,pos:{x:camp.x+7.8,y:camp.y},heading:{x:1,y:0},job:"forage",state:"search",carrying:0,forageRole:undefined,knownActiveFoodTargetId:undefined}));
      const a=c.ants.at(-1)!,seed=127+(index===1?23:0),search=620+seed%360,cycle=search+150+seed*7%120;
      w.tick=search+20+cycle*10-seed*41;
      const food={id:"distant-food",kind:"food" as const,amount:100,pos:{x:camp.x+(index===0?80:-80),y:camp.y}};
      w.surface.foodSources.push(food);c.colony.activeFoodTargetId=food.id;
      const view=colonyWorldView(w,c);let flips=0,delta={x:0,y:0};
      for(let t=0;t<100;t++){w.tick++;view.tick=w.tick;assignForageRoles(view);assert.equal(a.forageRole,undefined);updateWorldSurfaceCache(w);updateTickCache(view);const prev={...a.pos};stepAnt(view,a);const d={x:a.pos.x-prev.x,y:a.pos.y-prev.y};if(d.x*delta.x+d.y*delta.y<-.1)flips++;delta=d;}
      assert.ok(flips<4,`${c.id}: ${flips} reversals`);
      assert.equal(a.knownActiveFoodTargetId,undefined,"reserve never borrows and loses a forager's order");
    }
  });
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
  if(process.argv[2] && process.argv[2]!=="--scan") {
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
  if(process.argv[2]==="--scan") {
    const saved=JSON.parse(await readFile(path.resolve(process.argv[3]),"utf8")) as WorldSnapshot;
    for(const c of saved.colonies)if(!c.ants.length)c.ants=saved.ants.filter(a=>a.colonyId===c.id);
    check("Полная симуляция копии партии: назначения обоих племён не создают двухточечных циклов",()=>{
      const base=fresh(),w=worldFromSnapshot(saved,base.genomeState,base.spiderGenomeState,base.colonies[1].genomeState);
      const tracks=new Map<string,{prev:{x:number;y:number};before:{x:number;y:number};chain:number;max:number;cycles:number}>();
      for(let t=0;t<1000;t++) {
        step(w);
        for(const a of w.ants){let m=tracks.get(a.id);if(!m){tracks.set(a.id,{prev:{...a.pos},before:{...a.pos},chain:0,max:0,cycles:0});continue;}
          const cycle=distance(a.pos,m.before)<.12&&distance(a.pos,m.prev)>.3;
          m.chain=cycle?m.chain+1:0;m.max=Math.max(m.max,m.chain);m.cycles+=Number(cycle);m.before=m.prev;m.prev={...a.pos};
        }
      }
      assert.equal(w.tick,saved.tick+1000,"replay must actually advance the complete simulation");
      console.log(JSON.stringify({tick:w.tick,ants:w.ants.length,worst:[...tracks].sort((a,b)=>b[1].max-a[1].max).slice(0,8).map(([id,m])=>({id,maxConsecutive:m.max,cycles:m.cycles}))}));
      for(const [id,m]of tracks)assert.ok(m.max<12,`${id}: ${m.max} consecutive oscillations`);
    });
  }
  console.log(`${passed} jitter scenarios passed.`);
} finally {Math.random=originalRandom;await rm(temp,{recursive:true,force:true});}
