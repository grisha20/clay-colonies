import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Terrain as world data: a world built on non-legacy terrain spawns everything
// against its own lakes, keeps them through save/load, and saves made before
// terrain existed continue on the legacy map.
const temp = await mkdtemp(path.join(os.tmpdir(), "clayfolk-terrain-"));
for (const key of ["SNAPSHOT_FILE", "GENOME_FILE", "GENOME_FILE_B", "SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp, key + ".json");
const { createWorld, toSnapshot, worldFromSnapshot, toNetworkSnapshot } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { step } = await import("../sim/step");
const { updateWildlife } = await import("../sim/wildlife");
const { updateFishPopulation } = await import("../sim/fishing");
const { lakePoints } = await import("../../../shared/lakeNavigation");
const { lakeLilyPads } = await import("../../../shared/lakeHabitat");
const { lakeShorePortals } = await import("../../../shared/amphibianNavigation");
const terrainModule = await import("../../../shared/surfaceTerrain");
const { LEGACY_TERRAIN, getSurfaceTerrain, isWaterAt, lakeIdAt, setSurfaceTerrain } = terrainModule;
type SurfaceTerrainData = import("../../../shared/surfaceTerrain").SurfaceTerrainData;
const { CONFIG } = await import("../config");
const { surfacePointOpen, surfaceRoute, surfaceLineOpen } = await import("../../../shared/surfaceNavigation");
const { pointBuildingPlacement } = await import("../../../shared/buildingPlacement");
const { isMountainAt, isTerrainBlockedAt, heightAt } = terrainModule;
const { generateTerrain } = await import("../sim/terrainGen");
const { listSaves, saveGameSlot, loadGameSlot } = await import("../state/snapshot");

let seed = 4242, passed = 0;
const originalRandom = Math.random;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

function ring(cx: number, cy: number, rx: number, ry: number, n = 28) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: Math.round((cx + Math.cos(a) * rx) * 10) / 10, y: Math.round((cy + Math.sin(a) * ry) * 10) / 10 };
  });
}
// Organic lakes well away from both camps (120/240, 360/240) and the quarries.
const custom: SurfaceTerrainData = {
  version: 1,
  seed: 77,
  lakes: [
    { id: "lake-a", seed: 11, outline: ring(240, 70, 34, 22) },
    { id: "lake-b", seed: 23, outline: ring(240, 420, 30, 24) },
    { id: "lake-c", seed: 37, outline: ring(430, 420, 20, 16) }
  ]
};
function genomes() {
  const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  const s = { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
  return [g, s, structuredClone(g)] as [typeof g, typeof s, typeof g];
}
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }

