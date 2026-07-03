import { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { acquireSprite, antRotation, beginPool, deterministicOffset, endPool, placeSprite } from "../spritePool";
import type { SpritePool, ViewBounds } from "../types";
import { isInBounds } from "./scene";
import {
  getBerryTexture,
  getClayfolkTexture,
  getResourceTexture
} from "../../sprites";
import { drawPebble, drawLeaf } from "./ground";
import { getEnvironmentTextures } from "./environment";

// Выбранный житель (панель юнита): подсветка кольцом.
let selectedAntId: string | null = null;

export function setSelectedAntId(id: string | null): void {
  selectedAntId = id;
}

function drawSoftShadow(graphics: Graphics, x: number, y: number, rx: number, ry: number, alpha: number): void {
  graphics.ellipse(x + rx * 0.08, y + ry * 0.18, rx, ry).fill({ color: 0x1e130c, alpha });
  graphics.ellipse(x, y, rx * 0.62, ry * 0.58).fill({ color: 0x1e130c, alpha: alpha * 0.34 });
}

export function updateSurfaceShadows(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();

  for (const source of world.surface.foodSources) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 6)) {
      continue;
    }
    const size = Math.min(20, 7 + Math.sqrt(source.amount) * 1.8);
    drawSoftShadow(graphics, source.pos.x * cell, source.pos.y * cell + 4, size, size * 0.42, 0.16);
  }

  for (const source of world.surface.carrion) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 5)) {
      continue;
    }
    const size = Math.min(18, 8 + Math.sqrt(source.amount) * 1.4);
    drawSoftShadow(graphics, source.pos.x * cell, source.pos.y * cell + 4, size, size * 0.4, 0.18);
  }

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider") {
      continue;
    }
    if (isInBounds(enemy.lair, bounds, 5)) {
      drawSoftShadow(graphics, enemy.lair.x * cell, enemy.lair.y * cell + 7, 20, 8, 0.2);
    }
    if (enemy.hp > 0 && isInBounds(enemy.pos, bounds, 5)) {
      drawSoftShadow(graphics, enemy.pos.x * cell, enemy.pos.y * cell + 6, 18, 7, 0.22);
    }
  }

  for (const ant of world.ants) {
    if (ant.layer !== "surface" || !isInBounds(ant.pos, bounds, 7)) {
      continue;
    }
    const carrying = ant.state === "carry" || ant.carrying > 0 || !!ant.carryingDebris;
    drawSoftShadow(graphics, ant.pos.x * cell, ant.pos.y * cell + 22, carrying ? 18 : 16, carrying ? 6.5 : 5.8, 0.24);
  }

  if (world.surface.debris) {
    for (const item of world.surface.debris) {
      if (!isInBounds(item.pos, bounds, 3)) {
        continue;
      }
      drawSoftShadow(graphics, item.pos.x * cell, item.pos.y * cell + 3, item.type === "pebble" ? 5.5 : 4.5, 2.2, 0.11);
    }
  }
}

export function updateSurfaceFood(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);
  const props = getEnvironmentTextures().props;

  for (const source of world.surface.foodSources) {
    if (!isInBounds(source.pos, bounds, 7)) {
      continue;
    }

    // Food uses vegetation sprites from the summer-plains atlas; only berries vary by amount.
    const x = source.pos.x * cell;
    const y = source.pos.y * cell;
    const bush = acquireSprite(pool);
    bush.texture = props.foodBush;
    bush.anchor.set(0.5, 1);
    bush.scale.set(0.96);
    bush.tint = 0xffffff;
    bush.alpha = source.amount > 0 ? 1 : 0.72;
    placeSprite(bush, x, y + 13, 0);

    const berryCount = Math.max(0, Math.min(8, Math.ceil(source.amount / 15)));
    const berryTexture = getBerryTexture();
    for (let index = 0; index < berryCount; index += 1) {
      const berry = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 2, 15);
      berry.texture = berryTexture;
      berry.anchor.set(0.5);
      berry.scale.set(2.2 + (index % 3) * 0.12);
      berry.tint = 0xffffff;
      berry.alpha = 0.96;
      placeSprite(berry, x + offset.x * 0.82, y - 16 + offset.y * 0.48, (index % 5 - 2) * 0.08);
    }
  }

  endPool(pool);
}

