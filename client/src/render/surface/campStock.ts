import { Sprite } from "pixi.js";
import type { Colony } from "../../../../shared/types";
import { getEquipmentArt, type EquipmentKind } from "./equipmentArt";
import { getFishArt } from "./fishArt";
import { campPileRoots } from "./entrance";

export function campStockSprites(colony: Colony, x: number, y: number): Sprite[] {
  const result: Sprite[] = [];
  const add = (pile: keyof typeof campPileRoots, kind: EquipmentKind, amount: number, seed = 0) => {
    const root = campPileRoots[pile], count = amount > 0.5 ? Math.min(8, Math.max(1, Math.ceil(amount / 12))) : 0;
    for (let i = 0; i < count; i++) {
      const art = kind === "fish" ? getFishArt("blue", 0, true, 12) : getEquipmentArt(kind, kind === "wood" ? 18 : kind === "tomato" ? 9 : 12);
      const sprite = new Sprite(art.texture); sprite.anchor.set(0.5, 1); sprite.scale.set(art.scale);
      const dx = ((i + seed) * 13 % 29) - 14, dy = ((i + seed) * 7 % 13) - 6;
      sprite.position.set(x + root.x + dx, y + root.y + dy - 3); sprite.zIndex = sprite.y;
      sprite.rotation = kind === "wood" ? (i % 2 ? 0.16 : -0.12) : (i % 3 - 1) * 0.09;
      sprite.label = `camp_stock_${pile}_${i}_${seed}`; result.push(sprite);
    }
  };
  add("food", "tomato", colony.foodStock?.fruit ?? colony.food);
  add("food", "fish", colony.foodStock?.fish ?? 0, 3);
  add("food", "meat", colony.foodStock?.meat ?? 0, 6);
  add("clay", "clay", colony.clay); add("wood", "wood", colony.wood); add("stone", "stone", colony.stone);
  return result;
}
