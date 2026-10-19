import { Assets, Rectangle, Texture } from "pixi.js";
import { WALK_PHASES, type LookDirection } from "./motion";
import { loadSpriteAtlas, type LoadedAtlas } from "./atlas";
import type { HeadSeat } from "./royalHeadgear";
import { spriteGrounding, type GroundProfile } from "./spriteGrounding";

export const residentAtlasUrl = "/assets/characters/clayfolk/resident-atlas.png";
// Read-only alpha inspection of the generated atlas. Each frame keeps the
// original cell's horizontal root and uses the soles as its vertical root.
const frames = [
  [68,30,182,254,.48901], [409,29,135,262,.45556], [693,28,177,257,.5113], [1027,29,132,262,.5303],
  [75,343,167,264,.49102], [399,342,162,258,.44136], [694,341,168,267,.53274], [1008,343,163,258,.54601],
  [77,656,161,263,.49689], [395,653,165,257,.45758], [698,653,161,266,.53106], [1010,654,161,256,.54037],
  [83,966,147,254,.5034], [410,962,144,264,.42014], [707,965,150,256,.51], [1015,962,142,264,.57746]
] as const;
export type CharacterArt = { texture: Texture; anchorX: number; anchorY?: number; scale: number; tint?: number; head?: HeadSeat; ground?: GroundProfile };
const atlas: CharacterArt[] = [];
let actions: LoadedAtlas;
let actionScale = 1;
let captiveHead: CharacterArt;
let walking: LoadedAtlas, carryingWalk: LoadedAtlas, oppositeStep: LoadedAtlas, sideWalk: LoadedAtlas;
const registered = new WeakMap<CharacterArt, CharacterArt>();
const walkFrames = new Map<LoadedAtlas, CharacterArt[]>();
const actionFrames: CharacterArt[] = [];

function grounded(art: CharacterArt): CharacterArt {
  let result = registered.get(art);
  if (!result) {
    const ground = spriteGrounding(art.texture), delta = art.texture.height - ground.bottom;
    result = { ...art, ground, anchorY: ground.bottom / art.texture.height,
      head: art.head ? { ...art.head, y: art.head.y + delta * art.scale } : undefined };
    registered.set(art, result);
  }
  return result;
}

function walkingArt(source: LoadedAtlas, index: number): CharacterArt {
  const existing = walkFrames.get(source)?.[index]; if (existing) return existing;
  const f = source.data.frames[index], scale = 19 / f.height;
  // Register the torso on the head centre, so toe travel doesn't shift the
  // whole body left/right between adjacent walking frames.
  const anchorX = f.head ? f.head.x / f.width : f.anchorX;
  // Registration also balances the full-head mean RGB between generated
  // sheets. Sprite tint costs no additional filter or per-frame pixel reads.
  const art = grounded({ texture: source.textures[index], anchorX, scale, tint: f.tint,
    head: f.head ? { x: 0, y: (f.head.y - f.height) * scale, width: f.head.width * scale } : undefined });
  if (!walkFrames.has(source)) walkFrames.set(source, []);
  walkFrames.get(source)![index] = art; return art;
}

export async function preloadCharacterArt(): Promise<void> {
  if (atlas.length) return;
  const [base, actionAtlas, walk, carry, opposite, side] = await Promise.all([Assets.load<Texture>(residentAtlasUrl), loadSpriteAtlas("/assets/characters/clayfolk/resident-actions-atlas.png"),
    loadSpriteAtlas("/assets/characters/clayfolk/resident-walk-v2.png"), loadSpriteAtlas("/assets/characters/clayfolk/resident-carry-walk-v2.png"),
    loadSpriteAtlas("/assets/characters/clayfolk/resident-opposite-step-v3.png"), loadSpriteAtlas("/assets/characters/clayfolk/resident-side-walk-v4.png")]);
  walking = walk; carryingWalk = carry; oppositeStep = opposite; sideWalk = side;
  actions = actionAtlas;
  actionScale = 19 / (actions.data.frames.slice(0, 4).reduce((sum, f) => sum + f.height, 0) / 4);
  const source = base.source;
  source.scaleMode = "linear";
  const headXs = [0.110, 0.442, -0.147, -0.295, 0.037, 1.546, 0.037, -1.215, 0.037, 0.700, -0.111, -0.442, 0, 0.4, 0, -0.4];
  const headWidths = [143, 129, 147, 128, 143, 129, 144, 127, 141, 130, 148, 128, 143, 129, 147, 128];
  for (const [i, [x, y, width, height, anchorX]] of frames.entries()) {
    atlas.push({ texture: new Texture({ source, frame: new Rectangle(x, y, width, height) }), anchorX, scale: 19 / 258,
      head: { x: headXs[i], y: -height * 0.73 * 19 / 258, width: headWidths[i] * 19 / 258 } });
  }
  const [x, y, width, height, anchorX] = frames[0];
  captiveHead = { texture: new Texture({ source, frame: new Rectangle(x, y, width, Math.round(height * 0.44)) }), anchorX, scale: 19 / 258 };
  // Analyze every pose up front; no canvas reads or temporary art in the frame loop.
  for (const art of atlas) grounded(art);
  for (const source of [walking, carryingWalk, oppositeStep, sideWalk]) source.textures.forEach((_, i) => walkingArt(source, i));
  actions.textures.forEach((texture, i) => actionFrames.push(grounded({ texture, anchorX: actions.data.frames[i].anchorX, scale: actionScale })));
}

export function getResidentArt(look: LookDirection, facing: number, legFrame = 0, handsRaised = false, working = 0, work = 0): CharacterArt {
  const column = look === "front" ? 0 : look === "back" ? 2 : facing < 0 ? 3 : 1;
  const row = legFrame === 1 ? 1 : legFrame === 2 ? 2 : handsRaised ? 3 : 0;
  if (!atlas.length) throw new Error("Character art must be preloaded before rendering");
  if (working <= 0.4 && legFrame > 0) {
    // Insert the drawn opposite contact after the first half-stride. The
    // character remains one intact sprite: no cut-out or warped limbs.
    const phase = (legFrame - 1) % WALK_PHASES;
    const source = handsRaised ? carryingWalk : walking;
    if (look === "side") {
      const key = Math.floor(phase / 2);
      // The old contact has the near leg BACK; new keys put it forward,
      // under the hip, then raised. Never use the duplicate generated key 2.
      if (key === 2) return walkingArt(source, column);
      const sideRow = (handsRaised ? 2 : 0) + (facing < 0 ? 1 : 0);
      return walkingArt(sideWalk, sideRow * 4 + key);
    }
    if (phase === 4) return walkingArt(oppositeStep, (handsRaised ? 4 : 0) + column);
    return walkingArt(source, (phase > 4 ? phase - 1 : phase) * 4 + column);
  }
  if (working > 0.4) {
    const actionRow = working > 0.4 ? work > 0.5 ? 3 : 2 : legFrame === 2 ? 1 : 0;
    const index = actionRow * 4 + column;
    return actionFrames[index];
  }
  return grounded(atlas[row * 4 + column]);
}

export function getCaptiveHeadArt(): CharacterArt { return captiveHead; }
