// Задачи партии: простые цели, которые ведут игрока по петле
// «добудь -> построй -> вырасти -> переживи». Прогресс считается по состоянию
// мира племени A; done защёлкивается и не откатывается (запас можно потратить).
import type { Objective } from "../../../shared/types";
import type { World } from "./world";
import { CONFIG } from "../config";

/** Goals that need springs are left out on maps without them (older saves). */
export function createObjectives(hasSprings = true): Objective[] {
  return [
    // Пути победы: достаточно одного, у каждого своё «послевкусие».
    { id: "win-dominance", text: `Держать ${CONFIG.dominanceSprings} источника особой глины сутки`, target: CONFIG.dominanceTicks, progress: 0, done: false, victory: true },
    { id: "win-idol", text: "Завершить ритуал Идола (живой костёр и особая глина)", target: CONFIG.idolRitualTicks, progress: 0, done: false, victory: true },
    { id: "win-bigrain", text: "Пережить Великий ливень сильнее соседей", target: 1, progress: 0, done: false, victory: true },
    { id: "win-spider", text: "Одолеть паука", target: 1, progress: 0, done: false },
    // Обучение: ведёт новичка по петле.
    { id: "clay-40", text: "Запасти 40 глины", target: 40, progress: 0, done: false },
    { id: "stone-25", text: "Запасти 25 камня", target: 25, progress: 0, done: false },
    { id: "workshop-1", text: "Построить мастерскую", target: 1, progress: 0, done: false },
    { id: "hut-2", text: "Построить 2 новые хижины", target: 2, progress: 0, done: false },
    { id: "wall-12", text: "Построить 12 сегментов стены", target: 12, progress: 0, done: false },
    { id: "pop-20", text: "Вырастить племя до 20 жителей", target: 20, progress: 0, done: false },
    { id: "kiln-1", text: "Построить печь обжига", target: 1, progress: 0, done: false },
    { id: "fired-10", text: "Обжечь 10 жителей", target: 10, progress: 0, done: false },
    { id: "totem-1", text: "Поставить тотем рода", target: 1, progress: 0, done: false },
    { id: "spring-1", text: "Занять источник особой глины", target: 1, progress: 0, done: false }
  ].filter((goal) => hasSprings || (goal.id !== "spring-1" && goal.id !== "win-dominance"));
}

// Старые сохранения: сохраняем done-флаги, текст/цели берём из кода.
export function restoreObjectives(saved: Objective[] | undefined, hasSprings = true): Objective[] {
  const fresh = createObjectives(hasSprings);
  if (!saved?.length) {
    return fresh;
  }
  for (const objective of fresh) {
    const match = saved.find((item) => item.id === objective.id);
    if (match?.done) {
      objective.done = true;
      objective.progress = objective.target;
    }
  }
  return fresh;
}

function currentValue(world: World, id: string): number {
  const colony = world.colonies[world.session.playerColonyIndex ?? 0];
  if (!colony) {
    return 0;
  }
  switch (id) {
    case "clay-40":
      return colony.colony.clay;
    case "stone-25":
      return colony.colony.stone;
    case "workshop-1":
      return world.surface.buildings.filter(
        (building) => building.colonyId === colony.id && building.type === "workshop" && building.stage === "built"
      ).length;
    case "hut-2":
      // Стартовые 2 хижины не считаются: нужно построить НОВЫЕ.
      return Math.max(
        0,
        world.surface.buildings.filter(
          (building) => building.colonyId === colony.id && building.type === "hut" && building.stage === "built"
        ).length - 2
      );
    case "wall-12":
      return world.surface.buildings.filter(
        (building) => building.colonyId === colony.id && building.type === "wall" && building.stage === "built"
      ).length;
    case "pop-20":
      return colony.ants.length;
    case "kiln-1":
      return world.surface.buildings.filter(
        (building) => building.colonyId === colony.id && building.type === "kiln" && building.stage === "built"
      ).length;
    case "fired-10":
      return colony.colony.firedTotal ?? 0;
    case "totem-1":
      return world.surface.buildings.filter(
        (building) => building.colonyId === colony.id && building.type === "totem" && building.stage === "built"
      ).length;
    case "spring-1":
      return (world.surface.springs ?? []).filter((spring) => spring.holder === colony.id).length;
    case "win-spider":
      return colony.fitness.spidersKilled;
    case "win-idol":
      return world.session.idolProgress;
    case "win-bigrain":
      // Older saves: the early Big Rain survived with the fire, as before.
      if ((world.weather.bigRainAt ?? CONFIG.bigRainAtTicks) < CONFIG.bigRainAtTicks) return world.weather.bigRainDone && world.weather.bigRainSurvived ? 1 : 0;
      return world.session.finaleWon ? 1 : 0;
    case "win-dominance":
      return world.session.dominance?.holder === colony.id ? world.tick - world.session.dominance.since : 0;
    default:
      return 0;
  }
}

export function updateObjectives(world: World): void {
  for (const objective of world.objectives) {
    if (objective.done) {
      objective.progress = objective.target;
      continue;
    }
    const value = Math.max(0, currentValue(world, objective.id));
    objective.progress = Math.min(objective.target, value);
    if (objective.progress >= objective.target) {
      objective.done = true;
    }
  }
}
