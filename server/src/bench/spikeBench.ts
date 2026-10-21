// Replays a saved world headless and reports slow steps: the source of
// server step spikes seen in live QA (run with node --cpu-prof for a profile).
// Usage: SPIKE_SNAPSHOT=<path> tsx server/src/bench/spikeBench.ts [steps]
export {};
process.env.GENOME_FILE = "./.spike-genome-a.json";
process.env.GENOME_FILE_B = "./.spike-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.spike-genome-spider.json";
const fs = await import("node:fs");
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { worldFromSnapshot } = await import("../sim/world");
const { step } = await import("../sim/step");
const { obstacleIndexStats } = await import("../../../shared/surfaceNavigation");
const file = process.env.SPIKE_SNAPSHOT;
if (!file) throw new Error("SPIKE_SNAPSHOT is required");
const genome = await loadGenome(), spider = await loadSpiderGenome(), genomeB = await loadGenome(process.env.GENOME_FILE_B);
const world = worldFromSnapshot(JSON.parse(fs.readFileSync(file, "utf8")), genome, spider, genomeB);
const steps = Number(process.argv[2] ?? 2000);
const times: number[] = [];
let windowStart = 0, windowSum = 0;
for (let i = 0; i < steps; i++) {
  const t = performance.now();
  step(world);
  const ms = performance.now() - t;
  times.push(ms);
  windowSum += ms;
  if ((i + 1) % 200 === 0) {
    const alive = world.colonies.map(c => c.ants.length).join("/");
    console.log(`ticks ${world.tick - 199}-${world.tick}: avg ${(windowSum / 200).toFixed(2)}ms residents ${alive} enemies ${world.enemies.filter(e => e.hp > 0).length} weather ${world.weather.state} alarm ${world.colonies.map(c => c.colony.alarm ? 1 : 0).join("")}`);
    windowSum = 0; windowStart = i + 1;
  }
}
console.log(`steps over 20ms ${times.filter(t => t > 20).length}, over 50ms ${times.filter(t => t > 50).length}`);
times.sort((a, b) => a - b);
console.log(`obstacle index rebuilds ${obstacleIndexStats.builds} (changed in place ${obstacleIndexStats.changed})`);
console.log(`steps ${steps} p50 ${times[Math.floor(steps / 2)].toFixed(2)} p95 ${times[Math.floor(steps * 0.95)].toFixed(2)} max ${times[steps - 1].toFixed(2)}`);
for (const f of ["./.spike-genome-a.json", "./.spike-genome-b.json", "./.spike-genome-spider.json"]) fs.rmSync(f, { force: true });
