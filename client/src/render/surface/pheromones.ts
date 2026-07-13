import type { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { pheromoneAlpha } from "../spritePool";
import type { ViewBounds } from "../types";

type PheromoneDrawState = {
  food: WorldSnapshot["pheromones"]["food"];
  home: WorldSnapshot["pheromones"]["home"];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const drawStates = new WeakMap<Graphics, PheromoneDrawState>();

export function drawSurfacePheromones(pheromones: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  const left = Math.max(0, Math.floor(bounds.left / 3) * 3);
  const right = Math.min(world.pheromones.width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top / 3) * 3);
  const bottom = Math.min(world.pheromones.height, Math.ceil(bounds.bottom));
  const previous = drawStates.get(pheromones);
  if (
    previous &&
    previous.food === world.pheromones.food &&
    previous.home === world.pheromones.home &&
    previous.left === left && previous.right === right &&
    previous.top === top && previous.bottom === bottom
  ) {
    return;
  }
  drawStates.set(pheromones, { food: world.pheromones.food, home: world.pheromones.home, left, right, top, bottom });
  pheromones.clear();

  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      const index = y * world.pheromones.width + x;
      const foodValue = world.pheromones.food[index] ?? 0;
      const homeValue = world.pheromones.home[index] ?? 0;

      if (foodValue > 1.8) {
        pheromones.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell * 1.35), Math.ceil(cell * 1.35)).fill({
          color: 0x4f9f65,
          alpha: pheromoneAlpha(foodValue)
        });
      }
      if (homeValue > 1.8) {
        pheromones.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell * 1.35), Math.ceil(cell * 1.35)).fill({
          color: 0x557c9e,
          alpha: pheromoneAlpha(homeValue) * 0.55
        });
      }
    }
  }
}
