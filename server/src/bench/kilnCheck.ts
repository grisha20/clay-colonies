// Проверка этапа «Обжиг и дождь».
// Запуск: npm run check:kiln
// Печь зовёт сырого жителя, обжиг идёт только у печи и стоит 2 дерева;
// обожжённый не размокает под дождём, в воде растворяется медленнее и
// сильнее; печь ждёт при дожде, тревоге, паузе и без дров; погибший или
// пропавший житель освобождает печь; флаг переживает сохранение; в живой
// симуляции печь игрока обжигает жителей, а ИИ-сосед строит свою.
export {};
process.env.SNAPSHOT_FILE = "./.kiln-snapshot.json";
process.env.GENOME_FILE = "./.kiln-genome-a.json";
process.env.GENOME_FILE_B = "./.kiln-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.kiln-genome-spider.json";

const fs = await import("node:fs");
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, toSnapshot, worldFromSnapshot, colonyWorldView } = await import("../sim/world");
const { step } = await import("../sim/step");
const { CONFIG } = await import("../config");
const { placePointBuilding, completeBuilding } = await import("../sim/building");
const { updateKilns } = await import("../sim/kiln");
const { updateWaterExposure } = await import("../sim/ant/step");
const { buildingServicePoint } = await import("../../../shared/buildingGeometry");
const { isWaterAt, lakeDefinitions } = await import("../../../shared/surfaceTerrain");
const { updateObjectives } = await import("../sim/objectives");
const { updateSettlementAI } = await import("../sim/settlementAI");

let failures = 0;
function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) failures += 1;
}

const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const world = createWorld(genome, spider, genomeB);
world.enemies = [];
const player = world.colonies[0], c = player.colony, camp = player.surfaceEntrance;

function placeKiln(w: typeof world, index: number) {
  const home = w.colonies[index].surfaceEntrance;
  for (let r = 14; r < 60; r += 4) for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    if (placePointBuilding(w, index, "kiln", Math.round(home.x + Math.cos(a) * r), Math.round(home.y + Math.sin(a) * r))) {
      const kiln = w.surface.buildings[w.surface.buildings.length - 1];
      completeBuilding(w, kiln);
      return kiln;
    }
  }
  throw new Error("no place for a kiln");
}

const kiln = placeKiln(world, 0);
check("kiln is a point building with a footprint", kiln.type === "kiln" && kiln.maxHp === CONFIG.kilnMaxHp);
for (const ant of player.ants) { ant.job = "forage"; ant.carrying = 0; ant.fired = false; }
c.wood = 3; c.alarm = false; world.weather.state = "clear";
updateKilns(world);
check("no call without wood", !kiln.firing);
c.wood = 20; world.weather.state = "rain";
updateKilns(world);
check("no call in the rain", !kiln.firing);
world.weather.state = "clear"; c.alarm = true;
updateKilns(world);
check("no call during the alarm", !kiln.firing);
c.alarm = false; c.firingPaused = true;
updateKilns(world);
check("no call while paused", !kiln.firing);
c.firingPaused = false;
updateKilns(world);
const called = player.ants.find(a => a.kilnId === kiln.id);
check("free raw resident is called", !!kiln.firing && !!called && kiln.firing.antId === called.id);

// Progress only at the kiln; wood paid on arrival.
const wood0 = c.wood;
for (let i = 0; i < 50; i++) updateKilns(world);
check("no progress away from the kiln", kiln.firing?.progress === 0 && c.wood === wood0);
const service = buildingServicePoint(kiln);
called!.pos = { ...service };
const strength0 = called!.strength;
for (let i = 0; i < CONFIG.kilnFiringTicks - 1; i++) updateKilns(world);
check("wood paid on arrival", c.wood === wood0 - CONFIG.kilnWoodPerFiring, `${wood0} -> ${c.wood}`);
check("still firing before the time", !called!.fired && kiln.firing?.progress === CONFIG.kilnFiringTicks - 1);
updateKilns(world);
check("resident fired", called!.fired === true && !called!.kilnId && !kiln.firing);
check("fired is stronger", Math.abs(called!.strength - strength0 - CONFIG.firedStrengthBonus) < 1e-9);
check("fired counted", c.firedTotal === 1);
updateObjectives(world);
check("objectives: kiln built, 1/10 fired", world.objectives.find(o => o.id === "kiln-1")?.done === true && world.objectives.find(o => o.id === "fired-10")?.progress === 1);
updateKilns(world);
check("fired resident is not called again", kiln.firing?.antId !== called!.id);

