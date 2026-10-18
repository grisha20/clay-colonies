import type { BuildingType } from "../../../../shared/types";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";

let atlas: LoadedAtlas;
const frames = { hut: 0, storage: 1, workshop: 2, idol: 3 };
export async function preloadBuildingArt(): Promise<void> { atlas = await loadSpriteAtlas("/assets/buildings/clay-v2/buildings-atlas.png"); }
export function getBuildingArt(type: BuildingType, width: number) {
  const index = frames[type as keyof typeof frames];
  if (!atlas || index === undefined) throw new Error(`Building art unavailable: ${type}`);
  const texture = atlas.textures[index], box = atlas.data.frames[index];
  return { texture, anchorX: box.anchorX, scale: width / texture.width };
}
