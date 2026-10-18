import type { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { buildingFootprint } from "../../../../shared/buildingGeometry";

/** Thin, feathered worn earth. No opaque oval or baked directional shadow. */
export function drawBuildingGround(g: Graphics, world: WorldSnapshot, cell: number): void {
  g.clear();
  for (const b of world.surface.buildings) {
    const f = buildingFootprint(b); if (!f) continue;
    const seed = f.x * 0.7 + f.y * 1.3;
    for (let band = 7; band >= 0; band--) {
      const points: number[] = [], spread = 1.05 + band * 0.1;
      for (let i = 0; i < 48; i++) {
        const a = i * Math.PI / 24, rough = 1 + Math.sin(a * 5 + seed) * 0.04 + Math.cos(a * 9 - seed) * 0.025;
        points.push((f.x + Math.cos(a) * f.rx * spread * rough) * cell, (f.y + Math.sin(a) * f.ry * spread * rough) * cell);
      }
      g.poly(points).fill({ color: 0xa58a51, alpha: 0.022 });
    }
    // Fine grains and clay crumbs share the ground palette and fade at the edge.
    for (let i = 0; i < 85; i++) {
      const a = i * 2.399963 + seed, radius = Math.sqrt((i + 0.5) / 85) * 1.65;
      const x = (f.x + Math.cos(a) * f.rx * radius) * cell, y = (f.y + Math.sin(a) * f.ry * radius) * cell;
      g.ellipse(x, y, 0.45 + (i % 3) * 0.15, 0.3).fill({ color: i % 4 ? 0x947a48 : 0xc7ac70, alpha: Math.max(0, 1 - radius / 1.8) * 0.2 });
    }
  }
}
