// Проверка этапа «Праматерь ведёт племя игрока».
// Запуск: npm run check:mother
// ИИ Праматери ведёт приоритеты, запас глины и тревогу племени игрока, пока
// включено «Праматерь решает»; ручной режим и ручная тревога не перебиваются;
// советы появляются по причине, исчезают с ней и не мигают; флаг переживает
// сохранение, а старые сохранения грузятся в ручном режиме.
export {};

process.env.SNAPSHOT_FILE = "./.mother-snapshot.json";
process.env.GENOME_FILE = "./.mother-genome-a.json";
process.env.GENOME_FILE_B = "./.mother-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.mother-genome-spider.json";

const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, toSnapshot, worldFromSnapshot } = await import("../sim/world");
const { step } = await import("../sim/step");
const { updateSettlementAI, noteManualAlarm } = await import("../sim/settlementAI");
const { updateAdvisor, ADVICE_COOLDOWN, ADVICE_EVERY } = await import("../sim/advisor");

let failures = 0;
function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) failures += 1;
}

const genome = await loadGenome(), spiderGenome = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const world = createWorld(genome, spiderGenome, genomeB);
const restore = (s: any) => worldFromSnapshot(s, genome, spiderGenome, genomeB);
const player = world.colonies[world.session.playerColonyIndex ?? 0];
const c = player.colony;
const keys = () => (c.advice ?? []).map(a => a.key);
const at = (tick: number) => { world.tick = tick; };

check("new game: mother decides", c.autoManage === true);

// Mother runs priorities.
c.priorities = { clay: 0, wood: 0, stone: 0, build: 0, guard: 0, fish: 0 };
at(100); updateSettlementAI(world);
check("auto: mother sets priorities", c.priorities.clay > 0 && c.priorities.build > 0, JSON.stringify(c.priorities));

// Manual mode is left alone.
c.autoManage = false;
c.priorities = { clay: 0, wood: 4, stone: 0, build: 0, guard: 0, fish: 0 };
at(200); updateSettlementAI(world);
check("manual: priorities untouched", c.priorities.wood === 4 && c.priorities.clay === 0, JSON.stringify(c.priorities));
c.autoManage = true;

// Alarm: mother raises it near an enemy and lowers only her own alarm.
const savedEnemies = world.enemies;
const foe = { ...(savedEnemies.find(e => e.type === "spider") ?? savedEnemies[0]), hp: 50, pos: { x: player.surfaceEntrance.x + 6, y: player.surfaceEntrance.y } };
world.enemies = [foe];
c.alarm = false;
at(300); updateSettlementAI(world);
check("auto alarm on threat", Boolean(c.alarm as boolean | undefined));
world.enemies = [];
at(400); updateSettlementAI(world);
check("auto alarm off after threat", c.alarm === false);
c.alarm = true; noteManualAlarm(player);
at(500); updateSettlementAI(world);
check("manual alarm kept", c.alarm === true);
c.alarm = false;

// Advice appears with its cause, clears with it and stays quiet for a cooldown.
c.advice = [];
const food = c.food, fire = c.fire;
c.food = 2;
at(1000); updateAdvisor(world);
check("advice: hunger", keys().includes("hunger"), keys().join(","));
check("advice: danger first", c.advice?.[0]?.severity === "danger");
const since = c.advice?.find(a => a.key === "hunger")?.since;
c.fire = 0.1;
at(1000 + ADVICE_EVERY); updateAdvisor(world);
check("advice: since is kept", c.advice?.find(a => a.key === "hunger")?.since === since);
check("advice: fire", keys().includes("fire"), keys().join(","));
c.fire = 1;
at(1000 + 2 * ADVICE_EVERY); updateAdvisor(world);
check("advice: fire cleared", !keys().includes("fire"), keys().join(","));
c.fire = 0.1;
at(1000 + 3 * ADVICE_EVERY); updateAdvisor(world);
check("advice: no flicker inside cooldown", !keys().includes("fire"), keys().join(","));
at(1000 + 2 * ADVICE_EVERY + ADVICE_COOLDOWN); updateAdvisor(world);
check("advice: returns after cooldown", keys().includes("fire"), keys().join(","));
c.food = food; c.fire = fire;

const cap = c.nestCapacity;
c.nestCapacity = player.ants.length;
at(5000); updateAdvisor(world);
check("advice: crowded -> hut", keys().includes("huts"), keys().join(","));
check("advice: hut points at camp", !!c.advice?.find(a => a.key === "huts")?.pos);
c.nestCapacity = cap;
world.enemies = savedEnemies;

// Persistence.
c.autoManage = false;
const snap = JSON.parse(JSON.stringify(toSnapshot(world)));
check("save keeps manual flag", restore(snap).colonies[0].colony.autoManage === false);
snap.colonies[0].colony.autoManage = true;
check("save keeps auto flag", restore(snap).colonies[0].colony.autoManage === true);
delete snap.colonies[0].colony.autoManage;
check("old save loads manual", restore(snap).colonies[0].colony.autoManage === false);

// Headless run with the mother in charge.
const fresh = createWorld(genome, spiderGenome, genomeB);
let seen = new Set<string>(), bad = 0;
for (let i = 0; i < 6000; i++) {
  step(fresh);
  for (const a of fresh.colonies[0].colony.advice ?? []) { seen.add(a.key); if (a.since > fresh.tick || !a.text) bad += 1; }
}
const pop = fresh.colonies[0].ants.length;
check("headless: tribe grows under the mother", pop > 8, `population ${pop}`);
check("headless: advice is well formed", bad === 0);
console.log(`advice seen: ${[...seen].join(", ") || "none"}; priorities ${JSON.stringify(fresh.colonies[0].colony.priorities)}`);

console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
