import { Container, Graphics, Sprite } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { acquireSprite, beginPool, deterministicOffset, endPool, placeSprite } from "../spritePool";
import type { SpritePool, ViewBounds } from "../types";
import { isInBounds } from "./scene";
import { getEnvironmentTextures } from "./environment";
import { actorMotion, animationSeed, residentScale } from "./motion";
import { creatureDimensions, getCreatureArt, getSpiderCarcassArt, lakeTailArt } from "./creatureArt";
import { getEquipmentArt } from "./equipmentArt";
import { fishingRodMount, residentArt, residentPlacement } from "./residentLayout";
import { getBuildingArt } from "./buildingArt";
import { drawPlacedContact, drawSpriteContact, plantedOffset, spriteGrounding } from "./spriteGrounding";
import { getFishArt, swimmingFishArt } from "./fishArt";
import { surfaceLighting, drawGroundShadow } from "./lighting";
import { offsetSettings } from "./editor";
import { buildingFootprint } from "../../../../shared/buildingGeometry";
import { fishingCastActive } from "../../../../shared/fishingCast";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { submergedClay, submergedCorpse } from "../../../../shared/surfaceRemains";

const webDrawKeys = new WeakMap<Graphics, string>();


export function updateSurfaceShadows(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();
  const lighting = surfaceLighting(world, cell);
  graphics.position.set(0, 0);
  graphics.alpha = 1;

  for (const camp of world.surface.entrances) {
    const x = camp.x * cell, y = camp.y * cell;
    drawGroundShadow(graphics, lighting, x, y + 1, 24, 9, 0, 1.25);
  }

  for (const building of world.surface.buildings) {
    if (building.stage !== "built" || !isInBounds(building.pos, bounds, 12)) continue;
    const f = buildingFootprint(building);
    // Fence contacts are registered on individual posts by drawFences;
    // a shadow at every cell centre would put a dark blob inside open gates.
    if (!f) continue;
    const y = (f.y + f.ry * 0.35) * cell;
    drawGroundShadow(graphics, lighting, building.pos.x * cell, y, f.rx * cell * .9, f.ry * cell * .65, building.type === "idol" ? 25 : 46, 1, false);
    const art = getBuildingArt(building.type, f.rx * 2 * cell * 1.12);
    drawSpriteContact(graphics, art.ground, f.x * cell, (f.y + f.ry) * cell, art.scale, art.anchorX, art.texture.width);
  }

  for (const source of world.surface.foodSources) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 6)) {
      continue;
    }
    const size = Math.min(20, 7 + Math.sqrt(source.amount) * 1.8);
    const fruit = (source.kind ?? "food") === "food";
    if (fruit) drawGroundShadow(graphics, lighting, source.pos.x * cell, source.pos.y * cell + 4, size, size * 0.3, 18, .7, false);
  }


  for (const enemy of world.enemies) {
    if (enemy.type === "spider" && isInBounds(enemy.lair, bounds, 5)) {
      drawGroundShadow(graphics, lighting, enemy.lair.x * cell, enemy.lair.y * cell + 7, 20, 8, 15);
    }
    if (enemy.hp > 0 && (enemy.type !== "lakeMonster" || !isWaterAt(enemy.pos.x,enemy.pos.y)) && isInBounds(enemy.pos, bounds, 5)) {
      const shape = creatureDimensions(enemy.type);
      drawGroundShadow(graphics, lighting, enemy.pos.x * cell, enemy.pos.y * cell, shape.shadowX * .8, shape.shadowY * .45, shape.height * .65, .8, false);
    }
  }

  for (const ant of world.ants) {
    if (ant.layer !== "surface" || !isInBounds(ant.pos, bounds, 7)) {
      continue;
    }
    const scale = residentScale(ant) / 1.85;
    const body = residentPlacement(world, ant, cell);
    if (ant.capturedBy) continue;
    if (isWaterAt(ant.pos.x, ant.pos.y)) continue;
    drawGroundShadow(graphics, lighting, body.x, body.groundY, 5 * scale, 1.6 * scale, 27 * scale, .9, false);
    const art = residentArt(ant), c = Math.cos(body.rotation), s = Math.sin(body.rotation);
    for (const foot of art.ground?.feet ?? []) {
      const fx = (foot.x - art.anchorX * art.texture.width) * art.scale * body.size * (2 - body.stretch);
      const fy = (foot.y - art.ground!.bottom) * art.scale * body.size * body.stretch;
      const x = body.x + fx * c - fy * s, y = body.y + fx * s + fy * c;
      const rx = Math.max(.8 * scale, foot.rx * art.scale * body.size);
      graphics.ellipse(x, y + .25 * scale, rx * 1.22, 1.1 * scale).fill({ color: 0x302419, alpha: .15 });
      graphics.ellipse(x, y, rx, .75 * scale).fill({ color: 0x251b14, alpha: .44 });
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
    if ((source.kind ?? "food") !== "food") {
      if (source.amount <= 0) continue;
      if (source.kind === "spiderCarcass") {
        const body = acquireSprite(pool), art = getSpiderCarcassArt();
        body.label = "ground_food";
        body.texture = art.texture; body.anchor.set(.5);
        const scale = art.scale * (.72 + .28 * Math.min(1, source.amount / 140));
        body.scale.set(scale, -scale * .78); body.tint = 0xb9a99a; body.alpha = .88;
        placeSprite(body, x, y, .16); body.zIndex = y;
      }
      const chunks = Math.min(6, Math.ceil(source.amount / 30));
      for (let i = 0; i < chunks; i++) {
        const meat = acquireSprite(pool), art = getEquipmentArt("meat", 12), offset = deterministicOffset(i + source.id.length, 18);
        meat.label = "ground_food";
        meat.texture = art.texture; meat.anchor.set(.5); meat.scale.set(art.scale); meat.tint = 0xffffff; meat.alpha = 1;
        placeSprite(meat, x + offset.x, y + offset.y, i * .7); meat.zIndex = y + offset.y + .1;
      }
      continue;
    }
    const bush = acquireSprite(pool);
    bush.label = "ground_food";
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
      berry.label = "";
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

export function updateSurfaceFish(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);
  for (const fish of world.surface.fish ?? []) {
    if (fish.state === "respawning" || !isInBounds(fish.pos, bounds, 4)) {
      continue;
    }
    const sprite = acquireSprite(pool);
    const time = actorMotion.time, seed = animationSeed(fish.id);
    const art = swimmingFishArt(fish.species), scale = 25 / art.height;
    sprite.texture = art.body;
    sprite.anchor.set(0.5, art.height * 0.5 / art.split);
    sprite.scale.set(scale);
    sprite.alpha = fish.state === "lured" ? 0.95 : 0.82;
    sprite.tint = fish.state === "lured" ? 0xffffff : 0xe6fbff;
    const rotation = Math.atan2(fish.heading.y, fish.heading.x) + Math.PI / 2;
    sprite.position.set(fish.pos.x * cell, fish.pos.y * cell);
    sprite.rotation = rotation;
    sprite.zIndex = fish.pos.y * cell;
    const tail = acquireSprite(pool); tail.texture = art.tail; tail.anchor.set(0.5, 2 / tail.texture.height); tail.scale.set(scale);
    const offset = (art.split - art.height * 0.5) * scale;
    tail.position.set(sprite.x - Math.sin(rotation) * offset, sprite.y + Math.cos(rotation) * offset);
    tail.rotation = rotation + Math.sin(time * 4.8 + seed) * 0.13; tail.alpha = sprite.alpha; tail.tint = sprite.tint; tail.zIndex = sprite.zIndex - 0.01;
  }
  endPool(pool);
}

export function updateFishingEffects(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();
  for (const ant of world.ants) {
    if (!fishingCastActive(ant) || !ant.fishingLurePos || !isInBounds(ant.pos, bounds, 7)) {
      continue;
    }
    const tip = fishingRodMount(residentPlacement(world, ant, cell), ant).tip;
    const lureX = ant.fishingLurePos.x * cell;
    const lureY = ant.fishingLurePos.y * cell;
    graphics.moveTo(tip.x, tip.y).quadraticCurveTo((tip.x + lureX) / 2, Math.max(tip.y, lureY) + 3, lureX, lureY).stroke({ width: 1, color: 0xe8dfc4, alpha: 0.85 });
    graphics.circle(lureX, lureY, 2.4).fill({ color: 0xd24b2e, alpha: 0.95 });
    graphics.circle(lureX, lureY, 4.5 + Math.sin(actorMotion.time * 4) * 1.2).stroke({ width: 1, color: 0xd9ffff, alpha: 0.5 });
  }
}

// Узлы ресурсов: всё, что похоже на ресурс, приходит из серверного snapshot.
export function updateSurfaceResources(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);
  const props = getEnvironmentTextures().props;

  for (const node of world.surface.resourceNodes ?? []) {
    if (node.depositId || node.amount <= 0 || submergedClay(node) || !isInBounds(node.pos, bounds, 8)) {
      continue;
    }

    const x = node.pos.x * cell;
    const y = node.pos.y * cell;
    const ratio = Math.max(0.12, Math.min(1, node.amount / Math.max(0.1, node.maxAmount ?? node.amount)));
    if (node.kind === "clay" && node.id.startsWith("wash-")) {
      const sprite = acquireSprite(pool), clay = getEquipmentArt("clay", Math.min(12, 3 + Math.sqrt(node.amount) * 6));
      sprite.texture = clay.texture; sprite.anchor.set(0.5); sprite.scale.set(clay.scale, clay.scale * 0.35);
      sprite.position.set(x, y); sprite.rotation = 0; sprite.tint = 0xc6a391; sprite.alpha = 0.75; sprite.zIndex = y - 1;
      continue;
    }
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
        const log = getEquipmentArt("wood", 18 + ratio * 5);
        sprite.texture = log.texture;
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(log.scale);
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

      const large = index === 0 || index % 3 !== 2;
      const material = getEquipmentArt(node.kind === "clay" ? "clay" : "stone", node.kind === "loose-stone" ? 12 : large ? 23 : 16);
      sprite.texture = material.texture;
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(material.scale);
      sprite.alpha = 0.58 + ratio * 0.42;
      if (node.kind === "clay") {
        const clayTints = [0xffffff, 0xe7b7a0, 0xffddc0];
        sprite.tint = ratio < 0.35 ? 0xd59b78 : clayTints[index % clayTints.length];
      } else {
        sprite.tint = node.kind === "loose-stone" ? 0xc8c4b8 : index % 2 === 0 ? 0xd8d5c8 : 0xb7b3a9;
      }
      const feetY = y + offset.y + 10;
      placeSprite(sprite, x + offset.x, feetY, (index % 5 - 2) * 0.08);
      sprite.zIndex = feetY;
    }
  }

  for (let i = 0; i < pool.cursor; i++) pool.sprites[i].label = "ground_resource";
  endPool(pool);
}

