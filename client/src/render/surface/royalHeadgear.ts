import { Rectangle, Texture } from "pixi.js";
import { loadSpriteAtlas } from "./atlas";
import type { LookDirection } from "./motion";
import type { BodyMount } from "./attachment";
import { attachItem } from "./attachment";

export type HeadSeat = { x: number; y: number; width: number };
type CrownPart = { texture: Texture; anchorX: number; anchorY: number; behind: boolean; fullWidth: number; mirror: boolean };
const crowns: CrownPart[][] = [];

export function royalHeadgearFrame(role: "king" | "queen", look: LookDirection): number {
  return (role === "queen" ? 3 : 0) + (look === "front" ? 0 : look === "side" ? 1 : 2);
}

export async function preloadRoyalHeadgear(): Promise<void> {
  if (crowns.length) return;
  const atlas = await loadSpriteAtlas("/assets/characters/royals/headgear-v2.png");
  for (const [i, texture] of atlas.textures.entries()) {
    const f = atlas.data.frames[i];
    // Back rim and leaf sit behind the skull. Only the near band crosses the
    // forehead. Both texture windows retain exactly the same attachment root.
    const split = Math.round(f.height * ([0.77, 0.77, 0.78, 0.68, 0.76, 0.78][i]));
    const seatY = f.height * 0.98, seatX = f.width * 0.5;
    const part = (y: number, height: number, behind: boolean, x = 0, width = f.width): CrownPart => ({
      texture: new Texture({ source: texture.source, frame: new Rectangle(f.x + x, f.y + y, width, height) }),
      anchorX: (seatX - x) / width, anchorY: (seatY - y) / height, behind, fullWidth: f.width,
      // A temple seen on the left from the front is on the right from behind.
      mirror: i === 5
    });
    const parts = [part(0, split, true), part(split, f.height - split, false)];
    // The front ornament grows from the near rim, in front of the scalp.
    // A rear-facing ornament stays behind it. Only texture windows are used.
    if (i === 0) parts.push(part(0, split, false, Math.round(f.width * 0.38), Math.round(f.width * 0.26)));
    if (i === 3) parts.push(part(0, split, false, 0, Math.round(f.width * 0.34)));
    crowns.push(parts);
  }
}

export function getRoyalHeadgear(role: "king" | "queen", look: LookDirection) {
  const parts = crowns[royalHeadgearFrame(role, look)];
  if (!parts) throw new Error("Royal headgear not preloaded");
  return parts;
}

export function royalHeadgearMount(body: BodyMount, head: HeadSeat, widthPx: number, anchorX: number, anchorY: number) {
  // Head x already follows the chosen left/right body frame; only the artwork
  // is mirrored, never mirror that displacement a second time.
  return attachItem(body, head.x * body.facing, head.y, head.width * body.size * 1.06 / widthPx, 0, anchorX, anchorY);
}
