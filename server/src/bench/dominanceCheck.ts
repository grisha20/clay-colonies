// Проверка этапа «Доминирование».
// Запуск: npm run check:dominance
// Стража ломает чужой тотем и не трогает свой; господство (2 источника
// сутки) даёт победу или поражение; Великий ливень в конце решает партию
// счётом племён; старые сохранения с ранним дождём не задеты; ИИ-сосед
// идёт осаждать тотем игрока у источника и ломает его.
export {};
process.env.SNAPSHOT_FILE = "./.dominance-snapshot.json";
process.env.GENOME_FILE = "./.dominance-genome-a.json";
process.env.GENOME_FILE_B = "./.dominance-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.dominance-genome-spider.json";

const fs = await import("node:fs");
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld } = await import("../sim/world");
const { generateTerrain } = await import("../sim/terrainGen");
const { step } = await import("../sim/step");
const { CONFIG } = await import("../config");
const { updateSiege } = await import("../sim/siege");
const { updateSprings } = await import("../sim/springs");
const { updateOutcome, tribeScore } = await import("../sim/session");
const { updateObjectives } = await import("../sim/objectives");
const { updateWar } = await import("../sim/settlementAI");
const { territoryOwnerAt } = await import("../../../shared/territory");
const { buildingServicePoint } = await import("../../../shared/buildingGeometry");

let failures = 0;
function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) failures += 1;
}
const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const fresh = () => { const w = createWorld(genome, spider, genomeB, generateTerrain(4242).terrain); w.enemies = []; w.session.raid.at = 1e9; return w; };
const totemAt = (w: ReturnType<typeof fresh>, owner: string, pos: { x: number; y: number }, id = `t-${owner}`) => {
  const t = { id, colonyId: owner, type: "totem" as const, stage: "built" as const, pos, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 }, progress: 1, hp: CONFIG.totemMaxHp, maxHp: CONFIG.totemMaxHp };
  w.surface.buildings.push(t); return t;
};

// Siege.
{
  const w = fresh();
  const spring = w.surface.springs![0];
  const t = totemAt(w, "colony-1", { x: spring.pos.x + 8, y: spring.pos.y });
  const rivals = w.colonies[1].ants.slice(0, 4);
  for (const a of rivals) { a.job = "guard"; a.pos = { x: t.pos.x + 1.5, y: t.pos.y + 1 }; a.strength = 1; }
  const own = w.colonies[0].ants.slice(0, 3);
  for (const a of own) { a.job = "guard"; a.pos = { x: t.pos.x - 1, y: t.pos.y }; }
  updateSiege(w);
  check("rival guards damage the totem", Math.abs(t.hp - (CONFIG.totemMaxHp - 4 * CONFIG.siegeDamagePerGuard)) < 1e-6, String(t.hp));
  for (const a of rivals) a.pos = { x: t.pos.x + 30, y: t.pos.y };
  const hp = t.hp; updateSiege(w);
  check("own guards do not damage it", t.hp === hp);
  for (const a of rivals) a.pos = { x: t.pos.x + 1.5, y: t.pos.y + 1 };
  w.tick = 1000; updateSprings(w);
  check("totem holds the spring", spring.holder === "colony-1");
  let ticks = 0;
  while (w.surface.buildings.includes(t) && ticks < 5000) { updateSiege(w); ticks++; }
  check("siege breaks the totem", !w.surface.buildings.includes(t), `${ticks} ticks with 4 guards`);
  check("broken totem is logged", w.session.events.some(e => e.text.includes("разрушен осадой")));
  check("land is gone with it", territoryOwnerAt(w.surface, { x: t.pos.x, y: t.pos.y }) !== "colony-1");
  w.tick = 1100; updateSprings(w);
  check("spring lost with the land", spring.holder !== "colony-1");
}

