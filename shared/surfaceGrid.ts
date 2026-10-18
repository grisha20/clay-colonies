import { WALL_CELL_SIZE, type Vec2 } from "./types";

/** Visit every crossed fence/water cell, including arbitrarily short clips
 * near corners. Point sampling can miss those and disagree with collision. */
export function surfaceGridLineOpen(from: Vec2, to: Vec2, open: (x: number, y: number) => boolean): boolean {
  let x = Math.floor(from.x / WALL_CELL_SIZE), y = Math.floor(from.y / WALL_CELL_SIZE);
  const endX = Math.floor(to.x / WALL_CELL_SIZE), endY = Math.floor(to.y / WALL_CELL_SIZE);
  const dx = to.x - from.x, dy = to.y - from.y, stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx ? WALL_CELL_SIZE / Math.abs(dx) : Infinity;
  const deltaY = dy ? WALL_CELL_SIZE / Math.abs(dy) : Infinity;
  let crossX = dx ? ((x + Number(dx > 0)) * WALL_CELL_SIZE - from.x) / dx : Infinity;
  let crossY = dy ? ((y + Number(dy > 0)) * WALL_CELL_SIZE - from.y) / dy : Infinity;
  if (!open((x + 0.5) * WALL_CELL_SIZE, (y + 0.5) * WALL_CELL_SIZE)) return false;
  while (x !== endX || y !== endY) {
    // An endpoint on a grid line belongs to its floor cell. Once an axis
    // reaches that cell, it must not step beyond the endpoint on a tie.
    if (x === endX) { y += stepY; crossY += deltaY; }
    else if (y === endY) { x += stepX; crossX += deltaX; }
    else if (Math.abs(crossX - crossY) < 1e-10) {
      // A resident has to round the corner, not squeeze through the single
      // mathematical point where two blocked cells meet. Such zero-width
      // paths reverse after tiny steering/rounding errors in a stepped fence.
      if (!open((x + stepX + 0.5) * WALL_CELL_SIZE, (y + 0.5) * WALL_CELL_SIZE) ||
          !open((x + 0.5) * WALL_CELL_SIZE, (y + stepY + 0.5) * WALL_CELL_SIZE)) return false;
      x += stepX; y += stepY; crossX += deltaX; crossY += deltaY;
    }
    else if (crossX < crossY) { x += stepX; crossX += deltaX; }
    else if (crossY < crossX) { y += stepY; crossY += deltaY; }
    if (!open((x + 0.5) * WALL_CELL_SIZE, (y + 0.5) * WALL_CELL_SIZE)) return false;
  }
  return true;
}
