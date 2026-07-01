import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import type { ViewBounds } from "../types";

export function hash2(x: number, y: number, salt = 0): number {
  const value = Math.sin((x * 127.1 + y * 311.7 + salt * 74.7) * 0.0174533) * 43758.5453123;
  return value - Math.floor(value);
}

export function drawPebble(root: Graphics, x: number, y: number, size: number, shade: number): void {
  root.ellipse(x + size * 0.18, y + size * 0.22, size * 0.62, size * 0.45).fill({ color: 0x2f2923, alpha: 0.42 });
  root.ellipse(x, y, size * 0.68, size * 0.5).fill(shade);
  root.ellipse(x - size * 0.18, y - size * 0.16, size * 0.22, size * 0.13).fill({ color: 0xe0dcd1, alpha: 0.48 });
  root.ellipse(x + size * 0.22, y + size * 0.12, size * 0.28, size * 0.16).fill({ color: 0x69655f, alpha: 0.72 });
}

function distanceToNearest(pos: Vec2, points: Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dx = pos.x - point.x;
    const dy = pos.y - point.y;
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
  }
  return best;
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function terrainScore(x: number, y: number, salt = 0): number {
  return (
    hash2(Math.floor(x / 4), Math.floor(y / 4), 101 + salt) * 0.32 +
    hash2(Math.floor(x / 10), Math.floor(y / 10), 102 + salt) * 0.42 +
    hash2(Math.floor(x / 25), Math.floor(y / 25), 103 + salt) * 0.26
  );
}

function isCampOrFoodClearing(x: number, y: number, world: WorldSnapshot): number {
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  const foodSources = world.surface.foodSources ?? [];
  const campDistance = distanceToNearest({ x, y }, entrances);
  const foodDistance = distanceToNearest({ x, y }, foodSources.map((source) => source.pos));
  const camp = 1 - smoothStep(13, 30, campDistance);
  const food = 1 - smoothStep(6, 14, foodDistance);
  return Math.max(camp, food * 0.55);
}

function isWaterPatch(x: number, y: number, world: WorldSnapshot): boolean {
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  if (distanceToNearest({ x, y }, entrances) < 42) {
    return false;
  }
  const cx = Math.floor(x / 42);
  const cy = Math.floor(y / 42);
  if (hash2(cx, cy, 130) > 0.035) {
    return false;
  }
  const pondX = cx * 42 + 16 + hash2(cx, cy, 131) * 10;
  const pondY = cy * 42 + 14 + hash2(cx, cy, 132) * 12;
  const localX = x - pondX;
  const localY = y - pondY;
  const radiusX = 9 + hash2(cx, cy, 133) * 7;
  const radiusY = 6 + hash2(cx, cy, 134) * 5;
  const wobble = 0.82 + hash2(Math.floor(x / 3), Math.floor(y / 3), 135) * 0.34;
  return (localX * localX) / (radiusX * radiusX) + (localY * localY) / (radiusY * radiusY) < wobble;
}

function drawSoftBlob(root: Graphics, x: number, y: number, rx: number, ry: number, color: number, alpha: number): void {
  root.ellipse(x, y, rx, ry).fill({ color, alpha });
  root.ellipse(x - rx * 0.16, y - ry * 0.08, rx * 0.72, ry * 0.7).fill({ color: 0xf0d28d, alpha: alpha * 0.18 });
}

function drawGrassPatch(root: Graphics, x: number, y: number, rx: number, ry: number, seed: number): void {
  root.ellipse(x, y, rx, ry).fill({ color: 0x668f38, alpha: 0.5 });
  root.ellipse(x - rx * 0.18, y - ry * 0.12, rx * 0.72, ry * 0.68).fill({ color: 0x84ad4d, alpha: 0.34 });
  root.ellipse(x + rx * 0.18, y + ry * 0.1, rx * 0.62, ry * 0.56).fill({ color: 0x4f7d30, alpha: 0.22 });
  for (let i = 0; i < 18; i += 1) {
    const px = x + (hash2(seed, i, 151) - 0.5) * rx * 1.65;
    const py = y + (hash2(seed, i, 152) - 0.5) * ry * 1.45;
    const dot = 1.2 + hash2(seed, i, 153) * 2.4;
    root.circle(px, py, dot).fill({ color: hash2(seed, i, 154) > 0.45 ? 0x9ab75b : 0x456f2b, alpha: 0.32 });
  }
}

