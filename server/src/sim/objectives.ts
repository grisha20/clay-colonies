// Задачи партии: простые цели, которые ведут игрока по петле
// «добудь -> построй -> вырасти -> переживи». Прогресс считается по состоянию
// мира племени A; done защёлкивается и не откатывается (запас можно потратить).
import type { Objective } from "../../../shared/types";
import type { World } from "./world";

export function createObjectives(): Objective[] {
  return [
    // Пути победы: достаточно одного, у каждого своё «послевкусие».
    { id: "win-spider", text: "Одолеть паука (военная)", target: 1, progress: 0, done: false, victory: true },
    { id: "win-bigrain", text: "Пережить Большой дождь с костром", target: 1, progress: 0, done: false, victory: true },
    { id: "win-idol", text: "Слепить Идола (хитрая)", target: 1, progress: 0, done: false, victory: true },
    // Обучение: ведёт новичка по петле.
    { id: "clay-40", text: "Запасти 40 глины", target: 40, progress: 0, done: false },
    { id: "stone-25", text: "Запасти 25 камня", target: 25, progress: 0, done: false },
    { id: "hut-2", text: "Построить 2 новые хижины", target: 2, progress: 0, done: false },
    { id: "wall-12", text: "Построить 12 сегментов стены", target: 12, progress: 0, done: false },
    { id: "pop-20", text: "Вырастить племя до 20 жителей", target: 20, progress: 0, done: false }
  ];
}

// Старые сохранения: сохраняем done-флаги, текст/цели берём из кода.
export function restoreObjectives(saved: Objective[] | undefined): Objective[] {
  const fresh = createObjectives();
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
  const colony = world.colonies[0];
  if (!colony) {
    return 0;
  }
  switch (id) {
    case "clay-40":
      return colony.colony.clay;
    case "stone-25":
      return colony.colony.stone;
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
    case "win-spider":
      return colony.fitness.spidersKilled;
    case "win-idol":
      return world.surface.buildings.filter(
        (building) => building.colonyId === colony.id && building.type === "idol" && building.stage === "built"
      ).length;
    case "win-bigrain":
      return world.weather.bigRainDone && world.weather.bigRainSurvived ? 1 : 0;
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
