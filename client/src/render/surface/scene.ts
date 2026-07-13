import { Container, Graphics, RenderTexture, Sprite, Renderer, TilingSprite } from "pixi.js";
import { WALL_CELL_SIZE, ZONE_CELL_SIZE, type Vec2, type WorldSnapshot } from "../../../../shared/types";
import { isDeepWaterAt, isWaterAt, SURFACE_TERRAIN_CELL_SIZE } from "../../../../shared/surfaceTerrain";
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
import { getEnvironmentTextures } from "./environment";
import { updateSurfaceFood, updateSurfaceResources, updateSurfaceCarrion, updateSurfaceLairs, updateSurfaceEnemies, updateSurfaceAnts, updateSurfaceFish, updateFishingEffects, updateSurfaceWebs, updateSurfaceShadows } from "./entities";
import { offsetSettings } from "./editor";
import { updateAndDrawParticles } from "./particles";

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
  const waterLayer = new Container();
  const fishLayer = new Container();
  const shadowLayer = new Graphics();
  const dynamicLayer = new Container();
  const fireGlow = new Graphics();
  const zonesOverlay = new Graphics();
  const pheromones = new Graphics();
  const webs = new Graphics();
  const selectionGraphics = new Graphics();
  const particleGraphics = new Graphics();
  const fishingGraphics = new Graphics();

  staticLayer.label = "staticLayer";
  waterLayer.label = "waterLayer";
  fishLayer.label = "fishLayer";
  shadowLayer.label = "shadowLayer";
  dynamicLayer.label = "dynamicLayer";
  dynamicLayer.sortableChildren = true; // Сортируем все человечки, кусты, ресурсы и здания по y-координате низа!
  fireGlow.label = "fireGlow";
  zonesOverlay.label = "zonesOverlay";
  pheromones.label = "pheromones";
  webs.label = "webs";
  selectionGraphics.label = "selectionGraphics";
  selectionGraphics.zIndex = 9000; // Оверлей выделения всегда рисуется поверх самих человечков
  particleGraphics.label = "particleGraphics";
  particleGraphics.zIndex = 1; // Частицы позади существ и объектов, но поверх земли
  fishingGraphics.label = "fishingGraphics";
  fishingGraphics.zIndex = 8990;

  // Собираем слои в корень сцены
  root.addChild(staticLayer, waterLayer, fishLayer, shadowLayer, zonesOverlay, pheromones, webs, dynamicLayer, fireGlow);
  dynamicLayer.addChild(selectionGraphics, particleGraphics, fishingGraphics);

  if (typeof window !== "undefined") {
    (window as any).printLayers = () => {
      console.log("PIXI LAYERS ORDER:", root.children.map((c) => c.label || c.constructor.name));
    };
  }

  return {
    root,
    staticLayer,
    waterLayer,
    fishLayer,
    shadowLayer,
    dynamicLayer,
    fireGlow,
    zonesOverlay,
    pheromones,
    webs,
    selectionGraphics,
    particleGraphics,
    fishingGraphics,
    buildingGraphics: [],
    buildingSprites: [],
    entranceGraphics: [],
    entranceSprites: [],
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
    fishPool: createSpritePool(fishLayer, () => new Sprite()),
    staticKey: "",
    entranceKey: "",
    buildingKey: "",
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
  scene.waterLayer.removeChildren();
  scene.waterSprites = [];
  scene.waterFrames = undefined;
  scene.waterFrame = undefined;
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

  buildLakeWaterLayer(scene, world, cell);

  tempContainer.destroy({ children: true });
  scene.staticKey = staticKey;
}

