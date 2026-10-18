import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FootprintTrail } from "../../../client/src/render/surface/footprints";
import { lakeLilyPads, lakeMonsterResting } from "../../../shared/lakeHabitat";
import { lakeIdAt } from "../../../shared/surfaceTerrain";
import { pointBuildingPlacement } from "../../../shared/buildingPlacement";
import { MotionTracker } from "../../../client/src/render/surface/motion";
import { lakeShorePortals, nearLakeShore } from "../../../shared/amphibianNavigation";
import { fenceContains } from "../../../shared/fenceGeometry";
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-grounding-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, toSnapshot, worldFromSnapshot, addAntCorpse, addClayRemains, cleanupResourceNodes, respawnCarrion } = await import("../sim/world");
const { dissolveAnt } = await import("../sim/water");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { updateWildlife, moveCreature } = await import("../sim/wildlife");
const { placePointBuilding } = await import("../sim/building");
const { stepAnt } = await import("../sim/ant/step");
const { colonyWorldView } = await import("../sim/world");
const { updateWorldSurfaceCache, updateTickCache } = await import("../sim/cache");
const { crossesHearth } = await import("../../../shared/campGeometry");
function fresh() {
  const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  return createWorld(g, { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }, structuredClone(g));
}
let count = 0;
function check(name: string, run: () => void) { run(); count++; console.log(`PASS  ${name}`); }
try {
  check("Озёра: смытая глина и погибшие жители не оставляют пунктир и мясо на воде", () => {
    for (const start of [{ x: 210, y: 140 }, { x: 210, y: 360 }]) {
      const w = fresh(), a = w.ants[0], before = w.surface.resourceNodes.length;
      a.pos = { ...start };
      for (let i = 0; i < 40; i++) { a.pos.x += .3; dissolveAnt(a, 1, w); }
      assert.equal(w.surface.resourceNodes.length, before, "no trail of permanent resource nodes");
      assert.ok((a.dissolved ?? 0) > 0, "immersion still erodes the resident");
      a.state = "dead";
      assert.equal(addAntCorpse(w, a), null);
      addClayRemains(w, a);
      assert.equal(w.surface.resourceNodes.length, before, "partly dissolved dead resident leaves no deposit in water");
      assert.equal(w.surface.carrion.some(s => s.kind === "antCorpse"), false);
      a.pos = { x: 120, y: 250 }; a.state = "idle";
      dissolveAnt(a, 1, w);
      assert.ok(w.surface.resourceNodes.some(n => n.id.startsWith("wash-")), "erosion on dry ground is still collectible");
      assert.ok(addAntCorpse(w, a), "land remains are preserved");
    }
  });
  check("Старое сохранение: растворены только озёрные остатки; суша, постройки и жители сохранены", () => {
    const w = fresh(); w.tick = 12345;
    const wet = { x: 210, y: 360 }, dry = { x: 120, y: 250 };
    for (const [name, pos] of [["water", wet], ["land", dry]] as const) {
      w.surface.resourceNodes.push({ id: `wash-${name}`, kind: "clay", pos, amount: 1, maxAmount: 1, hitsPerUnit: 2 });
      w.surface.carrion.push({ id: `carrion-${name}`, kind: "antCorpse", pos, amount: 1 });
    }
    const loaded = worldFromSnapshot(toSnapshot(w, false), w.colonies[0].genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
    assert.equal(loaded.tick, w.tick);
    assert.deepEqual(loaded.surface.buildings, w.surface.buildings);
    assert.deepEqual(loaded.ants.map(a => a.id), w.ants.map(a => a.id));
    for (const target of [loaded, w]) {
      cleanupResourceNodes(target); respawnCarrion(target);
      assert.equal(target.surface.resourceNodes.some(n => n.id === "wash-water"), false);
      assert.equal(target.surface.carrion.some(s => s.id === "carrion-water"), false);
      assert.ok(target.surface.resourceNodes.some(n => n.id === "wash-land"));
      assert.ok(target.surface.carrion.some(s => s.id === "carrion-land"));
    }
  });
  check("Стража обоих племён не ждёт на камнях костра: старые позиции покидаются, посты раздельны",()=>{
    for(const index of [0,1]) {
      const w=fresh(),c=w.colonies[index],camp=c.surfaceEntrance;
      w.enemies=[];w.weather.state="clear";c.colony.defensePost={...camp};
      const guards=c.ants.slice(0,2);c.ants=guards;
      guards.forEach((a,i)=>{a.job="guard";a.pos={x:camp.x+1.4089+i*.03,y:camp.y+1.3916};a.carrying=0;a.energy=1000;});
      const view=colonyWorldView(w,c);
      for(let t=0;t<100;t++){w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);for(const a of guards){const prev={...a.pos};stepAnt(view,a);assert.equal(crossesHearth(prev.x,prev.y,a.pos.x,a.pos.y,camp),false);if(t>=80)assert.ok(Math.hypot(a.pos.x-prev.x,a.pos.y-prev.y)<.01,"idle guard stays still at the station");}}
      for(const a of guards){assert.ok(Math.hypot(a.pos.x-camp.x,a.pos.y-camp.y)>4.5,JSON.stringify(a.pos));assert.equal(a.job,"guard");}
      assert.ok(Math.hypot(guards[0].pos.x-guards[1].pos.x,guards[0].pos.y-guards[1].pos.y)>2.5);
      c.colony.defensePost={x:camp.x+15,y:camp.y+8};
      for(let t=0;t<100;t++){w.tick++;view.tick=w.tick;updateWorldSurfaceCache(w);updateTickCache(view);for(const a of guards)stepAnt(view,a);}
      for(const a of guards)assert.ok(Math.hypot(a.pos.x-c.colony.defensePost.x,a.pos.y-c.colony.defensePost.y)<=2,"explicit post still obeyed");
    }
  });
  check("Монстр выходит на берег, гуляет и возвращается в своё озеро без скачков позиции",()=>{
    const w=fresh(),e=w.enemies.find(e=>e.lakeId==="north")!,portal=lakeShorePortals("north")[0];w.ants=[];e.pos={...portal.water};e.lair={...portal.water};e.lakeNextShoreAt=0;e.lakeNextRestAt=100000;e.hunger=0;
    let landed=false,returned=false;
    for(let t=0;t<750;t++){w.tick++;const prev={...e.pos};updateWildlife(w);assert.ok(Math.hypot(e.pos.x-prev.x,e.pos.y-prev.y)<=.5+1e-7,"no teleport across shoreline");assert.ok(nearLakeShore(e.pos,"north"));if(!lakeIdAt(e.pos.x,e.pos.y))landed=true;if(landed&&w.tick>360&&lakeIdAt(e.pos.x,e.pos.y)==="north"){returned=true;break;}}
    assert.ok(landed,"went onto dry shore");assert.ok(returned,"returned by walking/swimming");
  });
  check("Береговой монстр не проходит через забор и возвращает пленника в воду",()=>{
    const w=fresh(),e=w.enemies.find(e=>e.lakeId==="north")!,portal=lakeShorePortals("north")[0],a=w.ants[0];
    e.pos={...portal.water};e.lair={...portal.water};w.ants=[];
    const wall={...w.surface.buildings[0],id:"shore-wall",type:"wall" as const,pos:{x:(Math.floor(portal.land.x/2)+.5)*2,y:(Math.floor(portal.land.y/2)+.5)*2},stage:"built" as const};w.surface.buildings.push(wall);
    for(let t=0;t<35;t++){w.tick++;moveCreature(w,e,portal.land,.4);assert.equal(fenceContains(wall,e.pos),false);}
    w.surface.buildings=w.surface.buildings.filter(b=>b.id!==wall.id);
    e.pos={...portal.land};a.pos={...e.pos};a.capturedBy=e.id;e.captiveId=a.id;w.ants=[a];
    let wet=false;
    for(let t=0;t<100;t++){w.tick++;const prev={...e.pos};updateWildlife(w);assert.ok(Math.hypot(prev.x-e.pos.x,prev.y-e.pos.y)<=.5);if(lakeIdAt(a.pos.x,a.pos.y)==="north"){wet=true;break;}}
    assert.ok(wet);
  });
  check("Следы: пять на жителя, общий предел 800, исчезновение и запрет при захвате/телепорте", () => {
    const trail = new FootprintTrail();
    for (let i = 0; i < 30; i++) for (let j = 0; j < 500; j++) trail.sample(String(j), i * 0.1, j, 0, i * Math.PI, 1, i * 0.03, true);
    assert.ok(trail.marks.length > 0 && trail.marks.length <= 800);
    const counts = new Map<string, number>(); for (const p of trail.marks) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    assert.ok([...counts.values()].every(n => n <= 5));
    const before = trail.marks.length;
    trail.sample("499", 200, 499, 0, 30 * Math.PI, 1, 1, true); assert.equal(trail.marks.length, before);
    trail.sample("499", 200.1, 499, 0, 31 * Math.PI, 1, 1, false); assert.equal(trail.marks.length, before);
    trail.expire(0.9); assert.equal(trail.marks.length, before); // paused presentation clock
    trail.expire(5); assert.equal(trail.marks.length, 0);
  });
  check("Кувшинки: устойчивые общие точки только внутри соответствующего озера", () => {
    for (const id of ["north", "south"] as const) {
      const points = lakeLilyPads(id); assert.ok(points.length >= 3); assert.equal(lakeLilyPads(id), points);
      for (const p of points) assert.equal(lakeIdAt(p.x, p.y), id);
    }
  });
  check("Монстр: добирается до кувшинки, отдыхает без перемещения и прерывает отдых ради человека", () => {
    const w = fresh(), e = w.enemies.find(e => e.lakeId === "north")!, pad = lakeLilyPads("north")[0];
    const ant = w.ants[0]; w.ants = []; e.pos = { x: pad.x + 3, y: pad.y }; e.lakeNextRestAt = 0; e.hunger = 0;
    // A previous nearby target must not leave the precise pad centre unreachable.
    moveCreature(w, e, { x: pad.x + 1, y: pad.y }, 0.1);
    w.tick = 100;
    for (let i = 0; i < 100 && !lakeMonsterResting(e, w.tick); i++) { w.tick++; updateWildlife(w); assert.equal(lakeIdAt(e.pos.x, e.pos.y), "north"); }
    assert.ok(lakeMonsterResting(e, w.tick));
    const pos = { ...e.pos }; w.tick++; updateWildlife(w); assert.deepEqual(e.pos, pos);
    const snapshot = JSON.parse(JSON.stringify(toSnapshot(w, false)));
    const restored = worldFromSnapshot(snapshot, w.colonies[0].genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
    assert.ok(lakeMonsterResting(restored.enemies.find(a => a.id === e.id)!, restored.tick));
    ant.pos = { x: pad.x + 1, y: pad.y }; ant.capturedBy = undefined; ant.rescuedUntil = 0; w.ants = [ant];
    w.tick++; updateWildlife(w); assert.equal(lakeMonsterResting(e, w.tick), false); assert.equal(e.captiveId, ant.id);
  });
  check("Плавание: корпус не подпрыгивает и не растягивается с наземным шагом; пауза сохраняет позу", () => {
    const w = fresh(), tracker = new MotionTracker(); w.session.speed = 1;
    const e = w.enemies.find(e => e.type === "lakeMonster")!;
    for (let i = 0; i < 100; i++) { e.pos.x += 0.01; w.tick++; tracker.update(toSnapshot(w, false), 1000 + i * 17); assert.equal(tracker.enemy(e).bob, 0); assert.equal(tracker.enemy(e).stretch, 1); }
    w.session.speed = 0; const time = tracker.time; tracker.update(toSnapshot(w, false), 9000); assert.equal(tracker.time, time);
  });
  check("Предпросмотр: те же решения, что у сервера, для суши, воды, костра и занятого места", () => {
    for (const type of ["hut", "storage", "workshop", "idol"] as const) for (const [pos, allowed] of [[{ x: 20, y: 20 }, true], [{ x: 240, y: 140 }, false], [{ x: 360, y: 240 }, false]] as const) {
      const w = fresh();
      const probes = [[pos, allowed], [w.surface.entrances[0], false], [w.surface.buildings[0].pos, false]] as const;
      for (const [probe, expected] of probes) {
        assert.equal(pointBuildingPlacement(w.surface, w.colonies[0].id, type, probe) === null, expected);
        assert.equal(placePointBuilding(w, 0, type, probe.x, probe.y), expected);
      }
    }
  });
  check("Сохранение v17: мир загружается без сброса и без обязательных полей отдыха", () => {
    const w = fresh(), snap = toSnapshot(w, false); snap.snapshotVersion = 17;
    const loaded = worldFromSnapshot(snap, w.colonies[0].genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
    assert.equal(loaded.surface.buildings.length, w.surface.buildings.length); assert.equal(loaded.tick, w.tick);
  });
  check("Спрайты: все ракурсы плавания ниже лежащей позы, файлы новых атласов зарегистрированы", () => {
    for (const file of ["characters/creatures/lake-swim-atlas", "buildings/clay-v2/fences-atlas", "environment/clay-v2/lilies-atlas"]) {
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "client/public/assets", file + ".json"), "utf8"));
      assert.equal(data.frames.length, data.columns * data.rows);
      for (const f of data.frames) assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.width <= data.imageWidth && f.y + f.height <= data.imageHeight);
      if (file.includes("lake-swim")) for (let col = 0; col < 4; col++) assert.ok(data.frames[col].height < data.frames[col + 4].height);
    }
  });
  console.log(`${count} grounding scenarios passed.`);
} finally { await rm(temp, { recursive: true, force: true }); }
