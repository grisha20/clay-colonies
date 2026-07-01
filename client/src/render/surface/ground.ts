import { Graphics, Sprite } from "pixi.js";
import type { Container } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import type { ViewBounds } from "../types";
import { getEnvironmentTextures } from "./environment";

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

function campDirtShapeValue(x: number, y: number, entrance: Vec2, index: number): number {
  const seed = index * 37 + Math.floor(entrance.x * 0.7 + entrance.y * 1.3);
  const angle = Math.atan2(y - entrance.y, x - entrance.x);
  const baseX = 42 + hash2(seed, 0, 601) * 12;
  const baseY = 30 + hash2(seed, 1, 602) * 9;
  const lobe =
    1 +
    Math.sin(angle * 3 + seed * 0.17) * (0.12 + hash2(seed, 2, 603) * 0.1) +
    Math.cos(angle * 5 + seed * 0.11) * (0.08 + hash2(seed, 3, 604) * 0.08) +
    Math.sin(angle * 8 + seed * 0.07) * 0.045;
  const dx = (x - entrance.x) / (baseX * lobe);
  const dy = (y - entrance.y) / (baseY * (1 + (lobe - 1) * 0.55));
  return dx * dx + dy * dy;
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

function drawPixelFleck(root: Graphics, x: number, y: number, size: number, color: number, alpha: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const s = Math.max(1, Math.round(size));
  root.rect(px, py, s, s).fill({ color, alpha });
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

  const textures = getEnvironmentTextures().terrain;
  const grassTexture = textures.grass;
  const dirtTexture = textures.dirt;
  const tileSize = 32;
  const pixelLeft = Math.floor((left * cell) / tileSize) * tileSize;
  const pixelRight = Math.ceil((right * cell) / tileSize) * tileSize;
  const pixelTop = Math.floor((top * cell) / tileSize) * tileSize;
  const pixelBottom = Math.ceil((bottom * cell) / tileSize) * tileSize;
  for (let y = pixelTop; y < pixelBottom; y += tileSize) {
    for (let x = pixelLeft; x < pixelRight; x += tileSize) {
      const tile = new Sprite(grassTexture);
      tile.position.set(x, y);
      tile.tint = 0xa0b85c;
      root.addChild(tile);
    }
  }

  const entrances = world.surface.entrances ?? [world.surface.entrance];
  const dirtStep = 8;
  const dirtLeft = Math.floor((left * cell) / dirtStep) * dirtStep;
  const dirtRight = Math.ceil((right * cell) / dirtStep) * dirtStep;
  const dirtTop = Math.floor((top * cell) / dirtStep) * dirtStep;
  const dirtBottom = Math.ceil((bottom * cell) / dirtStep) * dirtStep;
  const dirtEdge = new Graphics();
  for (let y = dirtTop; y < dirtBottom; y += dirtStep) {
    for (let x = dirtLeft; x < dirtRight; x += dirtStep) {
      const worldX = (x + dirtStep * 0.5) / cell;
      const worldY = (y + dirtStep * 0.5) / cell;
      let bestShape = Number.POSITIVE_INFINITY;
      for (let i = 0; i < entrances.length; i += 1) {
        const shape = campDirtShapeValue(worldX, worldY, entrances[i], i);
        if (shape < bestShape) {
          bestShape = shape;
        }
      }
      const edgeNoise = (hash2(Math.floor(worldX * 1.8), Math.floor(worldY * 1.8), 501) - 0.5) * 0.22;
      const shapeValue = bestShape + edgeNoise;
      const fringe = 1 - smoothStep(0.84, 1.18, shapeValue);
      const edgeBand = 1 - Math.min(1, Math.abs(shapeValue - 1) / 0.34);
      const keep = shapeValue < 1.05;
      if (!keep) {
        if (shapeValue < 1.38 && hash2(Math.floor(worldX * 3.5), Math.floor(worldY * 3.5), 503) > 0.72) {
          const px = x + hash2(worldX, worldY, 504) * dirtStep;
          const py = y + hash2(worldX, worldY, 505) * dirtStep;
          const r = 1.1 + hash2(worldX, worldY, 506) * 2.2;
          drawPixelFleck(dirtEdge, px, py, r, 0xc99c54, 0.45);
          if (hash2(worldX, worldY, 507) > 0.72) {
            drawPixelFleck(dirtEdge, px + r * 1.6, py - r * 0.4, r * 0.65, 0xe2bf73, 0.36);
          }
        }
        continue;
      }
      const tile = new Sprite(dirtTexture);
      tile.position.set(x, y);
      tile.scale.set(dirtStep / tileSize);
      if (shapeValue > 0.84) {
        tile.alpha = 0.7 + fringe * 0.3;
      }
      root.addChild(tile);
      if (shapeValue > 0.64 && edgeBand > 0 && hash2(Math.floor(worldX * 4), Math.floor(worldY * 4), 508) > 0.28 + edgeBand * 0.18) {
        const px = x + hash2(worldX, worldY, 509) * dirtStep;
        const py = y + hash2(worldX, worldY, 510) * dirtStep;
        drawPixelFleck(dirtEdge, px, py, 1 + hash2(worldX, worldY, 511) * 2.2, 0x87a23e, 0.82);
        if (edgeBand > 0.36 && hash2(worldX, worldY, 512) > 0.38) {
          drawPixelFleck(
            dirtEdge,
            px + (hash2(worldX, worldY, 513) - 0.5) * 9,
            py + (hash2(worldX, worldY, 514) - 0.5) * 9,
            1 + hash2(worldX, worldY, 515) * 2.6,
            hash2(worldX, worldY, 516) > 0.42 ? 0xa8c950 : 0x6f8c34,
            0.78
          );
        }
        if (edgeBand > 0.58 && hash2(worldX, worldY, 517) > 0.62) {
          drawPixelFleck(
            dirtEdge,
            px + (hash2(worldX, worldY, 518) - 0.5) * 13,
            py + (hash2(worldX, worldY, 519) - 0.5) * 13,
            1 + hash2(worldX, worldY, 520) * 1.8,
            0xbee264,
            0.64
          );
        }
      }
    }
  }
  root.addChild(dirtEdge);

  const ground = new Graphics();
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

  for (const entrance of entrances) {
    const x = entrance.x * cell;
    const y = entrance.y * cell;
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
