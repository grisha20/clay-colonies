import type { Vec2 } from "./types";

// The hearth is centred on the camp's world point. Deliveries are accepted
// outside this small footprint (dropPointRadius = 3); the whole camp is open.
export const HEARTH_RADIUS_X = 2.7;
export const HEARTH_RADIUS_Y = 1.45;

export function insideHearth(x: number, y: number, camp: Vec2): boolean {
  return ((x - camp.x) / HEARTH_RADIUS_X) ** 2 + ((y - camp.y) / HEARTH_RADIUS_Y) ** 2 < 1;
}

export function crossesHearth(fromX: number, fromY: number, toX: number, toY: number, camp: Vec2): boolean {
  const x = (fromX - camp.x) / HEARTH_RADIUS_X, y = (fromY - camp.y) / HEARTH_RADIUS_Y;
  const dx = (toX - fromX) / HEARTH_RADIUS_X, dy = (toY - fromY) / HEARTH_RADIUS_Y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSq)) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 < 1;
}

export function outsideHearth(pos: Vec2, camp: Vec2): Vec2 {
  const x = (pos.x - camp.x) / HEARTH_RADIUS_X, y = (pos.y - camp.y) / HEARTH_RADIUS_Y;
  const length = Math.hypot(x, y);
  return length > 0.00001
    ? { x: camp.x + x / length * (HEARTH_RADIUS_X + 0.05), y: camp.y + y / length * (HEARTH_RADIUS_Y + 0.05) }
    : { x: camp.x, y: camp.y + HEARTH_RADIUS_Y + 0.05 };
}
