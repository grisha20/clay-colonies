import type { Colony, FoodKind, FoodSource } from "../../../shared/types";

// Eat the most perishable stock first. Actual spoilage can later build on the
// same categories without changing callers.
const consumptionOrder: readonly FoodKind[] = ["meat", "fish", "fruit"];

export function normalizeFoodStock(colony: Colony): Record<FoodKind, number> {
  if (!colony.foodStock) {
    colony.foodStock = { fruit: Math.max(0, colony.food ?? 0), fish: 0, meat: 0 };
  } else {
    colony.foodStock.fruit = Math.max(0, colony.foodStock.fruit ?? 0);
    colony.foodStock.fish = Math.max(0, colony.foodStock.fish ?? 0);
    colony.foodStock.meat = Math.max(0, colony.foodStock.meat ?? 0);
  }
  colony.food = colony.foodStock.fruit + colony.foodStock.fish + colony.foodStock.meat;
  return colony.foodStock;
}

export function addFoodStock(colony: Colony, kind: FoodKind, amount: number): void {
  if (amount <= 0) return;
  const stock = normalizeFoodStock(colony);
  stock[kind] += amount;
  colony.food += amount;
}

export function consumeFoodStock(colony: Colony, amount: number): boolean {
  if (amount <= 0) return true;
  const stock = normalizeFoodStock(colony);
  if (colony.food + 1e-9 < amount) return false;
  let left = amount;
  for (const kind of consumptionOrder) {
    const take = Math.min(stock[kind], left);
    stock[kind] -= take;
    left -= take;
    if (left <= 1e-9) break;
  }
  colony.food = stock.fruit + stock.fish + stock.meat;
  return true;
}

export function foodKindForSource(source: Pick<FoodSource, "kind">): FoodKind {
  return source.kind === "food" || source.kind === undefined ? "fruit" : "meat";
}

export function isFoodCarryKind(kind: string | undefined): kind is FoodKind | "food" {
  return kind === undefined || kind === "food" || kind === "fruit" || kind === "fish" || kind === "meat";
}

export function normalizedCarryFoodKind(kind: string | undefined): FoodKind {
  return kind === "fish" || kind === "meat" || kind === "fruit" ? kind : "fruit";
}