// Узлы глины и дерева: комья/палочки кучкой, количество кусков растёт с запасом.
export function updateSurfaceResources(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const node of world.surface.resourceNodes ?? []) {
    if (node.amount <= 0 || !isInBounds(node.pos, bounds, 5)) {
      continue;
    }

    const texture = getResourceTexture(node.kind);
    const chunks = Math.max(1, Math.min(12, Math.ceil(node.amount / 8)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      sprite.texture = texture;
      const spread = index === 0 ? 0 : 4 + Math.min(8, index * 1.5);
      const offset = deterministicOffset(index * 3 + node.id.length, spread);
      sprite.scale.set(index === 0 ? 2.7 : 2.2);
      placeSprite(sprite, node.pos.x * cell + offset.x, node.pos.y * cell + offset.y, (index % 5) * 0.4);
    }
  }

  endPool(pool);
}

export function updateSurfaceCarrion(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.carrion) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 4)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(10, Math.ceil(source.amount / 10)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 3, 11);
      sprite.scale.set(2.6);
      placeSprite(sprite, source.pos.x * cell + offset.x, source.pos.y * cell + offset.y, (index % 5) * 0.27);
    }
  }

  endPool(pool);
}

export function updateSurfaceLairs(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || !isInBounds(enemy.lair, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    sprite.scale.set(3.4 + Math.min(1.2, enemy.hoard / 120));
    sprite.alpha = 0.74 + Math.min(0.2, enemy.hoard / Math.max(1, 900));
    placeSprite(sprite, enemy.lair.x * cell, enemy.lair.y * cell, 0);
  }

  endPool(pool);
}

export function updateSurfaceWebs(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || !enemy.lair || enemy.hp <= 0) {
      continue;
    }

    const lairX = enemy.lair.x * cell;
    const lairY = enemy.lair.y * cell;
    const webRadius = 14 * cell;

    if (!isInBounds(enemy.lair, bounds, 16)) {
      continue;
    }

    // 1. Радиальные лучи
    const rayCount = 16;
    for (let i = 0; i < rayCount; i += 1) {
      const angle = (Math.PI * 2 * i) / rayCount;
      graphics.moveTo(lairX, lairY);
      graphics.lineTo(lairX + Math.cos(angle) * webRadius, lairY + Math.sin(angle) * webRadius);
    }

    // 2. Спиральная паутина
    const spiralTurns = 5;
    const steps = 120;
    graphics.moveTo(lairX, lairY);
    for (let i = 0; i <= steps; i += 1) {
      const angle = (Math.PI * 2 * spiralTurns * i) / steps;
      const currentRadius = (webRadius * i) / steps;
      graphics.lineTo(lairX + Math.cos(angle) * currentRadius, lairY + Math.sin(angle) * currentRadius);
    }

    // В PixiJS v8 нужно явно вызвать stroke, чтобы нарисовать все накопленные линии
    graphics.stroke({ width: 1.6, color: 0xffffff, alpha: 0.42 });
  }
}

export function updateSurfaceEnemies(
  pool: SpritePool,
  carriedCarrionPool: SpritePool,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);
  beginPool(carriedCarrionPool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider") {
      continue;
    }
    if (!isInBounds(enemy.pos, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    const hpRatio = enemy.maxHp > 0 ? Math.max(0.2, Math.min(1, enemy.hp / enemy.maxHp)) : 1;
    sprite.scale.set(4.2);
    sprite.alpha = 0.45 + hpRatio * 0.55;
    placeSprite(sprite, enemy.pos.x * cell, enemy.pos.y * cell, 0);

    if (enemy.carrying > 0) {
      const cargo = acquireSprite(carriedCarrionPool);
      cargo.scale.set(1.9);
      placeSprite(cargo, enemy.pos.x * cell + 11, enemy.pos.y * cell - 11, 0.25);
    }
  }

  for (let index = 0; index < pool.cursor; index += 1) {
    pool.sprites[index].alpha = pool.sprites[index].visible ? pool.sprites[index].alpha : 1;
  }
  endPool(pool);
  endPool(carriedCarrionPool);
}

