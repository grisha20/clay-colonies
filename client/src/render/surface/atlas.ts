import { Assets, Rectangle, Texture } from "pixi.js";

export type AtlasFrame = { x: number; y: number; width: number; height: number; anchorX: number; head?: { x: number; y: number; width: number } };
export type AtlasData = { imageWidth: number; imageHeight: number; columns: number; rows: number; frames: AtlasFrame[] };
export type LoadedAtlas = { data: AtlasData; textures: Texture[] };
const pending = new Map<string, Promise<LoadedAtlas>>();

/** The source PNG remains untouched. Frame registration comes from alpha inspection. */
export function loadSpriteAtlas(url: string): Promise<LoadedAtlas> {
  let result = pending.get(url);
  if (!result) {
    // Pixi's spritesheet parser treats any JSON with `frames` as its own schema.
    // Our registration metadata must be read as plain JSON instead.
    const metadata = fetch(url.replace(/\.png$/, ".json")).then(async response => {
      if (!response.ok) throw new Error(`Atlas metadata unavailable: ${url}`);
      return await response.json() as AtlasData;
    });
    result = Promise.all([Assets.load<Texture>(url), metadata]).then(([image, data]) => {
      if (data.frames.length !== data.columns * data.rows || image.width !== data.imageWidth || image.height !== data.imageHeight) throw new Error(`Invalid atlas dimensions: ${url}`);
      image.source.scaleMode = "linear";
      const textures = data.frames.map(f => {
        if (f.width <= 0 || f.height <= 0 || f.x < 0 || f.y < 0 || f.x + f.width > image.width || f.y + f.height > image.height) throw new Error(`Invalid atlas frame: ${url}`);
        return new Texture({ source: image.source, frame: new Rectangle(f.x, f.y, f.width, f.height) });
      });
      return { data, textures };
    });
    pending.set(url, result);
  }
  return result;
}
