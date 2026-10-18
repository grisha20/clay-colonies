import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import { preloadRoyalHeadgear } from "./royalHeadgear";

export const equipmentNames = ["axe", "pick", "hammer", "spear", "fishingRod", "waterGun", "clay", "wood", "stone", "tomato", "meat", "fish", "satchel", "leaf", "headband", "ball"] as const;
export type EquipmentKind = typeof equipmentNames[number];
let atlas: LoadedAtlas | undefined;
export async function preloadEquipmentArt(): Promise<void> {
  const [equipment] = await Promise.all([loadSpriteAtlas("/assets/characters/equipment/equipment-atlas.png"), preloadRoyalHeadgear()]);
  atlas = equipment;
}
export function getEquipmentArt(kind: EquipmentKind, extent: number) {
  if (!atlas) throw new Error("Equipment art not preloaded");
  const index = equipmentNames.indexOf(kind), texture = atlas.textures[index];
  return { texture, scale: extent / Math.max(texture.width, texture.height) };
}
