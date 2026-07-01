import { Assets, Rectangle, Sprite, Texture } from "pixi.js";

const summerBase = "/assets/environment/summer-plains/summer_plains_v1.0_standard";

export const environmentAssetUrls = [
  `${summerBase}/tiles.png`,
  `${summerBase}/assets.png`,
  "/assets/environment/grassy-topdown-cc0/topdown grassy tileset.png",
  "/assets/environment/summer-plains-water-animation-demo/water_animation_demo/water_animation_demo.png",
  "/assets/environment/forest-tent-tileset/tileset-and-sprites.png",
  "/assets/environment/forest-tent-tileset/animated-campfire.png"
] as const;

const textureCache = new Map<string, Texture>();
type EnvironmentTextures = {
  terrain: {
    grass: Texture;
    grassDeep: Texture;
    dirt: Texture;
    dirtSoft: Texture;
    water: Texture;
    sandPatch: Texture;
    pathHorizontal: Texture;
    pathVertical: Texture;
  };
  props: {
    treeTall: Texture;
    treeRound: Texture;
    treeWide: Texture;
    log: Texture;
    stump: Texture;
    bushLarge: Texture;
    bushRound: Texture;
    berryBush: Texture;
    rockLarge: Texture;
    rockSmall: Texture;
    grassTuft: Texture;
    flowers: Texture;
    campfire: Texture;
    tent: Texture;
    bridge: Texture;
    fence: Texture;
  };
};

let environmentTextures: EnvironmentTextures | null = null;

export async function preloadEnvironmentAssets(): Promise<void> {
  await Assets.load([...environmentAssetUrls]);
  buildEnvironmentTextures();
}

function crop(url: string, x: number, y: number, width: number, height: number): Texture {
  const key = `${url}:${x}:${y}:${width}:${height}`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const base = Texture.from(url);
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(x, y, width, height)
  });
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

function buildEnvironmentTextures(): EnvironmentTextures {
  if (environmentTextures) {
    return environmentTextures;
  }

  const tilesUrl = `${summerBase}/tiles.png`;
  const cc0TilesUrl = "/assets/environment/grassy-topdown-cc0/topdown grassy tileset.png";
  const assetsUrl = `${summerBase}/assets.png`;
  environmentTextures = {
    terrain: {
      grass: crop(cc0TilesUrl, 80, 16, 32, 32),
      grassDeep: crop(cc0TilesUrl, 80, 16, 32, 32),
      dirt: crop(cc0TilesUrl, 144, 208, 32, 32),
      dirtSoft: crop(cc0TilesUrl, 80, 80, 32, 32),
      water: crop(cc0TilesUrl, 144, 144, 32, 32),
      sandPatch: crop(tilesUrl, 272, 192, 64, 64),
      pathHorizontal: crop(tilesUrl, 288, 288, 128, 32),
      pathVertical: crop(tilesUrl, 352, 192, 32, 128)
    },
    props: {
      treeTall: crop(assetsUrl, 0, 0, 128, 216),
      treeRound: crop(assetsUrl, 150, 0, 150, 210),
      treeWide: crop(assetsUrl, 332, 0, 165, 214),
      log: crop(assetsUrl, 0, 226, 102, 36),
      stump: crop(assetsUrl, 178, 228, 70, 54),
      bushLarge: crop(assetsUrl, 0, 365, 76, 66),
      bushRound: crop(assetsUrl, 0, 482, 66, 62),
      berryBush: crop(assetsUrl, 145, 300, 44, 56),
      rockLarge: crop(assetsUrl, 264, 482, 66, 48),
      rockSmall: crop(assetsUrl, 352, 493, 38, 32),
      grassTuft: crop(assetsUrl, 412, 336, 34, 30),
      flowers: crop(assetsUrl, 392, 438, 48, 42),
      campfire: crop(assetsUrl, 333, 710, 72, 58),
      tent: crop(assetsUrl, 344, 780, 140, 75),
      bridge: crop(assetsUrl, 0, 742, 86, 92),
      fence: crop(assetsUrl, 108, 754, 170, 62)
    }
  };
  return environmentTextures;
}

export function getEnvironmentTextures(): EnvironmentTextures {
  return buildEnvironmentTextures();
}

export function makeEnvironmentSprite(texture: Texture, x: number, y: number, scale: number, rotation = 0): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(x, y);
  sprite.scale.set(scale);
  sprite.rotation = rotation;
  return sprite;
}
