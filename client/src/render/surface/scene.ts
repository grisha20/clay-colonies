import { Container, Graphics, RenderTexture, Sprite, Renderer } from "pixi.js";
import { WALL_CELL_SIZE, ZONE_CELL_SIZE, type Vec2, type WorldSnapshot } from "../../../../shared/types";
import { createSpritePool } from "../spritePool";
import type { Camera, SurfaceScene, ViewBounds } from "../types";
import { SURFACE_TILE_SIZE } from "../types";
import {
  createClayfolkSprite,
  createCarrionSprite,
  createFoodSprite,
  createSpiderLairSprite,
  createSpiderSprite
} from "../../sprites";
import { drawSurfaceGround } from "./ground";
import { drawSurfacePheromones } from "./pheromones";
import { drawSurfaceEntrance } from "./entrance";
import { updateSurfaceFood, updateSurfaceResources, updateSurfaceCarrion, updateSurfaceLairs, updateSurfaceEnemies, updateSurfaceAnts, updateSurfaceWebs, updateSurfaceDebris, updateSurfaceShadows } from "./entities";

export function isInBounds(pos: Vec2, bounds: ViewBounds, padding = 0): boolean {
  return (
    pos.x >= bounds.left - padding &&
    pos.x <= bounds.right + padding &&
    pos.y >= bounds.top - padding &&
    pos.y <= bounds.bottom + padding
  );
}

export function visibleSurfaceBounds(camera: Camera, viewportWidth: number, viewportHeight: number): ViewBounds {
  const halfWidth = viewportWidth / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  const halfHeight = viewportHeight / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  return {
    left: camera.x - halfWidth - 2,
    right: camera.x + halfWidth + 2,
    top: camera.y - halfHeight - 2,
    bottom: camera.y + halfHeight + 2
  };
}

export function createSurfaceScene(): SurfaceScene {
  const root = new Container();
  const staticLayer = new Container();
  const shadowLayer = new Graphics();
  const entranceLayer = new Container();
  const fireGlow = new Graphics();
  const zonesOverlay = new Graphics();
  const buildingsLayer = new Graphics();
  const pheromones = new Graphics();
  const webs = new Graphics();
  const debrisGraphics = new Graphics();
  const foodContainer = new Container();
  const resourceContainer = new Container();
  const carrionContainer = new Container();
  const lairContainer = new Container();
  const enemyContainer = new Container();
  const carriedCarrionContainer = new Container();
  const antContainer = new Container();

  root.addChild(staticLayer, shadowLayer, zonesOverlay, buildingsLayer, entranceLayer, fireGlow, pheromones, webs, debrisGraphics, foodContainer, resourceContainer, carrionContainer, lairContainer, enemyContainer, carriedCarrionContainer, antContainer);

  return {
    root,
    staticLayer,
    shadowLayer,
    entranceLayer,
    fireGlow,
    zonesOverlay,
    buildingsLayer,
    pheromones,
    webs,
    debrisGraphics,
    foodPool: createSpritePool(foodContainer, () => createFoodSprite(2.2)),
    resourcePool: createSpritePool(resourceContainer, () => {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      return sprite;
    }),
    carrionPool: createSpritePool(carrionContainer, () => createCarrionSprite(2.6)),
    lairPool: createSpritePool(lairContainer, () => createSpiderLairSprite(3.4)),
    carriedCarrionPool: createSpritePool(carriedCarrionContainer, () => createCarrionSprite(1.7)),
    enemyPool: createSpritePool(enemyContainer, () => createSpiderSprite(4)),
    antPool: createSpritePool(antContainer, () => createClayfolkSprite(false, 2.85)),
    staticKey: "",
    entranceKey: "",
    zoneKey: ""
  };
}

