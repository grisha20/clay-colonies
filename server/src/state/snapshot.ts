import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { toDurableSnapshot, worldFromSnapshot, type World } from "../sim/world";
import type { WorldSnapshot } from "../../../shared/types";

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
