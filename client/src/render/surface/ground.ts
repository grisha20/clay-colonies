import { Container, Graphics, MaskFilter, Sprite, TilingSprite } from "pixi.js";
import { Texture } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import { isLakeShoreAt, isWaterAt, lakeFieldAt } from "../../../../shared/surfaceTerrain";
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

function drawPixelFleck(root: Graphics, x: number, y: number, size: number, color: number, alpha: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const s = Math.max(1, Math.round(size));
  root.rect(px, py, s, s).fill({ color, alpha });
}

function drawLakeBanks(
  root: Container,
  spriteRoot: Container,
  cell: number,
  width: number,
  height: number,
  rockTexture: Texture,
  grassTexture: Texture
): void {
  const bankStep = 2;
  const shoreDetails = new Graphics();
  for (let y = 0; y < height; y += bankStep) {
    for (let x = 0; x < width; x += bankStep) {
      const centerX = x + bankStep * 0.5;
      const centerY = y + bankStep * 0.5;
      const field = lakeFieldAt(centerX, centerY);
      if (field < -0.22 || field > -0.02) {
        continue;
      }
      if (isLakeShoreAt(centerX, centerY) && hash2(x, y, 941) > 0.5) {
        const px = (x + hash2(x, y, 942) * bankStep) * cell;
        const py = (y + hash2(x, y, 943) * bankStep) * cell;
        drawPixelFleck(shoreDetails, px, py, 1.2 + hash2(x, y, 944) * 1.7, field > 0 ? 0x557965 : 0xa7864d, 0.72);
      }

      // Sparse clusters only on dry outer bank. They break long clean contours
      // without obscuring the readable beach-to-water transition.
      if (field < -0.025 && field > -0.22) {
        const decor = hash2(x, y, 945);
        const px = (x + 0.2 + hash2(x, y, 946) * 0.6) * cell;
        const py = (y + 0.25 + hash2(x, y, 947) * 0.5) * cell;
        if (decor > 0.992) {
          addAssetProp(root, spriteRoot, rockTexture, px, py + 5, 0.26 + hash2(x, y, 948) * 0.1, 0, 0xd0c59e);
        } else if (decor < 0.012) {
          addAssetProp(root, spriteRoot, grassTexture, px, py + 4, 0.22 + hash2(x, y, 949) * 0.08, 0, 0x9bb85d);
        }
      }
    }
  }
  root.addChild(shoreDetails);
}

type ForestTree = {
  x: number;
  y: number;
  scale: number;
  texture: Texture;
  tint: number;
};

function addAssetTree(shadowRoot: Container, spriteRoot: Container, tree: ForestTree): void {
  const shadow = new Graphics();
  shadow.ellipse(tree.x + tree.scale * 8, tree.y - tree.scale * 2, tree.scale * 54, tree.scale * 14).fill({ color: 0x1d160d, alpha: 0.24 });
  shadow.ellipse(tree.x - tree.scale * 3, tree.y - tree.scale * 5, tree.scale * 35, tree.scale * 8).fill({ color: 0x1d160d, alpha: 0.1 });
  shadowRoot.addChild(shadow);

  const sprite = new Sprite(tree.texture);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(tree.x, tree.y);
  sprite.scale.set(tree.scale);
  sprite.tint = tree.tint;
  sprite.zIndex = tree.y; // Устанавливаем zIndex по Y основания дерева!
  sprite.label = "static_prop"; // Помечаем как статический проп для очистки
  spriteRoot.addChild(sprite);
}

function addAssetProp(
  shadowRoot: Container,
  spriteRoot: Container,
  texture: Texture,
  x: number,
  y: number,
  scale: number,
  rotation = 0,
  tint = 0xffffff
): void {
  const shadow = new Graphics();
  shadow.ellipse(x + scale * 4, y - scale * 2, scale * 18, scale * 5).fill({ color: 0x1d160d, alpha: 0.18 });
  shadowRoot.addChild(shadow);

  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(x, y);
  sprite.scale.set(scale);
  sprite.rotation = rotation;
  sprite.tint = tint;
  sprite.zIndex = y; // Устанавливаем zIndex по Y основания пропа!
  sprite.label = "static_prop"; // Помечаем как статический проп для очистки
  spriteRoot.addChild(sprite);
}

