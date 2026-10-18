import type { Enemy } from "../../../../shared/types";
import type { ResidentPose } from "./motion";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";

const definitions = {
  spider: { url: "/assets/characters/creatures/spider-atlas.png", height: 54, shadowX: 29, shadowY: 10 },
  beetle: { url: "/assets/characters/creatures/beetle-atlas.png", height: 34, shadowX: 18, shadowY: 7 },
  lakeMonster: { url: "/assets/characters/creatures/lake-monster-atlas.png", height: 48, shadowX: 27, shadowY: 10 }
} as const;
const loaded = new Map<Enemy["type"], LoadedAtlas>();
export async function preloadCreatureArt(): Promise<void> {
  await Promise.all(Object.entries(definitions).map(async ([key, def]) => loaded.set(key as Enemy["type"], await loadSpriteAtlas(def.url))));
}
export function creatureDimensions(type: Enemy["type"]) { return definitions[type]; }
export function getCreatureArt(enemy: Enemy, pose: ResidentPose) {
  const atlas = loaded.get(enemy.type);
  if (!atlas) throw new Error(`Creature art not preloaded: ${enemy.type}`);
  const col = pose.look === "front" ? 0 : pose.look === "back" ? 2 : pose.facing < 0 ? 3 : 1;
  const anticipation = enemy.captiveId && pose.walk < 0.15 || enemy.type === "spider" && enemy.sprintLeft > 0 && Math.sin(pose.phase) > 0.5;
  const row = anticipation ? 3 : pose.legFrame === 1 ? 1 : pose.legFrame === 2 ? 2 : 0;
  const index = row * 4 + col, frame = atlas.data.frames[index];
  // This sheet's side poses switch orientation in row 3. Correct the facing
  // explicitly instead of showing a predator moving backward.
  const mirror = enemy.type === "lakeMonster" && ((col === 1 && row !== 2) || (col === 3 && row === 2));
  const referenceHeight = atlas.data.frames.slice(0, 4).reduce((sum, f) => sum + f.height, 0) / 4;
  return { texture: atlas.textures[index], anchorX: frame.anchorX, anchorY: 0.78,
    scale: definitions[enemy.type].height / referenceHeight, mirror };
}