function rebuildSurfaceStatic(
  scene: SurfaceScene,
  renderer: Renderer,
  world: WorldSnapshot,
  cell: number,
  staticKey: string
): void {
  scene.staticLayer.removeChildren();
  if (scene.groundSprite) {
    scene.groundSprite.destroy({ children: true, texture: true });
    scene.groundSprite = undefined;
  }

  if (scene.trampleSprite) {
    scene.trampleSprite.destroy({ texture: true });
    scene.trampleSprite = undefined;
  }
  if (scene.trampleTexture) {
    scene.trampleTexture.destroy(true);
    scene.trampleTexture = undefined;
  }
  if (scene.eraserGraphics) {
    scene.eraserGraphics.destroy();
    scene.eraserGraphics = undefined;
  }

  const tempContainer = new Container();
  const fullBounds: ViewBounds = {
    left: 0,
    right: world.surface.width,
    top: 0,
    bottom: world.surface.height
  };
  drawSurfaceGround(tempContainer, world, cell, fullBounds);

  const widthPx = world.surface.width * cell;
  const heightPx = world.surface.height * cell;
  const renderTexture = RenderTexture.create({
    width: widthPx,
    height: heightPx
  });

  renderer.render({
    container: tempContainer,
    target: renderTexture
  });

  const groundSprite = new Sprite(renderTexture);
  scene.staticLayer.addChild(groundSprite);
  scene.groundSprite = groundSprite;

  const trampleTexture = RenderTexture.create({
    width: world.surface.width,
    height: world.surface.height
  });
  const trampleSprite = new Sprite(trampleTexture);
  trampleSprite.width = world.surface.width * cell;
  trampleSprite.height = world.surface.height * cell;
  trampleSprite.tint = 0x6d5934; // Цвет протоптанной земли
  trampleSprite.alpha = 0.28; // Тропинки не перекрывают тайлы окружения

  scene.trampleTexture = trampleTexture;
  scene.trampleSprite = trampleSprite;
  scene.staticLayer.addChild(trampleSprite);

  tempContainer.destroy({ children: true });
  scene.staticKey = staticKey;
}

function updateSurfaceEntrances(scene: SurfaceScene, world: WorldSnapshot, cell: number, entranceKey: string): void {
  if (scene.entranceKey === entranceKey) {
    return;
  }

  const children = scene.entranceLayer.removeChildren();
  for (const child of children) {
    child.destroy({ children: true });
  }

  drawSurfaceEntrance(scene.entranceLayer, world, cell);
  scene.entranceKey = entranceKey;
}

// Постройки: площадка (контур) -> стройка (полупрозрачно) -> готово (плотный цвет глины).
function updateBuildings(layer: Graphics, world: WorldSnapshot, cell: number): void {
  layer.clear();
  const buildings = world.surface.buildings ?? [];
  for (const building of buildings) {
    const isRed = building.colonyId === "colony-2";
    const clayColor = isRed ? 0xd05236 : 0xbc6240;
    const darkColor = isRed ? 0x692018 : 0x5b281c;
    const x = building.pos.x * cell;
    const y = building.pos.y * cell;

    if (building.type === "wall") {
      const half = (WALL_CELL_SIZE / 2) * cell;
      if (building.stage === "site") {
        layer.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.4, color: clayColor, alpha: 0.55 });
      } else if (building.stage === "inProgress") {
        layer.rect(x - half, y - half, half * 2, half * 2).fill({ color: clayColor, alpha: 0.28 + building.progress * 0.4 });
        layer.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.4, color: darkColor, alpha: 0.7 });
      } else {
        layer.rect(x - half, y - half + 2, half * 2, half * 2).fill({ color: darkColor, alpha: 0.9 });
        layer.rect(x - half, y - half, half * 2, half * 2 - 2).fill({ color: clayColor, alpha: 1 });
        layer.rect(x - half + 1.5, y - half + 1.5, half * 2 - 3, 2.5).fill({ color: 0xef9a64, alpha: 0.7 });
      }
      continue;
    }

    if (building.type === "storage") {
      const half = 1.7 * cell;
      if (building.stage === "site") {
        layer.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: 0x8a5429, alpha: 0.6 });
        const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
        const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
        if (deliveredTotal > 0.5) {
          layer.rect(x - half, y + half - (half * 2 * deliveredTotal) / costTotal, half * 2, (half * 2 * deliveredTotal) / costTotal).fill({ color: 0x8a5429, alpha: 0.3 });
        }
      } else if (building.stage === "inProgress") {
        layer.rect(x - half, y - half, half * 2, half * 2).fill({ color: 0x8a5429, alpha: 0.35 + building.progress * 0.5 });
        layer.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: 0x4f2f16, alpha: 0.8 });
      } else {
        layer.ellipse(x + 2, y + half * 0.8, half * 1.2, half * 0.4).fill({ color: 0x24190f, alpha: 0.22 });
        layer.rect(x - half, y - half + 2, half * 2, half * 2).fill({ color: 0x4f2f16, alpha: 1 });
        layer.rect(x - half, y - half, half * 2, half * 2 - 2).fill({ color: 0x8a5429, alpha: 1 });
        layer.rect(x - half + 2, y - half + 2, half * 2 - 4, 3).fill({ color: 0xb98a52, alpha: 0.8 });
        layer.moveTo(x, y - half).lineTo(x, y + half).stroke({ width: 1.2, color: 0x4f2f16, alpha: 0.6 });
      }
      continue;
    }

    // Хижина.
    const radius = 2.1 * cell;
    if (building.stage === "site") {
      layer.circle(x, y, radius).stroke({ width: 1.6, color: clayColor, alpha: 0.6 });
      const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
      const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
      const fillRadius = radius * Math.min(1, deliveredTotal / costTotal);
      if (fillRadius > 1) {
        layer.circle(x, y, fillRadius).fill({ color: clayColor, alpha: 0.3 });
      }
    } else if (building.stage === "inProgress") {
      layer.circle(x, y, radius).fill({ color: clayColor, alpha: 0.35 + building.progress * 0.5 });
      layer.circle(x, y, radius).stroke({ width: 1.6, color: darkColor, alpha: 0.8 });
    } else {
      layer.ellipse(x + 2, y + radius * 0.55, radius * 1.15, radius * 0.4).fill({ color: 0x24190f, alpha: 0.22 });
      layer.circle(x, y, radius).fill({ color: darkColor, alpha: 1 });
      layer.circle(x, y - radius * 0.15, radius * 0.88).fill({ color: clayColor, alpha: 1 });
      layer.circle(x - radius * 0.3, y - radius * 0.42, radius * 0.3).fill({ color: 0xef9a64, alpha: 0.75 });
      layer.rect(x - radius * 0.28, y + radius * 0.25, radius * 0.56, radius * 0.6).fill({ color: 0x2f1812, alpha: 0.85 });
    }
  }
}