function buildLakeWaterLayer(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  const frames = getEnvironmentTextures().terrain;
  const widthPx = world.surface.width * cell;
  const heightPx = world.surface.height * cell;
  const shallowMask = new Graphics();
  const deepMask = new Graphics();
  const shoreTiles: Sprite[] = [];
  const terrainCell = SURFACE_TERRAIN_CELL_SIZE;
  const tilePx = terrainCell * cell;
  const columns = Math.ceil(world.surface.width / terrainCell);
  const rows = Math.ceil(world.surface.height / terrainCell);
  const waterCell = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < columns && y < rows &&
    isWaterAt((x + 0.5) * terrainCell, (y + 0.5) * terrainCell);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const worldX = (x + 0.5) * terrainCell;
      const worldY = (y + 0.5) * terrainCell;
      if (!isWaterAt(worldX, worldY)) {
        continue;
      }
      shallowMask.rect(x * tilePx, y * tilePx, tilePx, tilePx).fill(0xffffff);
      const dryN = !waterCell(x, y - 1);
      const dryS = !waterCell(x, y + 1);
      const dryW = !waterCell(x - 1, y);
      const dryE = !waterCell(x + 1, y);
      const addCorner = (
        texture: (typeof frames.lakeCorners.outer)["nw"],
        positionX: number,
        positionY: number
      ) => {
        const corner = new Sprite(texture);
        corner.position.set(positionX * tilePx, positionY * tilePx);
        corner.width = tilePx * 2;
        corner.height = tilePx * 2;
        shoreTiles.push(corner);
      };
      const addInnerCornerWater = (
        dryCellX: number,
        dryCellY: number,
        direction: "nw" | "ne" | "sw" | "se"
      ) => {
        const centerOnLeft = direction === "nw" || direction === "sw";
        const centerOnTop = direction === "nw" || direction === "ne";
        const radius = tilePx;
        for (let row = 0; row < Math.ceil(tilePx); row += 1) {
          const dy = centerOnTop ? row + 0.5 : tilePx - row - 0.5;
          const boundary = Math.sqrt(Math.max(0, radius * radius - dy * dy));
          if (centerOnLeft) {
            const start = Math.ceil(boundary);
            shallowMask.rect(dryCellX * tilePx + start, dryCellY * tilePx + row, tilePx - start, 1).fill(0xffffff);
          } else {
            const width = Math.max(0, Math.floor(tilePx - boundary));
            shallowMask.rect(dryCellX * tilePx, dryCellY * tilePx + row, width, 1).fill(0xffffff);
          }
        }
      };
      const addEdge = (direction: "n" | "s" | "w" | "e") => {
        const edge = new Sprite(frames.lakeBank);
        edge.anchor.set(0.5);
        edge.width = tilePx;
        edge.height = tilePx * 2;
        if (direction === "n") edge.position.set((x + 0.5) * tilePx, y * tilePx);
        else if (direction === "s") {
          edge.position.set((x + 0.5) * tilePx, (y + 1) * tilePx);
          edge.rotation = Math.PI;
        } else if (direction === "w") {
          edge.position.set(x * tilePx, (y + 0.5) * tilePx);
          edge.rotation = -Math.PI / 2;
        } else {
          edge.position.set((x + 1) * tilePx, (y + 0.5) * tilePx);
          edge.rotation = Math.PI / 2;
        }
        shoreTiles.push(edge);
      };
      const outerNW = dryN && dryW;
      const outerNE = dryN && dryE;
      const outerSW = dryS && dryW;
      const outerSE = dryS && dryE;
      const innerReplacesN = dryN && (waterCell(x - 1, y - 1) || waterCell(x + 1, y - 1));
      const innerReplacesS = dryS && (waterCell(x - 1, y + 1) || waterCell(x + 1, y + 1));
      const innerReplacesW = dryW && (waterCell(x - 1, y - 1) || waterCell(x - 1, y + 1));
      const innerReplacesE = dryE && (waterCell(x + 1, y - 1) || waterCell(x + 1, y + 1));

      // Convex turns replace the two intersecting straight strips with a proper
      // quarter-circle made from the very same bank pixels.
      if (outerNW) addCorner(frames.lakeCorners.outer.nw, x - 1, y - 1);
      if (outerNE) addCorner(frames.lakeCorners.outer.ne, x, y - 1);
      if (outerSW) addCorner(frames.lakeCorners.outer.sw, x - 1, y);
      if (outerSE) addCorner(frames.lakeCorners.outer.se, x, y);

      if (dryN && !outerNW && !outerNE && !innerReplacesN) addEdge("n");
      if (dryS && !outerSW && !outerSE && !innerReplacesS) addEdge("s");
      if (dryW && !outerNW && !outerSW && !innerReplacesW) addEdge("w");
      if (dryE && !outerNE && !outerSE && !innerReplacesE) addEdge("e");

      // Concave turns are detected by diagonal land surrounded by water. These
      // four checks deliberately stay independent for arbitrary generated maps.
      if (!dryN && !dryW && !waterCell(x - 1, y - 1)) {
        addInnerCornerWater(x - 1, y - 1, "nw");
        addCorner(frames.lakeCorners.inner.nw, x - 1, y - 1);
      }
      if (!dryN && !dryE && !waterCell(x + 1, y - 1)) {
        addInnerCornerWater(x + 1, y - 1, "ne");
        addCorner(frames.lakeCorners.inner.ne, x, y - 1);
      }
      if (!dryS && !dryW && !waterCell(x - 1, y + 1)) {
        addInnerCornerWater(x - 1, y + 1, "sw");
        addCorner(frames.lakeCorners.inner.sw, x - 1, y);
      }
      if (!dryS && !dryE && !waterCell(x + 1, y + 1)) {
        addInnerCornerWater(x + 1, y + 1, "se");
        addCorner(frames.lakeCorners.inner.se, x, y);
      }
    }
  }
  // Depth transition uses a finer visual grid than collision/shore autotiles.
  // This keeps large deep-water masses organic without changing straight banks.
  const depthCell = 2;
  for (let y = 0; y < world.surface.height; y += depthCell) {
    for (let x = 0; x < world.surface.width; x += depthCell) {
      if (isDeepWaterAt(x + depthCell / 2, y + depthCell / 2)) {
        deepMask.rect(x * cell, y * cell, depthCell * cell, depthCell * cell).fill(0xffffff);
      }
    }
  }

  const shallow = TilingSprite.from(frames.lakeShallowFrames[0], { width: widthPx, height: heightPx });
  const deep = TilingSprite.from(frames.lakeDeepFrames[0], { width: widthPx, height: heightPx });
  shallow.mask = shallowMask;
  deep.mask = deepMask;
  shallow.tilePosition.set(7, 11);
  deep.tilePosition.set(19, 3);
  scene.waterLayer.addChild(shallow, deep, ...shoreTiles, shallowMask, deepMask);
  scene.waterSprites = [
    { sprite: shallow, depth: "shallow", phase: 0 },
    { sprite: deep, depth: "deep", phase: 3 }
  ];
  scene.waterFrames = { shallow: frames.lakeShallowFrames, deep: frames.lakeDeepFrames };
}

