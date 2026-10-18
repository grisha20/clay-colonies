import type { Graphics } from "pixi.js";
import type { Vec2 } from "../../../../shared/types";

export type CampPileKind = "food" | "clay" | "wood" | "stone";
export const campPileRoots = { food: { x: -48, y: 29 }, clay: { x: 48, y: 31 }, wood: { x: -2, y: 44 }, stone: { x: -46, y: -12 } } as const;

/** Only soil and ash. Stock is drawn as independent depth-sorted sprites. */
export function drawSurfaceEntranceAt(ground: Graphics, pos: Vec2, cell: number, color: "dark" | "red"): void {
  const x = Math.round(pos.x * cell), y = Math.round(pos.y * cell);
  ground.ellipse(x, y + 3, 48, 28).fill({ color: 0x8a6a3c, alpha: 0.09 });
  ground.ellipse(x, y, 28, 13).fill({ color: color === "red" ? 0x8e5a35 : 0x80603a, alpha: 0.13 });
  ground.ellipse(x, y, 19, 7).fill({ color: 0x413321, alpha: 0.28 });
}
