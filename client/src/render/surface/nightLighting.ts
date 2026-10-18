import { Texture, type Sprite } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { nightOpacityAt, surfaceLighting } from "./lighting";

const masks = new WeakMap<Sprite, { key: string; canvas: HTMLCanvasElement; texture: Texture }>();

export function updateNightVeil(veil: Sprite, world: WorldSnapshot, cell: number): void {
  const lighting = surfaceLighting(world, cell);
  veil.visible = lighting.darkness > 0;
  if (!veil.visible) return;
  const darkness = Math.round(lighting.darkness * 100) / 100;
  const lights = lighting.lights.map(light => ({ ...light, radius: Math.round(light.radius), fire: Math.round(light.fire * 50) / 50 }));
  const width = Math.ceil(world.surface.width), height = Math.ceil(world.surface.height);
  const key = `${width}:${height}:${cell}:${darkness}:${lights.map(l => `${l.x},${l.y},${l.radius},${l.fire}`).join("|")}`;
  let mask = masks.get(veil);
  if (mask?.key === key) return;
  if (!mask || mask.canvas.width !== width || mask.canvas.height !== height) {
    mask?.texture.destroy(true);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const texture = Texture.from(canvas); texture.source.scaleMode = "linear";
    mask = { key: "", canvas, texture }; masks.set(veil, mask); veil.texture = texture;
  }
  const ctx = mask.canvas.getContext("2d")!, pixels = ctx.createImageData(width, height);
  const sample = { ...lighting, darkness, lights };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels.data[i] = 21; pixels.data[i + 1] = 36; pixels.data[i + 2] = 61;
      pixels.data[i + 3] = Math.round(nightOpacityAt(sample, (x + 0.5) * cell, (y + 0.5) * cell) * 255);
    }
  }
  ctx.putImageData(pixels, 0, 0); mask.texture.source.update(); mask.key = key;
  veil.width = world.surface.width * cell; veil.height = world.surface.height * cell;
}
