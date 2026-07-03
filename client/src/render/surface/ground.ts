import { Container, Graphics, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
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

type ForestTree = {
  x: number;
  y: number;
  scale: number;
  texture: Texture;
  tint: number;
};

function addAssetTree(root: Container, tree: ForestTree): void {
  const shadow = new Graphics();
  shadow.ellipse(tree.x + tree.scale * 8, tree.y - tree.scale * 2, tree.scale * 54, tree.scale * 14).fill({ color: 0x1d160d, alpha: 0.24 });
  shadow.ellipse(tree.x - tree.scale * 3, tree.y - tree.scale * 5, tree.scale * 35, tree.scale * 8).fill({ color: 0x1d160d, alpha: 0.1 });
  root.addChild(shadow);

  const sprite = new Sprite(tree.texture);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(tree.x, tree.y);
  sprite.scale.set(tree.scale);
  sprite.tint = tree.tint;
  root.addChild(sprite);
}

function addAssetProp(
  root: Container,
  texture: Texture,
  x: number,
  y: number,
  scale: number,
  rotation = 0,
  tint = 0xffffff
): void {
  const shadow = new Graphics();
  shadow.ellipse(x + scale * 4, y - scale * 2, scale * 18, scale * 5).fill({ color: 0x1d160d, alpha: 0.18 });
  root.addChild(shadow);

  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(x, y);
  sprite.scale.set(scale);
  sprite.rotation = rotation;
  sprite.tint = tint;
  root.addChild(sprite);
}

function drawForestBorder(root: Container, world: WorldSnapshot, cell: number): void {
  const props = getEnvironmentTextures().props;
  const textures = [props.treeTall, props.treeRound, props.treeWide];
  const trees: ForestTree[] = [];
  const widthPx = world.surface.width * cell;
  const heightPx = world.surface.height * cell;

  function addTree(tileX: number, tileY: number, seed: number): void {
    const jitterX = (hash2(seed, 0, 701) - 0.5) * cell * 4;
    const jitterY = (hash2(seed, 0, 702) - 0.5) * cell * 3;
    const texture = textures[Math.floor(hash2(seed, 0, 703) * textures.length) % textures.length];
    const scale = 0.78 + hash2(seed, 0, 704) * 0.24;
    const tintRoll = hash2(seed, 0, 705);
    const tint = tintRoll > 0.66 ? 0xe1ffbf : tintRoll > 0.33 ? 0xc9ef9a : 0xb8dc82;
    trees.push({
      x: tileX * cell + jitterX,
      y: tileY * cell + jitterY,
      scale,
      texture,
      tint
    });
  }

  const borderTrees: Array<[number, number, number]> = [
    [17, 30, 10],
    [30, 50, 11],
    [18, 72, 12],
    [31, 96, 13],
    [17, 121, 14],
    [30, 146, 15],
    [18, 171, 16],
    [31, 196, 17],
    [17, 222, 18],
    [30, 248, 19],
    [18, 274, 20],
    [31, 300, 21],
    [17, 326, 22],
    [30, 352, 23],
    [18, 378, 24],
    [31, 404, 25],
    [17, 430, 26],
    [30, 455, 27],
    [20, 38, 30],
    [48, 35, 31],
    [77, 41, 32],
    [107, 36, 33],
    [137, 42, 34],
    [168, 37, 35],
    [199, 43, 36],
    [230, 36, 37],
    [261, 42, 38],
    [292, 37, 39],
    [323, 43, 40],
    [354, 36, 41],
    [385, 42, 42],
    [416, 37, 43],
    [447, 43, 44],
    [world.surface.width - 17, 30, 50],
    [world.surface.width - 30, 53, 51],
    [world.surface.width - 18, 77, 52],
    [world.surface.width - 31, 102, 53],
    [world.surface.width - 17, 127, 54],
    [world.surface.width - 30, 152, 55],
    [world.surface.width - 18, 177, 56],
    [world.surface.width - 31, 202, 57],
    [world.surface.width - 17, 228, 58],
    [world.surface.width - 30, 254, 59],
    [world.surface.width - 18, 280, 60],
    [world.surface.width - 31, 306, 61],
    [world.surface.width - 17, 332, 62],
    [world.surface.width - 30, 358, 63],
    [world.surface.width - 18, 384, 64],
    [world.surface.width - 31, 410, 65],
    [world.surface.width - 17, 436, 66],
    [world.surface.width - 30, 458, 67],
    [22, world.surface.height - 6, 70],
    [52, world.surface.height - 17, 71],
    [82, world.surface.height - 7, 72],
    [112, world.surface.height - 19, 73],
    [142, world.surface.height - 8, 74],
    [172, world.surface.height - 17, 75],
    [202, world.surface.height - 6, 76],
    [232, world.surface.height - 19, 77],
    [262, world.surface.height - 8, 78],
    [292, world.surface.height - 17, 79],
    [322, world.surface.height - 6, 80],
    [352, world.surface.height - 19, 81],
    [382, world.surface.height - 8, 82],
    [412, world.surface.height - 17, 83],
    [442, world.surface.height - 6, 84]
  ];

  for (const [x, y, seed] of borderTrees) {
    addTree(x, y, seed);
  }

  trees.sort((a, b) => a.y - b.y);
  for (const tree of trees) {
    if (tree.x < -96 || tree.x > widthPx + 96 || tree.y < -140 || tree.y > heightPx + 140) {
      continue;
    }
    addAssetTree(root, tree);
  }
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

export function drawSurfaceGround(root: Container, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  const width = world.surface.width;
  const height = world.surface.height;
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom));

  const environment = getEnvironmentTextures();
  const textures = environment.terrain;
  const props = environment.props;
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

  const propLayer = new Container();
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
        const treeTextures = [props.treeTall, props.treeRound, props.treeWide];
        const texture = treeTextures[Math.floor(hash2(gx, gy, 64) * treeTextures.length) % treeTextures.length];
        addAssetProp(propLayer, texture, px, py, 0.28 + hash2(gx, gy, 65) * 0.08, 0, 0xd9f5a6);
      } else if (roll > 0.918) {
        addAssetProp(propLayer, props.bushRound, px, py, 0.58 + hash2(gx, gy, 67) * 0.16, 0, 0xf4ffd8);
      } else if (roll > 0.868) {
        const rockTextures = [props.rockLarge, props.rockRound, props.rockSmall];
        const texture = rockTextures[Math.floor(hash2(gx, gy, 69) * rockTextures.length) % rockTextures.length];
        addAssetProp(propLayer, texture, px, py, 0.9 + hash2(gx, gy, 70) * 0.24, 0, 0xd8d5c8);
      } else if (roll > 0.824) {
        addAssetProp(propLayer, props.log, px, py, 0.36 + hash2(gx, gy, 71) * 0.08, (hash2(gx, gy, 72) - 0.5) * 0.7);
      }
    }
  }

  for (const entrance of entrances) {
    const x = entrance.x * cell;
    const y = entrance.y * cell;
    addAssetProp(propLayer, props.log, x - 82, y + 72, 0.4, -0.28);
    addAssetProp(propLayer, props.log, x + 85, y + 66, 0.38, 0.22);
    addAssetProp(propLayer, props.rockRound, x - 62, y + 52, 0.78, 0, 0xd8d5c8);
    addAssetProp(propLayer, props.rockSmall, x + 58, y + 50, 0.88, 0, 0xd8d5c8);
    addAssetProp(propLayer, props.bushRound, x - 154, y + 96, 0.52, 0, 0xf4ffd8);
    addAssetProp(propLayer, props.bushRound, x + 154, y + 92, 0.5, 0, 0xf4ffd8);
    addAssetProp(propLayer, props.rockLarge, x - 126, y - 88, 0.66, 0, 0xd8d5c8);
    addAssetProp(propLayer, props.treeRound, x - 202, y + 132, 0.26, 0, 0xd9f5a6);
    addAssetProp(propLayer, props.treeWide, x + 204, y + 128, 0.25, 0, 0xd9f5a6);
  }

  root.addChild(propLayer);
  drawForestBorder(root, world, cell);
}
