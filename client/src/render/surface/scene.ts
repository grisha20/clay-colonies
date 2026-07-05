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
import { drawSurfaceEntranceAt } from "./entrance";
import { updateSurfaceFood, updateSurfaceResources, updateSurfaceCarrion, updateSurfaceLairs, updateSurfaceEnemies, updateSurfaceAnts, updateSurfaceWebs, updateSurfaceDebris, updateSurfaceShadows } from "./entities";
import { offsetSettings } from "./editor";

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
  const dynamicLayer = new Container();
  const fireGlow = new Graphics();
  const zonesOverlay = new Graphics();
  const pheromones = new Graphics();
  const webs = new Graphics();
  const debrisGraphics = new Graphics();

  staticLayer.label = "staticLayer";
  shadowLayer.label = "shadowLayer";
  dynamicLayer.label = "dynamicLayer";
  dynamicLayer.sortableChildren = true; // Сортируем все человечки, кусты, ресурсы и здания по y-координате низа!
  fireGlow.label = "fireGlow";
  zonesOverlay.label = "zonesOverlay";
  pheromones.label = "pheromones";
  webs.label = "webs";
  debrisGraphics.label = "debrisGraphics";
  debrisGraphics.zIndex = 9000; // Мусор и оверлей выделения всегда рисуются поверх самих человечков

  // Собираем слои в корень сцены
  root.addChild(staticLayer, shadowLayer, zonesOverlay, pheromones, webs, dynamicLayer, fireGlow);
  dynamicLayer.addChild(debrisGraphics);

  if (typeof window !== "undefined") {
    (window as any).printLayers = () => {
      console.log("PIXI LAYERS ORDER:", root.children.map((c) => c.label || c.constructor.name));
    };
  }

  return {
    root,
    staticLayer,
    shadowLayer,
    dynamicLayer,
    fireGlow,
    zonesOverlay,
    pheromones,
    webs,
    debrisGraphics,
    buildingGraphics: [],
    entranceGraphics: [],
    foodPool: createSpritePool(dynamicLayer, () => createFoodSprite(2.2)),
    resourcePool: createSpritePool(dynamicLayer, () => {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      return sprite;
    }),
    carrionPool: createSpritePool(dynamicLayer, () => createCarrionSprite(2.6)),
    lairPool: createSpritePool(dynamicLayer, () => createSpiderLairSprite(3.4)),
    carriedCarrionPool: createSpritePool(dynamicLayer, () => createCarrionSprite(1.7)),
    enemyPool: createSpritePool(dynamicLayer, () => createSpiderSprite(4)),
    antPool: createSpritePool(dynamicLayer, () => createClayfolkSprite(false, 2.85)),
    carriedItemsPool: createSpritePool(dynamicLayer, () => new Sprite()),
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

  // Удаляем старые статические декорации из dynamicLayer перед перестроением
  const toRemove = scene.dynamicLayer.children.filter(c => c.label === "static_prop");
  for (const child of toRemove) {
    scene.dynamicLayer.removeChild(child);
    child.destroy();
  }

  const tempContainer = new Container();
  const fullBounds: ViewBounds = {
    left: 0,
    right: world.surface.width,
    top: 0,
    bottom: world.surface.height
  };
  drawSurfaceGround(tempContainer, scene.dynamicLayer, world, cell, fullBounds);

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
  // Сначала удаляем старые Graphics входов
  for (const g of scene.entranceGraphics ?? []) {
    g.destroy();
  }
  scene.entranceGraphics = [];

  const entrances = world.surface.entrances ?? [world.surface.entrance];
  entrances.forEach((entrance, index) => {
    const colony = world.colonies?.[index];
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell);

    const g = new Graphics();
    g.label = `entrance_${index}`;
    // Точка опоры костра базы (под костром)
    g.zIndex = y + 24;

    drawSurfaceEntranceAt(
      g,
      entrance,
      cell,
      index === 1 ? "red" : "dark",
      colony?.colony.food ?? world.colony.food,
      colony?.colony.clay ?? 0,
      colony?.colony.wood ?? 0,
      colony?.colony.stone ?? 0
    );

    scene.dynamicLayer.addChild(g);
    scene.entranceGraphics?.push(g);
  });
}

