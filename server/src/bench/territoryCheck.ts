// Проверка этапа «Территория и тотемы».
// Запуск: npm run check:territory
// Источники особой глины ставятся честно (далеко от лагерей, на суше, в
// одной проходимой области, парами), земля племени ограничивает стройку,
// тотем её раздвигает, источник на своей земле даёт особую глину, всё
// переживает сохранение, а ИИ-сосед тянет тотемы к источнику.
export {};
process.env.SNAPSHOT_FILE = "./.territory-snapshot.json";
process.env.GENOME_FILE = "./.territory-genome-a.json";
process.env.GENOME_FILE_B = "./.territory-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.territory-genome-spider.json";

const fs = await import("node:fs");
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, toSnapshot, worldFromSnapshot } = await import("../sim/world");
const { generateTerrain } = await import("../sim/terrainGen");
const { step } = await import("../sim/step");
const { CONFIG } = await import("../config");
const { placePointBuilding, completeBuilding } = await import("../sim/building");
const { updateSprings } = await import("../sim/springs");
const { isTerrainBlockedAt } = await import("../../../shared/surfaceTerrain");
const { pointBuildingPlacement } = await import("../../../shared/buildingPlacement");
const { fencePlacement } = await import("../../../shared/fenceGeometry");
const { territoryOwnerAt, CAMP_TERRITORY_RADIUS, TOTEM_TERRITORY_RADIUS } = await import("../../../shared/territory");

let failures = 0;
function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) failures += 1;
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// Springs on generated maps.
let springCounts: number[] = [], fair = true, placedOk = true, homes = true;
for (const seed of [7, 42, 4242, 9716477, 123456, 777]) {
  const { terrain } = generateTerrain(seed);
  const springs = terrain.springs ?? [];
  springCounts.push(springs.length);
  const [a, b] = terrain.camps!;
  for (const s of springs) if (dist(s, a) <= 80 || dist(s, b) <= 80) placedOk = false;
  const da = springs.map(s => dist(s, a)).sort((x, y) => x - y), db = springs.map(s => dist(s, b)).sort((x, y) => x - y);
  if (springs.length >= 3 && Math.abs(da[0] - db[0]) > 70) fair = false;
  if (!(da[0] <= 115 && db[0] <= 115)) homes = false;
  const again = generateTerrain(seed).terrain.springs ?? [];
  if (JSON.stringify(again) !== JSON.stringify(springs)) placedOk = false;
}
check("generated maps have springs", springCounts.every(n => n >= 1) && springCounts.some(n => n >= 3), springCounts.join(","));
check("springs far from camps and deterministic", placedOk);
check("nearest spring is about as far for both camps", fair);
check("each camp has a home spring within 115", homes);

const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const w = createWorld(genome, spider, genomeB, generateTerrain(4242).terrain);
w.enemies = [];
check("world springs on dry land", (w.surface.springs ?? []).length >= 1 && w.surface.springs!.every(s => !isTerrainBlockedAt(s.pos.x, s.pos.y)));
check("no resource node on a spring", w.surface.resourceNodes.every(n => w.surface.springs!.every(s => dist(s.pos, n.pos) >= 5)));
const legacy = createWorld(genome, spider, genomeB);
check("classic map gets springs too", (legacy.surface.springs ?? []).length >= 1, String(legacy.surface.springs?.length));

// Land rules.
const camp = w.colonies[0].surfaceEntrance, rival = w.colonies[1].surfaceEntrance;
const toward = (from: typeof camp, to: typeof camp, d: number) => { const l = dist(from, to); return { x: from.x + (to.x - from.x) / l * d, y: from.y + (to.y - from.y) / l * d }; };
check("camp land is own", territoryOwnerAt(w.surface, toward(camp, rival, CAMP_TERRITORY_RADIUS - 5)) === "colony-1");
check("rival camp land is theirs", territoryOwnerAt(w.surface, toward(rival, camp, 20)) === "colony-2");
const far = toward(camp, rival, CAMP_TERRITORY_RADIUS + 15);
check("no building outside own land", pointBuildingPlacement(w.surface, "colony-1", "hut", far) === "Вне своей земли — поставь тотем ближе");
check("no building on rival land", pointBuildingPlacement(w.surface, "colony-1", "storage", toward(rival, camp, 25)) === "Чужая земля");
check("no fence outside own land", fencePlacement(w.surface, "colony-1", far) === "Вне своей земли — поставь тотем ближе");
const spring0 = w.surface.springs![0];
check("no building on a spring", pointBuildingPlacement(w.surface, "colony-1", "hut", spring0.pos) !== null);

