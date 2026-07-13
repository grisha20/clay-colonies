import { CONFIG } from "./config";
import { saveWorldSnapshot } from "./state/snapshot";
import { step } from "./sim/step";
import type { World } from "./sim/world";
import { profiler } from "./utils/profiler";

export type LoopController = {
  setSpeed(speed: number): void;
  getSpeed(): number;
};

export function simulationSlice(simSpeed: number): { targetTickMs: number; stepsPerTick: number } {
  const maxStepsPerSlice = 3;
  const paused = simSpeed === 0;
  let targetTickMs = simSpeed <= 1 ? CONFIG.tickMs : Math.max(20, Math.floor(CONFIG.tickMs / simSpeed));
  let stepsPerTick = paused ? 0 : simSpeed === 1 ? 1 : Math.max(1, Math.round(simSpeed / (CONFIG.tickMs / targetTickMs)));
  if (stepsPerTick > maxStepsPerSlice) {
    stepsPerTick = maxStepsPerSlice;
    targetTickMs = Math.max(4, Math.floor((CONFIG.tickMs * stepsPerTick) / simSpeed));
  }
  return { targetTickMs, stepsPerTick };
}

export function startLoop(world: World, onSnapshot: (includePheromones: boolean) => void): LoopController {
  let simSpeed = 1;
  let lastPheromoneSentAt = 0;
  let lastBroadcastAt = 0;
  let lastSaveAt = Date.now();
  let timerId: NodeJS.Timeout | null = null;

  function runTick() {
    const now = Date.now();

    // Smaller slices preserve requested steps/second while yielding to
    // networking more often. At 50x this is 3 steps about every 6 ms.
    const { targetTickMs, stepsPerTick } = simulationSlice(simSpeed);

    // Замеряем каждый симуляционный шаг отдельно, чтобы профайлер фаз считал ms/step.
    for (let i = 0; i < stepsPerTick; i += 1) {
      profiler.measure("step_total", () => {
        step(world);
      });
    }

    // Автосохранение по реальному времени — раз в 15 секунд (15000 мс)
    if (now - lastSaveAt >= 15000) {
      profiler.measureAsync("saveWorldSnapshot", () => saveWorldSnapshot(world)).catch((error: unknown) => {
        console.warn(`Could not save snapshot: ${(error as Error).message}`);
      });
      lastSaveAt = now;
    }

    // Snapshot отправляем по wall-clock throttle, а не на каждый ускоренный tick.
    if (now - lastBroadcastAt >= CONFIG.broadcastIntervalMs) {
      const includePheromones = now - lastPheromoneSentAt >= 1000;
      if (includePheromones) {
        lastPheromoneSentAt = now;
      }
      profiler.measure("broadcast", () => onSnapshot(includePheromones));
      lastBroadcastAt = now;
    }

    // Вывод логов профайлера в консоль раз в 10 секунд
    profiler.reportIfNeeded();

    // Планируем следующий тик с компенсацией времени вычислений
    const elapsed = Date.now() - now;
    const delay = Math.max(1, targetTickMs - elapsed);
    timerId = setTimeout(runTick, delay);
  }

  // Запуск первого тика
  timerId = setTimeout(runTick, CONFIG.tickMs);

  return {
    setSpeed(speed: number) {
      if (Number.isFinite(speed)) {
        simSpeed = Math.max(0, Math.floor(speed));
      }
    },
    getSpeed() {
      return simSpeed;
    }
  };
}
