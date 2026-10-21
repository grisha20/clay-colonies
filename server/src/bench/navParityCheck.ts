// Parity of the indexed shared/surfaceNavigation.ts with the full-scan
// reference (bench/reference/surfaceNavigationReference.ts): point, segment
// and route answers must match exactly on real worlds — a late-match save
// with walls and gates (SPIKE_SNAPSHOT, optional) and fresh random maps with
// buildings and gates mutated between queries (index invalidation).
// Run: npm run check:navparity
export {};
process.env.GENOME_FILE = "./.navparity-genome-a.json";
process.env.GENOME_FILE_B = "./.navparity-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.navparity-genome-spider.json";
const fs = await import("node:fs");
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, worldFromSnapshot } = await import("../sim/world");
const { generateTerrain } = await import("../sim/terrainGen");
const { step } = await import("../sim/step");
const nav = await import("../../../shared/surfaceNavigation");
const ref = await import("./reference/surfaceNavigationReference");
type World = ReturnType<typeof createWorld>;

let failures = 0, checks = 0, routeCapped = 0;
function same(label: string, a: unknown, b: unknown): void {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures += 1;
    if (failures <= 10) console.log(`FAIL ${label}: indexed=${JSON.stringify(a)} reference=${JSON.stringify(b)}`);
  }
}

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return ((seed >>> 0) % 1_000_000) / 1_000_000; };

function probe(world: World, label: string, queries: number): void {
  const s = world.surface;
  const owners = [undefined, ...world.colonies.map(c => c.id)];
  const near = () => {
    const b = s.buildings[Math.floor(rnd() * s.buildings.length)];
    return b && rnd() < 0.7 ? { x: b.pos.x + (rnd() - 0.5) * 14, y: b.pos.y + (rnd() - 0.5) * 14 } : { x: rnd() * s.width, y: rnd() * s.height };
  };
  for (let i = 0; i < queries; i++) {
    const owner = owners[Math.floor(rnd() * owners.length)];
    const a = near(), b = rnd() < 0.8 ? { x: a.x + (rnd() - 0.5) * 8, y: a.y + (rnd() - 0.5) * 8 } : near();
    same(`${label} point`, nav.surfacePointOpen(s, a, owner), ref.surfacePointOpen(s, a, owner));
    same(`${label} line`, nav.surfaceLineOpen(s, a, b, owner), ref.surfaceLineOpen(s, a, b, owner));
    if (i % 20 === 0) {
      const r = nav.surfaceRoute(s, a, b, owner), q = ref.surfaceRoute(s, a, b, owner);
      if (r === null && q !== null) routeCapped += 1; // only allowed when the reference needed > cap cells
      else same(`${label} route`, r, q);
    }
  }
}

const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
if (process.env.SPIKE_SNAPSHOT && fs.existsSync(process.env.SPIKE_SNAPSHOT)) {
  const w = worldFromSnapshot(JSON.parse(fs.readFileSync(process.env.SPIKE_SNAPSHOT, "utf8")), genome, spider, genomeB);
  probe(w, "late-match", 6000);
}
for (const s of [7, 4242, 9716477]) {
  const w = createWorld(genome, spider, genomeB, generateTerrain(s).terrain);
  for (let i = 0; i < 4000; i++) step(w);
  probe(w, `seed ${s}`, 3000);
  // Mutate in place: new gate, a building finishing, one removed.
  const camp = w.colonies[0].surfaceEntrance;
  w.surface.buildings.push({ id: "parity-gate", colonyId: w.colonies[1].id, type: "gate", stage: "built", pos: { x: camp.x + 13, y: camp.y + 15 }, gateAxis: "vertical", gateSpan: 3, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 }, progress: 1, hp: 10, maxHp: 10 });
  const pending = w.surface.buildings.find(b => b.stage !== "built");
  if (pending) { pending.stage = "built"; nav.markObstaclesChanged(); }
  probe(w, `seed ${s} mutated`, 1500);
  w.surface.buildings.splice(0, 1);
  probe(w, `seed ${s} removed`, 1500);
}
console.log(`${checks} answers compared, ${failures} mismatches, ${routeCapped} routes stopped by the expansion cap`);
for (const f of ["./.navparity-genome-a.json", "./.navparity-genome-b.json", "./.navparity-genome-spider.json"]) fs.rmSync(f, { force: true });
process.exit(failures ? 1 : 0);