try {
  check("Местность: новый мир строится на собственных озёрах", () => {
    const [g, s, gb] = genomes();
    const w = createWorld(g, s, gb, custom);
    assert.equal(getSurfaceTerrain(), custom);
    assert.equal(w.surface.terrain, custom);
    assert.ok(isWaterAt(240, 70) && isWaterAt(240, 420) && isWaterAt(430, 420));
    assert.ok(!isWaterAt(238, 115) && !isWaterAt(237, 352), "legacy lakes are gone");
    const lakeIds = new Set(custom.lakes.map((l) => l.id));
    for (const id of lakeIds) assert.equal(w.surface.fish.filter((f) => f.lakeId === id).length, CONFIG.fishPerLake);
    assert.ok(w.surface.fish.every((f) => lakeIdAt(f.pos.x, f.pos.y) === f.lakeId), "fish swim in their own lake");
    const monsters = w.enemies.filter((e) => e.type === "lakeMonster");
    assert.deepEqual(new Set(monsters.map((m) => m.lakeId)), lakeIds);
    assert.ok(monsters.every((m) => lakeIdAt(m.pos.x, m.pos.y) === m.lakeId));
    assert.deepEqual(new Set(Object.keys(w.session.lakes)), lakeIds);
    assert.ok(w.surface.resourceNodes.every((n) => !isWaterAt(n.pos.x, n.pos.y)), "resources on land");
    assert.ok(w.surface.foodSources.every((f) => !isWaterAt(f.pos.x, f.pos.y)), "food on land");
  });

  check("Местность: производные кэши озёр пересчитываются при смене карты", () => {
    setSurfaceTerrain(custom);
    const points = lakePoints("lake-a");
    assert.ok(points.length > 20 && points.every((p) => lakeIdAt(p.x, p.y) === "lake-a"));
    assert.ok(lakeLilyPads("lake-a").length > 0);
    assert.ok(lakeShorePortals("lake-a").length > 0);
    assert.equal(lakePoints("north").length, 0, "legacy lake unknown on this map");
    setSurfaceTerrain(LEGACY_TERRAIN);
    assert.equal(lakePoints("lake-a").length, 0);
    assert.ok(lakePoints("north").length > 20);
  });

  check("Местность: сохраняется, загружается и уходит клиентам", () => {
    const [g, s, gb] = genomes();
    const w = createWorld(g, s, gb, custom);
    for (let i = 0; i < 40; i++) { step(w); updateWildlife(w); updateFishPopulation(w); }
    const snap = JSON.parse(JSON.stringify(toSnapshot(w, false)));
    setSurfaceTerrain(LEGACY_TERRAIN);
    const loaded = worldFromSnapshot(snap, g, s, gb);
    assert.deepEqual(loaded.surface.terrain, custom);
    assert.ok(isWaterAt(240, 70) && !isWaterAt(238, 115), "loading activates the saved terrain");
    const net = toNetworkSnapshot(loaded, false);
    assert.deepEqual(net.surface.terrain, custom);
  });

  check("Местность: старое сохранение без terrain продолжается на прежней карте", () => {
    const [g, s, gb] = genomes();
    const w = createWorld(g, s, gb);
    const snap = JSON.parse(JSON.stringify(toSnapshot(w, false)));
    delete snap.surface.terrain;
    setSurfaceTerrain(custom);
    const loaded = worldFromSnapshot(snap, g, s, gb);
    assert.equal(loaded.surface.terrain, LEGACY_TERRAIN);
    assert.ok(isWaterAt(238, 115) && isWaterAt(237, 352));
    assert.ok(loaded.surface.fish.every((f) => f.lakeId === "north" || f.lakeId === "south"));
    for (let i = 0; i < 20; i++) { step(loaded); updateWildlife(loaded); }
  });

  check("Горы: непроходимы, обходятся маршрутом, на них не строят и не спавнят", () => {
    const rocky: SurfaceTerrainData = {
      ...custom,
      seed: 78,
      // A rock wall across the meadow north of camp A with open ends.
      mountains: [{ id: "ridge", height: 9, outline: [{ x: 100, y: 196 }, { x: 140, y: 196 }, { x: 142, y: 206 }, { x: 98, y: 206 }] }],
      hills: [{ x: 300, y: 300, radius: 30, height: 3 }]
    };
    const [g, s, gb] = genomes();
    const w = createWorld(g, s, gb, rocky);
    assert.ok(isMountainAt(120, 200) && isTerrainBlockedAt(120, 200) && !isWaterAt(120, 200));
    assert.ok(heightAt(120, 200) > 4 && heightAt(300, 300) > 2.9 && heightAt(60, 60) === 0);
    assert.ok(w.surface.resourceNodes.every((n) => !isMountainAt(n.pos.x, n.pos.y)), "no resources in rock");
    assert.ok(w.surface.foodSources.every((f) => !isMountainAt(f.pos.x, f.pos.y)), "no food in rock");
    assert.equal(surfacePointOpen(w.surface, { x: 120, y: 201 }, "colony-1"), false);
    assert.equal(surfaceLineOpen(w.surface, { x: 120, y: 190 }, { x: 120, y: 212 }, "colony-1"), false);
    const route = surfaceRoute(w.surface, { x: 120, y: 188 }, { x: 120, y: 214 }, "colony-1");
    assert.ok(route && route.length > 1, "route detours around the ridge");
    let prev = { x: 120, y: 188 };
    for (const p of route!) { assert.ok(surfaceLineOpen(w.surface, prev, p, "colony-1")); prev = p; }
    assert.equal(pointBuildingPlacement(w.surface, "colony-1", "hut", { x: 120, y: 201 }), "Основание упирается в скалы");
    for (let i = 0; i < 300; i++) step(w);
    assert.ok(w.ants.every((a) => a.layer !== "surface" || !isMountainAt(a.pos.x, a.pos.y)), "no resident inside rock");
  });

  check("Генератор: 60 случайных карт — углы, озёра, горы, связность", () => {
    let totalAttempts = 0;
    for (let seedNo = 1; seedNo <= 60; seedNo++) {
      const { terrain, attempts } = generateTerrain(seedNo * 7919);
      totalAttempts += attempts;
      const [c1, c2] = terrain.camps!;
      assert.ok(Math.hypot(c1.x - c2.x, c1.y - c2.y) > 300, `camps far apart (seed ${seedNo})`);
      assert.ok(terrain.lakes.length >= 2 && terrain.lakes.length <= 4);
      assert.ok((terrain.mountains ?? []).length >= 2);
      setSurfaceTerrain(terrain);
      for (const camp of terrain.camps!) {
        for (let a = 0; a < 16; a++) assert.ok(!isTerrainBlockedAt(camp.x + Math.cos(a * Math.PI / 8) * 24, camp.y + Math.sin(a * Math.PI / 8) * 24), "camp clearing is open");
      }
      // Fair quarries: each camp has its own clay and stone at the same distance.
      const sites = terrain.depositSites!;
      for (const [i, camp] of terrain.camps!.entries()) {
        const suffix = i === 0 ? "a" : "b";
        for (const kind of ["clay", "stone"]) {
          const site = sites.find((d) => d.id === `${kind}-${suffix}`)!;
          assert.ok(site, `${kind}-${suffix} exists`);
          const d = Math.hypot(site.x - camp.x, site.y - camp.y);
          assert.ok(d >= 38 && d <= 50, `${kind}-${suffix} distance ${d}`);
        }
      }
    }
    setSurfaceTerrain(LEGACY_TERRAIN);
    assert.ok(totalAttempts < 60 * 4, `generator rarely retries (${totalAttempts} attempts)`);
    assert.deepEqual(generateTerrain(12345).terrain, generateTerrain(12345).terrain, "same seed, same map");
  });

  check("Генератор: партия на случайной карте играется и честна к обоим племенам", () => {
    for (const mapSeed of [101, 202, 303]) {
      const [g, s, gb] = genomes();
      const terrain = generateTerrain(mapSeed).terrain;
      const w = createWorld(g, s, gb, terrain);
      assert.deepEqual(w.surface.entrances, terrain.camps!.map((c) => ({ x: c.x, y: c.y })));
      assert.deepEqual(w.colonies.map((c) => c.surfaceEntrance), w.surface.entrances);
      const trees = w.surface.resourceNodes.filter((n) => n.kind === "tree");
      assert.ok(trees.length > 150, `woodland is dense (${trees.length} trees)`);
      assert.ok(w.surface.resourceNodes.every((n) => !isTerrainBlockedAt(n.pos.x, n.pos.y)));
      for (const camp of w.surface.entrances) {
        const near = (kind: string) => (w.surface.deposits ?? []).filter((d) => d.kind === kind && Math.hypot(d.pos.x - camp.x, d.pos.y - camp.y) < 70).length;
        assert.ok(near("clay") >= 1 && near("stone") >= 1, "each camp has both quarries nearby");
        assert.ok(w.surface.buildings.filter((b) => Math.hypot(b.pos.x - camp.x, b.pos.y - camp.y) < 30).length === 3, "starter huts and store");
      }
      for (let i = 0; i < 400; i++) { step(w); updateWildlife(w); updateFishPopulation(w); }
      assert.ok(w.ants.every((a) => a.layer !== "surface" || !isMountainAt(a.pos.x, a.pos.y)));
    }
    setSurfaceTerrain(LEGACY_TERRAIN);
  });

  {
    // Save slots: a named save keeps the generated map and is listed for the start menu.
    const [g, s2, gb] = genomes();
    const w = createWorld(g, s2, gb, generateTerrain(555).terrain);
    for (let i = 0; i < 30; i++) step(w);
    assert.deepEqual(await listSaves(), []);
    const meta = await saveGameSlot(w, "Тестовая");
    const list = await listSaves();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Тестовая");
    assert.equal(list[0].tick, w.tick);
    assert.equal(list[0].mapSeed, 555);
    setSurfaceTerrain(LEGACY_TERRAIN);
    const loaded = await loadGameSlot(meta.id, g, s2, gb);
    assert.ok(loaded);
    assert.equal(loaded!.tick, w.tick);
    assert.deepEqual(loaded!.surface.terrain, w.surface.terrain);
    assert.equal(getSurfaceTerrain().seed, 555, "loading activates the save's map");
    assert.equal(await loadGameSlot("../snapshot", g, s2, gb), null, "ids cannot escape the saves folder");
    passed++; console.log("PASS  Сохранения: слот сохраняет случайную карту, виден в списке и загружается");
  }

  console.log(`${passed} passed, 0 failed.`);
} finally {
  Math.random = originalRandom;
  setSurfaceTerrain(LEGACY_TERRAIN);
  await rm(temp, { recursive: true, force: true });
}
