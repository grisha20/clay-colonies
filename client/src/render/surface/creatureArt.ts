import type { Enemy } from "../../../../shared/types";
import type { ResidentPose } from "./motion";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import { preloadLakeArt } from "./lakeArt";
import { lakeMonsterResting } from "../../../../shared/lakeHabitat";
import { Rectangle, Texture } from "pixi.js";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { spriteGrounding } from "./spriteGrounding";

const definitions = {
  spider: { url: "/assets/characters/creatures/spider-atlas.png", height: 54, shadowX: 29, shadowY: 10 },
  beetle: { url: "/assets/characters/creatures/beetle-atlas.png", height: 34, shadowX: 18, shadowY: 7 },
  lakeMonster: { url: "/assets/characters/creatures/lake-monster-atlas.png", height: 48, shadowX: 27, shadowY: 10 }
} as const;
const loaded = new Map<Enemy["type"], LoadedAtlas>();
let swimming: LoadedAtlas;
const swimParts = new Map<number, { body: Texture; tail: Texture }>();
export async function preloadCreatureArt(): Promise<void> {
  await Promise.all(Object.entries(definitions).map(async ([key, def]) => loaded.set(key as Enemy["type"], await loadSpriteAtlas(def.url))));
  [swimming] = await Promise.all([loadSpriteAtlas("/assets/characters/creatures/lake-swim-atlas.png"), preloadLakeArt()]);
  for (const atlas of loaded.values()) atlas.textures.forEach(spriteGrounding);
}
export function creatureDimensions(type: Enemy["type"]) { return definitions[type]; }
export function getSpiderCarcassArt() {
  const atlas = loaded.get("spider")!;
  return { texture: atlas.textures[0], scale: definitions.spider.height / atlas.data.frames[0].height };
}
export function getCreatureArt(enemy: Enemy, pose: ResidentPose, tick = 0) {
  if (enemy.type === "lakeMonster" && isWaterAt(enemy.pos.x,enemy.pos.y)) {
    const col = pose.look === "front" ? 0 : pose.look === "back" ? 2 : pose.facing < 0 ? 3 : 1;
    const resting = lakeMonsterResting(enemy, tick), index = (resting ? 4 : 0) + col;
    const frame = swimming.data.frames[index];
    const width = col % 2 ? 70 : 47;
    if (!resting && col % 2) {
      const parts = lakeSwimParts(col);
      return { texture: parts.body, anchorX: 0.5 / 0.76, anchorY: 0.96, scale: width / frame.width, mirror: col === 1 };
    }
    return { texture: swimming.textures[index], anchorX: 0.5, anchorY: resting ? 0.7 : 0.96, scale: width / frame.width, mirror: col === 1 };
  }
  const atlas = loaded.get(enemy.type);
  if (!atlas) throw new Error(`Creature art not preloaded: ${enemy.type}`);
  const col = pose.look === "front" ? 0 : pose.look === "back" ? 2 : pose.facing < 0 ? 3 : 1;
  const anticipation = enemy.captiveId && pose.walk < 0.15 || enemy.type === "spider" && enemy.sprintLeft > 0 && Math.sin(pose.phase) > 0.5;
  const row = anticipation ? 3 : pose.legFrame === 1 ? 1 : pose.legFrame === 2 ? 2 : 0;
  const index = row * 4 + col, frame = atlas.data.frames[index];
  const referenceHeight = atlas.data.frames.slice(0, 4).reduce((sum, f) => sum + f.height, 0) / 4;
  const ground = spriteGrounding(atlas.textures[index]);
  return { texture: atlas.textures[index], ground, anchorX: frame.anchorX, anchorY: ground.bottom / frame.height,
    scale: definitions[enemy.type].height / referenceHeight, mirror: false };
}

function lakeSwimParts(column: number) {
  let parts = swimParts.get(column);
  if (!parts) {
    const original = swimming.textures[column], f = original.frame;
    parts = { body: new Texture({ source: original.source, frame: new Rectangle(f.x, f.y, f.width * 0.76, f.height) }),
      tail: new Texture({ source: original.source, frame: new Rectangle(f.x + f.width * 0.68, f.y, f.width * 0.32, f.height) }) };
    swimParts.set(column, parts);
  }
  return parts;
}
export function lakeTailArt(enemy: Enemy, pose: ResidentPose, tick: number) {
  if (enemy.type !== "lakeMonster" || !isWaterAt(enemy.pos.x,enemy.pos.y) || pose.look !== "side" || lakeMonsterResting(enemy, tick)) return null;
  const col = pose.facing < 0 ? 3 : 1;
  return { texture: lakeSwimParts(col).tail, scale: 70 / swimming.data.frames[col].width, mirror: col === 1, offsetX: 70 * 0.18 };
}