// Зоны игрока: полупрозрачный слой поверх земли (зелёная — добыча, красная — запрет).
function updateZonesOverlay(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  const zones = world.colonies?.[0]?.colony.zones;
  const key = zones ? `z${zones.version}` : "z0";
  if (scene.zoneKey === key) {
    return;
  }
  scene.zoneKey = key;

  const overlay = scene.zonesOverlay;
  overlay.clear();
  if (!zones) {
    return;
  }

  const gridWidth = Math.ceil(world.surface.width / ZONE_CELL_SIZE);
  const size = ZONE_CELL_SIZE * cell;
  for (const index of zones.harvest) {
    const x = (index % gridWidth) * size;
    const y = Math.floor(index / gridWidth) * size;
    overlay.rect(x, y, size, size).fill({ color: 0x7ec850, alpha: 0.17 });
  }
  for (const index of zones.forbid) {
    const x = (index % gridWidth) * size;
    const y = Math.floor(index / gridWidth) * size;
    overlay.rect(x, y, size, size).fill({ color: 0xd9534f, alpha: 0.19 });
  }
}

// Живое мерцание костра поверх статичного лагеря: два тёплых круга с альфой от тика.
function updateFireGlow(glow: Graphics, world: WorldSnapshot, cell: number): void {
  glow.clear();
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  const t = world.tick;
  for (let index = 0; index < entrances.length; index += 1) {
    const entrance = entrances[index];
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell) + 6;
    const flicker = 0.5 + 0.5 * Math.sin(t * 0.9 + index * 2.1) * Math.sin(t * 0.37 + index);
    glow.circle(x, y, 16 + flicker * 5).fill({ color: 0xffa63c, alpha: 0.1 + flicker * 0.08 });
    glow.circle(x + Math.sin(t * 0.7 + index) * 1.5, y - 2, 7 + flicker * 3).fill({ color: 0xffe07a, alpha: 0.16 + flicker * 0.12 });
  }
}

