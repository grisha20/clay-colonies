import { CONFIG } from "./config";
import { loadGenome } from "./ai/genome";
import { loadSpiderGenome } from "./ai/spiderGenome";
import { createSocketHub } from "./net/socket";
import { loadWorldSnapshot, saveWorldSnapshot } from "./state/snapshot";
import { addFoodSource, createWorld, toNetworkSnapshot } from "./sim/world";
import { eraseColonyZone, paintColonyZone } from "./sim/zones";
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
    // До Фазы 8 (playerId) команды игрока применяются к племени A.
    paintColonyZone(world, 0, command.zone, command.cells);
  }
  if (command.type === "eraseZone") {
    eraseColonyZone(world, 0, command.cells);
  }
  if (command.type === "setSpeed") {
    loop.setSpeed(Math.max(1, Math.min(50, Math.floor(command.value))));
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
