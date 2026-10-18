import type { BuildingType } from "../../../../shared/types";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import { Rectangle, Texture } from "pixi.js";
import { spriteGrounding } from "./spriteGrounding";

let atlas: LoadedAtlas;
let fenceParts: { post: Texture; rail: Texture; clay: Texture };
const frames = { hut: 0, storage: 1, workshop: 2, idol: 3 };
export async function preloadBuildingArt(): Promise<void> {
  const [buildings, fence] = await Promise.all([loadSpriteAtlas("/assets/buildings/clay-v2/buildings-atlas.png"), loadSpriteAtlas("/assets/buildings/clay-v2/fences-atlas.png")]);
  atlas = buildings;
  atlas.textures.forEach(spriteGrounding);
  const source = fence.textures[0].source;
  // Register actual materials, never repeat a complete perspective panel.
  fenceParts = {
    post: new Texture({ source, frame: new Rectangle(328, 258, 65, 240) }),
    rail: new Texture({ source, frame: new Rectangle(210, 750, 225, 45) }),
    clay: new Texture({ source, frame: new Rectangle(170, 512, 140, 25) })
  };
}
export function getFenceParts() { return fenceParts; }
export function getBuildingArt(type: BuildingType, width: number) {
  const index = frames[type as keyof typeof frames];
  if (!atlas || index === undefined) throw new Error(`Building art unavailable: ${type}`);
  const texture = atlas.textures[index], box = atlas.data.frames[index];
  const ground = spriteGrounding(texture);
  return { texture, ground, anchorX: box.anchorX, anchorY: ground.bottom / texture.height, scale: width / texture.width };
}
