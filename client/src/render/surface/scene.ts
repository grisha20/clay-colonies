import { Container, Graphics, MaskFilter, RenderTexture, Sprite, Renderer, TilingSprite, Texture } from "pixi.js";
import { WALL_CELL_SIZE, ZONE_CELL_SIZE, type Vec2, type WorldSnapshot } from "../../../../shared/types";
import { lakeFieldAt, isWaterAt, SURFACE_TERRAIN_CELL_SIZE, surfaceTerrainRevision } from "../../../../shared/surfaceTerrain";
import { createSpritePool } from "../spritePool";
import type { Camera, SurfaceScene, ViewBounds } from "../types";
import { SURFACE_TILE_SIZE } from "../types";
import {
  createSpiderLairSprite
} from "../../sprites";
import { drawSurfaceGround } from "./ground";
import { drawSurfacePheromones } from "./pheromones";
import { drawSurfaceEntranceAt } from "./entrance";
import { getEnvironmentTextures } from "./environment";
import { updateSurfaceFood, updateSurfaceResources, updateSurfaceCarrion, updateSurfaceLairs, updateSurfaceEnemies, updateSurfaceAnts, updateSurfaceFish, updateFishingEffects, updateSurfaceWebs, updateSurfaceShadows, updatePropContacts } from "./entities";
import { offsetSettings } from "./editor";
import { updateAndDrawParticles } from "./particles";
import { drawGameplay } from "./gameplay";
import { actorMotion } from "./motion";
import { surfaceLighting } from "./lighting";
import { getBuildingArt } from "./buildingArt";
import { buildingFootprint } from "../../../../shared/buildingGeometry";
import { campStockSprites } from "./campStock";
import { royalWalk } from "./royals";
import { drawBuildingGround } from "./buildingGround";
import { updateFootprints } from "./footprints";
import { updateLakeDetails } from "./lakeArt";
import { drawFences } from "./fenceRender";
import { fenceCellCenters } from "../../../../shared/fenceGeometry";
import { buildingGardens } from "./gardenArt";
import { updateDeposits } from "./deposits";

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
  const campGround = new Container();
  const depositGround = new Container();
  const buildingGround = new Graphics();
  const footGround = new Graphics(), lakeDetails = new Container(), lakeRipples = new Graphics();
  const dynamicLayer = new Container();
  const fireGlow = new Graphics();
  const zonesOverlay = new Graphics();
  const pheromones = new Graphics();
  const webs = new Graphics();
  const selectionGraphics = new Graphics();
  const particleGraphics = new Graphics();
  const fishingGraphics = new Graphics();
  const gameplayGraphics = new Graphics();
  gameplayGraphics.zIndex = 8995;
  const nightVeil = new Sprite();

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
  root.addChild(staticLayer, depositGround, waterLayer, fishLayer, lakeDetails, lakeRipples, campGround, buildingGround, footGround, fireGlow, shadowLayer, zonesOverlay, pheromones, webs, dynamicLayer, nightVeil);
  dynamicLayer.addChild(selectionGraphics, particleGraphics, fishingGraphics, gameplayGraphics);

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
    campGround,
    depositGround,
    buildingGround,
    footGround, lakeDetails, lakeRipples,
    dynamicLayer,
    fireGlow,
    zonesOverlay,
    pheromones,
    webs,
    selectionGraphics,
    particleGraphics,
    fishingGraphics,
    gameplayGraphics,
    nightVeil,
    buildingGraphics: [],
    buildingSprites: [],
    entranceGraphics: [],
    entranceSprites: [],
    foodPool: createSpritePool(dynamicLayer, () => new Sprite()),
    resourcePool: createSpritePool(dynamicLayer, () => {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      return sprite;
    }),
    carrionPool: createSpritePool(dynamicLayer, () => new Sprite()),
    lairPool: createSpritePool(dynamicLayer, () => createSpiderLairSprite(3.4)),
    carriedCarrionPool: createSpritePool(dynamicLayer, () => new Sprite()),
    enemyPool: createSpritePool(dynamicLayer, () => new Sprite()),
    antPool: createSpritePool(dynamicLayer, () => new Sprite()),
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
  for (const child of scene.waterLayer.removeChildren()) child.destroy({ children: true });
  scene.waterDepthTexture?.destroy(true);
  scene.waterDepthTexture = undefined;
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
  // A small, bilinearly sampled alpha mask blends depth without changing the
  // collision/shore cells. It replaces thousands of hard-edged stencil squares.
  const depthCanvas = document.createElement("canvas");
  depthCanvas.width = Math.ceil(world.surface.width / 2);
  depthCanvas.height = Math.ceil(world.surface.height / 2);
  const depthContext = depthCanvas.getContext("2d")!;
  const pixels = depthContext.createImageData(depthCanvas.width, depthCanvas.height);
  for (let y = 0; y < depthCanvas.height; y++) {
    for (let x = 0; x < depthCanvas.width; x++) {
      const field = lakeFieldAt(x * 2 + 1, y * 2 + 1);
      const t = Math.max(0, Math.min(1, (field - 0.08) / 0.75)), alpha = t * t * (3 - 2 * t);
      const index = (y * depthCanvas.width + x) * 4;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 255;
      pixels.data[index + 3] = Math.round(alpha * 255);
    }
  }
  depthContext.putImageData(pixels, 0, 0);
  const depthTexture = Texture.from(depthCanvas);
  depthTexture.source.scaleMode = "linear";
  scene.waterDepthTexture = depthTexture;
  const deepMask = new Sprite(depthTexture);
  deepMask.width = widthPx; deepMask.height = heightPx;

  const shallow = TilingSprite.from(frames.lakeShallowFrames[0], { width: widthPx, height: heightPx });
  const deep = TilingSprite.from(frames.lakeDeepFrames[0], { width: widthPx, height: heightPx });
  shallow.mask = shallowMask;
  // Keep this filter local, so rebuilding the world cannot leave Pixi's
  // pooled alpha-mask effect pointing at a destroyed depth texture.
  const depthFilter = new MaskFilter({ sprite: deepMask, channel: "alpha" });
  deep.filters = [depthFilter]; deepMask.renderable = false;
  deep.on("destroyed", () => depthFilter.destroy());
  shallow.tint = deep.tint = 0xb3c7ad;
  for (const tile of shoreTiles) tile.tint = 0xb3c7ad;
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
  const frame = Math.floor(actorMotion.time / 0.145) % scene.waterFrames.shallow.length;
  if (scene.waterFrame === frame) {
    return;
  }
  scene.waterFrame = frame;
  for (const entry of scene.waterSprites) {
    const frames = entry.depth === "shallow" ? scene.waterFrames.shallow : scene.waterFrames.deep;
    entry.sprite.texture = frames[(frame + entry.phase) % frames.length];
  }
}