// Pause in the middle of a firing stops it and resumes it (review 569d093, item 3).
{
  const k = kiln.firing ? kiln : undefined;
  if (k?.firing) {
    const ant = player.ants.find(a => a.id === k.firing!.antId)!;
    ant.pos = { ...buildingServicePoint(k) };
    for (let i = 0; i < 10; i++) updateKilns(world);
    const woodPaid = c.wood, progress = k.firing!.progress;
    c.firingPaused = true;
    for (let i = 0; i < 50; i++) updateKilns(world);
    check("pause: no progress, no wood, resident released", k.firing?.progress === progress && c.wood === woodPaid && !ant.kilnId && !ant.fired, `${k.firing?.progress} ${ant.kilnId}`);
    c.firingPaused = false;
    updateKilns(world);
    check("resume: the same resident is called back", ant.kilnId === k.id && k.firing?.antId === ant.id);
    for (let i = 0; i < CONFIG.kilnFiringTicks; i++) updateKilns(world);
    check("resume: firing finishes without paying again", ant.fired === true && c.wood === woodPaid, `${c.wood} vs ${woodPaid}`);
  } else check("pause scenario has an active firing", false);
}

// The called resident dies: the kiln frees itself.
const second = player.ants.find(a => a.id === kiln.firing?.antId)!;
second.state = "dead";
updateKilns(world);
check("dead resident frees the kiln", !kiln.firing || kiln.firing.antId !== second.id);
second.state = "search";
// Timeout when nobody comes.
if (kiln.firing) { kiln.firing.calledAt = world.tick - CONFIG.kilnCallTimeoutTicks - 1; const id = kiln.firing.antId; updateKilns(world); check("call times out", !kiln.firing || kiln.firing.antId !== id); }

// Rain and water.
const view = colonyWorldView(world, player);
const rawAnt = player.ants.find(a => !a.fired && a.state !== "dead")!;
const far = { x: camp.x + 40, y: camp.y + 40 };
world.weather.state = "rain";
called!.pos = { ...far }; rawAnt.pos = { ...far };
called!.waterExposure = 0; rawAnt.waterExposure = 0; called!.dissolved = 0; rawAnt.dissolved = 0;
for (let i = 0; i < 200; i++) { updateWaterExposure(called!, view); updateWaterExposure(rawAnt, view); }
check("raw resident soaks in the rain", (rawAnt.waterExposure ?? 0) > 0);
check("fired resident stays dry in the rain", (called!.waterExposure ?? 0) === 0 && (called!.dissolved ?? 0) === 0);
world.weather.state = "clear";
const lake = lakeDefinitions()[0];
let wet = { x: 0, y: 0 };
for (let y = 0; y < 480 && !wet.x; y += 2) for (let x = 0; x < 480; x += 2) if (isWaterAt(x, y)) { wet = { x, y }; break; }
called!.pos = { ...wet }; rawAnt.pos = { ...wet }; called!.dissolved = 0; rawAnt.dissolved = 0; called!.waterExposure = 0; rawAnt.waterExposure = 0;
for (let i = 0; i < 20; i++) { updateWaterExposure(called!, view); updateWaterExposure(rawAnt, view); }
check("fired dissolves slower in water", (called!.dissolved ?? 0) > 0 && (called!.dissolved ?? 0) < (rawAnt.dissolved ?? 0) * 0.5, `${called!.dissolved?.toFixed(4)} vs ${rawAnt.dissolved?.toFixed(4)} (lake ${lake?.id})`);

// Persistence.
const snap = JSON.parse(JSON.stringify(toSnapshot(world)));
const loaded = worldFromSnapshot(snap, genome, spider, genomeB);
check("save keeps fired", loaded.colonies[0].ants.find(a => a.id === called!.id)?.fired === true);
check("save keeps fired count", loaded.colonies[0].colony.firedTotal === c.firedTotal && (c.firedTotal ?? 0) >= 2);

// Mother: no firing when hungry.
c.autoManage = true; c.food = 1; world.tick = 100;
updateSettlementAI(world);
check("mother pauses firing when food is low", Boolean(c.firingPaused as boolean | undefined));

// Live: the player's kiln fires residents through normal movement; the AI builds its own.
const live = createWorld(genome, spider, genomeB);
let firedLive = 0, aiKilnAt = -1;
for (let i = 0; i < 14000; i++) {
  if (i === 2000) { placeKiln(live, 0); }
  if (i > 2000) live.colonies[0].colony.wood = Math.max(live.colonies[0].colony.wood, 10);
  step(live);
  if (aiKilnAt < 0 && live.surface.buildings.some(b => b.type === "kiln" && b.colonyId === live.colonies[1].id && b.stage === "built")) aiKilnAt = live.tick;
}
firedLive = live.colonies[0].colony.firedTotal ?? 0;
check("live: player's kiln fires residents", firedLive >= 3, `fired ${firedLive}`);
check("live: AI tribe builds a kiln", aiKilnAt > 0, `tick ${aiKilnAt}`);
console.log(`AI fired ${live.colonies[1].colony.firedTotal ?? 0}, player fired ${firedLive}, events: ${live.session.events.map(e => e.text).filter(t => t.includes("обож")).join(" | ")}`);

for (const f of ["./.kiln-snapshot.json", "./.kiln-genome-a.json", "./.kiln-genome-b.json", "./.kiln-genome-spider.json"]) fs.rmSync(f, { force: true });
console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
