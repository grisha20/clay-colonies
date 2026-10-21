import { writeFile } from "node:fs/promises";
import path from "node:path";

// Writes godot/tests/fixtures/terrain_parity.json: one generated terrain plus
// sample points with the reference answers of shared/surfaceTerrain.ts. The
// Godot port (surface_terrain.gd) must reproduce them exactly.
const { generateTerrain } = await import("../sim/terrainGen");
const { setSurfaceTerrain, isWaterAt, isMountainAt, heightAt, LEGACY_TERRAIN } = await import("../../../shared/surfaceTerrain");
const terrain = generateTerrain(20261021).terrain;
setSurfaceTerrain(terrain);
const samples: Array<{ x: number; y: number; water: boolean; mountain: boolean; height: number }> = [];
const add = (x: number, y: number) => samples.push({ x, y, water: isWaterAt(x, y), mountain: isMountainAt(x, y), height: Math.round(heightAt(x, y) * 1e5) / 1e5 });
for (let y = 3; y < 480; y += 12) for (let x = 5; x < 480; x += 12) add(x, y);
// Dense samples around every mountain and lake edge, where ports usually diverge.
for (const shape of [...terrain.lakes, ...(terrain.mountains ?? [])]) for (const p of shape.outline) for (const d of [-1.3, 0.4, 2.7]) add(p.x + d, p.y - d * 0.6);
setSurfaceTerrain(LEGACY_TERRAIN);
const out = path.resolve(import.meta.dirname, "../../../godot/tests/fixtures/terrain_parity.json");
await writeFile(out, JSON.stringify({ terrain, samples }));
console.log(`wrote ${samples.length} samples to ${out}`);