function updateLakeWater(scene: SurfaceScene): void {
  if (!scene.waterSprites || !scene.waterFrames) {
    return;
  }
  const frame = Math.floor(Date.now() / 145) % scene.waterFrames.shallow.length;
  if (scene.waterFrame === frame) {
    return;
  }
  scene.waterFrame = frame;
  for (const entry of scene.waterSprites) {
    const frames = entry.depth === "shallow" ? scene.waterFrames.shallow : scene.waterFrames.deep;
    entry.sprite.texture = frames[(frame + entry.phase) % frames.length];
  }
}

function updateSurfaceEntrances(scene: SurfaceScene, world: WorldSnapshot, cell: number, entranceKey: string): void {
  // Сначала удаляем старые Graphics входов
  for (const g of scene.entranceGraphics ?? []) {
    g.destroy();
  }
  scene.entranceGraphics = [];
  for (const sprite of scene.entranceSprites ?? []) {
    sprite.destroy();
  }
  scene.entranceSprites = [];

  const campfireFrames = getEnvironmentTextures().props.campfireFrames;
  const campfireFrame = campfireFrames[Math.floor(world.tick / 8) % campfireFrames.length];
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

    const campfire = new Sprite(campfireFrame);
    campfire.anchor.set(0.5, 1);
    campfire.position.set(x, y + 29);
    campfire.scale.set(0.46);
    campfire.zIndex = y + 18;
    campfire.label = `campfire_${index}`;
    scene.dynamicLayer.addChild(campfire);
    scene.entranceSprites?.push(campfire);
  });
}

