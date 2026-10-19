import { writeFileSync } from "node:fs";
import { createWorld, toDurableSnapshot } from "../../server/src/sim/world";
import { randomGenome } from "../../server/src/ai/genome";
import { randomSpiderGenome } from "../../server/src/ai/spiderGenome";

const outPath = process.argv[2];
const tick = process.argv[3] ? parseInt(process.argv[3], 10) : 7777;

const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
const w = createWorld(
  g,
  { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 },
  structuredClone(g)
);
w.tick = tick;
const snap = toDurableSnapshot(w);
if (outPath) {
  writeFileSync(outPath, JSON.stringify(snap, null, 2), "utf8");
} else {
  process.stdout.write(JSON.stringify(snap));
}