function drawColdHearth(x: number, y: number): Graphics {
  const g = new Graphics();
  g.ellipse(x, y, 23, 11).fill({ color: 0x443b31 });
  g.moveTo(x - 13, y - 3).lineTo(x + 12, y + 4).stroke({ color: 0x493629, width: 6 });
  g.moveTo(x - 11, y + 5).lineTo(x + 11, y - 4).stroke({ color: 0x645040, width: 5 });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, px = x + Math.cos(a) * 22, py = y + Math.sin(a) * 10;
    g.ellipse(px, py, 5.5, 4.6).fill(0x61594c);
    g.ellipse(px - 0.5, py - 1, 4.2, 3.2).fill(0x8d8371);
  }
  return g;
}

export function updateSurfaceEntrances(scene: SurfaceScene, world: WorldSnapshot, cell: number, entranceKey: string): void {
  const campfireFrames = getEnvironmentTextures().props.campfireFrames;
  const campfireFrame = campfireFrames[Math.floor(actorMotion.time * 10) % campfireFrames.length];
  const fires = world.colonies.map(c => c.colony.fire > 0.05);
  const key = `${entranceKey}:${fires}:${JSON.stringify(offsetSettings.chiefs)}:${JSON.stringify(offsetSettings.campPiles)}`;
  if (scene.entranceKey === key) {
    for (const sprite of scene.entranceSprites ?? []) if (sprite.label.startsWith("campfire_") && sprite.visible) sprite.texture = campfireFrame;
    return;
  }
  scene.entranceKey = key;
  // Сначала удаляем старые Graphics входов
  for (const g of scene.entranceGraphics ?? []) {
    g.destroy();
  }
  scene.entranceGraphics = [];
  for (const sprite of scene.entranceSprites ?? []) {
    sprite.destroy();
  }
  scene.entranceSprites = [];
  for (const child of scene.campGround.removeChildren()) child.destroy();

  const entrances = world.surface.entrances ?? [world.surface.entrance];
  entrances.forEach((entrance, index) => {
    const colony = world.colonies?.[index];
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell);

    const g = new Graphics();
    g.label = `entrance_${index}`;
    scene.campGround.addChild(g);
    drawSurfaceEntranceAt(g, entrance, cell, index === 1 ? "red" : "dark");
    for (const stock of campStockSprites(colony?.colony ?? world.colony, x, y)) {
      scene.dynamicLayer.addChild(stock); scene.entranceSprites?.push(stock);
    }

    const campfire = new Sprite(campfireFrame);
    // Pixel row 105 is the centre of the stone ring, not the PNG's bottom.
    campfire.anchor.set(0.5, 105 / 128);
    campfire.position.set(x, y);
    campfire.scale.set(0.46);
    // A short ground object sorts at its centre. Sorting the entire flame by
    // the front collision edge covered residents already outside that ellipse.
    campfire.zIndex = y;
    campfire.visible = fires[index];
    campfire.label = `campfire_${index}`;
    scene.dynamicLayer.addChild(campfire);
    scene.entranceSprites?.push(campfire);
    const cold = drawColdHearth(x, y);
    cold.zIndex = campfire.zIndex; cold.visible = !fires[index];
    cold.label = `cold_hearth_${index}`; scene.dynamicLayer.addChild(cold); scene.entranceGraphics?.push(cold);
  });
}

