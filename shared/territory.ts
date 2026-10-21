import type { Building, Vec2 } from "./types";

/**
 * Земля племени: круг вокруг костра и круг вокруг каждого достроенного тотема.
 * Строить можно только на своей земле; тотем ставится на своей земле и
 * раздвигает её. Где круги племён перекрываются, земля того, чей центр
 * «глубже» (больше запас до края круга). Камп i принадлежит "colony-(i+1)".
 * Same rules in the server, the 2D client and godot/scripts/game/build_rules.gd.
 */
export const CAMP_TERRITORY_RADIUS = 45;
export const TOTEM_TERRITORY_RADIUS = 36;

export type TerritoryDisc = { x: number; y: number; r: number; owner: string };
type TerritorySurface = { entrances: Vec2[]; buildings: Building[] };

export function campOwner(index: number): string {
  return `colony-${index + 1}`;
}

export function territoryDiscs(surface: TerritorySurface): TerritoryDisc[] {
  const discs: TerritoryDisc[] = surface.entrances.map((c, i) => ({ x: c.x, y: c.y, r: CAMP_TERRITORY_RADIUS, owner: campOwner(i) }));
  for (const b of surface.buildings) {
    if (b.type === "totem" && b.stage === "built") discs.push({ x: b.pos.x, y: b.pos.y, r: TOTEM_TERRITORY_RADIUS, owner: b.colonyId });
  }
  return discs;
}

/** Owner of the land at p, or undefined for no one's land. */
export function territoryOwnerAt(surface: TerritorySurface | TerritoryDisc[], p: Vec2): string | undefined {
  const discs = Array.isArray(surface) ? surface : territoryDiscs(surface);
  let owner: string | undefined, best = 0;
  for (const d of discs) {
    const margin = d.r - Math.hypot(p.x - d.x, p.y - d.y);
    if (margin > best) { best = margin; owner = d.owner; }
  }
  return owner;
}

/** Refusal for building at p by owner, or null on own land. */
export function territoryPlacement(surface: TerritorySurface, owner: string, p: Vec2): string | null {
  // A surface without camps (bench worlds) has no land to own.
  if (!surface.entrances.length) return null;
  const at = territoryOwnerAt(surface, p);
  if (at === owner) return null;
  return at ? "Чужая земля" : "Вне своей земли — поставь тотем ближе";
}