function drawPond(root: Graphics, x: number, y: number, rx: number, ry: number, seed: number): void {
  root.ellipse(x + 3, y + 5, rx * 1.13, ry * 1.16).fill({ color: 0x8f6c38, alpha: 0.28 });
  root.ellipse(x, y, rx, ry).fill(0x2f8fa5);
  root.ellipse(x - rx * 0.12, y - ry * 0.08, rx * 0.76, ry * 0.72).fill(0x3ca9bd);
  root.ellipse(x - rx * 0.32, y - ry * 0.28, rx * 0.28, ry * 0.12).fill({ color: 0xb7e0dc, alpha: 0.32 });
  for (let i = 0; i < 5; i += 1) {
    const px = x + (hash2(seed, i, 171) - 0.5) * rx * 1.25;
    const py = y + (hash2(seed, i, 172) - 0.5) * ry * 1.1;
    root.ellipse(px, py, 5 + hash2(seed, i, 173) * 7, 1.1).fill({ color: 0xb6e2df, alpha: 0.32 });
  }
}

function drawTinyPlants(root: Graphics, x: number, y: number, scale: number): void {
  const color = hash2(x, y, 41) > 0.5 ? 0x6d8d39 : 0x8aa64e;
  root.circle(x, y, scale * 0.42).fill({ color, alpha: 0.72 });
  root.circle(x + scale * 1.1, y - scale * 0.3, scale * 0.34).fill({ color: 0x9eb35c, alpha: 0.58 });
  root.circle(x - scale * 0.8, y + scale * 0.45, scale * 0.3).fill({ color: 0x4f762e, alpha: 0.55 });
}

function drawBush(root: Graphics, x: number, y: number, scale: number, berries = false): void {
  root.ellipse(x + scale * 2, y + scale * 5.5, scale * 13, scale * 4).fill({ color: 0x24190f, alpha: 0.2 });
  const greens = [0x3f792d, 0x4f8f33, 0x6fa13d, 0x2f6429];
  for (let i = 0; i < 9; i += 1) {
    const px = x + (hash2(x, y, 200 + i) - 0.5) * scale * 16;
    const py = y + (hash2(x, y, 220 + i) - 0.5) * scale * 10;
    const r = scale * (3.8 + hash2(x, y, 240 + i) * 2.8);
    root.circle(px, py, r).fill(greens[i % greens.length]);
    root.circle(px - r * 0.25, py - r * 0.3, r * 0.34).fill({ color: 0x8fba55, alpha: 0.28 });
  }
  if (berries) {
    for (let i = 0; i < 6; i += 1) {
      root.circle(
        x + (hash2(x, y, 260 + i) - 0.5) * scale * 14,
        y + (hash2(x, y, 280 + i) - 0.5) * scale * 8,
        scale * 1.15
      ).fill(0xc84a2d);
    }
  }
}

function drawRockCluster(root: Graphics, x: number, y: number, scale: number): void {
  root.ellipse(x + scale * 2, y + scale * 7, scale * 15, scale * 4.5).fill({ color: 0x24190f, alpha: 0.2 });
  for (let i = 0; i < 5; i += 1) {
    const px = x + (hash2(x, y, 300 + i) - 0.5) * scale * 18;
    const py = y + (hash2(x, y, 320 + i) - 0.25) * scale * 9;
    const rx = scale * (3.5 + hash2(x, y, 340 + i) * 4.8);
    const ry = scale * (2.8 + hash2(x, y, 360 + i) * 3.2);
    const shade = hash2(x, y, 380 + i) > 0.5 ? 0x8d8b82 : 0xa9a69b;
    root.ellipse(px, py, rx, ry).fill(0x5d5a54);
    root.ellipse(px - rx * 0.15, py - ry * 0.18, rx * 0.88, ry * 0.82).fill(shade);
    root.ellipse(px - rx * 0.32, py - ry * 0.36, rx * 0.26, ry * 0.18).fill({ color: 0xd8d2bf, alpha: 0.42 });
  }
}