function updateTrample(scene: SurfaceScene, renderer: Renderer, world: WorldSnapshot): void {
  if (!scene.trampleTexture || !scene.trampleSprite) {
    return;
  }

  if (!scene.trailPainter) {
    scene.trailPainter = new Graphics();
  }

  const trailPainter = scene.trailPainter;
  trailPainter.clear();

  let hasSurfaceEntities = false;

  const ants = world.ants ?? [];
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    if (ant.layer === "surface") {
      hasSurfaceEntities = true;
      trailPainter.circle(ant.pos.x, ant.pos.y, 0.9).fill({ color: 0xffffff, alpha: 0.08 });
    }
  }

  const enemies = world.enemies ?? [];
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    hasSurfaceEntities = true;
    trailPainter.circle(enemy.pos.x, enemy.pos.y, 1.8).fill({ color: 0xffffff, alpha: 0.12 });
  }

  if (hasSurfaceEntities) {
    renderer.render({
      container: trailPainter,
      target: scene.trampleTexture,
      clear: false
    });
  }

  // Медленное затухание следов (зарастание травой)
  if (world.tick % 2 === 0) {
    if (!scene.eraserGraphics) {
      scene.eraserGraphics = new Graphics();
      scene.eraserGraphics
        .rect(0, 0, world.surface.width, world.surface.height)
        .fill({ color: 0xffffff, alpha: 0.005 });
      scene.eraserGraphics.blendMode = "erase";
    }

    renderer.render({
      container: scene.eraserGraphics,
      target: scene.trampleTexture,
      clear: false
    });
  }
}

export function renderSurface(
  scene: SurfaceScene,
  renderer: Renderer,
  world: WorldSnapshot,
  viewportWidth: number,
  viewportHeight: number,
  camera: Camera,
  trampleEnabled = true
): void {
  scene.root.scale.set(camera.zoom);
  scene.root.x = Math.round(viewportWidth * 0.5 - camera.x * SURFACE_TILE_SIZE * camera.zoom);
  scene.root.y = Math.round(viewportHeight * 0.5 - camera.y * SURFACE_TILE_SIZE * camera.zoom);

  const cell = SURFACE_TILE_SIZE;
  const bounds = visibleSurfaceBounds(camera, viewportWidth, viewportHeight);
  const staticKey = [
    world.surface.width,
    world.surface.height,
    "surface-art-edge-trees-v3"
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildSurfaceStatic(scene, renderer, world, cell, staticKey);
  }

  if (scene.trampleSprite) {
    scene.trampleSprite.visible = trampleEnabled;
  }

  if (trampleEnabled) {
    updateTrample(scene, renderer, world);
  }

  const storageLevels = world.colonies?.map((c) =>
    [
      Math.floor((c.colony.food ?? 0) / 10),
      Math.floor((c.colony.clay ?? 0) / 8),
      Math.floor((c.colony.wood ?? 0) / 8),
      Math.floor((c.colony.stone ?? 0) / 8)
    ].join("-")
  ) ?? [Math.floor((world.colony.food ?? 0) / 10)];
  const entranceKey = [
    ...(world.surface.entrances ?? [world.surface.entrance]).flatMap((entrance) => [entrance.x, entrance.y]),
    ...storageLevels
  ].join(":");
  updateSurfaceEntrances(scene, world, cell, entranceKey);
  updateFireGlow(scene.fireGlow, world, cell);
  updateZonesOverlay(scene, world, cell);
  updateBuildings(scene.buildingsLayer, world, cell);

  updateSurfaceShadows(scene.shadowLayer, world, cell, bounds);
  drawSurfacePheromones(scene.pheromones, world, cell, bounds);
  updateSurfaceWebs(scene.webs, world, cell, bounds);
  updateSurfaceDebris(scene.debrisGraphics, world, cell, bounds);
  updateSurfaceFood(scene.foodPool, world, cell, bounds);
  updateSurfaceResources(scene.resourcePool, world, cell, bounds);
  updateSurfaceCarrion(scene.carrionPool, world, cell, bounds);
  updateSurfaceLairs(scene.lairPool, world, cell, bounds);
  updateSurfaceEnemies(scene.enemyPool, scene.carriedCarrionPool, world, cell, bounds);
  updateSurfaceAnts(scene.antPool, scene.debrisGraphics, world, cell, bounds);
}