// Dominance.
{
  const w = fresh();
  const [s0, s1] = w.surface.springs!;
  totemAt(w, "colony-1", { x: s0.pos.x + 8, y: s0.pos.y }, "a1"); totemAt(w, "colony-1", { x: s1.pos.x + 8, y: s1.pos.y }, "a2");
  w.tick = 20000; updateSprings(w); updateOutcome(w);
  check("dominance starts", w.session.dominance?.holder === "colony-1" && w.session.dominance.since === 20000);
  w.tick = 20000 + CONFIG.dominanceTicks; updateObjectives(w); updateOutcome(w);
  check("no win before the minimum time", w.session.status === "playing");
  w.tick = CONFIG.matchMinTicks + CONFIG.dominanceTicks; w.session.dominance = { holder: "colony-1", since: CONFIG.matchMinTicks }; updateObjectives(w); updateOutcome(w);
  check("holding two springs a day wins", w.session.status === "victory" && w.session.reason.includes("источник"), w.session.reason);
  const r = fresh();
  const [r0, r1] = r.surface.springs!;
  totemAt(r, "colony-2", { x: r0.pos.x + 8, y: r0.pos.y }, "b1"); totemAt(r, "colony-2", { x: r1.pos.x + 8, y: r1.pos.y }, "b2");
  r.tick = CONFIG.matchMinTicks; updateSprings(r); updateOutcome(r);
  r.tick += CONFIG.dominanceTicks; updateOutcome(r);
  check("rival dominance is a defeat", r.session.status === "defeat" && r.session.reason.includes("Соседи"), r.session.reason);
}

// Finale.
{
  const w = fresh();
  check("finale rain is late", w.weather.bigRainAt === CONFIG.bigRainAtTicks && CONFIG.bigRainAtTicks > CONFIG.matchMinTicks);
  totemAt(w, "colony-1", { x: w.surface.springs![0].pos.x + 8, y: w.surface.springs![0].pos.y });
  w.tick = CONFIG.bigRainAtTicks + 5000; updateSprings(w);
  w.weather.bigRainDone = true; w.weather.bigRainSurvived = true;
  updateOutcome(w); updateObjectives(w); updateOutcome(w);
  check("stronger tribe wins the finale", w.session.finaleWon === true && w.session.status === "victory", `${JSON.stringify(w.session.finaleScores)} ${w.session.reason}`);
  const l = fresh();
  totemAt(l, "colony-2", { x: l.surface.springs![0].pos.x + 8, y: l.surface.springs![0].pos.y });
  l.tick = CONFIG.bigRainAtTicks + 5000; updateSprings(l);
  l.weather.bigRainDone = true; l.weather.bigRainSurvived = true;
  updateOutcome(l);
  check("weaker tribe loses the finale", l.session.status === "defeat" && l.session.reason.includes("соседи сильнее"), l.session.reason);
  check("score counts springs first", tribeScore(l, 1) > tribeScore(l, 0), `${tribeScore(l, 0)} vs ${tribeScore(l, 1)}`);
  const o = fresh();
  o.weather.bigRainAt = 15000; o.weather.bigRainDone = true; o.weather.bigRainSurvived = true; o.tick = 20000;
  updateOutcome(o);
  check("old save: early Big Rain decides nothing", o.session.status === "playing" && o.session.finaleWon === undefined);
}