export function updateSurfaceAnts(
  pool: SpritePool,
  debrisGraphics: Graphics,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);

  for (const ant of world.ants) {
    if (ant.layer !== "surface") {
      continue;
    }
    if (!isInBounds(ant.pos, bounds, 7)) {
      continue;
    }

    const carrying = ant.state === "carry" || ant.carrying > 0 || !!ant.carryingDebris;
    const color = ant.colonyId === "colony-2" ? "red" : "dark";
    const sprite = acquireSprite(pool);
    sprite.texture = getClayfolkTexture(carrying, color);
    const spriteScale = ant.state === "carry" ? 3.05 : 2.85;
    const facing = ant.heading.x < -0.05 ? -1 : 1;
    sprite.scale.set(spriteScale * facing, spriteScale);
    sprite.tint = 0xffffff;
    const headingAngle = antRotation(ant);
    const rot = Math.max(-0.14, Math.min(0.14, ant.heading.x * 0.12));
    placeSprite(sprite, ant.pos.x * cell, ant.pos.y * cell, rot);

    if (ant.id === selectedAntId) {
      const sx = ant.pos.x * cell;
      const sy = ant.pos.y * cell;
      debrisGraphics.circle(sx, sy + 4, 11).stroke({ width: 1.8, color: 0xfff3c4, alpha: 0.9 });
      debrisGraphics.circle(sx, sy + 4, 13.5).stroke({ width: 1, color: 0xfff3c4, alpha: 0.35 });
    }

    if (ant.job === "guard") {
      // Временная метка стражи: копьё-черта (спрайты — задача Codex).
      const gx = ant.pos.x * cell;
      const gy = ant.pos.y * cell;
      debrisGraphics.moveTo(gx + 5, gy + 7).lineTo(gx + 11, gy - 11).stroke({ width: 1.6, color: 0x6b4a24, alpha: 0.95 });
      debrisGraphics.rect(gx + 10, gy - 13, 2.4, 4).fill({ color: 0xc9c4b4, alpha: 1 });
    }

    if (ant.carryingDebris) {
      const hX = Math.cos(headingAngle);
      const hY = Math.sin(headingAngle);
      const offsetDist = cell * 0.7;
      const debrisX = ant.pos.x * cell + hX * offsetDist;
      const debrisY = ant.pos.y * cell + hY * offsetDist;

      if (ant.carryingDebris === "pebble") {
        drawPebble(debrisGraphics, debrisX, debrisY, cell * 0.45, 0xb4b0a6);
      } else {
        drawLeaf(debrisGraphics, debrisX, debrisY, cell * 0.22, rot + Math.PI / 2);
      }
    }
  }

  endPool(pool);
}

export function updateSurfaceDebris(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();

  if (!world.surface.debris) {
    return;
  }

  for (const item of world.surface.debris) {
    if (!isInBounds(item.pos, bounds, 3)) {
      continue;
    }

    const x = item.pos.x * cell;
    const y = item.pos.y * cell;

    if (item.type === "pebble") {
      const sizeSeed = Math.sin(item.pos.x * 12.9898 + item.pos.y * 78.233) * 43758.5453;
      const sizeRoll = sizeSeed - Math.floor(sizeSeed);
      const size = cell * (0.6 + sizeRoll * 0.5);
      const shade = sizeRoll > 0.45 ? 0x9c9a91 : 0xb8b5aa;
      drawPebble(graphics, x, y, size, shade);
    } else {
      const rotSeed = Math.sin(item.pos.x * 31.7 + item.pos.y * 127.1) * 43758.5453;
      const rotRoll = rotSeed - Math.floor(rotSeed);
      const rotation = rotRoll * Math.PI * 2;
      const scale = cell * (0.3 + rotRoll * 0.2);
      drawLeaf(graphics, x, y, scale, rotation);
    }
  }
}
