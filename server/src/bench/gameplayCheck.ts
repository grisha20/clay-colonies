// Controlled behavior scenarios. No live saves/genomes are read or overwritten.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Vec2 } from "../../../shared/types";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "clayfolk-gameplay-"));
process.env.SNAPSHOT_FILE = path.join(tempDir, "snapshot.json");
process.env.SPIDER_GENOME_FILE = path.join(tempDir, "spider_genome.json");
const { CONFIG } = await import("../config");
const { createWorld, colonyWorldView, toSnapshot, worldFromSnapshot, restartColony, syncWorldLegacyFields } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { updateWildlife, createLakeMonster, createBeetle, moveCreature } = await import("../sim/wildlife");
const { updateRaids, updateOutcome, trainWaterWeapons, prepareSandboxGuard } = await import("../sim/session");
const { updateObjectives } = await import("../sim/objectives");
const { dissolveAnt } = await import("../sim/water");
const { updateWaterExposure, stepAnt } = await import("../sim/ant/step");
const { moveDefending } = await import("../sim/ant/defense");
const { assignHarvestJobs, assignBuildJobs } = await import("../sim/economy");
const { assignForageRoles } = await import("../sim/foodMemory");
const { paintWallCells, wallCellIndexAt, completeBuilding, placePointBuilding, resolveSurfaceCollision, isSurfaceBlockedAt } = await import("../sim/building");
const { insideHearth, crossesHearth } = await import("../../../shared/campGeometry");
const { pointBuildingPlacement } = await import("../../../shared/buildingPlacement");
const { moveHarvestCarrying } = await import("../sim/ant/forage");
const { moveSurfaceToward } = await import("../sim/ant/movement");
const { buildingFootprint, insideBuilding, crossesBuilding, buildingServicePoint } = await import("../../../shared/buildingGeometry");
const { markMelee, settleMeleePosition } = await import("../sim/melee");
const { moveToSafety } = await import("../sim/ant/defense");
const { step } = await import("../sim/step");
const { saveWorldSnapshot, loadWorldSnapshot } = await import("../state/snapshot");
const { parseCommand } = await import("../net/socket");
const { createSpider, updateEnemies } = await import("../sim/enemy");
const { updateWorldSurfaceCache } = await import("../sim/cache");
const { dayCycle } = await import("../../../shared/dayCycle");
const { isWaterAt } = await import("../../../shared/surfaceTerrain");
const { moveToRainShelter, rainShelterPoint } = await import("../sim/ant/shelter");
const { isSheltered } = await import("../sim/weather");
const { fishingCastActive } = await import("../../../shared/fishingCast");
const { assignFishingJobs } = await import("../sim/fishing");

