import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-world-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, toSnapshot, colonyWorldView, worldFromSnapshot } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { step } = await import("../sim/step");
const { updateOutcome } = await import("../sim/session");
const { updateWildlife } = await import("../sim/wildlife");
const { updateFishPopulation } = await import("../sim/fishing");
const { updateSettlementAI } = await import("../sim/settlementAI");
const { stepAnt } = await import("../sim/ant/step");
const { updateWorldSurfaceCache } = await import("../sim/cache");
const { buildingFootprint, insideBuilding, crossesBuilding } = await import("../../../shared/buildingGeometry");
const { surfaceRoute, surfaceLineOpen, surfacePointOpen, routePoint } = await import("../../../shared/surfaceNavigation");
const { lakeIdAt, isWaterAt } = await import("../../../shared/surfaceTerrain");
const { activeFoodTarget } = await import("../sim/foodMemory");
const { CONFIG } = await import("../config");
const { moveBuilding } = await import("../sim/ant/build");
const { placePointBuilding } = await import("../sim/building");
let seed = 91817, passed = 0; const originalRandom = Math.random;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function fresh() { const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }; return createWorld(g, { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }, structuredClone(g)); }
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }
try {
  check("Стройка: остаток материала меньше 0.5 доставляется и не блокирует хижину", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0], scoped = colonyWorldView(w, c);
    assert.ok(placePointBuilding(w, 0, "hut", c.surfaceEntrance.x - 23, c.surfaceEntrance.y - 8));
    const site = w.surface.buildings.at(-1)!; site.delivered = { clay: site.cost.clay, wood: site.cost.wood - 0.28, stone: 0 };
    a.job = "build"; a.buildTargetId = site.id; a.pos = { x: c.surfaceEntrance.x, y: c.surfaceEntrance.y + 3 }; a.carrying = 0; c.colony.wood = 10;
    assert.ok(moveBuilding(scoped, a)); assert.ok(Math.abs(a.carrying - 0.28) < 0.00001);
    a.pos = { ...site.pos }; moveBuilding(scoped, a); assert.equal(site.delivered.wood, site.cost.wood);
  });
  check("Партия: первый паук/дождь не завершают 12 минут; финал на 2–3 часах", () => {
    const w = fresh(); w.objectives.find(o => o.id === "win-spider")!.done = true; w.tick = 7200;
    updateOutcome(w); assert.equal(w.session.status, "playing"); w.tick = CONFIG.matchMinTicks - 1; updateOutcome(w); assert.equal(w.session.status, "playing");
    w.tick++; updateOutcome(w); assert.equal(w.session.status, "victory");
    const s = fresh(); s.tick = CONFIG.matchMaxTicks; updateOutcome(s); assert.equal(s.session.status, "victory");
  });
  check("Вода: недоступная еда в озере исключается из памяти, а обход имеет безопасные сегменты", () => {
    const w = fresh(), c = w.colonies[0], scoped = colonyWorldView(w, c);
    const source = w.surface.foodSources[0]; source.pos = { x: 240, y: 140 }; c.colony.activeFoodTargetId = source.id;
    assert.equal(activeFoodTarget(scoped), null);
    const from = { x: 170, y: 140 }, target = { x: 295, y: 145 }, route = surfaceRoute(w.surface, from, target, c.id); assert.ok(route);
    let prev = from; for (const p of route) { assert.ok(surfaceLineOpen(w.surface, prev, p, c.id)); prev = p; }
    for (let i = 0; i <= 100; i++) { const p = routePoint(from, route, i / 100); assert.equal(isWaterAt(p.x, p.y), false); }
  });
  check("Показ между пакетами: обход не срезает основание даже на 50×", () => {
    const w = fresh(), b = w.surface.buildings.find(b => b.type === "hut")!, f = buildingFootprint(b)!;
    const from = { x: f.x - 9, y: f.y }, to = { x: f.x + 9, y: f.y }, route = surfaceRoute(w.surface, from, to, b.colonyId); assert.ok(route);
    let prev = from;
    for (let i = 1; i <= 120; i++) { const p = routePoint(from, route, i / 120); assert.equal(insideBuilding(p.x, p.y, f), false); assert.equal(crossesBuilding(prev, p, f), false); prev = p; }
  });
  check("Собиратель с известной едой за озером действительно идёт вокруг, а не бьётся в берег", () => {
    const w = fresh(), c = w.colonies[0], a = c.ants[0], scoped = colonyWorldView(w, c); scoped.enemies = []; w.weather.state = "clear";
    const source = w.surface.foodSources[0]; source.pos = { x: 295, y: 142 }; source.amount = 100;
    c.colony.activeFoodTargetId = source.id; c.colony.knownFood = [{ id: source.id, pos: source.pos, lastSeenTick: 0, trail: [{ x: 170, y: 140 }, { ...source.pos }] }];
    a.pos = { x: 170, y: 140 }; a.forageRole = "forager"; a.knownActiveFoodTargetId = source.id; a.job = "forage"; a.energy = CONFIG.maxEnergy;
    updateWorldSurfaceCache(w);
    let reached = false;
    for (let i = 0; i < 700; i++) { scoped.tick++; stepAnt(scoped, a); assert.equal(isWaterAt(a.pos.x, a.pos.y), false); if (a.carrying > 0) { reached = true; break; } }
    assert.ok(reached, `worker stopped at ${a.pos.x},${a.pos.y}`);
  });
  check("Монстры: существуют с начала, патрулируют своё озеро и едят рыбу", () => {
    const w = fresh(); w.ants = []; w.colonies.forEach(c => { c.ants = []; });
    assert.equal(w.enemies.filter(e => e.type === "lakeMonster").length, 2);
    const e = w.enemies.find(e => e.lakeId === "north")!, start = { ...e.pos };
    for (let i = 0; i < 400; i++) { w.tick++; updateWildlife(w); for (const monster of w.enemies.filter(e => e.type === "lakeMonster")) assert.equal(lakeIdAt(monster.pos.x, monster.pos.y), monster.lakeId); }
    assert.ok(Math.hypot(e.pos.x - start.x, e.pos.y - start.y) > 3);
    e.hunger = 500; const f = w.surface.fish.find(f => f.lakeId === e.lakeId)!; f.pos = { ...e.pos };
    updateWildlife(w); assert.equal(f.state, "respawning"); assert.equal(e.hunger, 0);
  });
  check("Рыбы: курс и положение непрерывны и при свободном плавании, и у приманки", () => {
    const w = fresh(); let minDot = 1;
    for (let i = 0; i < 1800; i++) { const prev = w.surface.fish.map(f => ({ p: { ...f.pos }, h: { ...f.heading } })); w.tick++; updateFishPopulation(w);
      w.surface.fish.forEach((f, j) => { assert.ok(Math.hypot(f.pos.x - prev[j].p.x, f.pos.y - prev[j].p.y) <= CONFIG.fishSwimSpeed + 0.0001); minDot = Math.min(minDot, f.heading.x * prev[j].h.x + f.heading.y * prev[j].h.y); assert.equal(lakeIdAt(f.pos.x, f.pos.y), f.lakeId); }); }
    assert.ok(minDot > 0.99, `minDot=${minDot}`);
  });
  check("Ручное управление: выбранное племя не получает приказов автопилота", () => {
    const w = fresh(); w.tick = 100; w.session.playerColonyIndex = 1; const before = { ...w.colonies[1].colony.priorities }; updateSettlementAI(w);
    assert.deepEqual(w.colonies[1].colony.priorities, before); assert.ok(w.surface.buildings.some(b => b.colonyId === w.colonies[0].id && b.type === "workshop"));
  });
  check("Сохранение v16: новая версия сохраняет жителей, постройки, исход и срок партии", () => {
    const w = fresh(), saved = toSnapshot(w); saved.snapshotVersion = 16; saved.protocolVersion = 16; saved.tick = 7500; delete saved.session.playerColonyIndex; delete saved.session.startedAt;
    const restored = worldFromSnapshot(saved, w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState);
    assert.equal(restored.tick, 7500); assert.equal(restored.ants.length, w.ants.length); assert.equal(restored.surface.buildings.length, w.surface.buildings.length); assert.equal(restored.session.startedAt, 0);
    saved.session.status = "victory"; assert.equal(worldFromSnapshot(saved, w.genomeState, w.spiderGenomeState, w.colonies[1].genomeState).session.status, "victory");
  });
  check("40 минут: племя Б добывает и строится обычными рабочими, без подаренных запасов", () => {
    const w = fresh(); w.session.mode = "sandbox"; w.session.dangersEnabled = false;
    const c = w.colonies[1], initial = w.surface.buildings.filter(b => b.colonyId === c.id).length;
    for (let i = 0; i < 24000; i++) { step(w); if (i % 6000 === 5999) console.log(`  tick=${w.tick}, B=${c.ants.length}, stock=${Math.round(c.colony.clay)}/${Math.round(c.colony.wood)}/${Math.round(c.colony.stone)}, buildings=${w.surface.buildings.filter(b => b.colonyId === c.id && b.stage === "built").length}`); }
    const built = w.surface.buildings.filter(b => b.colonyId === c.id && b.stage === "built");
    console.log(built.map(b => b.type).join(","));
    console.log(JSON.stringify({ sites: w.surface.buildings.filter(b => b.colonyId === c.id && b.stage !== "built"), builders: c.ants.filter(a => a.job === "build").map(a => ({ id: a.id, pos: a.pos, state: a.state, target: a.buildTargetId, carry: a.carrying, kind: a.carryKind })), priorities: c.colony.priorities }));
    assert.ok(built.some(b => b.type === "workshop")); assert.ok(built.length > initial + 1); assert.ok(c.colony.axes > 0 && c.colony.picks > 0);
    assert.ok(c.ants.length >= 12); assert.ok(built.filter(b => b.type === "hut").length >= 3);
    const view = colonyWorldView(w, c); for (const a of c.ants) assert.ok(surfacePointOpen(view.surface, a.pos, a.colonyId));
  });
  console.log(`${passed} world scenarios passed.`);
} finally { Math.random = originalRandom; await rm(temp, { recursive: true, force: true }); }