// Постройки: площадка (контур) -> стройка (полупрозрачно) -> готово (плотный цвет глины).
function updateBuildings(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  // Сначала удаляем старые Graphics зданий
  for (const g of scene.buildingGraphics ?? []) {
    g.destroy();
  }
  scene.buildingGraphics = [];

  const buildings = world.surface.buildings ?? [];

  // Собираем все координаты готовых стен
  const wallPositions = new Set<string>();
  for (const b of buildings) {
    if (b.type === "wall" && b.stage === "built") {
      wallPositions.add(`${Math.round(b.pos.x)},${Math.round(b.pos.y)}`);
    }
  }

  for (const building of buildings) {
    const isRed = building.colonyId === "colony-2";
    const clayColor = isRed ? 0xd05236 : 0xbc6240;
    const darkColor = isRed ? 0x692018 : 0x5b281c;
    const x = building.pos.x * cell;
    const y = building.pos.y * cell;

    const g = new Graphics();
    g.label = `building_${building.type}_${building.id}`;

    if (building.type === "wall") {
      const half = (WALL_CELL_SIZE / 2) * cell;
      // Основание стены
      g.zIndex = y + half;

      if (building.stage === "site") {
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.4, color: clayColor, alpha: 0.55 });
      } else if (building.stage === "inProgress") {
        g.rect(x - half, y - half, half * 2, half * 2).fill({ color: clayColor, alpha: 0.28 + building.progress * 0.4 });
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.4, color: darkColor, alpha: 0.7 });
      } else {
        const bx = Math.round(building.pos.x);
        const by = Math.round(building.pos.y);
        const hasLeft = wallPositions.has(`${bx - 2},${by}`);
        const hasRight = wallPositions.has(`${bx + 2},${by}`);
        const hasUp = wallPositions.has(`${bx},${by - 2}`);
        const hasDown = wallPositions.has(`${bx},${by + 2}`);

        // Объёмная стена выше жителей: тень, лицевая грань, светлый верх.
        const wallRise = offsetSettings.buildingGeometry.wallRise * cell;
        const topDepth = 4;

        // Нахлесты для сглаживания швов по горизонтали
        const xLeft = hasLeft ? x - half : x - half - 1;
        const xRight = hasRight ? x + half : x + half + 1;
        const width = xRight - xLeft;

        // 1. Рисуем тень (только если нет соседа снизу)
        if (!hasDown) {
          g.rect(xLeft, y + half - 2, width, 4).fill({ color: 0x24190f, alpha: 0.25 });
        }

        // 2. Отрисовка геометрии стены
        if (hasDown) {
          // Если есть сосед снизу, рисуем только сплошную крышу до нижнего соседа
          g.rect(xLeft, y - half - wallRise - topDepth, width, half * 2 + topDepth + 1).fill({ color: 0xef9a64, alpha: 1 });
          if (!hasUp) {
            g.rect(xLeft, y - half - wallRise - topDepth, width, 2).fill({ color: 0xffffff, alpha: 0.2 });
          }
        } else {
          // Соседа снизу нет -> рисуем полноценную лицевую грань и крышу сверху
          g.rect(xLeft, y - half - wallRise, width, wallRise + half * 2).fill({ color: clayColor, alpha: 1 });
          g.rect(xLeft, y + half - 3, width, 3).fill({ color: darkColor, alpha: 0.9 });
          g.rect(xLeft, y - half - wallRise - topDepth, width, topDepth + 2).fill({ color: 0xef9a64, alpha: 1 });

          if (!hasUp) {
            g.rect(xLeft, y - half - wallRise - topDepth, width, 1.2).fill({ color: 0xffffff, alpha: 0.25 });
          }
          g.rect(xLeft, y - half - wallRise + 2, width, 1.6).fill({ color: darkColor, alpha: 0.35 });
        }
      }
    } else if (building.type === "storage") {
      const half = 2.9 * cell;
      // Основание склада
      g.zIndex = y + half;

      if (building.stage === "site") {
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: 0x8a5429, alpha: 0.6 });
        const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
        const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
        if (deliveredTotal > 0.5) {
          g.rect(x - half, y + half - (half * 2 * deliveredTotal) / costTotal, half * 2, (half * 2 * deliveredTotal) / costTotal).fill({ color: 0x8a5429, alpha: 0.3 });
        }
      } else if (building.stage === "inProgress") {
        g.rect(x - half, y - half, half * 2, half * 2).fill({ color: 0x8a5429, alpha: 0.35 + building.progress * 0.5 });
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: 0x4f2f16, alpha: 0.8 });
      } else {
        // Сарай с двускатной крышей, по росту жителей.
        const roofRise = offsetSettings.buildingGeometry.roofRise * cell;
        g.ellipse(x + 2, y + half * 0.9, half * 1.25, half * 0.42).fill({ color: 0x24190f, alpha: 0.22 });
        g.rect(x - half, y - half * 0.2, half * 2, half * 1.2).fill({ color: 0x4f2f16, alpha: 1 });
        g.rect(x - half, y - half * 0.3, half * 2, half * 1.2).fill({ color: 0x8a5429, alpha: 1 });
        g.poly([
          x - half - 2, y - half * 0.3,
          x, y - half * 0.3 - roofRise,
          x + half + 2, y - half * 0.3
        ]).fill({ color: 0xb98a52, alpha: 1 });
        g.poly([
          x - half - 2, y - half * 0.3,
          x, y - half * 0.3 - roofRise,
          x, y - half * 0.3
        ]).fill({ color: 0x9a733f, alpha: 0.6 });
        g.rect(x - half * 0.28, y + half * 0.2, half * 0.56, half * 0.7).fill({ color: 0x2f1812, alpha: 0.9 });
      }
    } else {
      // Хижина
      const radius = offsetSettings.buildingGeometry.hutRadius * cell;
      // Основание хижины
      g.zIndex = y + radius;

      if (building.stage === "site") {
        g.circle(x, y, radius).stroke({ width: 1.6, color: clayColor, alpha: 0.6 });
        const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
        const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
        const fillRadius = radius * Math.min(1, deliveredTotal / costTotal);
        if (fillRadius > 1) {
          g.circle(x, y, fillRadius).fill({ color: clayColor, alpha: 0.3 });
        }
      } else if (building.stage === "inProgress") {
        g.circle(x, y, radius).fill({ color: clayColor, alpha: 0.35 + building.progress * 0.5 });
        g.circle(x, y, radius).stroke({ width: 1.6, color: darkColor, alpha: 0.8 });
      } else {
        g.ellipse(x + 2, y + radius * 0.55, radius * 1.15, radius * 0.4).fill({ color: 0x24190f, alpha: 0.22 });
        g.circle(x, y, radius).fill({ color: darkColor, alpha: 1 });
        g.circle(x, y - radius * 0.15, radius * 0.88).fill({ color: clayColor, alpha: 1 });
        g.circle(x - radius * 0.3, y - radius * 0.42, radius * 0.3).fill({ color: 0xef9a64, alpha: 0.75 });
        g.rect(x - radius * 0.28, y + radius * 0.25, radius * 0.56, radius * 0.6).fill({ color: 0x2f1812, alpha: 0.85 });
      }
    }

    scene.dynamicLayer.addChild(g);
    scene.buildingGraphics?.push(g);
  }
}

