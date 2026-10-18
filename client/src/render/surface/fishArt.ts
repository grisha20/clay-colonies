import type { FishSpecies } from "../../../../shared/types";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";

export const fishAtlasUrl = "/assets/characters/fish/fish-atlas.png";
let atlas: LoadedAtlas;
const rows: Record<FishSpecies, number> = { gold: 0, blue: 1, silver: 2, red: 3 };
export async function preloadFishArt(): Promise<void> { atlas = await loadSpriteAtlas(fishAtlasUrl); }
export function getFishArt(species: FishSpecies, frame = 0, carried = false, extent = carried ? 12 : 25) {
  if (!atlas) throw new Error("Fish art not preloaded");
  const row = rows[species], col = carried ? 3 : [0, 1, 0, 2][frame % 4];
  const index = row * 4 + col, texture = atlas.textures[index], box = atlas.data.frames[index];
  const referenceHeight = atlas.data.frames.slice(row * 4, row * 4 + 3).reduce((sum, f) => sum + f.height, 0) / 3;
  return { texture, scale: extent / (carried ? Math.max(texture.width, texture.height) : referenceHeight),
    anchorX: carried ? 0.5 : box.anchorX,
    anchorY: carried ? 0.5 : ((row + 0.5) * atlas.data.imageHeight / 4 - box.y) / box.height };
}
