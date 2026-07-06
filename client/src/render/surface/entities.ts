import { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { acquireSprite, antRotation, beginPool, deterministicOffset, endPool, placeSprite } from "../spritePool";
import type { SpritePool, ViewBounds } from "../types";
import { isInBounds } from "./scene";
import {
  getClayfolkTexture,
  getClayTexture,
  getWoodTexture,
  getStoneTexture,
  getSpearTexture,
  getFoodTexture
} from "../../sprites";
import { drawPebble, drawLeaf } from "./ground";
import { getEnvironmentTextures } from "./environment";
import { offsetSettings } from "./editor";

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

  // Фиксированные координаты томатов, равномерно распределенные по всей площади куста
  // (включая нижние боковые ветки листвы), во избежание наслаивания.
  const tomatoOffsets = [
    { x: 0, y: -13 },   // Центр кроны
    { x: -12, y: -2 },  // Низ-лево (боковая ветка)
    { x: 12, y: -2 },   // Низ-право (боковая ветка)
    { x: -17, y: -12 }, // Середина-лево
    { x: 17, y: -12 },  // Середина-право
    { x: -10, y: -22 }, // Верх-лево
    { x: 10, y: -22 },  // Верх-право
    { x: 0, y: -29 }    // Верхушка куста
  ];

  for (const source of world.surface.foodSources) {
    if (!isInBounds(source.pos, bounds, 7)) {
      continue;
    }

    const x = source.pos.x * cell;
    const y = source.pos.y * cell;
    const bush = acquireSprite(pool);
    bush.texture = props.foodBush;
    bush.anchor.set(0.5, 1);
    bush.scale.set(0.96);
    bush.tint = 0xffffff;
    bush.alpha = source.amount > 0 ? 1 : 0.72;
    placeSprite(bush, x, y + 13, 0);
    bush.zIndex = y + 13;

    const berryCount = Math.max(0, Math.min(8, Math.ceil(source.amount / 15)));
    const tomatoTexture = props.tomato;
    
    // Детерминированное зеркалирование и хэш на основе ID куста
    const hash = source.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const mirrorX = hash % 2 === 0 ? 1 : -1;

    for (let index = 0; index < berryCount; index += 1) {
      const offset = tomatoOffsets[index % tomatoOffsets.length];
      if (!offset) {
        continue;
      }

      const berry = acquireSprite(pool);
      berry.texture = tomatoTexture;
      berry.anchor.set(0.5);
      // Масштаб ~1.0 для идеального 11x11 пиксельного размера
      berry.scale.set(0.95 + (index % 3) * 0.05);
      berry.tint = 0xffffff;
      berry.alpha = 0.96;

      // Минимальное детерминированное дрожание в пределах [-1, 1]
      const jitterX = ((index * 7 + hash) % 3) - 1;
      const jitterY = ((index * 13 + hash) % 3) - 1;

      placeSprite(
        berry,
        x + offset.x * mirrorX + jitterX,
        y + offset.y + jitterY,
        (index % 5 - 2) * 0.04
      );
      berry.zIndex = y + 13.01;
    }
  }

  endPool(pool);
}

