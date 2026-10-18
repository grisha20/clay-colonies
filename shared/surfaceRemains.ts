import type { FoodSource, ResourceNode } from "./types";
import { isWaterAt } from "./surfaceTerrain";

// Washed clay disperses in a lake; it is not a harvestable deposit on the water.
export function submergedClay(node: Pick<ResourceNode, "id" | "kind" | "pos">): boolean {
  return node.kind === "clay" && node.id.startsWith("wash-") && isWaterAt(node.pos.x, node.pos.y);
}

// A drowned clay resident dissolves rather than leaving edible meat afloat.
export function submergedCorpse(source: Pick<FoodSource, "kind" | "pos">): boolean {
  return source.kind === "antCorpse" && isWaterAt(source.pos.x, source.pos.y);
}
