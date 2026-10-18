import { Container, Sprite } from "pixi.js";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import type { WorldSnapshot } from "../../../../shared/types";
import { buildingFootprint } from "../../../../shared/buildingGeometry";
import { surfacePointOpen } from "../../../../shared/surfaceNavigation";

let atlas: LoadedAtlas;
export async function preloadGardenArt(): Promise<void> { atlas = await loadSpriteAtlas("/assets/environment/clay-v2/garden-atlas.png"); }

export function buildingGardens(root: Container, world: WorldSnapshot, cell: number): void {
  for (const child of root.children.filter(c => c.label === "building_garden")) child.destroy({ children: true });
  for (const b of world.surface.buildings) {
    const f = buildingFootprint(b); if (!f) continue;
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI * 2 / 12 + Math.sin(f.x * 3 + f.y) * 0.12;
      // A worn door approach stays clear. Vegetation grows beside the wall.
      if (Math.sin(angle) > 0.45 && Math.abs(Math.cos(angle)) < 0.65) continue;
      const p = { x: f.x + Math.cos(angle) * (f.rx + 0.45 + i % 3 * 0.4), y: f.y + Math.sin(angle) * (f.ry + 0.5 + i % 3 * 0.25) };
      if (!surfacePointOpen(world.surface, p, b.colonyId)) continue;
      const index = (i + Math.floor(f.x + f.y)) % atlas.textures.length, texture = atlas.textures[index];
      const sprite = new Sprite(texture); sprite.anchor.set(0.5, 1);
      sprite.scale.set((index === 2 || index === 3 || index === 7 ? 8 : 10) / texture.height);
      sprite.position.set(p.x * cell, p.y * cell); sprite.zIndex = sprite.y; sprite.label = "building_garden";
      sprite.tint = 0xf4efdd; root.addChild(sprite);
    }
  }
}