export function updateSurfaceCarrion(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.carrion) {
    if (source.amount <= 0 || submergedCorpse(source) || !isInBounds(source.pos, bounds, 4)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(10, Math.ceil(source.amount / 10)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 3, 11);
      sprite.label = "ground_food";
      const food = getEquipmentArt("meat", 10 + Math.min(5, Math.sqrt(source.amount)));
      sprite.texture = food.texture; sprite.anchor.set(0.5); sprite.scale.set(food.scale); sprite.alpha = 1; sprite.tint = 0xffffff;
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
  const left = Math.floor(bounds.left);
  const right = Math.ceil(bounds.right);
  const top = Math.floor(bounds.top);
  const bottom = Math.ceil(bounds.bottom);
  const key = [
    left, right, top, bottom,
    ...world.enemies.flatMap((enemy) => enemy.type === "spider"
      ? [enemy.id, enemy.lair.x, enemy.lair.y, enemy.hp > 0 ? 1 : 0]
      : [])
  ].join(":");
  if (webDrawKeys.get(graphics) === key) {
    return;
  }
  webDrawKeys.set(graphics, key);
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
    if (enemy.hp <= 0 || !isInBounds(enemy.pos, bounds, 8)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    const pose = actorMotion.enemy(enemy), art = getCreatureArt(enemy, pose, world.tick);
    sprite.texture = art.texture;
    sprite.anchor.set(art.anchorX, art.anchorY);
    const hpRatio = enemy.maxHp > 0 ? Math.max(0.2, Math.min(1, enemy.hp / enemy.maxHp)) : 1;
    sprite.scale.set(art.scale * (art.mirror ? -1 : 1) * (2 - pose.stretch), art.scale * pose.stretch);
    sprite.alpha = 1; sprite.tint = hpRatio < 0.3 ? 0xffd3bd : 0xffffff;
    if (world.ants.some(a => a.melee && actorMotion.resident(a).attack > 0.7 && Math.hypot(a.melee.to.x - enemy.pos.x, a.melee.to.y - enemy.pos.y) < 4)) sprite.tint = 0xffb88d;
    const swimming = enemy.type === "lakeMonster" && isWaterAt(enemy.pos.x,enemy.pos.y);
    const feetY = enemy.pos.y * cell;
    const support = "ground" in art && art.ground ? plantedOffset(art.ground, art.anchorX, art.texture.width, sprite.scale.x, sprite.scale.y, pose.lean) : 0;
    sprite.position.set(enemy.pos.x * cell, enemy.pos.y * cell + (swimming ? pose.bob : -support));
    sprite.label = swimming ? "swimming_creature" : "ground_creature";
    sprite.rotation = pose.lean;
    sprite.zIndex = feetY;
    const tailArt = lakeTailArt(enemy, pose, world.tick);
    if (tailArt) {
      const tail = acquireSprite(pool), direction = tailArt.mirror ? -1 : 1;
      tail.texture = tailArt.texture; tail.anchor.set(0, 0.96);
      tail.scale.set(tailArt.scale * direction, tailArt.scale);
      // No foot cycle: the body glides while only the tail sweeps sideways.
      const sway = Math.sin(actorMotion.time * 3 + animationSeed(enemy.id)) * 0.12 * pose.walk;
      const ox = tailArt.offsetX * direction;
      tail.position.set(sprite.x + Math.cos(sprite.rotation) * ox, sprite.y + Math.sin(sprite.rotation) * ox);
      tail.rotation = sprite.rotation + sway; tail.alpha = sprite.alpha; tail.tint = sprite.tint; tail.zIndex = feetY + 0.01;
    }

    if (enemy.carrying > 0) {
      const cargo = acquireSprite(carriedCarrionPool);
      const food = getEquipmentArt("meat", 12);
      cargo.texture = food.texture; cargo.anchor.set(0.5); cargo.scale.set(food.scale);
      cargo.position.set(enemy.pos.x * cell + Math.cos(pose.angle) * 23, enemy.pos.y * cell + Math.sin(pose.angle) * 17 - 5 + pose.bob);
      cargo.rotation = pose.lean; cargo.alpha = 1; cargo.tint = 0xffffff;
      cargo.zIndex = feetY + 0.01;
    }
  }

  for (let index = 0; index < pool.cursor; index += 1) {
    pool.sprites[index].alpha = pool.sprites[index].visible ? pool.sprites[index].alpha : 1;
  }
  endPool(pool);
  endPool(carriedCarrionPool);
}

export { updateSurfaceResidents as updateSurfaceAnts, setSelectedAntId } from "./residents";

/** Per-item contacts stay attached even when a pile's pieces are scattered or rotated. */
export function updatePropContacts(g: Graphics, root: Container, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  const lighting = surfaceLighting(world, cell);
  for (const child of root.children) {
    if (!(child instanceof Sprite) || !child.visible || child.alpha <= 0) continue;
    const label = child.label;
    const hearth = label.startsWith("campfire_");
    if (!(hearth || label.startsWith("camp_stock_") || ["ground_resource", "ground_food", "ground_creature", "static_prop", "building_garden", "fence_post"].includes(label))) continue;
    const pos = { x: child.x / cell, y: child.y / cell };
    if (!isInBounds(pos, bounds, 15)) continue;
    if (!hearth && label !== "ground_creature" && label !== "building_garden") {
      const width = Math.abs(child.width), height = Math.abs(child.height), profile = spriteGrounding(child.texture);
      const groundY = child.y + ((child.scale.y < 0 ? profile.top ?? 0 : profile.bottom) - child.anchor.y * child.texture.height) * child.scale.y;
      drawGroundShadow(g, lighting, child.x, groundY, width * .27, Math.min(3, width * .08), height * .6, .65, false);
    }
    drawPlacedContact(g, child, label === "building_garden" ? .45 : .9);
  }
}
