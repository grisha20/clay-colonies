import { mkdir, readFile, writeFile, rename, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { toDurableSnapshot, worldFromSnapshot, type World } from "../sim/world";
import type { SaveMeta, WorldSnapshot } from "../../../shared/types";

export async function loadWorldSnapshot(
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  genomeStateB: GenomeState = genomeState
): Promise<World | null> {
  for (const file of [CONFIG.snapshotFile, `${CONFIG.snapshotFile}.bak`]) {
    try {
      const raw = await readFile(file, "utf8");
      const snapshot = JSON.parse(raw) as WorldSnapshot;
      return worldFromSnapshot(snapshot, genomeState, spiderGenomeState, genomeStateB);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`Could not load ${file}: ${(error as Error).message}`);
    }
  }
  return null;
}

let isSaving = false;

export async function saveWorldSnapshot(world: World): Promise<void> {
  if (isSaving) {
    return;
  }
  isSaving = true;
  try {
    await mkdir(path.dirname(CONFIG.snapshotFile), { recursive: true });
    const temp = `${CONFIG.snapshotFile}.tmp`;
    await writeFile(temp, JSON.stringify(toDurableSnapshot(world)), "utf8");
    try { await copyFile(CONFIG.snapshotFile, `${CONFIG.snapshotFile}.bak`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rename(temp, CONFIG.snapshotFile);
  } finally {
    isSaving = false;
  }
}

// Named save slots live next to the autosave: <snapshot dir>/saves/<id>.json
// with a small <id>.meta.json for the start menu list. QA servers point
// SNAPSHOT_FILE elsewhere, so their slots never touch the player's saves.
const MAX_SAVES = 20;

export function savesDir(): string {
  return path.join(path.dirname(CONFIG.snapshotFile), "saves");
}

export async function listSaves(): Promise<SaveMeta[]> {
  let files: string[];
  try {
    files = await readdir(savesDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const metas: SaveMeta[] = [];
  for (const file of files.filter((f) => f.endsWith(".meta.json"))) {
    try {
      metas.push(JSON.parse(await readFile(path.join(savesDir(), file), "utf8")) as SaveMeta);
    } catch (error) {
      console.warn(`Skipping unreadable save meta ${file}: ${(error as Error).message}`);
    }
  }
  return metas.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVES);
}

export async function saveGameSlot(world: World, name?: string): Promise<SaveMeta> {
  // Serialise synchronously: a command right after (e.g. newGame) must not
  // replace the world before this save captured it.
  const data = JSON.stringify(toDurableSnapshot(world));
  const savedAt = Date.now();
  const id = `save-${savedAt.toString(36)}`;
  const meta: SaveMeta = {
    id,
    name: (name?.trim() || `Партия, шаг ${world.tick}`).slice(0, 40),
    tick: world.tick,
    savedAt,
    mapSeed: world.surface.terrain?.seed ?? 0,
    population: world.colonies.map((colony) => colony.ants.filter((ant) => ant.state !== "dead").length)
  };
  await mkdir(savesDir(), { recursive: true });
  const temp = path.join(savesDir(), `${id}.json.tmp`);
  await writeFile(temp, data, "utf8");
  await rename(temp, path.join(savesDir(), `${id}.json`));
  await writeFile(path.join(savesDir(), `${id}.meta.json`), JSON.stringify(meta), "utf8");
  return meta;
}

export async function loadGameSlot(
  id: string,
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  genomeStateB: GenomeState = genomeState
): Promise<World | null> {
  if (!/^save-[a-z0-9]{1,16}$/.test(id)) return null;
  try {
    const snapshot = JSON.parse(await readFile(path.join(savesDir(), `${id}.json`), "utf8")) as WorldSnapshot;
    return worldFromSnapshot(snapshot, genomeState, spiderGenomeState, genomeStateB);
  } catch (error) {
    console.warn(`Could not load save ${id}: ${(error as Error).message}`);
    return null;
  }
}