// A totem at the edge extends the land.
let totemAt: { x: number; y: number } | undefined;
for (const back of [5, 8, 11, 14]) for (const turn of [0, 0.3, -0.3, 0.6, -0.6]) {
  if (totemAt) break;
  const a = Math.atan2(rival.y - camp.y, rival.x - camp.x) + turn, s = CAMP_TERRITORY_RADIUS - back;
  const p = { x: Math.round(camp.x + Math.cos(a) * s), y: Math.round(camp.y + Math.sin(a) * s) };
  if (placePointBuilding(w, 0, "totem", p.x, p.y)) totemAt = p;
}
check("totem placed at the edge of own land", !!totemAt, JSON.stringify(totemAt));
const totem = w.surface.buildings.find(b => b.type === "totem")!;
check("totem site does not extend land yet", territoryOwnerAt(w.surface, toward(camp, totem.pos, dist(camp, totem.pos) + TOTEM_TERRITORY_RADIUS - 3)) !== "colony-1");
completeBuilding(w, totem);
const beyond = toward(camp, totem.pos, dist(camp, totem.pos) + TOTEM_TERRITORY_RADIUS - 3);
check("built totem extends land", territoryOwnerAt(w.surface, beyond) === "colony-1");

// Holding a spring: a totem next to it.
w.surface.buildings.push({ id: "spring-totem", colonyId: "colony-1", type: "totem", stage: "built", pos: { x: spring0.pos.x + 8, y: spring0.pos.y }, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 }, progress: 1, hp: 150, maxHp: 150 });
const c = w.colonies[0].colony; c.specialClay = 0;
w.tick = 1000; updateSprings(w);
check("spring held by the tribe on whose land it is", spring0.holder === "colony-1");
check("holding is logged", w.session.events.some(e => e.text.includes("заняло источник")));
for (let t = 1; t <= CONFIG.springYieldTicks / 100; t++) { w.tick = 1000 + t * 100; updateSprings(w); }
check("held spring yields special clay", c.specialClay === 1, String(c.specialClay));
const snap = JSON.parse(JSON.stringify(toSnapshot(w)));
const loaded = worldFromSnapshot(snap, genome, spider, genomeB);
check("save keeps springs, holder and special clay", loaded.surface.springs?.[0]?.holder === "colony-1" && loaded.colonies[0].colony.specialClay === 1);
w.surface.buildings = w.surface.buildings.filter(b => b.id !== "spring-totem");
w.tick += 100; updateSprings(w);
check("spring lost with the totem", spring0.holder !== "colony-1");

// Live: the AI tribe walks totems toward a spring.
const live = createWorld(genome, spider, genomeB, generateTerrain(9716477).terrain);
const B = live.colonies[1];
const gapB = () => Math.min(...(live.surface.springs ?? []).map(s => Math.min(...[B.surfaceEntrance, ...live.surface.buildings.filter(b => b.type === "totem" && b.stage === "built" && b.colonyId === B.id).map(b => b.pos)].map(p => dist(p, s.pos)))));
const gap0 = gapB();
for (let i = 0; i < 24000; i++) step(live);
const totemsB = live.surface.buildings.filter(b => b.type === "totem" && b.colonyId === B.id && b.stage === "built").length;
check("live: AI tribe builds totems", totemsB >= 1, `totems ${totemsB}`);
check("live: AI land moves toward a spring", gapB() < gap0 - 10, `${gap0.toFixed(0)} -> ${gapB().toFixed(0)}`);
console.log(`springs: ${JSON.stringify((live.surface.springs ?? []).map(s => s.holder ?? "-"))}; special clay A ${live.colonies[0].colony.specialClay ?? 0}, B ${B.colony.specialClay ?? 0}`);

for (const f of ["./.territory-snapshot.json", "./.territory-genome-a.json", "./.territory-genome-b.json", "./.territory-genome-spider.json"]) fs.rmSync(f, { force: true });
console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