function drawForestBorder(shadowRoot: Container, spriteRoot: Container, world: WorldSnapshot, cell: number): void {
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
    addAssetTree(shadowRoot, spriteRoot, tree);
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

export function drawSurfaceGround(
  shadowRoot: Container,
  spriteRoot: Container,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds,
  decorate = true
): void {
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
  const grass = new TilingSprite({ texture: grassTexture, width: pixelRight - pixelLeft, height: pixelBottom - pixelTop });
  grass.position.set(pixelLeft, pixelTop); grass.tileScale.set(0.26); grass.tilePosition.set(-pixelLeft, -pixelTop);
  grass.tint = 0xe2e3c6; shadowRoot.addChild(grass);

  const entrances = world.surface.entrances ?? [world.surface.entrance];
  // One continuous material under a feathered mask. The previous 8px stamps
  // left a square pixel fringe against the sculpted buildings.
  const soil = new TilingSprite({ texture: dirtTexture, width: pixelRight - pixelLeft, height: pixelBottom - pixelTop });
  soil.position.set(pixelLeft, pixelTop); soil.tileScale.set(0.26); soil.tilePosition.set(-pixelLeft, -pixelTop); soil.tint = 0xe5dfca;
  const maskCanvas = document.createElement("canvas"), maskStep = 4;
  maskCanvas.width = Math.ceil(soil.width / maskStep); maskCanvas.height = Math.ceil(soil.height / maskStep);
  const context = maskCanvas.getContext("2d")!, pixels = context.createImageData(maskCanvas.width, maskCanvas.height);
  for (let y = 0; y < maskCanvas.height; y++) for (let x = 0; x < maskCanvas.width; x++) {
    const wx = (pixelLeft + (x + 0.5) * maskStep) / cell, wy = (pixelTop + (y + 0.5) * maskStep) / cell;
    let value = Infinity;
    for (let i = 0; i < entrances.length; i++) value = Math.min(value, campDirtShapeValue(wx, wy, entrances[i], i));
    value += (hash2(Math.floor(wx * 0.8), Math.floor(wy * 0.8), 501) - 0.5) * 0.035;
    const offset = (y * maskCanvas.width + x) * 4;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = Math.round((1 - smoothStep(0.78, 1.18, value)) * 255);
  }
  context.putImageData(pixels, 0, 0);
  const maskTexture = Texture.from(maskCanvas); maskTexture.source.scaleMode = "linear";
  const soilMask = new Sprite(maskTexture); soilMask.position.copyFrom(soil.position); soilMask.width = soil.width; soilMask.height = soil.height;
  // Own the filter: Pixi's pooled alpha-mask filter retains a destroyed source
  // after this temporary ground container is baked, breaking the next lake mask.
  const soilFilter = new MaskFilter({ sprite: soilMask, channel: "alpha" });
  soil.filters = [soilFilter]; soilMask.renderable = false;
  soil.on("destroyed", () => soilFilter.destroy());
  soilMask.on("destroyed", () => maskTexture.destroy(true));
  shadowRoot.addChild(soil, soilMask);
  if (decorate) drawLakeBanks(shadowRoot, spriteRoot, cell, width, height, props.rockSmall, props.grassTuft);

  const ground = new Graphics();
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const noise = hash2(x, y, 1);
      const speckle = hash2(x, y, 2);
      const clearing = isCampOrFoodClearing(x + 0.5, y + 0.5, world);
      const water = isWaterAt(x + 0.5, y + 0.5);
      if (!water && (clearing > 0.04 || speckle > 0.55)) {
        const color = noise < 0.28 ? 0xc99650 : noise > 0.82 ? 0xe6c074 : 0xd8ad63;
        const size = cell * (0.18 + hash2(x, y, 13) * 0.34);
        ground.ellipse((x + hash2(x, y, 14) * 0.75) * cell, (y + hash2(x, y, 15) * 0.75) * cell, size * 0.3, size * 0.18).fill({
          color,
          alpha: 0.07
        });
      }

      if (!water && speckle > 0.998) {
        ground.rect(Math.round((x + 0.35) * cell), Math.round((y + 0.35) * cell), Math.max(1, Math.ceil(cell * 0.2)), Math.max(1, Math.ceil(cell * 0.2))).fill({ color: 0xf0d28d, alpha: 0.55 });
      } else if (!water && speckle < 0.005) {
        ground.rect(Math.round((x + 0.45) * cell), Math.round((y + 0.45) * cell), Math.max(1, Math.ceil(cell * 0.16)), Math.max(1, Math.ceil(cell * 0.16))).fill({ color: 0x7f6135, alpha: 0.24 });
      }
    }
  }

  shadowRoot.addChild(ground);

  for (const entrance of decorate ? entrances : []) {
    const x = entrance.x * cell;
    const y = entrance.y * cell;
    addAssetProp(shadowRoot, spriteRoot, props.bushRound, x - 154, y + 96, 0.52, 0, 0xf4ffd8);
    addAssetProp(shadowRoot, spriteRoot, props.bushRound, x + 154, y + 92, 0.5, 0, 0xf4ffd8);
  }

  if (decorate) drawForestBorder(shadowRoot, spriteRoot, world, cell);
}