// Постройки: площадка (контур) -> стройка (полупрозрачно) -> готово (плотный цвет глины).
export function updateBuildings(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
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
    building.colonyId,
    building.gateAxis,
    building.gateSpan
  ].join(":")).join("|");
  if (scene.buildingKey === buildingKey) {
    return;
  }
  scene.buildingKey = buildingKey;
  drawBuildingGround(scene.buildingGround, world, cell);
  buildingGardens(scene.dynamicLayer, world, cell);

  // Сначала удаляем старые Graphics зданий
  for (const g of scene.buildingGraphics ?? []) {
    g.destroy();
  }
  scene.buildingGraphics = [];
  for (const sprite of scene.buildingSprites ?? []) {
    sprite.destroy();
  }
  scene.buildingSprites = [];

  const fences = drawFences(scene.dynamicLayer, scene.buildingGround, buildings, cell);
  scene.buildingSprites.push(...fences.sprites); scene.buildingGraphics.push(fences.contacts);

  for (const building of buildings) {
    const isRed = building.colonyId === "colony-2";
    const clayColor = isRed ? 0xd05236 : 0xbc6240;
    const darkColor = isRed ? 0x692018 : 0x5b281c;
    const x = building.pos.x * cell;
    const y = building.pos.y * cell;

    const foundation = buildingFootprint(building);
    if (foundation) {
      const art = getBuildingArt(building.type, foundation.rx * 2 * cell * 1.12);
      const sprite = new Sprite(art.texture); sprite.anchor.set(art.anchorX, art.anchorY); sprite.scale.set(art.scale);
      sprite.position.set(x, (foundation.y + foundation.ry) * cell); sprite.zIndex = sprite.y;
      sprite.label = `${building.type}_${building.id}`;
      scene.dynamicLayer.addChild(sprite); scene.buildingSprites?.push(sprite);
      continue;
    }

    const g = new Graphics();
    g.label = `building_${building.type}_${building.id}`;

    if (building.type === "wall" || building.type === "gate") {
      const half = (WALL_CELL_SIZE / 2) * cell;
      // Основание стены
      g.zIndex = y + half;

      for (const p of fenceCellCenters(building)) {
        if (building.stage === "site") {
          g.rect(p.x * cell - half, p.y * cell - half, half * 2, half * 2).stroke({ width: 1.4, color: clayColor, alpha: 0.55 });
        } else if (building.stage === "inProgress") {
          g.rect(p.x * cell - half, p.y * cell - half, half * 2, half * 2).fill({ color: clayColor, alpha: 0.28 + building.progress * 0.4 });
          g.rect(p.x * cell - half, p.y * cell - half, half * 2, half * 2).stroke({ width: 1.4, color: darkColor, alpha: 0.7 });
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
        const storage = new Sprite(getEnvironmentTextures().props.storage);
        storage.anchor.set(0.5, 1);
        storage.position.set(Math.round(x), Math.round(y + half * 0.92));
        g.zIndex = storage.y;
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
        const workshop = new Sprite(getEnvironmentTextures().props.workshop);
        workshop.anchor.set(0.5, 1);
        workshop.position.set(Math.round(x), Math.round(y + half * 1.08));
        g.zIndex = workshop.y;
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
        const hut = new Sprite(getEnvironmentTextures().props.hut);
        hut.anchor.set(0.5, 1);
        hut.position.set(Math.round(x), Math.round(y + radius * 0.72));
        g.zIndex = hut.y;
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

export function updateFireGlow(glow: Graphics, world: WorldSnapshot, cell: number): void {
  glow.clear();
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  const t = actorMotion.time * 10;
  const config = offsetSettings.fireGlow;
  const darkness = surfaceLighting(world, cell).darkness;

  for (let index = 0; index < entrances.length; index += 1) {
    const entrance = entrances[index];
    // Уровень огня (colony.fire 0..1): без дров костёр гаснет — пламя меньше и тусклее.
    const fire = world.colonies?.[index]?.colony.fire ?? 1;
    const x = Math.round(entrance.x * cell);
    const y = Math.round(entrance.y * cell);

    if (fire <= 0.05) {
      // Потух: угольки и струйка дыма.
      continue;
    }

    const fireScale = 0.35 + fire * 0.65;
    const fireBright = 0.5 + fire * 0.5;
    const flicker = 0.5 + 0.5 * Math.sin(t * config.pulseSpeed * 8.18 + index * 2.1) * Math.sin(t * config.pulseSpeed * 3.36 + index);
    const pulseOffset = flicker * config.pulseAmp * cell * fireScale;

    const strength = (0.25 + darkness * 0.75) * fireBright;
    // Nested low-opacity ellipses form a floor light, below feet and stones.
    const radius = config.outerRadius * cell * 0.5 * fireScale + pulseOffset;
    for (let band = 8; band >= 1; band--) {
      const r = radius * band / 8;
      glow.ellipse(x, y, r, r * 0.6).fill({ color: 0xffb657, alpha: (config.outerAlpha + 0.006) * strength });
    }
    for (let band = 5; band >= 1; band--) {
      const r = (config.innerRadius * cell * 0.5 * fireScale + pulseOffset * 0.6) * band / 5;
      glow.ellipse(x, y, r, r * 0.55).fill({ color: 0xffcc78, alpha: config.innerAlpha * 0.14 * strength });
    }
  }
}

const trampleStates = new WeakMap<SurfaceScene, { texture: RenderTexture; tick: number; positions: Map<string, Vec2> }>();
function updateTrample(scene: SurfaceScene, renderer: Renderer, world: WorldSnapshot): void {
  if (!scene.trampleTexture || !scene.trampleSprite) {
    return;
  }

  if (!scene.trailPainter) {
    scene.trailPainter = new Graphics();
  }
  let state = trampleStates.get(scene);
  if (!state || state.texture !== scene.trampleTexture) {
    state = { texture: scene.trampleTexture, tick: -1, positions: new Map() };
    trampleStates.set(scene, state);
  }
  if (world.tick < state.tick) {
    state.positions.clear(); state.tick = -1;
    scene.trailPainter.clear();
    renderer.render({ container: scene.trailPainter, target: scene.trampleTexture, clear: true });
  }
  if (world.session.speed === 0 || world.session.status !== "playing" || world.tick === state.tick) return;
  state.tick = world.tick;

  const trailPainter = scene.trailPainter;
  trailPainter.clear();

  let hasSurfaceEntities = false;
  const seen = new Set<string>();
  const moved = (id: string, pos: Vec2) => {
    seen.add(id); const before = state!.positions.get(id); state!.positions.set(id, { ...pos });
    return !!before && Math.hypot(pos.x - before.x, pos.y - before.y) > 0.05;
  };

  const ants = world.ants ?? [];
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    if (ant.layer === "surface" && !ant.capturedBy && ant.state !== "dead" && moved(ant.id, ant.pos)) {
      hasSurfaceEntities = true;
      trailPainter.circle(ant.pos.x, ant.pos.y, 0.9).fill({ color: 0xffffff, alpha: 0.08 });
    }
  }

  const enemies = world.enemies ?? [];
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0 || !moved(enemy.id, enemy.pos)) continue;
    hasSurfaceEntities = true;
    trailPainter.circle(enemy.pos.x, enemy.pos.y, 1.8).fill({ color: 0xffffff, alpha: 0.12 });
  }
  for (const id of state.positions.keys()) if (!seen.has(id)) state.positions.delete(id);

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
  scene.root.addChild(scene.depositGround);
  scene.root.addChild(scene.waterLayer);
  scene.root.addChild(scene.fishLayer);
  scene.root.addChild(scene.lakeDetails);
  scene.root.addChild(scene.lakeRipples);
  scene.root.addChild(scene.campGround);
  scene.root.addChild(scene.buildingGround);
  scene.root.addChild(scene.footGround);
  scene.root.addChild(scene.fireGlow);
  scene.root.addChild(scene.shadowLayer);
  scene.root.addChild(scene.zonesOverlay);
  scene.root.addChild(scene.pheromones);
  scene.root.addChild(scene.webs);
  scene.root.addChild(scene.dynamicLayer);
  scene.root.addChild(scene.nightVeil);

  const cell = SURFACE_TILE_SIZE;
  const now = performance.now();
  world = { ...world, ants: [...world.ants, ...royalWalk.update(world, now)] };
  actorMotion.update(world, now);
  const bounds = visibleSurfaceBounds(camera, viewportWidth, viewportHeight);
  const staticKey = [
    world.surface.width,
    world.surface.height,
    "surface-clay-materials-v6-quarries",
    // Generated worlds bring their own lakes: rebuild the ground when terrain changes.
    surfaceTerrainRevision(),
    (world.surface.deposits ?? []).map(d => `${d.id},${d.pos.x},${d.pos.y}`).join(";")
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildSurfaceStatic(scene, renderer, world, cell, staticKey);
  }
  updateLakeWater(scene);
  updateDeposits(scene.depositGround, world, cell, bounds);
  updateLakeDetails(scene.lakeDetails, scene.lakeRipples, world, cell, bounds);
  updateFootprints(scene.footGround, world, cell, bounds);
  updateSurfaceFish(scene.fishPool, world, cell, bounds);

  if (scene.trampleSprite) {
    scene.trampleSprite.visible = trampleEnabled;
  }

  if (trampleEnabled) {
    updateTrample(scene, renderer, world);
  }

  const storageLevels = world.colonies?.map((c) =>
    [
      Math.ceil((c.colony.foodStock?.fruit ?? c.colony.food ?? 0) / 12),
      Math.ceil((c.colony.foodStock?.fish ?? 0) / 12),
      Math.ceil((c.colony.foodStock?.meat ?? 0) / 12),
      Math.ceil((c.colony.clay ?? 0) / 12),
      Math.ceil((c.colony.wood ?? 0) / 12),
      Math.ceil((c.colony.stone ?? 0) / 12)
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
  drawGameplay(scene, world, cell);
  updatePropContacts(scene.shadowLayer, scene.dynamicLayer, world, cell, bounds);
  updateAndDrawParticles(scene.particleGraphics, world, cell, camera, viewportWidth, viewportHeight);
}