// AI war.
{
  const w = fresh();
  const B = w.colonies[1], A = w.colonies[0];
  const spring = [...w.surface.springs!].sort((a, b) => Math.hypot(a.pos.x - B.surfaceEntrance.x, a.pos.y - B.surfaceEntrance.y) - Math.hypot(b.pos.x - B.surfaceEntrance.x, b.pos.y - B.surfaceEntrance.y))[0];
  const t = totemAt(w, A.id, { x: spring.pos.x + 7, y: spring.pos.y + 3 }, "player-totem");
  // A grown neighbour: enough people to field a war party.
  for (let i = 0; B.ants.length < CONFIG.aiWarMinGuards * 3 + 2; i++) B.ants.push({ ...B.ants[i % B.ants.length], id: `grown-${i}`, pos: { ...B.surfaceEntrance } });
  w.tick = CONFIG.aiWarAfterTicks + 100;
  check("AI goes to war against a totem by a spring", updateWar(w, 1) && B.colony.war?.targetId === t.id);
  check("AI moves its post next to the totem", !!B.colony.defensePost && Math.hypot(B.colony.defensePost.x - t.pos.x, B.colony.defensePost.y - t.pos.y) < 3.5);
  let hit = false, broke = -1;
  for (let i = 0; i < CONFIG.aiWarMaxTicks; i++) {
    step(w);
    if (t.hp < t.maxHp) hit = true;
    if (!w.surface.buildings.includes(t)) { broke = i; break; }
  }
  check("live: AI guards reach and hit the totem", hit, `hp ${t.hp.toFixed(0)}`);
  check("live: AI breaks the totem", broke >= 0, `after ${broke} ticks`);
  for (let i = 0; i < 200; i++) step(w);
  check("AI war ends after the totem falls", !B.colony.war && (B.colony.warCooldownUntil ?? 0) > w.tick);
}

// Defence: the player's guards at a post by the totem at its home spring fight the besiegers off.
{
  const w = fresh();
  const B = w.colonies[1], A = w.colonies[0];
  const spring = [...w.surface.springs!].sort((a, b) => Math.hypot(a.pos.x - A.surfaceEntrance.x, a.pos.y - A.surfaceEntrance.y) - Math.hypot(b.pos.x - A.surfaceEntrance.x, b.pos.y - A.surfaceEntrance.y))[0];
  const t = totemAt(w, A.id, { x: spring.pos.x + 7, y: spring.pos.y + 3 }, "defended-totem");
  for (let i = 0; B.ants.length < CONFIG.aiWarMinGuards * 3 + 2; i++) B.ants.push({ ...B.ants[i % B.ants.length], id: `grown-${i}`, pos: { ...B.surfaceEntrance } });
  for (let i = 0; A.ants.length < 20; i++) A.ants.push({ ...A.ants[i % A.ants.length], id: `a-grown-${i}`, pos: { ...A.surfaceEntrance } });
  A.colony.autoManage = false;
  A.colony.defensePost = { x: t.pos.x - 3, y: t.pos.y };
  A.colony.priorities = { clay: 1, wood: 1, stone: 0, build: 1, guard: 10, fish: 0 };
  for (const a of A.ants.slice(0, 10)) { a.job = "guard"; a.pos = { x: t.pos.x - 3 + (a.id.length % 3), y: t.pos.y + 1 }; }
  w.tick = CONFIG.aiWarAfterTicks + 100;
  // The neighbour has already decided to besiege this totem.
  B.colony.war = { targetId: t.id, since: w.tick };
  const deadB0 = B.ants.filter(a => a.state === "dead").length;
  let warEnded = false, fights = 0, weakest = Infinity;
  for (let i = 0; i < CONFIG.aiWarMaxTicks + 400; i++) {
    step(w);
    fights += A.ants.filter(a => a.state === "fight" && a.job === "guard").length;
    for (const a of B.ants) if (a.job === "guard" && a.state !== "dead") weakest = Math.min(weakest, a.energy);
    if (i > 50 && !B.colony.war) { warEnded = true; break; }
  }
  const fallenB = B.ants.filter(a => a.state === "dead").length - deadB0;
  check("defence: totem survives the war", w.surface.buildings.includes(t), `hp ${t.hp.toFixed(0)}`);
  check("defence: guards fight the besiegers at the post", fights > 0 && (fallenB > 0 || weakest < CONFIG.refuelEnergyThreshold), `fight ticks ${fights}, fallen ${fallenB}, weakest besieger energy ${weakest.toFixed(0)}`);
  check("defence: the siege is lifted", warEnded);
}

for (const f of ["./.dominance-snapshot.json", "./.dominance-genome-a.json", "./.dominance-genome-b.json", "./.dominance-genome-spider.json"]) fs.rmSync(f, { force: true });
console.log(failures ? `FAILURES: ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