// Зоны игроков: полупрозрачный слой поверх земли (зелёная — добыча, красная — запрет).
// Рисуются зоны ОБОИХ племён; у племени B — свои оттенки, чтобы не путать.
function updateZonesOverlay(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  const colonies = world.colonies ?? [];
  const key = colonies.map((item, index) => `${index}:${item.colony.zones?.version ?? 0}`).join("|");
  if (scene.zoneKey === key) {
    return;
  }
  scene.zoneKey = key;

  const overlay = scene.zonesOverlay;
  overlay.clear();

  const gridWidth = Math.ceil(world.surface.width / ZONE_CELL_SIZE);
  const size = ZONE_CELL_SIZE * cell;
  colonies.forEach((item, index) => {
    const zones = item.colony.zones;
    if (!zones) {
      return;
    }
    const harvestColor = index === 1 ? 0x4fb8a8 : 0x7ec850;
    const forbidColor = index === 1 ? 0xc03a8a : 0xd9534f;
    for (const cellIndex of zones.harvest) {
      const x = (cellIndex % gridWidth) * size;
      const y = Math.floor(cellIndex / gridWidth) * size;
      overlay.rect(x, y, size, size).fill({ color: harvestColor, alpha: 0.17 });
    }
    for (const cellIndex of zones.forbid) {
      const x = (cellIndex % gridWidth) * size;
      const y = Math.floor(cellIndex / gridWidth) * size;
      overlay.rect(x, y, size, size).fill({ color: forbidColor, alpha: 0.19 });
    }
  });
}

