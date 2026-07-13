// Минимапа: упрощённая картина мира на 2D-canvas + рамка вьюпорта.
// Перерисовывается на каждом снапшоте (10 раз/с) — при <100 точках это дёшево.
import type { WorldSnapshot } from "../../../shared/types";
import { SURFACE_TERRAIN_CELL_SIZE, isDeepWaterAt, isWaterAt } from "../../../shared/surfaceTerrain";
import type { Camera } from "./types";
import { SURFACE_TILE_SIZE } from "./types";

export function drawMinimap(
  canvas: HTMLCanvasElement,
  world: WorldSnapshot,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const scale = canvas.width / world.surface.width;
  const toX = (x: number) => x * scale;
  const toY = (y: number) => y * scale;

  // Фон: трава + поляны лагерей.
  context.fillStyle = "#7fa14f";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Large authored lakes use same shared terrain formula as server collision.
  for (let y = 0; y < world.surface.height; y += SURFACE_TERRAIN_CELL_SIZE) {
    for (let x = 0; x < world.surface.width; x += SURFACE_TERRAIN_CELL_SIZE) {
      const centerX = x + SURFACE_TERRAIN_CELL_SIZE * 0.5;
      const centerY = y + SURFACE_TERRAIN_CELL_SIZE * 0.5;
      if (!isWaterAt(centerX, centerY)) {
        continue;
      }
      context.fillStyle = isDeepWaterAt(centerX, centerY) ? "#1b8c98" : "#32c3c1";
      context.fillRect(toX(x), toY(y), SURFACE_TERRAIN_CELL_SIZE * scale + 0.3, SURFACE_TERRAIN_CELL_SIZE * scale + 0.3);
    }
  }
  for (const entrance of world.surface.entrances ?? [world.surface.entrance]) {
    context.fillStyle = "#c2a06a";
    context.beginPath();
    context.ellipse(toX(entrance.x), toY(entrance.y), 38 * scale, 28 * scale, 0, 0, Math.PI * 2);
    context.fill();
  }

  // Узлы ресурсов.
  for (const node of world.surface.resourceNodes ?? []) {
    if (node.amount <= 0) {
      continue;
    }
    context.fillStyle =
      node.kind === "clay"
        ? "#bc6240"
        : node.kind === "tree" || node.kind === "stick"
          ? "#3f7a2d"
          : "#8d8b82";
    context.fillRect(toX(node.pos.x) - 1.5, toY(node.pos.y) - 1.5, 3, 3);
  }

  // Еда.
  context.fillStyle = "#4f9a3c";
  for (const source of world.surface.foodSources) {
    if (source.amount > 0) {
      context.fillRect(toX(source.pos.x) - 1, toY(source.pos.y) - 1, 2, 2);
    }
  }

  // Постройки.
  for (const building of world.surface.buildings ?? []) {
    context.fillStyle = building.stage === "built" ? "#8b3f2a" : "#d9b98a";
    context.fillRect(toX(building.pos.x) - 1, toY(building.pos.y) - 1, 2, 2);
  }

  // Жители по цвету племени.
  for (const ant of world.ants) {
    context.fillStyle = ant.colonyId === "colony-2" ? "#e05a3a" : "#5a2f1d";
    context.fillRect(toX(ant.pos.x) - 1, toY(ant.pos.y) - 1, 2, 2);
  }

  // Паук.
  for (const enemy of world.enemies) {
    if (enemy.hp > 0) {
      context.fillStyle = "#1c1210";
      context.fillRect(toX(enemy.pos.x) - 2, toY(enemy.pos.y) - 2, 4, 4);
    }
  }

  // Рамка вьюпорта.
  const halfWidth = viewportWidth / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  const halfHeight = viewportHeight / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  context.strokeStyle = "rgba(255, 251, 234, 0.9)";
  context.lineWidth = 1;
  context.strokeRect(
    toX(camera.x - halfWidth),
    toY(camera.y - halfHeight),
    halfWidth * 2 * scale,
    halfHeight * 2 * scale
  );
}

// Клик по минимапе -> мировые координаты.
export function minimapClickToWorld(
  canvas: HTMLCanvasElement,
  world: WorldSnapshot,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) / Math.max(1, rect.width);
  const py = (clientY - rect.top) / Math.max(1, rect.height);
  return {
    x: Math.max(0, Math.min(world.surface.width, px * world.surface.width)),
    y: Math.max(0, Math.min(world.surface.height, py * world.surface.height))
  };
}