function drawTree(root: Graphics, x: number, y: number, scale: number): void {
  root.ellipse(x + scale * 2, y + scale * 18, scale * 22, scale * 6).fill({ color: 0x24190f, alpha: 0.2 });
  root.rect(x - scale * 3, y - scale * 1, scale * 7, scale * 21).fill(0x6b3e20);
  root.rect(x - scale * 1.8, y - scale * 4, scale * 5, scale * 20).fill(0x8a5429);
  const crowns: Array<[number, number, number, number]> = [
    [-8, -18, 13, 0x4f8f34],
    [8, -18, 13, 0x5fa23b],
    [0, -28, 14, 0x6eaa42],
    [-15, -8, 11, 0x3f7a2d],
    [15, -7, 11, 0x4f8f34],
    [0, -9, 15, 0x578f34]
  ];
  for (const [dx, dy, radius, color] of crowns) {
    root.circle(x + dx * scale, y + dy * scale, radius * scale).fill(color);
    root.circle(x + (dx - radius * 0.28) * scale, y + (dy - radius * 0.28) * scale, radius * scale * 0.32).fill({ color: 0x9abf57, alpha: 0.26 });
  }
}

function drawLog(root: Graphics, x: number, y: number, scale: number, rotation = 0): void {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const pts = [
    [-12, -3],
    [13, -3],
    [13, 4],
    [-12, 4]
  ].map(([px, py]) => [x + (px * c - py * s) * scale, y + (px * s + py * c) * scale]);
  root.ellipse(x + scale * 2, y + scale * 5, scale * 15, scale * 3.5).fill({ color: 0x24190f, alpha: 0.18 });
  root.poly(pts.flat()).fill(0x6e421f);
  root.poly(pts.map(([px, py]) => [px, py - scale * 1.6]).flat()).fill({ color: 0x9b642e, alpha: 0.72 });
  root.circle(x - 12 * c * scale, y - 12 * s * scale, scale * 4).fill(0x5a321a);
  root.circle(x - 12 * c * scale, y - 12 * s * scale, scale * 2.2).fill(0xb37a3c);
}

export function drawLeaf(root: Graphics, x: number, y: number, scale: number, rotation: number): void {
  const dx = Math.cos(rotation);
  const dy = Math.sin(rotation);
  const color = hash2(x, y, 7) > 0.5 ? 0x7a6b24 : 0x3f7a2d;
  root.ellipse(x, y, scale * 2.7, scale * 1.05).fill({ color, alpha: 0.9 });
  root.setStrokeStyle({ width: 1, color: 0x2f3f1c, alpha: 0.5 });
  root.moveTo(x - dx * scale * 2.2, y - dy * scale * 2.2);
  root.lineTo(x + dx * scale * 2.2, y + dy * scale * 2.2);
  root.stroke();
}

function drawCrack(root: Graphics, x: number, y: number, scale: number): void {
  root.setStrokeStyle({ width: 1, color: 0x3b2816, alpha: 0.62 });
  root.moveTo(x, y);
  let cx = x;
  let cy = y;
  for (let step = 0; step < 4; step += 1) {
    cx += (hash2(x + step, y, 8) - 0.45) * scale * 4;
    cy += scale * (1.2 + hash2(x, y + step, 9) * 2);
    root.lineTo(cx, cy);
  }
  root.moveTo(x + scale * 1.2, y + scale * 2.2);
  root.lineTo(x + scale * (3 + hash2(x, y, 10) * 3), y + scale * (1.5 + hash2(x, y, 11) * 2));
  root.stroke();
}

