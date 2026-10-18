import type { BuildingType } from "../../../../shared/types";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import { Rectangle, Texture } from "pixi.js";

let atlas: LoadedAtlas;
let fence: LoadedAtlas, horizontalRail: Texture;
const frames = { hut: 0, storage: 1, workshop: 2, idol: 3 };
export async function preloadBuildingArt(): Promise<void> {
  [atlas, fence] = await Promise.all([loadSpriteAtlas("/assets/buildings/clay-v2/buildings-atlas.png"), loadSpriteAtlas("/assets/buildings/clay-v2/fences-atlas.png")]);
  const f = fence.textures[0].frame;
  horizontalRail = new Texture({ source: fence.textures[0].source, frame: new Rectangle(f.x + f.width / 3, f.y, f.width / 3, f.height) });
}
export function getFenceArt(gate: boolean, vertical: boolean, cell: number) {
  return { texture: gate ? fence.textures[vertical ? 3 : 2] : vertical ? fence.textures[1] : horizontalRail,
    width: cell * (gate ? vertical ? 2.4 : 4 : vertical ? 1.8 : 2.05),
    height: cell * (gate ? vertical ? 4.4 : 3.2 : vertical ? 4 : 2.85) };
}
export function getBuildingArt(type: BuildingType, width: number) {
  const index = frames[type as keyof typeof frames];
  if (!atlas || index === undefined) throw new Error(`Building art unavailable: ${type}`);
  const texture = atlas.textures[index], box = atlas.data.frames[index];
  return { texture, anchorX: box.anchorX, scale: width / texture.width };
}
