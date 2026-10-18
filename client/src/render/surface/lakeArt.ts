import { Container, Graphics, Sprite } from "pixi.js";
import { lakeLilyPads, lakeMonsterResting } from "../../../../shared/lakeHabitat";
import type { WorldSnapshot } from "../../../../shared/types";
import type { ViewBounds } from "../types";
import { actorMotion, animationSeed } from "./motion";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";

let lilies: LoadedAtlas;
export async function preloadLakeArt(): Promise<void> { lilies = await loadSpriteAtlas("/assets/environment/clay-v2/lilies-atlas.png"); }
export function updateLakeDetails(root: Container, ripples: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  if (!root.children.length && lilies) {
    for (const id of ["north", "south"] as const) for (const [index, p] of lakeLilyPads(id).entries()) {
      const texture = lilies.textures[index % 4], leaf = new Sprite(texture);
      leaf.anchor.set(0.6, 0.62); leaf.scale.set(72 / texture.width); leaf.position.set(p.x * cell, p.y * cell);
      root.addChild(leaf);
    }
  }
  root.visible = true; ripples.clear();
  for (const enemy of world.enemies) {
    if (enemy.type !== "lakeMonster" || enemy.hp <= 0 || enemy.pos.x < bounds.left - 10 || enemy.pos.x > bounds.right + 10 || enemy.pos.y < bounds.top - 10 || enemy.pos.y > bounds.bottom + 10) continue;
    const rest = lakeMonsterResting(enemy, world.tick), pose = actorMotion.enemy(enemy), x = enemy.pos.x * cell, y = enemy.pos.y * cell;
    if (rest) continue;
    // The submerged mass stays visible as a faint silhouette, never a ground shadow.
    ripples.ellipse(x, y + 1, 26, 8).fill({ color: 0x234a3a, alpha: 0.12 });
    const phase = (actorMotion.time * 0.65 + animationSeed(enemy.id)) % 1;
    for (let i = 0; i < 2; i++) {
      const t = (phase + i * 0.5) % 1;
      ripples.ellipse(x, y + 2, 24 + t * 12, 6 + t * 5).stroke({ width: 0.8, color: 0xa6d3bc, alpha: (1 - t) * 0.23 });
    }
    if (pose.walk > 0.1) {
      const dx = Math.cos(pose.angle), dy = Math.sin(pose.angle), backX = x - dx * 17, backY = y - dy * 10;
      for (const side of [-1, 1]) ripples.moveTo(backX, backY)
        .quadraticCurveTo(backX - dx * 16 - dy * side * 11, backY - dy * 9 + dx * side * 5,
          backX - dx * 30 - dy * side * 20, backY - dy * 18 + dx * side * 10)
        .stroke({ width: 1, color: 0xc0e0cb, alpha: pose.walk * 0.3 });
    }
  }
}
