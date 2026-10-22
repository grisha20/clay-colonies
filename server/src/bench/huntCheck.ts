// Проверка охоты.
// Запуск: npm run check:hunt
// Стада дичи стоят на суше вдали от лагерей; дичь убегает от жителя;
// мастерская делает копья; охотник догоняет зверя, бросает копьё и несёт
// мясо на склад; убитый зверь возвращается; сохранение не теряет дичь и копья;
// Праматерь посылает охотников, когда есть копья и дичь рядом.
export {};
process.env.SNAPSHOT_FILE = "./.hunt-snapshot.json";
process.env.GENOME_FILE = "./.hunt-genome-a.json";
process.env.GENOME_FILE_B = "./.hunt-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.hunt-genome-spider.json";

const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, toSnapshot, worldFromSnapshot } = await import("../sim/world");
const { generateTerrain } = await import("../sim/terrainGen");
const { step } = await import("../sim/step");
const { CONFIG } = await import("../config");
const { createAnimals, updateAnimals } = await import("../sim/hunting");
const { updateWorldSurfaceCache } = await import("../sim/cache");
const { updateSettlementAI } = await import("../sim/settlementAI");
const { isWaterAt, isMountainAt } = await import("../../../shared/surfaceTerrain");

let failures = 0;
function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) failures += 1;
}
const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const fresh = (seed = 4242) => { const w = createWorld(genome, spider, genomeB, generateTerrain(seed).terrain); w.enemies = []; w.session.raid.at = 1e9; return w; };

// Herds on dry land, away from the camps.
for (const seed of [4242, 911028219, 714183925]) {
  const w = fresh(seed);
  const animals = createAnimals(w.surface);
  const deer = animals.filter(a => a.kind === "deer"), hares = animals.filter(a => a.kind === "hare");
  const dry = animals.every(a => !isWaterAt(a.pos.x, a.pos.y) && !isMountainAt(a.pos.x, a.pos.y));
  const far = animals.every(a => w.surface.entrances.every(c => Math.hypot(c.x - a.pos.x, c.y - a.pos.y) > 40));
  check(`seed ${seed}: herds of deer and hares on open land`, deer.length >= CONFIG.deerPerHerd * 2 && hares.length >= 4 && dry && far, `deer ${deer.length}, hares ${hares.length}`);
}

// Game bolts from a resident.
{
  const w = fresh();
  w.surface.animals = createAnimals(w.surface);
  const deer = w.surface.animals.find(a => a.kind === "deer")!;
  const ant = w.colonies[0].ants[0];
  ant.pos = { x: deer.pos.x + 4, y: deer.pos.y };
  const before = { ...deer.pos };
  updateWorldSurfaceCache(w);
  for (let i = 0; i < 20; i++) { w.tick++; updateAnimals(w); }
  check("deer bolts away from a resident", deer.state === "flee" && Math.hypot(deer.pos.x - ant.pos.x, deer.pos.y - ant.pos.y) > Math.hypot(before.x - ant.pos.x, before.y - ant.pos.y) + 10,
    `${deer.state}, ${Math.hypot(deer.pos.x - ant.pos.x, deer.pos.y - ant.pos.y).toFixed(1)}`);
}

// Workshop makes spears.
{
  const w = fresh();
  const A = w.colonies[0];
  w.surface.buildings.push({ id: "shop", colonyId: A.id, type: "workshop", stage: "built", pos: { x: A.surfaceEntrance.x + 18, y: A.surfaceEntrance.y }, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 }, progress: 1, hp: 100, maxHp: 100 });
  A.colony.axes = 9; A.colony.picks = 9; A.colony.rods = CONFIG.maxRods; A.colony.wood = 50; A.colony.stone = 50; A.colony.spears = 0;
  for (let i = 0; i < CONFIG.toolCraftTicks * 3; i++) step(w);
  check("workshop makes spears", (A.colony.spears ?? 0) >= 1, `spears ${A.colony.spears}`);
}

// Hunters bring meat home; a kill comes back later; save keeps game and spears.
{
  const w = fresh();
  const A = w.colonies[0], c = A.colony;
  c.autoManage = false; c.spears = 3; c.priorities = { clay: 1, wood: 1, stone: 0, build: 0, guard: 0, fish: 0, hunt: 3 };
  const meat0 = c.foodStock?.meat ?? 0;
  let kills = 0, delivered = 0, hunters = 0;
  for (let i = 0; i < 5000; i++) {
    const deadBefore = (w.surface.animals ?? []).filter(a => a.state === "dead").length;
    const meat = c.foodStock?.meat ?? 0;
    step(w);
    kills += Math.max(0, (w.surface.animals ?? []).filter(a => a.state === "dead").length - deadBefore);
    delivered += Math.max(0, (c.foodStock?.meat ?? 0) - meat);
    hunters = Math.max(hunters, A.ants.filter(a => a.job === "hunt").length);
  }
  check("hunters take the field (one per spear)", hunters >= 2 && hunters <= 3, `hunters ${hunters}`);
  check("hunters kill game and carry meat to the store", kills >= 2 && delivered >= CONFIG.hareMeat, `kills ${kills}, meat delivered ${delivered}, stock ${meat0}→${c.foodStock?.meat}`);
  const dead = w.surface.animals!.find(a => a.state === "dead");
  if (dead) { w.tick = dead.respawnAt! ; updateAnimals(w); }
  check("a killed animal comes back home", !dead || dead.state === "graze", dead ? `${dead.state}` : "none dead");
  const restored = worldFromSnapshot(JSON.parse(JSON.stringify(toSnapshot(w))), genome, spider, genomeB);
  check("save keeps game, spears and hunt priority", (restored.surface.animals?.length ?? 0) === w.surface.animals!.length && restored.colonies[0].colony.spears === c.spears && restored.colonies[0].colony.priorities.hunt === 3);
}

// The mother sends hunters when there are spears and game near.
{
  const w = fresh();
  const A = w.colonies[0], c = A.colony;
  c.autoManage = true; c.spears = 2; c.food = 20;
  for (let i = 0; i < 14; i++) A.ants.push({ ...A.ants[i % A.ants.length], id: `grown-${i}`, pos: { ...A.surfaceEntrance } });
  w.surface.animals = createAnimals(w.surface);
  w.tick = 100; updateSettlementAI(w);
  check("mother asks for hunters", (c.priorities.hunt ?? 0) >= 1, `hunt ${c.priorities.hunt}`);
  c.spears = 0; w.tick = 200; updateSettlementAI(w);
  check("no spears, no hunters", (c.priorities.hunt ?? 0) === 0);
}

console.log(failures ? `FAILURES: ${failures}` : "ALL PASSED");
process.exit(failures ? 1 : 0);
