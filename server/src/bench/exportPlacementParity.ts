import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Writes godot/tests/fixtures/placement_parity.json: a generated world surface
// and placement queries answered by shared/buildingPlacement.ts and
// shared/fenceGeometry.ts. godot/scripts/game/build_rules.gd must agree.
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-placement-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, toSnapshot } = await import("../sim/world");
const { generateTerrain } = await import("../sim/terrainGen");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { step } = await import("../sim/step");
const { pointBuildingPlacement } = await import("../../../shared/buildingPlacement");
const { fencePlacement, gatePlacement } = await import("../../../shared/fenceGeometry");
const { setSurfaceTerrain, LEGACY_TERRAIN } = await import("../../../shared/surfaceTerrain");

let seed = 777;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
const w = createWorld(g, { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 }, structuredClone(g), generateTerrain(4242).terrain);
for (let i = 0; i < 1500; i++) step(w);
// A built totem per tribe (land beyond the camp disc) and a built kiln per
// tribe, so their footprints and land take part in the refusals.
const { placePointBuilding, completeBuilding } = await import("../sim/building");
for (const [index, colony] of w.colonies.entries()) {
  const camp = colony.surfaceEntrance, toward = Math.atan2(240 - camp.y, 240 - camp.x);
  for (let k = 0, placed = false; k < 12 && !placed; k++) {
    const a = toward + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.3;
    if (placePointBuilding(w, index, "totem", Math.round(camp.x + Math.cos(a) * 38), Math.round(camp.y + Math.sin(a) * 38))) {
      completeBuilding(w, w.surface.buildings[w.surface.buildings.length - 1]); placed = true;
    }
  }
  for (let r = 16, placed = false; r < 50 && !placed; r += 4) for (let k = 0; k < 16 && !placed; k++) {
    const a = k * Math.PI / 8;
    if (placePointBuilding(w, index, "kiln", Math.round(colony.surfaceEntrance.x + Math.cos(a) * r), Math.round(colony.surfaceEntrance.y + Math.sin(a) * r))) {
      completeBuilding(w, w.surface.buildings[w.surface.buildings.length - 1]); placed = true;
    }
  }
}
const surface = toSnapshot(w, false).surface;
const queries: Array<{ kind: string; x: number; y: number; axis?: string; owner: string; reason: string }> = [];
const owners = ["colony-1", "colony-2"];
const camps = surface.entrances;
// Mostly around camps and quarries, where the interesting refusals happen.
const spots = [...camps, ...(surface.deposits ?? []).map((d) => d.pos), ...surface.buildings.map((b) => b.pos), ...(surface.springs ?? []).map((sp) => sp.pos)];
for (let i = 0; i < 1200; i++) {
  const base = i % 4 === 0 ? { x: Math.random() * 480, y: Math.random() * 480 } : spots[i % spots.length];
  const x = Math.round((base.x + (Math.random() - 0.5) * 40) * 10) / 10, y = Math.round((base.y + (Math.random() - 0.5) * 40) * 10) / 10;
  const owner = owners[i % 2];
  const kind = ["hut", "storage", "workshop", "idol", "fence", "gate-h", "gate-v", "kiln", "totem"][i % 9];
  let reason: string | null;
  if (kind === "fence") reason = fencePlacement(surface, owner, { x, y });
  else if (kind.startsWith("gate")) reason = gatePlacement(surface, owner, { x, y }, kind === "gate-h" ? "horizontal" : "vertical");
  else reason = pointBuildingPlacement(surface, owner, kind as "hut", { x, y });
  queries.push({ kind, x, y, owner, reason: reason ?? "" });
}
setSurfaceTerrain(LEGACY_TERRAIN);
const out = path.resolve(import.meta.dirname, "../../../godot/tests/fixtures/placement_parity.json");
await writeFile(out, JSON.stringify({ surface, queries }));
const counts: Record<string, number> = {};
for (const q of queries) counts[q.reason || "ok"] = (counts[q.reason || "ok"] ?? 0) + 1;
console.log(`wrote ${queries.length} queries`, counts);