function updateFireGlow(glow: Graphics, world: WorldSnapshot, cell: number): void {
  glow.clear();
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  const t = world.tick;
  const config = offsetSettings.fireGlow;

  for (let index = 0; index < entrances.length; index += 1) {
    const entrance = entrances[index];
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell) + 6;
    const flicker = 0.5 + 0.5 * Math.sin(t * config.pulseSpeed * 8.18 + index * 2.1) * Math.sin(t * config.pulseSpeed * 3.36 + index);
    const pulseOffset = flicker * config.pulseAmp * cell;

    // Внешний круг мягкого рассеивания
    glow.circle(x, y, config.outerRadius * cell * 0.5 + pulseOffset).fill({
      color: 0xff7a00,
      alpha: config.outerAlpha + flicker * config.pulseAmp * 0.5
    });

    // Внутренний круг яркого центра
    glow.circle(x + Math.sin(t * 0.7 + index) * 1.5, y - 2, config.innerRadius * cell * 0.5 + pulseOffset * 0.6).fill({
      color: 0xffe07a,
      alpha: config.innerAlpha + flicker * config.pulseAmp
    });
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

  // Гарантируем правильный порядок слоев (особенно важно при HMR перезагрузках Vite)
  scene.root.addChild(scene.staticLayer);
  scene.root.addChild(scene.shadowLayer);
  scene.root.addChild(scene.zonesOverlay);
  scene.root.addChild(scene.pheromones);
  scene.root.addChild(scene.webs);
  scene.root.addChild(scene.dynamicLayer);
  scene.root.addChild(scene.fireGlow);

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
  updateBuildings(scene, world, cell);

  updateSurfaceShadows(scene.shadowLayer, world, cell, bounds);
  drawSurfacePheromones(scene.pheromones, world, cell, bounds);
  updateSurfaceWebs(scene.webs, world, cell, bounds);
  updateSurfaceDebris(scene.debrisGraphics, world, cell, bounds);
  updateSurfaceFood(scene.foodPool, world, cell, bounds);
  updateSurfaceResources(scene.resourcePool, world, cell, bounds);
  updateSurfaceCarrion(scene.carrionPool, world, cell, bounds);
  updateSurfaceLairs(scene.lairPool, world, cell, bounds);
  updateSurfaceEnemies(scene.enemyPool, scene.carriedCarrionPool, world, cell, bounds);
  updateSurfaceAnts(scene.antPool, scene.carriedItemsPool, scene.debrisGraphics, world, cell, bounds);
}