let passed = 0;
function scenario(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }
function fresh() {
  const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  const s = { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  const w = createWorld(g, s, structuredClone(g)); w.colonies.forEach(c => { c.colony.autoManage = false; });
  return w;
}

try {
  scenario("Рыбалка: бегство прерывает заброс, рыба и место сохраняются, леска не тянется через карту",()=>{
    const w=fresh(),c=w.colonies[0],a=c.ants[0],scoped=colonyWorldView(w,c),fish=w.surface.fish[0];
    a.job="fish";a.pos={x:182,y:161.12};a.state="idle";a.carrying=0;a.fishingStandPos={...a.pos};a.fishingLurePos={x:182,y:158.88};a.fishingTargetId=fish.id;a.fishingTicks=20;
    fish.targetAntId=a.id;fish.state="lured";fish.lurePos={...a.fishingLurePos};assert.equal(fishingCastActive(a),true);
    c.colony.alarm=true;scoped.enemies=[];stepAnt(scoped,a);
    // Paused, not dropped: the fish stops coming to the float, the fisher keeps fish and stand.
    assert.equal(a.fishingTicks,0);assert.equal(fish.state,"swim");assert.equal(fish.lurePos,undefined);
    assert.equal(a.fishingTargetId,fish.id);assert.equal(fish.targetAntId,a.id);assert.ok(a.fishingStandPos,"stand kept for after the danger");
    c.colony.alarm=false;c.colony.rods=1;c.colony.priorities.fish=1;assignFishingJobs(scoped);assert.ok(a.fishingStandPos,"fishing continues after danger");assert.equal(a.fishingTicks,0);
    a.pos={x:400,y:400};a.state="idle";a.job="fish";a.fishingTicks=20;a.fishingStandPos={x:182,y:161.12};a.fishingLurePos={x:182,y:158.88};assert.equal(fishingCastActive(a),false);
  });
  scenario("Дождь: еда и топливо сдаются до сушки, профессии и строительный груз сохраняются", () => {
    for (const kind of ["wood", "clay", "stone", "fruit", "fish", "meat"] as const) {
      const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c), a = c.ants[0]; w.weather.state = "rain"; scoped.enemies = [];
      a.job = kind === "fish" ? "fish" : "harvest"; const job = a.job;
      a.pos = { x: c.surfaceEntrance.x, y: c.surfaceEntrance.y + 4 }; a.carrying = 2; a.carryKind = kind;
      const before = kind === "wood" || kind === "clay" || kind === "stone" ? c.colony[kind] : c.colony.food;
      assert.ok(moveToRainShelter(scoped, a)); assert.equal(a.carrying, 0); assert.equal(a.job, job);
      assert.equal(kind === "wood" || kind === "clay" || kind === "stone" ? c.colony[kind] : c.colony.food, before + 2);
      assert.ok(moveToRainShelter(scoped, a));
    }
  });
  scenario("Дождь в общей симуляции: рабочие прекращают добычу, пережидают и сохраняют назначения", () => {
    const w = fresh(); w.session.mode = "sandbox"; w.enemies = []; w.tick = 1800;
    w.weather.state = "rain"; w.weather.until = 100000;
    w.colonies.forEach(c => { c.colony.growthPaused = true; c.colony.wood = 100; c.colony.food = 1000; });
    const a = w.colonies[0].ants[0]; a.job = "harvest"; const id = a.id;
    const b = w.colonies[0].ants[1]; b.job = "build"; b.carrying = 1; b.carryKind = "wood";
    for (let i = 0; i < 1000; i++) step(w);
    const current = w.ants.find(ant => ant.id === id)!; assert.ok(current); assert.equal(current.job, "harvest");
    assert.equal(b.job, "build"); assert.equal(b.carrying, 1);
    for (const c of w.colonies) for (const ant of c.ants) {
      assert.ok(Math.hypot(ant.pos.x - c.surfaceEntrance.x, ant.pos.y - c.surfaceEntrance.y) < CONFIG.rainShelterFireRadius);
      assert.equal(ant.waterExposure ?? 0, 0); assert.notEqual(ant.state, "dead");
    }
    w.weather.state = "clear"; const before = { ...current.pos };
    for (let i = 0; i < 25; i++) step(w);
    assert.ok(Math.hypot(current.pos.x - before.x, current.pos.y - before.y) > 1);
  });
  scenario("Дождь: отдельные сухие места, возврат с предупреждения, сохранение работы и груза", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c); w.enemies = []; scoped.enemies = [];
    w.weather.state = "warning"; const targets = c.ants.map(a => rainShelterPoint(scoped, a)!);
    targets.forEach((p, i) => { assert.ok(p); assert.equal(isSurfaceBlockedAt(scoped, p.x, p.y, c.id), false); assert.ok(isSheltered(scoped, p)); targets.slice(i + 1).forEach(q => assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 2)); });
    const a = c.ants[0]; a.pos = { x: c.surfaceEntrance.x + 75, y: c.surfaceEntrance.y + 18 }; a.job = "build"; a.carrying = 2; a.carryKind = "wood";
    for (let i = 0; i < 600; i++) { w.tick++; scoped.tick = w.tick; stepAnt(scoped, a); }
    assert.ok(Math.hypot(a.pos.x - targets[0].x, a.pos.y - targets[0].y) < 1);
    assert.equal(a.job, "build"); assert.equal(a.carrying, 2); assert.equal(a.carryKind, "wood");
    const settled = { ...a.pos }; for (let i = 0; i < 80; i++) stepAnt(scoped, a); assert.deepEqual(a.pos, settled);
    w.weather.state = "rain"; a.waterExposure = 40;
    for (let i = 0; i < CONFIG.bigRainTicks; i++) { scoped.tick++; stepAnt(scoped, a); }
    assert.equal(a.waterExposure, 0); assert.notEqual(a.state, "dead"); assert.equal(a.dissolved ?? 0, 0);
    w.weather.state = "clear"; assert.equal(moveToRainShelter(scoped, a), false); assert.equal(a.state, "carry");
  });
  scenario("Дождь: промокание и размывание снаружи, тёплый огонь и холодная хижина", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c), a = c.ants[0]; w.weather.state = "rain";
    a.pos = { x: c.surfaceEntrance.x + 80, y: c.surfaceEntrance.y + 20 }; assert.equal(isSheltered(scoped, a.pos), false);
    for (let i = 0; i < 100; i++) updateWaterExposure(a, scoped);
    assert.ok((a.waterExposure ?? 0) > 7); assert.equal(a.dissolved ?? 0, 0);
    for (let i = 0; i < 1900 && a.state !== "dead"; i++) updateWaterExposure(a, scoped);
    assert.equal(a.state, "dead"); assert.ok((a.dissolved ?? 0) > 0);
    a.state = "idle"; a.waterExposure = 30; a.pos = { x: c.surfaceEntrance.x, y: c.surfaceEntrance.y + 6 };
    c.colony.fire = 0; assert.equal(isSheltered(scoped, a.pos), false);
    c.colony.fire = 1; for (let i = 0; i < 15; i++) updateWaterExposure(a, scoped); assert.equal(a.waterExposure, 0);
    c.colony.fire = 0; const hutPlace = rainShelterPoint(scoped, a)!; assert.ok(hutPlace); assert.ok(isSheltered(scoped, hutPlace));
    a.pos = { ...hutPlace }; a.waterExposure = 30; updateWaterExposure(a, scoped); assert.ok((a.waterExposure ?? 0) < 30 && (a.waterExposure ?? 0) > 29);
  });
  scenario("Дождь: дальний мокрый рабочий успевает к огню, стража реагирует на угрозу", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c), a = c.ants[0]; scoped.enemies = []; w.weather.state = "rain";
    a.pos = { x: c.surfaceEntrance.x + 100, y: c.surfaceEntrance.y + 20 }; a.waterExposure = 5; a.job = "harvest";
    for (let i = 0; i < 1100; i++) { scoped.tick++; stepAnt(scoped, a); }
    assert.notEqual(a.state, "dead"); assert.equal(a.waterExposure, 0); assert.equal(a.job, "harvest");
    a.job = "guard"; assert.equal(moveToRainShelter(scoped, a), true);
    const e = createSpider(); e.pos = { x: a.pos.x + 5, y: a.pos.y }; scoped.enemies = [e];
    assert.equal(moveToRainShelter(scoped, a), false);
    scoped.enemies = []; w.weather.state = "clear"; assert.equal(moveToRainShelter(scoped, a), false);
  });
  scenario("Существа: жук и паук обходят готовую хижину, сохраняя цель", () => {
    const w = fresh(), hut = w.surface.buildings.find(b => b.type === "hut")!, f = buildingFootprint(hut)!;
    for (const type of ["spider", "beetle"] as const) {
      const e = createSpider(); e.type = type; e.pos = { x: f.x - 8, y: f.y };
      const target = { x: f.x + 8, y: f.y };
      for (let i = 0; i < 160 && Math.hypot(e.pos.x - target.x, e.pos.y - target.y) > 0.7; i++) {
        moveCreature(w, e, target, 0.6);
        assert.equal(insideBuilding(e.pos.x, e.pos.y, f), false);
      }
      assert.ok(Math.hypot(e.pos.x - target.x, e.pos.y - target.y) < 1);
    }
  });
  scenario("Бой: совпавшие позиции бойцов расходятся без выхода из радиуса удара", () => {
    const w = fresh(), a = w.ants[0], b = w.ants[1], target = { x: 145, y: 260 };
    a.pos = { x: 148, y: 260 }; b.pos = { ...a.pos };
    for (let i = 0; i < 16; i++) { settleMeleePosition(w, a, target); settleMeleePosition(w, b, target); }
    assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > 1.5);
    assert.ok(Math.hypot(a.pos.x - target.x, a.pos.y - target.y) <= 4);
    assert.ok(Math.hypot(b.pos.x - target.x, b.pos.y - target.y) <= 4);
  });
  scenario("Здания: отрезок не пересекает основание, старый житель выходит наружу", () => {
    const w = fresh();
    for (const b of w.surface.buildings) {
      const f = buildingFootprint(b); if (!f) continue;
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, dx = Math.cos(angle) * 8, dy = Math.sin(angle) * 8;
        const from: Vec2 = { x: f.x - dx, y: f.y - dy };
        const pos: Vec2 = { x: f.x + dx, y: f.y + dy };
        resolveSurfaceCollision(w, pos, from.x, from.y);
        assert.equal(crossesBuilding(from, pos, f), false);
      }
      const legacy = { x: f.x, y: f.y }; resolveSurfaceCollision(w, legacy, legacy.x, legacy.y);
      assert.equal(isSurfaceBlockedAt(w, legacy.x, legacy.y), false);
      const service = buildingServicePoint(b); assert.equal(isSurfaceBlockedAt(w, service.x, service.y), false);
    }
  });
  scenario("Здания: рабочий обходит хижину и сдаёт груз у склада с любой стороны", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c), ant = c.ants[0];
    const hut = w.surface.buildings.find(b => b.type === "hut")!, f = buildingFootprint(hut)!;
    ant.pos = { x: f.x - 8, y: f.y }; ant.heading = { x: 1, y: 0 }; ant.job = "harvest";
    const target = { x: f.x + 8, y: f.y };
    for (let i = 0; i < 250 && Math.hypot(ant.pos.x - target.x, ant.pos.y - target.y) > 1; i++) {
      const prev = { ...ant.pos }; moveSurfaceToward(scoped, ant, target, false, false); resolveSurfaceCollision(scoped, ant.pos, prev.x, prev.y, ant.colonyId);
      assert.equal(insideBuilding(ant.pos.x, ant.pos.y, f), false);
    }
    assert.ok(Math.hypot(ant.pos.x - target.x, ant.pos.y - target.y) < 1.5, "walk around hut");
    const storage = w.surface.buildings.find(b => b.type === "storage" && b.colonyId === c.id)!, sf = buildingFootprint(storage)!;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      ant.pos = { x: sf.x + Math.cos(angle) * 7, y: sf.y + Math.sin(angle) * 7 }; ant.heading = { x: -Math.cos(angle), y: -Math.sin(angle) };
      ant.carrying = 1; ant.carryKind = "wood"; ant.state = "carry";
      for (let tick = 0; tick < 240 && ant.carrying > 0; tick++) {
        const prev = { ...ant.pos }; moveHarvestCarrying(scoped, ant); resolveSurfaceCollision(scoped, ant.pos, prev.x, prev.y, ant.colonyId);
        assert.equal(insideBuilding(ant.pos.x, ant.pos.y, sf), false);
      }
      assert.equal(ant.carrying, 0, `storage approach ${i}: ${JSON.stringify(ant.pos)}`);
    }
  });
  scenario("Бой: короткое событие удара имеет паузу и не запускается с грузом", () => {
    const w = fresh(), a = w.ants[0], target = { x: a.pos.x + 2, y: a.pos.y };
    a.carrying = 0;
    assert.equal(markMelee(a, target, 100), true);
    assert.equal(markMelee(a, target, 101), false);
    assert.equal(markMelee(a, target, 110), true);
    a.carrying = 1; assert.equal(markMelee(a, target, 120), false);
  });
  scenario("Бой у костра: носильщик уходит от паука, стражник подходит и атакует", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c), a = c.ants[0], camp = c.surfaceEntrance;
    const e = createSpider(); e.pos = { x: camp.x + 3, y: camp.y + 2 }; e.raid = true; w.enemies = [e]; scoped.enemies = w.enemies;
    a.pos = { x: camp.x + 1, y: camp.y + 3 }; a.carrying = 1; a.carryKind = "wood"; a.job = "harvest";
    const before = Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y); moveToSafety(scoped, a);
    assert.ok(Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) > before);
    a.carrying = 0; a.job = "guard"; a.pos = { x: camp.x + 12, y: camp.y + 3 }; a.energy = CONFIG.maxEnergy; e.hp = 200; e.maxHp = 200;
    for (let i = 0; i < 120 && e.hp === 200; i++) { w.tick++; scoped.tick = w.tick; const prev = { ...a.pos }; moveDefending(scoped, a); resolveSurfaceCollision(scoped, a.pos, prev.x, prev.y, a.colonyId); }
    assert.ok(e.hp < 200 && a.melee, "guard attacks instead of waiting beyond post leash");
  });
  scenario("Очаг: нельзя пересечь с любой стороны; старые жители внутри выходят", () => {
    const w = fresh();
    for (const camp of w.surface.entrances) {
      assert.equal(isSurfaceBlockedAt(w, camp.x, camp.y), true);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, dx = Math.cos(a) * 5, dy = Math.sin(a) * 5;
        const from = { x: camp.x - dx, y: camp.y - dy }, pos = { x: camp.x + dx, y: camp.y + dy };
        resolveSurfaceCollision(w, pos, from.x, from.y);
        assert.equal(crossesHearth(from.x, from.y, pos.x, pos.y, camp), false);
        assert.equal(insideHearth(pos.x, pos.y, camp), false);
      }
      const legacy = { ...camp }; resolveSurfaceCollision(w, legacy, camp.x, camp.y);
      assert.equal(isSurfaceBlockedAt(w, legacy.x, legacy.y), false);
    }
  });
  scenario("Очаг: оба племени сдают груз с восьми направлений без прохода через огонь", () => {
    const w = fresh(); w.surface.buildings = [];
    for (const c of w.colonies) {
      const scoped = colonyWorldView(w, c), camp = c.surfaceEntrance, ant = c.ants[0];
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ant.pos = { x: camp.x + Math.cos(a) * 5, y: camp.y + Math.sin(a) * 5 };
        ant.heading = { x: -Math.cos(a), y: -Math.sin(a) }; ant.state = "carry";
        ant.carrying = 1; ant.carryKind = "wood"; ant.job = "harvest";
        const before = c.colony.wood;
        for (let tick = 0; tick < 240 && ant.carrying > 0; tick++) {
          const prev = { ...ant.pos }; moveHarvestCarrying(scoped, ant);
          resolveSurfaceCollision(scoped, ant.pos, prev.x, prev.y, ant.colonyId);
          assert.equal(insideHearth(ant.pos.x, ant.pos.y, camp), false);
        }
        assert.equal(ant.carrying, 0, `colony=${c.id}, approach=${i}`);
        assert.equal(c.colony.wood, before + 1);
      }
    }
  });
  scenario("Команды: неверные координаты/типы отвергаются, резерв ограничен", () => {
    assert.equal(parseCommand('{"type":"setDefensePost","x":-1,"y":0}'), null);
    assert.equal(parseCommand('{"type":"setAlarm","value":"yes"}'), null);
    assert.equal(parseCommand('{"type":"setGrowth","paused":false,"reserve":null}'), null);
    assert.deepEqual(parseCommand('{"type":"setGrowth","paused":true,"reserve":1000}'), { type: "setGrowth", colonyIndex: 0, paused: true, reserve: 100 });
  });
  scenario("Назначения: 3→1 освобождает лишних добытчиков; груз сначала сдаётся", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c);
    const clay = w.surface.resourceNodes.find(n => n.kind === "clay")!;
    c.colony.priorities.clay = 1;
    c.colony.priorities.wood = 0; c.colony.priorities.stone = 0;
    for (const a of c.ants.slice(0, 3)) { a.job = "harvest"; a.harvestNodeId = clay.id; a.carrying = 0; }
    c.ants[2].carrying = 1; c.ants[2].carryKind = "clay";
    assignHarvestJobs(scoped);
    assert.equal(c.ants[1].job, "forage");
    assert.equal(c.ants[2].job, "harvest");
    c.ants[2].carrying = 0; assignHarvestJobs(scoped);
    assert.equal(c.ants.filter(a => a.job === "harvest").length, 1);
  });
  scenario("Рыбак и похищенный житель сохраняют работу при ротации собирателей", () => {
    const w = fresh(), a = w.colonies[0].ants[0];
    a.job = "fish"; a.fishingTicks = 45;
    assignForageRoles(colonyWorldView(w, w.colonies[0]));
    assert.equal(a.job, "fish"); assert.equal(a.fishingTicks, 45);
    a.job = "harvest"; a.capturedBy = "monster";
    assignForageRoles(colonyWorldView(w, w.colonies[0])); assert.equal(a.job, "harvest");
  });
  scenario("Тревога прерывает стройку и возвращает рабочего с грузом", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0];
    c.colony.alarm = true; a.job = "build"; a.pos = { x: 150, y: 240 }; a.heading = { x: -1, y: 0 };
    a.carrying = 1; a.carryKind = "clay";
    const before = a.pos.x; stepAnt(colonyWorldView(w, c), a);
    assert.ok(a.pos.x < before); assert.equal(a.carrying, 1);
  });
  scenario("Снижение числа строителей освобождает лишних; рост соблюдает резерв глины", () => {
    const w = fresh(), c = w.colonies[0];
    w.session.mode = "sandbox"; w.session.dangersEnabled = false;
    placePointBuilding(w, 0, "workshop", 105, 254);
    const site = w.surface.buildings.at(-1)!;
    c.colony.priorities.build = 1;
    for (const a of c.ants.slice(0, 3)) { a.job = "build"; a.buildTargetId = site.id; a.carrying = 0; }
    assignBuildJobs(colonyWorldView(w, c)); assert.equal(c.ants.filter(a => a.job === "build").length, 1);
    c.colony.priorities = { clay: 0, wood: 0, stone: 0, build: 0, guard: 0, fish: 0 };
    c.colony.clay = 10; c.colony.clayReserve = 10; c.colony.reproductionCooldown = 0;
    const before = c.ants.length; step(w); assert.equal(c.ants.length, before);
    c.colony.clayReserve = 0; c.colony.growthPaused = true; step(w); assert.equal(c.ants.length, before);
    c.colony.growthPaused = false; step(w); assert.equal(c.ants.length, before + 1);
  });
  scenario("Обучение требует мастерскую и платится только один раз", () => {
    const w = fresh(), c = w.colonies[0];
    c.colony.wood = 20; c.colony.stone = 20;
    assert.equal(trainWaterWeapons(w, 0), false);
    assert.ok(placePointBuilding(w, 0, "workshop", 105, 254));
    completeBuilding(w, w.surface.buildings.at(-1)!);
    assert.ok(trainWaterWeapons(w, 0)); assert.equal(c.colony.wood, 14); assert.equal(c.colony.stone, 16);
    assert.equal(trainWaterWeapons(w, 0), false); assert.equal(c.colony.wood, 14);
  });
  scenario("Песочница даёт одного тестового водомёта; повтор не размножает стражу", () => {
    const w = fresh(), c = w.colonies[0];
    prepareSandboxGuard(w, 0); assert.equal(c.colony.waterWeapons, undefined);
    w.session.mode = "sandbox"; prepareSandboxGuard(w, 0);
    const total = c.ants.length; prepareSandboxGuard(w, 0);
    assert.equal(c.ants.length, total); assert.equal(c.colony.waterWeapons, true);
    assert.equal(c.ants.filter(a => a.job === "guard").length, 1);
    assert.equal(c.ants.find(a => a.job === "guard")!.waterAmmo, CONFIG.waterAmmoCapacity);
  });
  scenario("Водомёт стреляет по угрозе, тратит заряд и держит пост", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0];
    c.colony.waterWeapons = true; c.colony.defensePost = { x: 120, y: 240 };
    a.job = "guard"; a.waterAmmo = 8; a.pos = { x: 120, y: 240 };
    const e = createBeetle(w, { x: 132, y: 240 }); w.enemies = [e];
    moveDefending(colonyWorldView(w, c), a);
    assert.equal(a.waterAmmo, 7); assert.equal(e.hp, e.maxHp - CONFIG.waterShotDamage); assert.equal(a.pos.x, 120); assert.ok(a.shot);
    moveDefending(colonyWorldView(w, c), a); assert.equal(a.waterAmmo, 7);
  });
  scenario("Стены перекрывают водяной выстрел", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0];
    c.colony.waterWeapons = true; a.job = "guard"; a.waterAmmo = 8; a.pos = { x: 120, y: 240 };
    const e = createBeetle(w, { x: 132, y: 240 }); w.enemies = [e];
    paintWallCells(w, 0, [wallCellIndexAt(126, 240)]); completeBuilding(w, w.surface.buildings.at(-1)!);
    moveDefending(colonyWorldView(w, c), a); assert.equal(e.hp, e.maxHp); assert.equal(a.waterAmmo, 8);
  });
  scenario("Водяная атака по жителю размокает его; убийство паука засчитывается правильному племени", () => {
    const w = fresh(), c = w.colonies[1], a = c.ants[0], victim = w.colonies[0].ants[0];
    w.tick = CONFIG.colonyGraceTicks;
    c.colony.waterWeapons = true; a.job = "guard"; a.waterAmmo = 8;
    a.pos = { x: 360, y: 240 }; victim.pos = { x: 370, y: 240 };
    moveDefending(colonyWorldView(w, c), a); assert.ok((victim.dissolved ?? 0) > 0);
    const e = createSpider(); e.pos = { x: 370, y: 240 }; e.hp = 1; w.enemies = [e];
    w.tick += CONFIG.waterShotEveryTicks;
    moveDefending(colonyWorldView(w, c), a);
    updateWorldSurfaceCache(w); updateEnemies(w);
    assert.equal(w.colonies[0].fitness.spidersKilled, 0); assert.equal(c.fitness.spidersKilled, 1);
  });
  scenario("Водомёт пополняется с сухого берега и возвращается к посту", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0];
    c.colony.waterWeapons = true; a.job = "guard"; a.waterAmmo = 0;
    moveDefending(colonyWorldView(w, c), a); assert.ok(a.refillPos); assert.equal(isWaterAt(a.refillPos.x, a.refillPos.y), false);
    a.pos = { ...a.refillPos };
    for (let i = 0; i < CONFIG.waterRefillTicks; i++) moveDefending(colonyWorldView(w, c), a);
    assert.equal(a.waterAmmo, CONFIG.waterAmmoCapacity); assert.equal(a.refillPos, undefined);
  });
  scenario("Вода уменьшает тело, оставляет глину; высыхание не возвращает массу", () => {
    const w = fresh(), a = w.ants[0]; a.pos = { x: 120, y: 240 };
    dissolveAnt(a, 30, w); const mass = a.dissolved;
    assert.equal(mass, 0.25);
    assert.ok(Math.abs(w.surface.resourceNodes.filter(n => n.id.startsWith("wash-")).reduce((n, x) => n + x.amount, 0) - CONFIG.deadClayAmount / 4) < 0.001);
    for (let i = 0; i < 30; i++) updateWaterExposure(a, w);
    assert.equal(a.waterExposure, 0); assert.equal(a.dissolved, mass);
    dissolveAnt(a, 90, w); assert.equal(a.state, "dead");
  });
  scenario("Озёрный монстр хватает жителя; смерть монстра освобождает его на суше", () => {
    const w = fresh(), a = w.ants[0], e = createLakeMonster(w, "north");
    a.pos = { x: 179, y: 140 }; e.pos = { x: 181, y: 140 }; e.lair = { x: 185, y: 140 }; w.enemies = [e];
    updateWildlife(w); assert.equal(a.capturedBy, e.id); assert.equal(e.captiveId, a.id);
    a.pos = { x: 185, y: 140 }; e.hp = 0;
    updateWildlife(w); assert.equal(a.capturedBy, undefined); assert.equal(isWaterAt(a.pos.x, a.pos.y), false); assert.equal(w.session.stats.rescued, 1);
  });
  scenario("Похищение доводит жителя до озера, растворение засчитывает жертву", () => {
    const w = fresh(), a = w.ants[0], e = createLakeMonster(w, "north");
    a.pos = { x: 179, y: 140 }; e.pos = { x: 181, y: 140 }; e.lair = { x: 185, y: 140 }; w.enemies = [e];
    updateWildlife(w);
    for (let i = 0; i < 180; i++) { w.tick++; stepAnt(colonyWorldView(w, w.colonies[0]), a); updateWildlife(w); }
    assert.equal(a.state, "dead"); assert.equal(w.session.lakes.north.swallowed, 1);
  });
  scenario("Жертвы увеличивают число озёрных монстров до ограниченного потолка", () => {
    const w = fresh(); w.session.lakes.north.swallowed = 100;
    for (let i = 0; i < 8; i++) { w.tick = (i + 1) * CONFIG.lakeMonsterSpawnTicks; updateWildlife(w); }
    assert.equal(w.enemies.filter(e => e.type === "lakeMonster" && e.lakeId === "north").length, CONFIG.lakeMonsterMaxPerLake);
  });
  scenario("Ночной жук катает пленника; рассвет освобождает выжившего", () => {
    const w = fresh(), a = w.ants[0], e = createBeetle(w, { x: 160, y: 240 });
    w.tick = 4300; a.pos = { x: 150, y: 240 }; e.pos = { x: 151, y: 240 }; w.enemies = [e];
    updateWildlife(w); assert.equal(a.capturedBy, e.id);
    const before = a.pos.x; w.tick++; updateWildlife(w); assert.ok(a.pos.x > before);
    w.tick = 6000; updateWildlife(w); assert.equal(a.capturedBy, undefined); assert.ok(!w.enemies.some(x => x.type === "beetle"));
  });
  scenario("Набег предупреждается, паук ломает стену, после набега есть передышка", () => {
    const w = fresh(); w.tick = CONFIG.raidFirstAt - CONFIG.raidWarningTicks; updateRaids(w); assert.equal(w.session.raid.phase, "warning");
    w.tick = CONFIG.raidFirstAt; updateRaids(w); assert.equal(w.session.raid.phase, "attack");
    const e = w.enemies.find(e => e.raid)!;
    // A lone fence section is walked around, not smashed.
    paintWallCells(w, 0, [wallCellIndexAt(140, 240)]); const wall = w.surface.buildings.at(-1)!; completeBuilding(w, wall);
    e.pos = { x: 143, y: 241 };
    for (let i = 0; i < 100; i++) { w.tick++; moveCreature(w, e, { x: 120, y: 241 }, 0.9, true); }
    assert.ok(w.surface.buildings.some(b => b.id === wall.id) && Math.hypot(e.pos.x - 120, e.pos.y - 241) < 3, "lone section survives, spider gets past");
    // A closed ring around the target is smashed through. Built directly from
    // copies of the section: placement rules (land, margins) are not the point.
    const ringIds = new Set<string>();
    const cellCenter = (v: number) => Math.floor(v / 2) * 2 + 1;
    for (let k = -10; k <= 10; k += 2) for (const [x, y] of [[200 + k, 231], [200 + k, 251], [190, 241 + k], [210, 241 + k]]) {
      const id = `ring-${cellCenter(x)}-${cellCenter(y)}`;
      if (ringIds.has(id)) continue;
      ringIds.add(id);
      w.surface.buildings = [...w.surface.buildings, { ...wall, id, pos: { x: cellCenter(x), y: cellCenter(y) }, hp: wall.maxHp }];
    }
    e.pos = { x: 225, y: 241 };
    for (let i = 0; i < 400; i++) { w.tick++; moveCreature(w, e, { x: 200, y: 241 }, 0.9, true); }
    assert.ok([...ringIds].some(id => !w.surface.buildings.some(b => b.id === id)), "closed ring gets a breach");
    assert.ok((e.attackAt ?? -1) > 0, "smashing is a visible blow");
    w.tick = w.session.raid.until; updateRaids(w); assert.equal(w.session.raid.phase, "peace"); assert.equal(w.session.stats.raidsSurvived, 1);
  });
  scenario("Хижина встаёт внутри огороженного лагеря: зазор считается по основаниям", () => {
    const w = fresh(), c = w.colonies[0], home = c.surfaceEntrance;
    // A fence ring of radius ~24 round the camp, every 2 units.
    const ring: number[] = [];
    for (let a = 0; a < 360; a += 4) ring.push(wallCellIndexAt(home.x + Math.cos(a * Math.PI / 180) * 24, home.y + Math.sin(a * Math.PI / 180) * 24));
    paintWallCells(w, 0, [...new Set(ring)]);
    const free = [[0, -14], [-14, 6], [14, 8], [0, 15]].map(([dx, dy]) => ({ x: home.x + dx, y: home.y + dy }))
      .filter(p => pointBuildingPlacement(w.surface, c.id, "hut", p) === null);
    assert.ok(free.length >= 2, `huts fit inside the fence: ${free.length}`);
    // Still no hut right against the fence or overlapping another foundation.
    assert.equal(pointBuildingPlacement(w.surface, c.id, "hut", { x: home.x + 22.5, y: home.y }), "Слишком близко к ограде");
    const hut = w.surface.buildings.find(b => b.colonyId === c.id && b.type === "hut")!;
    assert.equal(pointBuildingPlacement(w.surface, c.id, "hut", { x: hut.pos.x + 3, y: hut.pos.y }), "Слишком близко к другой постройке");
  });
  scenario("Паук у очага во время набега: жители встают на защиту, а не разбегаются", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c);
    w.tick = CONFIG.raidFirstAt - CONFIG.raidWarningTicks; updateRaids(w);
    w.tick = CONFIG.raidFirstAt; updateRaids(w);
    const e = w.enemies.find(x => x.raid)!;
    e.pos = { x: c.surfaceEntrance.x + 7, y: c.surfaceEntrance.y + 1 };
    c.colony.alarm = true;
    const hands = c.ants.filter(a => a.state !== "dead").slice(0, 4);
    for (const [i, a] of hands.entries()) { a.carrying = 0; a.energy = 900; a.job = "forage"; a.pos = { x: c.surfaceEntrance.x + 12, y: c.surfaceEntrance.y - 6 + i * 3 }; }
    const startDist = hands.map(a => Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y));
    for (let i = 0; i < 30; i++) { w.tick++; scoped.tick = w.tick; for (const a of hands) stepAnt(scoped, a); }
    const rallied = hands.filter((a, i) => a.state === "fight" || Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) < startDist[i] - 1).length;
    assert.ok(rallied >= 3, `rallied ${rallied}/4`);
  });
  scenario("Идол требует ритуал; победа останавливает тик, новая партия сбрасывает итог", () => {
    const w = fresh(); assert.ok(placePointBuilding(w, 0, "idol", 105, 254)); completeBuilding(w, w.surface.buildings.at(-1)!);
    updateObjectives(w); updateOutcome(w); assert.equal(w.session.status, "playing");
    // The ritual feeds on special clay: without it, it cannot even start.
    assert.ok((w.surface.springs?.length ?? 0) > 0);
    w.colonies[0].colony.specialClay = 0;
    for (let i = 0; i < 200; i++) updateOutcome(w);
    assert.equal(w.session.idolProgress, 0);
    w.colonies[0].colony.specialClay = Math.ceil(CONFIG.idolRitualTicks / CONFIG.idolSpecialClayEvery);
    for (let i = 0; i < CONFIG.idolRitualTicks; i++) updateOutcome(w);
    assert.equal(w.colonies[0].colony.specialClay, 0);
    updateObjectives(w); updateOutcome(w); assert.equal(w.session.status, "playing");
    w.tick = CONFIG.matchMinTicks; updateOutcome(w); assert.equal(w.session.status, "victory");
    const tick = w.tick; step(w); assert.equal(w.tick, tick);
    restartColony(w); assert.equal(w.session.status, "playing"); assert.equal(w.session.stats.lost, 0); assert.equal(w.session.idolProgress, 0);
  });
  scenario("Потеря всех жителей A завершает матч; песочница продолжает жить", () => {
    const w = fresh(); w.colonies[0].ants = []; syncWorldLegacyFields(w); updateOutcome(w); assert.equal(w.session.status, "defeat");
    const s = fresh(); s.session.mode = "sandbox"; s.colonies[0].ants = []; updateOutcome(s); assert.equal(s.session.status, "playing");
  });
  scenario("Сутки имеют сумерки, ночь и рассвет", () => {
    assert.equal(dayCycle(0).phase, "day"); assert.equal(dayCycle(4000).phase, "dusk"); assert.equal(dayCycle(4300).darkness, 1); assert.equal(dayCycle(5850).phase, "dawn"); assert.equal(dayCycle(6000).day, 2);
  });
  scenario("20 минут: экономика, ночь, озёра и набег совместимы; нет потерянных пленников", () => {
    const originalRandom = Math.random;
    let seed = 1701;
    Math.random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    try {
      const world = fresh(); world.session.mode = "sandbox";
      for (let i = 0; i < 12000; i++) step(world);
      assert.equal(world.tick, 12000);
      assert.ok(world.session.raid.count >= 1);
      for (const ant of world.ants) {
        assert.ok(Number.isFinite(ant.pos.x) && Number.isFinite(ant.pos.y) && Number.isFinite(ant.energy));
        if (ant.capturedBy) assert.ok(world.enemies.some(e => e.id === ant.capturedBy && e.captiveId === ant.id));
      }
      console.log(`  tick=${world.tick}, population=${world.ants.length}, lost=${world.session.stats.lost}, raids=${world.session.raid.count}`);
    } finally { Math.random = originalRandom; }
  });
  const w = fresh();
  w.colonies[0].colony.alarm = true; w.colonies[0].colony.waterWeapons = true;
  const captive = w.ants[0], monster = createLakeMonster(w, "north");
  captive.capturedBy = monster.id; monster.captiveId = captive.id; w.enemies = [monster];
  dissolveAnt(captive, 10, w); w.session.lakes.north.swallowed = 3;
  await saveWorldSnapshot(w);
  await saveWorldSnapshot(w);
  const loaded = await loadWorldSnapshot(w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
  assert.ok(loaded); assert.equal(loaded.session.lakes.north.swallowed, 3); assert.equal(loaded.ants[0].capturedBy, monster.id);
  assert.equal(loaded.colonies[0].colony.alarm, true); assert.equal(loaded.ants[0].dissolved, captive.dissolved);
  assert.ok(JSON.parse(await readFile(`${CONFIG.snapshotFile}.bak`, "utf8")));
  passed++; console.log("PASS  Атомарный сейв/резервная копия: угрозы, пленник, размокание и команды переживают загрузку");
  await writeFile(CONFIG.snapshotFile, "{ interrupted save", "utf8");
  const recovered = await loadWorldSnapshot(w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
  assert.equal(recovered?.session.lakes.north.swallowed, 3);
  passed++; console.log("PASS  Повреждённое сохранение восстанавливается из резервной копии");
  const old = structuredClone(toSnapshot(w, false)); old.snapshotVersion = 14; delete (old as Partial<typeof old>).session;
  const migrated = worldFromSnapshot(old, w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
  assert.equal(migrated.session.status, "playing"); passed++; console.log("PASS  Сохранение v14 мигрирует без удаления поселения");
  const previousVersion = structuredClone(toSnapshot(w, false)); previousVersion.snapshotVersion = 15; previousVersion.protocolVersion = 15;
  previousVersion.colonies[0].ants[1].job = "guard";
  const upgraded = worldFromSnapshot(previousVersion, w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
  assert.equal(upgraded.tick, w.tick); assert.equal(upgraded.ants.length, w.ants.length);
  assert.equal(upgraded.surface.buildings.length, w.surface.buildings.length);
  assert.equal(upgraded.colonies[0].ants[1].job, "guard");
  passed++; console.log("PASS  Сохранение v15 загружается в актуальную версию с теми же жителями и постройками");
  console.log(`\nВсе ${passed} сценариев пройдены.`);
} finally {
  assert.ok(path.resolve(tempDir).startsWith(path.resolve(os.tmpdir()) + path.sep + "clayfolk-gameplay-"));
  await rm(tempDir, { recursive: true, force: true });
}