// Узлы ресурсов: всё, что похоже на ресурс, приходит из серверного snapshot.
export function updateSurfaceResources(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);
  const props = getEnvironmentTextures().props;

  for (const node of world.surface.resourceNodes ?? []) {
    if (node.amount <= 0 || !isInBounds(node.pos, bounds, 8)) {
      continue;
    }

    const x = node.pos.x * cell;
    const y = node.pos.y * cell;
    const ratio = Math.max(0.12, Math.min(1, node.amount / Math.max(0.1, node.maxAmount ?? node.amount)));
    if (node.kind === "tree") {
      const sprite = acquireSprite(pool);
      const textures = [props.treeTall, props.treeRound, props.treeWide];
      const textureIndex = node.growth === "sapling" ? 1 : node.growth === "young" ? 2 : node.id.length % textures.length;
      sprite.texture = textures[textureIndex] ?? props.treeRound;
      sprite.anchor.set(0.5, 1);
      const growthScale = node.growth === "sapling" ? 0.24 : node.growth === "young" ? 0.36 : 0.52;
      sprite.scale.set(growthScale * (0.75 + ratio * 0.25));
      sprite.tint = node.growth === "sapling" ? 0xd8f5a3 : ratio < 0.45 ? 0xb8c97b : 0xffffff;
      sprite.alpha = 0.72 + ratio * 0.28;
      placeSprite(sprite, x, y + 10, 0);
      sprite.zIndex = y + 10;
      continue;
    }

    if (node.kind === "stick") {
      const chunks = Math.max(1, Math.min(3, Math.ceil(node.amount)));
      for (let index = 0; index < chunks; index += 1) {
        const sprite = acquireSprite(pool);
        const offset = deterministicOffset(index * 5 + node.id.length, 9);
        sprite.texture = props.log;
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(0.28 + ratio * 0.08);
        sprite.tint = index % 2 === 0 ? 0xffffff : 0xe8c18a;
        sprite.alpha = 0.9;
        const feetY = y + offset.y + 7;
        placeSprite(sprite, x + offset.x, feetY, (index % 2 === 0 ? -0.42 : 0.34) + index * 0.08);
        sprite.zIndex = feetY;
      }
      continue;
    }

    const chunks =
      node.kind === "clay"
        ? Math.max(2, Math.min(7, Math.ceil(node.amount / 14)))
        : node.kind === "loose-stone"
          ? Math.max(1, Math.min(3, Math.ceil(node.amount)))
          : Math.max(1, Math.min(5, Math.ceil(node.amount / 16)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const spread = index === 0 ? 0 : node.kind === "clay" ? 8 + index * 1.5 : 12 + index * 2;
      const offset = deterministicOffset(index * 3 + node.id.length, spread);

      const rockTextures = [props.rockLarge, props.rockRound, props.rockSmall];
      const large = index === 0 || index % 3 !== 2;
      sprite.texture = rockTextures[index % rockTextures.length];
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(node.kind === "clay" ? (large ? 1.42 : 1.55) : node.kind === "loose-stone" ? 0.72 : large ? 1.15 : 1.28);
      sprite.alpha = 0.58 + ratio * 0.42;
      if (node.kind === "clay") {
        const clayTints = [0xe76f34, 0xc84f2a, 0xf08a4f];
        sprite.tint = ratio < 0.35 ? 0xd59b78 : clayTints[index % clayTints.length];
      } else {
        sprite.tint = node.kind === "loose-stone" ? 0xc8c4b8 : index % 2 === 0 ? 0xd8d5c8 : 0xb7b3a9;
      }
      const feetY = y + offset.y + 10;
      placeSprite(sprite, x + offset.x, feetY, (index % 5 - 2) * 0.08);
      sprite.zIndex = feetY;
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
      const feetY = source.pos.y * cell + offset.y;
      placeSprite(sprite, source.pos.x * cell + offset.x, feetY, (index % 5) * 0.27);
      sprite.zIndex = feetY;
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
    const feetY = enemy.lair.y * cell;
    placeSprite(sprite, enemy.lair.x * cell, feetY, 0);
    sprite.zIndex = feetY;
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
    const feetY = enemy.pos.y * cell + 22; // Низ лапок паука при масштабе 4.2
    placeSprite(sprite, enemy.pos.x * cell, enemy.pos.y * cell, 0);
    sprite.zIndex = feetY;

    if (enemy.carrying > 0) {
      const cargo = acquireSprite(carriedCarrionPool);
      cargo.scale.set(1.9);
      placeSprite(cargo, enemy.pos.x * cell + 11, enemy.pos.y * cell - 11, 0.25);
      cargo.zIndex = feetY + 0.01;
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
  carriedItemsPool: SpritePool,
  debrisGraphics: Graphics,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);
  beginPool(carriedItemsPool);
  const props = getEnvironmentTextures().props;

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
    sprite.anchor.set(0.5); // Всегда сбрасываем якорь тела человечка в центр
    const spriteScale = 2.85;
    const facing = ant.heading.x < -0.05 ? -1 : 1;
    sprite.scale.set(spriteScale * facing, spriteScale);
    sprite.tint = 0xffffff;
    const headingAngle = antRotation(ant);
    const harvestSwing = ant.job === "harvest" && ant.carrying <= 0 ? Math.sin(world.tick * 0.45 + (ant.harvestHits ?? 0) * 0.8) * 0.16 : 0;
    const rot = Math.max(-0.24, Math.min(0.24, ant.heading.x * 0.12 + harvestSwing));
    const cx = ant.pos.x * cell;
    const cy = ant.pos.y * cell;
    const feetY = cy + 9.5 * spriteScale; // Точка контакта ног человечка с землей
    placeSprite(sprite, cx, cy, rot);
    sprite.zIndex = feetY;

    // Если переносится стандартный ресурс (глина, дерево, камень, еда)
    if (carrying && ant.carrying > 0) {
      const itemSprite = acquireSprite(carriedItemsPool);
      let itemTexture = props.tomato;
      const kind = ant.carryKind ?? "food";
      const settings = offsetSettings[kind] ?? offsetSettings.food;

      if (kind === "clay") {
        itemTexture = getClayTexture();
      } else if (kind === "wood") {
        itemTexture = getWoodTexture();
      } else if (kind === "stone") {
        itemTexture = getStoneTexture();
      } else if (kind === "food") {
        itemTexture = props.tomato;
      }

      itemSprite.texture = itemTexture;
      itemSprite.anchor.set(0.5);
      itemSprite.scale.set(settings.scale * facing, settings.scale);
      itemSprite.tint = 0xffffff;
      itemSprite.alpha = 0.95;

      // Рассчитываем покачивание при движении
      const swingSpeed = offsetSettings.swing.swingSpeed;
      const swingAmpY = offsetSettings.swing.swingAmpY;
      const swingAmpRot = offsetSettings.swing.swingAmpRot;

      const swingY = Math.sin(world.tick * swingSpeed) * swingAmpY * spriteScale;
      const swingRot = Math.cos(world.tick * swingSpeed) * swingAmpRot;

      // Локальные координаты рук относительно центра человечка с учетом покачивания
      const itemLocalX = settings.offsetX * facing * spriteScale;
      const itemLocalY = (settings.offsetY * spriteScale) + swingY;

      // Применяем вращение корпуса человечка к координатам предмета в руках
      const cosR = Math.cos(rot + swingRot);
      const sinR = Math.sin(rot + swingRot);
      const rotatedX = itemLocalX * cosR - itemLocalY * sinR;
      const rotatedY = itemLocalX * sinR + itemLocalY * cosR;

      placeSprite(itemSprite, cx + rotatedX, cy + rotatedY, rot + swingRot);
      itemSprite.zIndex = feetY + 0.01;
    }

    if (ant.id === selectedAntId) {
      const sx = ant.pos.x * cell;
      const sy = ant.pos.y * cell;
      debrisGraphics.circle(sx, sy + 4, 11).stroke({ width: 1.8, color: 0xfff3c4, alpha: 0.9 });
      debrisGraphics.circle(sx, sy + 4, 13.5).stroke({ width: 1, color: 0xfff3c4, alpha: 0.35 });
    }

    if (ant.job === "guard") {
      const spearSprite = acquireSprite(carriedItemsPool);
      spearSprite.texture = getSpearTexture();
      const settings = offsetSettings.spear;
      spearSprite.anchor.set(settings.anchorX, settings.anchorY);
      spearSprite.scale.set(settings.scale * facing, settings.scale);
      spearSprite.tint = 0xffffff;
      spearSprite.alpha = 0.96;
      // Позиционируем копьё справа от человечка, наклоненным вверх/вправо
      placeSprite(spearSprite, cx + settings.offsetX * facing, cy + settings.offsetY, rot + (facing > 0 ? settings.rotation : -settings.rotation));
      spearSprite.zIndex = feetY + 0.01;
    }

    if (ant.carryingDebris) {
      const debrisSprite = acquireSprite(carriedItemsPool);
      const isPebble = ant.carryingDebris === "pebble";
      const settings = isPebble ? offsetSettings.pebble : offsetSettings.leaf;
      debrisSprite.texture = isPebble ? getStoneTexture() : getFoodTexture();
      debrisSprite.anchor.set(0.5);
      debrisSprite.scale.set(settings.scale, settings.scale);
      debrisSprite.tint = 0xffffff;
      debrisSprite.alpha = 0.95;

      const hX = Math.cos(headingAngle);
      const hY = Math.sin(headingAngle);
      const offsetDist = cell * (settings.offsetDist / 8);
      placeSprite(debrisSprite, cx + hX * offsetDist, cy + hY * offsetDist, rot + Math.PI / 2);
      debrisSprite.zIndex = feetY + 0.01;
    }
  }

  endPool(pool);
  endPool(carriedItemsPool);
}

export function updateSurfaceDebris(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();
  void world;
  void cell;
  void bounds;
}
