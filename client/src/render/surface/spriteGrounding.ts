import type { Graphics, Sprite, Texture } from "pixi.js";

export type GroundPoint = { x: number; y: number };
export type GroundProfile = { bottom: number; edge: GroundPoint[]; top?: number; upperEdge?: GroundPoint[]; feet: Array<GroundPoint & { rx: number }> };
const profiles = new WeakMap<Texture, GroundProfile>();

/** Read alpha once at preload, without changing the source artwork. */
export function spriteGrounding(texture: Texture): GroundProfile {
  const cached = profiles.get(texture); if (cached) return cached;
  const f = texture.frame, canvas = document.createElement("canvas");
  canvas.width = f.width; canvas.height = f.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(texture.source.resource as CanvasImageSource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const profile = alphaGroundProfile(rgba, canvas.width, canvas.height);
  profiles.set(texture, profile); return profile;
}

/** Opaque lower silhouette excludes transparent gutters and stray generation pixels. */
export function alphaGroundProfile(rgba: Uint8ClampedArray, width: number, height: number): GroundProfile {
  const edge: GroundPoint[] = [], upperEdge: GroundPoint[] = [], step = Math.max(1, Math.floor(width / 90));
  for (let x = 0; x < width; x += step) {
    for (let y = height - 1; y >= height * .62; y--) {
      if (rgba[(y * width + x) * 4 + 3] < 180) continue;
      // Ignore an isolated opaque fleck without a small solid neighbourhood.
      if (y < 2 || rgba[((y - 2) * width + x) * 4 + 3] < 180) continue;
      edge.push({ x, y: y + 1 }); break;
    }
    for (let y = 0; y < height * .38; y++) {
      if (rgba[(y * width + x) * 4 + 3] < 180 || y >= height - 2 || rgba[((y + 2) * width + x) * 4 + 3] < 180) continue;
      upperEdge.push({ x, y }); break;
    }
  }
  const bottom = edge.length ? Math.max(...edge.map(p => p.y)) : height;
  const feet = [0, 1].flatMap(side => {
    const half = edge.filter(p => (p.x < width / 2 ? 0 : 1) === side);
    if (!half.length) return [];
    const sole = Math.max(...half.map(p => p.y));
    const support = half.filter(p => p.y >= sole - height * .025);
    const left = Math.min(...support.map(p => p.x)), right = Math.max(...support.map(p => p.x));
    return [{ x: (left + right) / 2, y: sole, rx: Math.max(step, (right - left) / 2) }];
  });
  return { bottom, edge, feet, top: upperEdge.length ? Math.min(...upperEdge.map(p => p.y)) : 0, upperEdge };
}

/** A narrow seam follows the artwork's actual lower contour, not an oval under it. */
export function drawSpriteContact(g: Graphics, profile: GroundProfile, x: number, y: number, scale: number, anchorX: number, width: number, opacity = 1): void {
  let segment: GroundPoint[] = [];
  const flush = () => {
    if (segment.length > 1) for (const [depth, alpha] of [[2.1, .13], [.85, .32]]) {
      const points = segment.flatMap(p => [x + (p.x - anchorX * width) * scale, y + (p.y - profile.bottom) * scale - .35]);
      for (let i = segment.length - 1; i >= 0; i--) {
        const p = segment[i]; points.push(x + (p.x - anchorX * width) * scale, y + (p.y - profile.bottom) * scale + depth);
      }
      g.poly(points).fill({ color: 0x302419, alpha: alpha * opacity });
    }
    segment = [];
  };
  for (const p of profile.edge) {
    if (segment.length && p.x - segment[segment.length - 1].x > width * .06) flush();
    segment.push(p);
  }
  flush();
}

export function plantedOffset(profile: GroundProfile, anchorX: number, width: number, sx: number, sy: number, rotation: number): number {
  return profile.feet.length ? Math.max(...profile.feet.map(p => (p.x - anchorX * width) * sx * Math.sin(rotation) + (p.y - profile.bottom) * sy * Math.cos(rotation))) : 0;
}

/** Transform each visible contact with the same scale/anchor/rotation as its prop. */
export function drawPlacedContact(g: Graphics, sprite: Sprite, opacity = .8): void {
  const profile = spriteGrounding(sprite.texture), c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation);
  const points: number[] = [];
  const inverted = sprite.scale.y < 0;
  for (const p of (inverted ? profile.upperEdge : profile.edge) ?? []) {
    if (inverted ? p.y > (profile.top ?? 0) + sprite.texture.height * .12 : p.y < profile.bottom - sprite.texture.height * .12) continue;
    const x = (p.x - sprite.anchor.x * sprite.texture.width) * sprite.scale.x;
    const y = (p.y - sprite.anchor.y * sprite.texture.height) * sprite.scale.y;
    points.push(sprite.x + x * c - y * s, sprite.y + x * s + y * c);
  }
  if (points.length < 4) return;
  for (const [depth, alpha] of [[1.6, .12], [.6, .27]]) {
    const strip = [...points];
    for (let i = points.length - 2; i >= 0; i -= 2) strip.push(points[i], points[i + 1] + depth);
    g.poly(strip).fill({ color: 0x302419, alpha: alpha * opacity });
  }
}