export function drawSurfaceGround(root: Container, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  const width = world.surface.width;
  const height = world.surface.height;
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom));

  const ground = new Graphics();
  ground.rect(left * cell, top * cell, (right - left) * cell, (bottom - top) * cell).fill(0xd8ad63);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const noise = hash2(x, y, 1);
      const speckle = hash2(x, y, 2);
      const clearing = isCampOrFoodClearing(x + 0.5, y + 0.5, world);
      const water = isWaterPatch(x + 0.5, y + 0.5, world);
      if (!water && (clearing > 0.04 || speckle > 0.55)) {
        const color = noise < 0.28 ? 0xc99650 : noise > 0.82 ? 0xe6c074 : 0xd8ad63;
        const size = cell * (0.18 + hash2(x, y, 13) * 0.34);
        ground.rect((x + hash2(x, y, 14) * 0.75) * cell, (y + hash2(x, y, 15) * 0.75) * cell, size, size).fill({
          color,
          alpha: clearing > 0.04 ? 0.12 + clearing * 0.08 : 0.1
        });
      }

      if (!water && speckle > 0.982) {
        ground.rect(Math.round((x + 0.35) * cell), Math.round((y + 0.35) * cell), Math.max(1, Math.ceil(cell * 0.2)), Math.max(1, Math.ceil(cell * 0.2))).fill({ color: 0xf0d28d, alpha: 0.55 });
      } else if (speckle < 0.035) {
        ground.rect(Math.round((x + 0.45) * cell), Math.round((y + 0.45) * cell), Math.max(1, Math.ceil(cell * 0.16)), Math.max(1, Math.ceil(cell * 0.16))).fill({ color: 0x7f6135, alpha: 0.24 });
      }
    }
  }

  const patchLeft = Math.floor(left / 26) * 26;
  const patchRight = Math.ceil(right / 26) * 26;
  const patchTop = Math.floor(top / 26) * 26;
  const patchBottom = Math.ceil(bottom / 26) * 26;
  for (let gy = patchTop; gy <= patchBottom; gy += 26) {
    for (let gx = patchLeft; gx <= patchRight; gx += 26) {
      const cx = gx + 7 + hash2(gx, gy, 91) * 16;
      const cy = gy + 6 + hash2(gx, gy, 92) * 16;
      const edge = Math.max(
        1 - smoothStep(0, 28, cx),
        1 - smoothStep(0, 28, cy),
        smoothStep(width - 28, width, cx),
        smoothStep(height - 28, height, cy)
      );
      const clearing = isCampOrFoodClearing(cx, cy, world);
      const roll = terrainScore(gx, gy, 93) + edge * 0.38 - clearing * 0.72;
      if (roll > 0.62 && !isWaterPatch(cx, cy, world)) {
        const rx = cell * (7 + hash2(gx, gy, 94) * 8);
        const ry = cell * (4 + hash2(gx, gy, 95) * 6);
        drawGrassPatch(ground, cx * cell, cy * cell, rx, ry, gx * 997 + gy);
      }
    }
  }

  for (let gy = Math.floor(top / 42) * 42; gy <= bottom; gy += 42) {
    for (let gx = Math.floor(left / 42) * 42; gx <= right; gx += 42) {
      const cx = gx + 18 + hash2(gx, gy, 131) * 10;
      const cy = gy + 15 + hash2(gx, gy, 132) * 12;
      if (
        cx < left - 18 ||
        cx > right + 18 ||
        cy < top - 18 ||
        cy > bottom + 18 ||
        distanceToNearest({ x: cx, y: cy }, world.surface.entrances ?? [world.surface.entrance]) < 42 ||
        hash2(Math.floor(gx / 42), Math.floor(gy / 42), 130) > 0.035
      ) {
        continue;
      }
      drawPond(ground, cx * cell, cy * cell, cell * (8 + hash2(gx, gy, 133) * 6), cell * (5 + hash2(gx, gy, 134) * 4), gx * 811 + gy);
    }
  }
  root.addChild(ground);

  const decor = new Graphics();
  const chunkLeft = Math.floor(left / 8) * 8;
  const chunkRight = Math.ceil(right / 8) * 8;
  const chunkTop = Math.floor(top / 8) * 8;
  const chunkBottom = Math.ceil(bottom / 8) * 8;
  for (let gy = chunkTop; gy <= chunkBottom; gy += 8) {
    for (let gx = chunkLeft; gx <= chunkRight; gx += 8) {
      const roll = hash2(gx, gy, 20);
      const x = (gx + 1 + hash2(gx, gy, 21) * 6) * cell;
      const y = (gy + 1 + hash2(gx, gy, 22) * 6) * cell;
      if (x < left * cell - 24 || x > right * cell + 24 || y < top * cell - 24 || y > bottom * cell + 24) {
        continue;
      }
      if (isCampOrFoodClearing(gx + 4, gy + 4, world) > 0.25 || isWaterPatch(gx + 4, gy + 4, world)) {
        continue;
      }
      if (roll > 0.82 && roll <= 0.92) {
        drawTinyPlants(decor, x, y, cell * (0.42 + hash2(gx, gy, 25) * 0.28));
      } else if (roll < 0.014) {
        drawCrack(decor, x, y, cell * (0.45 + hash2(gx, gy, 29) * 0.55));
      } else if (roll > 0.965 && roll < 0.978) {
        drawSoftBlob(decor, x, y, cell * 1.9, cell * 0.68, 0xd0ae6a, 0.32);
      }
    }
  }

  root.addChild(decor);

  const propChunk = 16;
  for (let gy = Math.floor(top / propChunk) * propChunk; gy <= bottom; gy += propChunk) {
    for (let gx = Math.floor(left / propChunk) * propChunk; gx <= right; gx += propChunk) {
      const worldX = gx + 4 + hash2(gx, gy, 61) * 8;
      const worldY = gy + 5 + hash2(gx, gy, 62) * 8;
      if (
        worldX < left - 12 ||
        worldX > right + 12 ||
        worldY < top - 20 ||
        worldY > bottom + 20 ||
        isCampOrFoodClearing(worldX, worldY, world) > 0.12 ||
        isWaterPatch(worldX, worldY, world)
      ) {
        continue;
      }

      const roll = hash2(gx, gy, 60);
      const px = worldX * cell;
      const py = worldY * cell;
      if (roll > 0.972) {
        drawTree(decor, px, py, 1.05 + hash2(gx, gy, 64) * 0.18);
      } else if (roll > 0.918) {
        drawBush(decor, px, py, 1.05 + hash2(gx, gy, 67) * 0.22, hash2(gx, gy, 68) > 0.55);
      } else if (roll > 0.868) {
        drawRockCluster(decor, px, py, 1 + hash2(gx, gy, 69) * 0.22);
      } else if (roll > 0.824) {
        drawLog(decor, px, py, 1 + hash2(gx, gy, 71) * 0.15, (hash2(gx, gy, 72) - 0.5) * 0.6);
      }
    }
  }

  const entrances = world.surface.entrances ?? [world.surface.entrance];
  for (const entrance of entrances) {
    const x = entrance.x * cell;
    const y = entrance.y * cell;
    drawGrassPatch(decor, x - 138, y + 92, 76, 34, Math.round(x + y + 11));
    drawGrassPatch(decor, x + 146, y + 86, 70, 30, Math.round(x + y + 17));
    drawGrassPatch(decor, x - 42, y - 132, 62, 25, Math.round(x + y + 23));
    drawLog(decor, x - 82, y + 72, 1.18, -0.28);
    drawLog(decor, x + 85, y + 66, 1.12, 0.22);
    drawRockCluster(decor, x - 62, y + 52, 0.72);
    drawRockCluster(decor, x + 58, y + 50, 0.62);
    drawBush(decor, x - 154, y + 96, 0.72, true);
    drawBush(decor, x + 154, y + 92, 0.68, false);
    drawRockCluster(decor, x - 126, y - 88, 0.58);
    drawTree(decor, x - 202, y + 132, 0.82);
    drawTree(decor, x + 204, y + 128, 0.78);
    drawTinyPlants(decor, x - 112, y + 28, cell * 0.52);
    drawTinyPlants(decor, x + 116, y + 30, cell * 0.5);
  }
}
