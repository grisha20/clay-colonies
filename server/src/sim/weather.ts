// Погода Clayfolk: ясно -> предупреждение -> дождь -> ясно.
// Дождь — главная «своя» катастрофа: размывает глиняные стены, мочит жителей
// вне круга костра и хижин, притушает костры. После дождя строители чинят
// стены глиной — та же глина, из которой лепят жителей.
import type { Weather } from "../../../shared/types";
import { CONFIG } from "../config";
import { damageBuilding } from "./building";
import type { World } from "./world";

function clearDuration(): number {
  return CONFIG.weatherClearMinTicks + Math.floor(Math.random() * CONFIG.weatherClearVarTicks);
}

export function createWeather(): Weather {
  return { state: "clear", until: clearDuration(), bigRainAt: CONFIG.bigRainAtTicks };
}

export function updateWeather(world: World): void {
  const weather = world.weather;

  // Большой дождь: объявленное испытание партии — втрое длиннее обычного.
  const bigRainAt = weather.bigRainAt ?? CONFIG.bigRainAtTicks;
  if (!weather.bigRainDone && !weather.bigRainActive && weather.state === "clear" && world.tick >= bigRainAt) {
    weather.bigRainActive = true;
    weather.state = "warning";
    weather.until = world.tick + CONFIG.weatherWarningTicks;
    return;
  }

  if (world.tick < weather.until) {
    applyRain(world);
    return;
  }

  if (weather.state === "clear") {
    weather.state = "warning";
    weather.until = world.tick + CONFIG.weatherWarningTicks;
  } else if (weather.state === "warning") {
    weather.state = "rain";
    weather.until = world.tick + (weather.bigRainActive ? CONFIG.bigRainTicks : CONFIG.weatherRainTicks);
  } else {
    if (weather.bigRainActive) {
      // Большой дождь закончился: пережили ли с живым костром?
      weather.bigRainActive = false;
      weather.bigRainDone = true;
      weather.bigRainSurvived = (world.colonies[0]?.colony.fire ?? 0) >= CONFIG.bigRainFireGoal;
    }
    weather.state = "clear";
    weather.until = world.tick + clearDuration();
  }
}

// Дождь размывает ДОСТРОЕННЫЕ стены (глина плывёт).
function applyRain(world: World): void {
  if (world.weather.state !== "rain" || world.tick % CONFIG.rainWallDamageEveryTicks !== 0) {
    return;
  }
  for (const building of [...world.surface.buildings]) {
    if ((building.type === "wall" || building.type === "gate") && building.stage === "built") {
      damageBuilding(world, building, CONFIG.rainWallDamage);
    }
  }
}

// Житель в укрытии? (у костра или у достроенной хижины своего племени)
export function isSheltered(world: World, pos: { x: number; y: number }): boolean {
  const entrance = world.surface.entrance;
  const dxE = pos.x - entrance.x;
  const dyE = pos.y - entrance.y;
  if (dxE * dxE + dyE * dyE <= CONFIG.rainShelterFireRadius * CONFIG.rainShelterFireRadius) {
    return true;
  }
  for (const building of world.surface.buildings) {
    if (building.type !== "hut" || building.stage !== "built" || building.colonyId !== world.colony.id) {
      continue;
    }
    const dx = pos.x - building.pos.x;
    const dy = pos.y - building.pos.y;
    if (dx * dx + dy * dy <= CONFIG.rainShelterHutRadius * CONFIG.rainShelterHutRadius) {
      return true;
    }
  }
  return false;
}