// Постройки: площадка (контур) -> стройка (полупрозрачно) -> готово (плотный цвет глины).
function updateBuildings(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  const buildings = world.surface.buildings ?? [];
  const buildingKey = buildings.map((building) => [
    building.id,
    building.type,
    building.stage,
    building.pos.x,
    building.pos.y,
    building.progress,
    building.delivered.clay,
    building.delivered.wood,
    building.delivered.stone,
    building.colonyId
  ].join(":")).join("|");
  if (scene.buildingKey === buildingKey) {
    return;
  }
  scene.buildingKey = buildingKey;

  // Сначала удаляем старые Graphics зданий
  for (const g of scene.buildingGraphics ?? []) {
    g.destroy();
  }
  scene.buildingGraphics = [];
  for (const sprite of scene.buildingSprites ?? []) {
    sprite.destroy();
  }
  scene.buildingSprites = [];

  // Собираем все координаты готовых стен
  const wallPositions = new Set<string>();
  for (const b of buildings) {
    if ((b.type === "wall" || b.type === "gate") && b.stage === "built") {
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

    if (building.type === "wall" || building.type === "gate") {
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
          // Тень падает вниз от стены (к камере)
          g.rect(xLeft, y + half, width, 4).fill({ color: 0x1d120b, alpha: 0.24 });
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

        // Ворота: тёмный проём и светлая перекладина — читается как проход.
        if (building.type === "gate") {
          const gapWidth = Math.max(3, half * 0.9);
          g.rect(x - gapWidth / 2, y - half - wallRise + 3, gapWidth, wallRise + half * 2 - 4).fill({ color: 0x2e1d12, alpha: 0.92 });
          g.rect(x - gapWidth / 2 - 1, y - half - wallRise + 1, gapWidth + 2, 2.4).fill({ color: 0xf7c979, alpha: 0.95 });
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
        // Тень смещена еще выше под основание строения
        g.ellipse(x + 3, y + half * 0.65, half * 1.25, half * 0.34).fill({ color: 0x1d120b, alpha: 0.24 });

        const storage = new Sprite(getEnvironmentTextures().props.storage);
        storage.anchor.set(0.5, 1);
        storage.position.set(Math.round(x), Math.round(y + half * 0.92));
        storage.scale.set((half * 2.65) / Math.max(1, storage.texture.width));
        storage.zIndex = g.zIndex + 0.1;
        storage.label = `storage_${building.id}`;
        scene.dynamicLayer.addChild(storage);
        scene.buildingSprites?.push(storage);
      }
    } else if (building.type === "workshop") {
      const half = 3.2 * cell;
      g.zIndex = y + half;

      if (building.stage === "site") {
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: 0x6b4a2b, alpha: 0.65 });
        const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
        const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
        if (deliveredTotal > 0.5) {
          g.rect(x - half, y + half - (half * 2 * deliveredTotal) / costTotal, half * 2, (half * 2 * deliveredTotal) / costTotal).fill({ color: 0xbc6240, alpha: 0.28 });
        }
      } else if (building.stage === "inProgress") {
        g.rect(x - half, y - half, half * 2, half * 2).fill({ color: 0xbc6240, alpha: 0.3 + building.progress * 0.42 });
        g.rect(x - half, y - half, half * 2, half * 2).stroke({ width: 1.6, color: darkColor, alpha: 0.8 });
      } else {
        // Тень смещена еще выше под основание строения
        g.ellipse(x + 4, y + half * 0.75, half * 1.6, half * 0.42).fill({ color: 0x1d120b, alpha: 0.24 });

        const workshop = new Sprite(getEnvironmentTextures().props.workshop);
        workshop.anchor.set(0.5, 1);
        workshop.position.set(Math.round(x), Math.round(y + half * 1.08));
        workshop.scale.set((half * 4.0) / Math.max(1, workshop.texture.width));
        workshop.zIndex = g.zIndex + 0.1;
        workshop.label = `workshop_${building.id}`;
        scene.dynamicLayer.addChild(workshop);
        scene.buildingSprites?.push(workshop);
      }
    } else if (building.type === "idol") {
      // Идол-тотем: столб с маской. Хитрая победа партии.
      const poleH = 5.5 * cell;
      const maskR = 1.6 * cell;
      g.zIndex = y + 4;

      if (building.stage === "site") {
        g.circle(x, y, 2.2 * cell).stroke({ width: 1.6, color: darkColor, alpha: 0.6 });
        const deliveredTotal = building.delivered.clay + building.delivered.wood + building.delivered.stone;
        const costTotal = Math.max(1, building.cost.clay + building.cost.wood + building.cost.stone);
        if (deliveredTotal > 0.5) {
          g.circle(x, y, 2.2 * cell * Math.min(1, deliveredTotal / costTotal)).fill({ color: clayColor, alpha: 0.3 });
        }
      } else if (building.stage === "inProgress") {
        g.rect(x - 3, y - poleH * building.progress, 6, poleH * building.progress).fill({ color: clayColor, alpha: 0.7 });
        g.circle(x, y, 2.2 * cell).stroke({ width: 1.6, color: darkColor, alpha: 0.8 });
      } else {
        // Тень смещена еще выше под основание идола
        g.ellipse(x + 2, y - 6, 2.4 * cell, 0.7 * cell).fill({ color: 0x1d120b, alpha: 0.24 });
        g.rect(x - 3, y - poleH, 6, poleH + 2).fill({ color: 0x8a5429, alpha: 1 });
        g.rect(x - 8, y - poleH * 0.55, 16, 3).fill({ color: 0x8a5429, alpha: 1 });
        g.circle(x, y - poleH, maskR).fill({ color: clayColor, alpha: 1 });
        g.circle(x, y - poleH, maskR).stroke({ width: 1.5, color: darkColor, alpha: 1 });
        g.circle(x - maskR * 0.4, y - poleH - maskR * 0.15, 1.6).fill({ color: 0x2f1812, alpha: 1 });
        g.circle(x + maskR * 0.4, y - poleH - maskR * 0.15, 1.6).fill({ color: 0x2f1812, alpha: 1 });
        g.rect(x - maskR * 0.35, y - poleH + maskR * 0.35, maskR * 0.7, 1.6).fill({ color: 0x2f1812, alpha: 0.9 });
        g.circle(x, y - poleH - maskR - 2, 1.4).fill({ color: 0xef9a64, alpha: 0.9 });
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
        // Тень смещена еще выше под основание хижины
        g.ellipse(x + 3, y + radius * 0.5, radius * 1.18, radius * 0.34).fill({ color: 0x1d120b, alpha: 0.24 });

        const hut = new Sprite(getEnvironmentTextures().props.hut);
        hut.anchor.set(0.5, 1);
        hut.position.set(Math.round(x), Math.round(y + radius * 0.72));
        hut.scale.set((radius * 2.45) / Math.max(1, hut.texture.width));
        hut.zIndex = g.zIndex + 0.1;
        hut.label = `hut_${building.id}`;
        scene.dynamicLayer.addChild(hut);
        scene.buildingSprites?.push(hut);
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
    // Уровень огня (colony.fire 0..1): без дров костёр гаснет — пламя меньше и тусклее.
    const fire = world.colonies?.[index]?.colony.fire ?? 1;
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell) + 6;

    if (fire <= 0.05) {
      // Потух: угольки и струйка дыма.
      glow.circle(x, y, 4).fill({ color: 0x5a3a28, alpha: 0.5 });
      glow.circle(x + Math.sin(t * 0.3 + index) * 2, y - 8 - (t % 24) * 0.4, 2.5).fill({ color: 0x9a9a94, alpha: 0.18 });
      continue;
    }

    const fireScale = 0.35 + fire * 0.65;
    const fireBright = 0.5 + fire * 0.5;
    const flicker = 0.5 + 0.5 * Math.sin(t * config.pulseSpeed * 8.18 + index * 2.1) * Math.sin(t * config.pulseSpeed * 3.36 + index);
    const pulseOffset = flicker * config.pulseAmp * cell * fireScale;

    // Внешний круг мягкого рассеивания
    glow.circle(x, y, config.outerRadius * cell * 0.5 * fireScale + pulseOffset).fill({
      color: 0xff7a00,
      alpha: (config.outerAlpha + flicker * config.pulseAmp * 0.5) * fireBright
    });

    // Внутренний круг яркого центра
    glow.circle(x + Math.sin(t * 0.7 + index) * 1.5, y - 2, config.innerRadius * cell * 0.5 * fireScale + pulseOffset * 0.6).fill({
      color: 0xffe07a,
      alpha: (config.innerAlpha + flicker * config.pulseAmp) * fireBright
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
  scene.root.addChild(scene.waterLayer);
  scene.root.addChild(scene.fishLayer);
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
  updateLakeWater(scene);
  updateSurfaceFish(scene.fishPool, world, cell, bounds);

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
  updateSurfaceFood(scene.foodPool, world, cell, bounds);
  updateSurfaceResources(scene.resourcePool, world, cell, bounds);
  updateSurfaceCarrion(scene.carrionPool, world, cell, bounds);
  updateSurfaceLairs(scene.lairPool, world, cell, bounds);
  updateSurfaceEnemies(scene.enemyPool, scene.carriedCarrionPool, world, cell, bounds);
  updateFishingEffects(scene.fishingGraphics, world, cell, bounds);
  updateSurfaceAnts(scene.antPool, scene.carriedItemsPool, scene.selectionGraphics, world, cell, bounds);
  updateAndDrawParticles(scene.particleGraphics, world, cell, camera, viewportWidth, viewportHeight);
}
