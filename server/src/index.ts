import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG } from "./config";
import { loadGenome } from "./ai/genome";
import { loadSpiderGenome } from "./ai/spiderGenome";
import { createSocketHub } from "./net/socket";
import { loadWorldSnapshot, saveWorldSnapshot } from "./state/snapshot";
import { addFoodSource, createWorld, restartColony, toNetworkSnapshot } from "./sim/world";
import { eraseColonyZone, paintColonyZone } from "./sim/zones";
import { eraseBuildCells, paintWallCells, placePointBuilding } from "./sim/building";
import { startLoop, type LoopController } from "./loop";

const genomeState = await loadGenome();
const genomeStateB = await loadGenome(CONFIG.genomeFileB);
const spiderGenomeState = await loadSpiderGenome();
const loadedWorld = await loadWorldSnapshot(genomeState, spiderGenomeState, genomeStateB);
const world = loadedWorld ?? createWorld(genomeState, spiderGenomeState, genomeStateB);

let loop: LoopController;
const hub = createSocketHub(CONFIG.wsPort, (view, includePheromones) => toNetworkSnapshot(world, includePheromones, view), (command) => {
  if (command.type === "dropFood") {
    addFoodSource(world, command.x, command.y, CONFIG.playerFoodAmount);
  }
  if (command.type === "paintZone") {
    paintColonyZone(world, command.colonyIndex, command.zone, command.cells);
  }
  if (command.type === "eraseZone") {
    eraseColonyZone(world, command.colonyIndex, command.cells);
  }
  if (command.type === "placeBuilding") {
    placePointBuilding(world, command.colonyIndex, command.building, command.x, command.y);
  }
  if (command.type === "paintWall") {
    paintWallCells(world, command.colonyIndex, command.cells);
  }
  if (command.type === "paintGate") {
    paintWallCells(world, command.colonyIndex, command.cells, "gate");
  }
  if (command.type === "eraseBuild") {
    eraseBuildCells(world, command.colonyIndex, command.cells);
  }
  if (command.type === "setPriorities") {
    const colony = world.colonies[command.colonyIndex];
    if (colony) {
      colony.colony.priorities = command.priorities;
    }
  }
  if (command.type === "newGame") {
    // Новая партия: свежий мир на месте, геномы и обучение сохраняются.
    restartColony(world);
  }
  if (command.type === "setSpeed") {
    // 0 = пауза; 1..50 = скорость симуляции.
    loop.setSpeed(Math.max(0, Math.min(50, Math.floor(command.value))));
  }
  if (command.type === "saveOffsetSettings") {
    try {
      let baseDir = process.cwd();
      if (baseDir.endsWith("server") || baseDir.endsWith("server\\") || baseDir.endsWith("server/") || !fs.existsSync(path.join(baseDir, "client"))) {
        baseDir = path.join(baseDir, "..");
      }
      const filePath = path.join(baseDir, "client/src/render/surface/editor.ts");
      const currentContent = fs.readFileSync(filePath, "utf-8");
      const newSettingsStr = `export const offsetSettings = ${JSON.stringify(command.settings, null, 2)};`;
      const regex = /export const offsetSettings = \{[\s\S]*?\};/;
      const updatedContent = currentContent.replace(regex, newSettingsStr);
      fs.writeFileSync(filePath, updatedContent, "utf-8");
      console.log("[EDITOR] Graphics offsets configuration updated successfully!");
    } catch (e: any) {
      console.error("[EDITOR] Failed to save offsets config:", e.message);
    }
  }
});
loop = startLoop(world, (includePheromones) => {
  hub.broadcast((view) => toNetworkSnapshot(world, includePheromones, view));
});

process.on("SIGINT", () => {
  saveWorldSnapshot(world)
    .catch((error: unknown) => {
      console.warn(`Could not save snapshot on exit: ${(error as Error).message}`);
    })
    .finally(() => {
      hub.close();
      process.exit(0);
    });
});
