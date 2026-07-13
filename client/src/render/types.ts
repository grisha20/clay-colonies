import type { Container, Graphics, Sprite, RenderTexture, Texture, TilingSprite } from "pixi.js";

export type ViewMode = "surface";
export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export const SURFACE_TILE_SIZE = 8;
export const UNDERGROUND_WIDTH = 1180;
export const UNDERGROUND_HEIGHT = 860;
export const SHOW_UNDERGROUND_DEBUG = false;

export const undergroundLayout = {
  surfaceY: 58,
  marginX: 38,
  bottomPadding: 34
} as const;

export type SpriteFactory = () => Sprite;

export type SpritePool = {
  container: Container;
  cursor: number;
  sprites: Sprite[];
  factory: SpriteFactory;
};

export type SurfaceScene = {
  root: Container;
  staticLayer: Container;
  waterLayer: Container;
  shadowLayer: Graphics;
  dynamicLayer: Container;
  fireGlow: Graphics;
  zonesOverlay: Graphics;
  pheromones: Graphics;
  webs: Graphics;
  selectionGraphics: Graphics;
  particleGraphics: Graphics;
  buildingGraphics?: Graphics[];
  buildingSprites?: Sprite[];
  entranceGraphics?: Graphics[];
  entranceSprites?: Sprite[];
  foodPool: SpritePool;
  resourcePool: SpritePool;
  carrionPool: SpritePool;
  lairPool: SpritePool;
  carriedCarrionPool: SpritePool;
  enemyPool: SpritePool;
  antPool: SpritePool;
  carriedItemsPool: SpritePool;
  staticKey: string;
  entranceKey: string;
  zoneKey: string;
  groundSprite?: Sprite;
  trampleTexture?: RenderTexture;
  trampleSprite?: Sprite;
  trailPainter?: Graphics;
  eraserGraphics?: Graphics;
  waterSprites?: Array<{ sprite: TilingSprite; depth: "shallow" | "deep"; phase: number }>;
  waterFrames?: { shallow: Texture[]; deep: Texture[] };
  waterFrame?: number;
};

export type UndergroundScene = {
  root: Container;
  staticLayer: Container;
  storagePool: SpritePool;
  carrionPool: SpritePool;
  broodPool: SpritePool;
  antPool: SpritePool;
  queen: Sprite;
  staticKey: string;
  earthGraphics: Graphics;
  gridGraphics: Graphics;
};

export type RendererState = {
  stage: Container | null;
  surface: SurfaceScene;
};

export type ViewBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
