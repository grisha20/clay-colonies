import { Assets, Rectangle, Sprite, Texture } from "pixi.js";

const summerBase = "/assets/environment/summer-plains/summer_plains_v1.0_standard";
const customBase = "/assets/environment/custom";
const campfireFrameUrls = Array.from({ length: 6 }, (_, index) =>
  `${customBase}/campfire/campfire_${String(index).padStart(2, "0")}.png`
);

export const environmentAssetUrls = [
  `${summerBase}/tiles.png`,
  `${summerBase}/assets.png`,
  "/assets/environment/grassy-topdown-cc0/topdown grassy tileset.png",
  "/assets/environment/summer-plains-water-animation-demo/water_animation_demo/water_animation_demo.png",
  "/assets/environment/forest-tent-tileset/tileset-and-sprites.png",
  "/assets/environment/forest-tent-tileset/animated-campfire.png",
  "/assets/environment/veggies/tomato-pixel.png",
  `${customBase}/hut.png`,
  `${customBase}/storage.png`,
  `${customBase}/workshop-cutout.png`,
  ...campfireFrameUrls
] as const;

const textureCache = new Map<string, Texture>();
type EnvironmentTextures = {
  terrain: {
    grass: Texture;
    grassDeep: Texture;
    dirt: Texture;
    dirtSoft: Texture;
    water: Texture;
    lakeShallowFrames: Texture[];
    lakeDeepFrames: Texture[];
    lakeBank: Texture;
    lakeCorners: {
      outer: { nw: Texture; ne: Texture; sw: Texture; se: Texture };
      inner: { nw: Texture; ne: Texture; sw: Texture; se: Texture };
    };
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
    foodBush: Texture;
    tomato: Texture;
    rockLarge: Texture;
    rockRound: Texture;
    rockSmall: Texture;
    grassTuft: Texture;
    flowers: Texture;
    campfire: Texture;
    campfireFrames: Texture[];
    hut: Texture;
    storage: Texture;
    workshop: Texture;
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

function image(url: string): Texture {
  const key = `${url}:image`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const texture = Texture.from(url);
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

function lakeBankOverlay(url: string): Texture {
  const key = `${url}:lake-bank-overlay`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }
  const source = Texture.from(url);
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is required for lake bank texture");
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(source.source.resource as CanvasImageSource, 0, 0, 32, 64, 0, 0, 32, 64);
  const pixels = context.getImageData(0, 0, 32, 64);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const y = Math.floor(index / 4 / 32);
    // Rows 0..7 are copied grass; rows 32..63 are repeated open water. Keep the
    // authored sand, stone and first shallow-water transition as one bank band.
    if (y < 8 || y >= 32) {
      pixels.data[index + 3] = 0;
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

type LakeCornerKind = "outer" | "inner";
type LakeCornerDirection = "nw" | "ne" | "sw" | "se";

function lakeCornerOverlay(url: string, kind: LakeCornerKind, direction: LakeCornerDirection): Texture {
  const key = `${url}:lake-corner:${kind}:${direction}`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const source = Texture.from(url);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 32;
  sourceCanvas.height = 64;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Canvas 2D context is required for lake corner source");
  }
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(source.source.resource as CanvasImageSource, 0, 0, 32, 64, 0, 0, 32, 64);
  const sourcePixels = sourceContext.getImageData(0, 0, 32, 64);

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is required for lake corner texture");
  }
  const pixels = context.createImageData(64, 64);
  const mirrorX = direction === "ne" || direction === "se";
  const mirrorY = direction === "sw" || direction === "se";

  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const u = mirrorX ? 63.5 - x : x + 0.5;
      const v = mirrorY ? 63.5 - y : y + 0.5;
      const dx = kind === "outer" ? 64 - u : u;
      const dy = kind === "outer" ? 64 - v : v;
      const radius = Math.hypot(dx, dy);
      const sourceY = Math.floor(kind === "outer" ? 64 - radius : radius);
      if (sourceY < 8 || sourceY >= 32) {
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const sourceX = Math.max(0, Math.min(31, Math.floor((angle / (Math.PI / 2)) * 32)));
      const sourceIndex = (sourceY * 32 + sourceX) * 4;
      const sourceRed = sourcePixels.data[sourceIndex];
      const sourceGreen = sourcePixels.data[sourceIndex + 1];
      const sourceBlue = sourcePixels.data[sourceIndex + 2];
      // The jagged first bank row contains a few pixels of the demo's own lime
      // background. They are useful on its sample strip but create wedges when
      // bent around a concave corner, so let the real map grass show through.
      if (kind === "inner" && sourceGreen > sourceRed * 1.05 && sourceBlue < 110) {
        continue;
      }
      const targetIndex = (y * 64 + x) * 4;
      pixels.data[targetIndex] = sourceRed;
      pixels.data[targetIndex + 1] = sourceGreen;
      pixels.data[targetIndex + 2] = sourceBlue;
      pixels.data[targetIndex + 3] = sourcePixels.data[sourceIndex + 3];
    }
  }

  context.putImageData(pixels, 0, 0);
  const texture = Texture.from(canvas);
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
  const waterAnimationUrl = "/assets/environment/summer-plains-water-animation-demo/water_animation_demo/water_animation_demo.png";
  const assetsUrl = `${summerBase}/assets.png`;
  environmentTextures = {
    terrain: {
      grass: crop(tilesUrl, 16, 16, 32, 32),
      grassDeep: crop(tilesUrl, 16, 16, 32, 32),
      dirt: crop(tilesUrl, 128, 20, 32, 32),
      dirtSoft: crop(cc0TilesUrl, 80, 80, 32, 32),
      water: crop(cc0TilesUrl, 144, 144, 32, 32),
      // Summer Plains demo: six frames across. Row 1 is clear shallow water,
      // bottom row is deep water; both match the shoreline palette in tiles.png.
      lakeShallowFrames: Array.from({ length: 6 }, (_, frame) => crop(waterAnimationUrl, frame * 32, 32, 32, 32)),
      lakeDeepFrames: Array.from({ length: 6 }, (_, frame) => crop(waterAnimationUrl, frame * 32, 96, 32, 32)),
      lakeBank: lakeBankOverlay(waterAnimationUrl),
      lakeCorners: {
        outer: {
          nw: lakeCornerOverlay(waterAnimationUrl, "outer", "nw"),
          ne: lakeCornerOverlay(waterAnimationUrl, "outer", "ne"),
          sw: lakeCornerOverlay(waterAnimationUrl, "outer", "sw"),
          se: lakeCornerOverlay(waterAnimationUrl, "outer", "se")
        },
        inner: {
          nw: lakeCornerOverlay(waterAnimationUrl, "inner", "nw"),
          ne: lakeCornerOverlay(waterAnimationUrl, "inner", "ne"),
          sw: lakeCornerOverlay(waterAnimationUrl, "inner", "sw"),
          se: lakeCornerOverlay(waterAnimationUrl, "inner", "se")
        }
      },
      sandPatch: crop(tilesUrl, 272, 192, 64, 64),
      pathHorizontal: crop(tilesUrl, 288, 288, 128, 32),
      pathVertical: crop(tilesUrl, 352, 192, 32, 128)
    },
    props: {
      treeTall: crop(assetsUrl, 0, 0, 160, 240),
      treeRound: crop(assetsUrl, 176, 34, 164, 210),
      treeWide: crop(assetsUrl, 360, 26, 152, 218),
      log: crop(assetsUrl, 0, 226, 102, 36),
      stump: crop(assetsUrl, 178, 228, 70, 54),
      bushLarge: crop(assetsUrl, 0, 365, 76, 66),
      bushRound: crop(assetsUrl, 0, 482, 66, 62),
      berryBush: crop(assetsUrl, 145, 300, 44, 56),
      foodBush: crop(assetsUrl, 121, 498, 46, 46),
      tomato: crop("/assets/environment/veggies/tomato-pixel.png", 0, 0, 11, 11),
      rockLarge: crop(assetsUrl, 250, 496, 36, 35),
      rockRound: crop(assetsUrl, 293, 496, 37, 35),
      rockSmall: crop(assetsUrl, 343, 499, 24, 21),
      grassTuft: crop(assetsUrl, 412, 336, 34, 30),
      flowers: crop(assetsUrl, 392, 438, 48, 42),
      campfire: crop(assetsUrl, 333, 710, 72, 58),
      campfireFrames: campfireFrameUrls.map((url) => image(url)),
      hut: image(`${customBase}/hut.png`),
      storage: image(`${customBase}/storage.png`),
      workshop: image(`${customBase}/workshop-cutout.png`),
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
