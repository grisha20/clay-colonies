import { Application, Graphics } from "pixi.js";
import { CURRENT_PROTOCOL_VERSION, WALL_CELL_SIZE, ZONE_CELL_SIZE, type NetworkWorldSnapshot, type WorldSnapshot } from "../../shared/types";
import { renderWorld, surfaceTileFromGlobal, type Camera, type ViewMode } from "./render";
import { preloadEnvironmentAssets } from "./render/surface/environment";
import { spriteIconDataUrl } from "./sprites";
import { drawMinimap, minimapClickToWorld } from "./render/minimap";
import { setSelectedAntId } from "./render/surface/entities";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root");
}

appRoot.innerHTML = `
  <main class="app">
    <div id="canvas-host" class="canvasHost"></div>
    <section class="panel topPanel">
      <div class="brand">
        <span class="mark"></span>
        <strong>Clayfolk</strong>
      </div>
      <div class="segmented" role="tablist" aria-label="Слой">
        <button class="active" data-view="surface" type="button">Поверхность</button>
        <button data-view="underground" type="button">Подземелье</button>
      </div>
      <div class="segmented nestControls" aria-label="Гнездо">
        <button class="active" data-nest="0" type="button">Гнездо A</button>
        <button data-nest="1" type="button">Гнездо B</button>
      </div>
      <div class="segmented speedControls" aria-label="Скорость">
        <button data-speed="0" type="button">II</button>
        <button class="active" data-speed="1" type="button">1x</button>
        <button data-speed="5" type="button">5x</button>
        <button data-speed="20" type="button">20x</button>
        <button data-speed="50" type="button">Max</button>
      </div>
      <div class="segmented trampleControls" aria-label="Тропинки">
        <button class="active" id="btn-trample" type="button">Тропинки: Вкл</button>
      </div>
      <div class="segmented toolControls" aria-label="Инструмент">
        <button class="active" data-tool="food" type="button">Еда</button>
        <button data-tool="harvest" type="button">Зона добычи</button>
        <button data-tool="forbid" type="button">Зона запрета</button>
        <button data-tool="hut" type="button">Хижина</button>
        <button data-tool="storage" type="button">Склад</button>
        <button data-tool="wall" type="button">Стена</button>
        <button data-tool="erase" type="button">Ластик</button>
      </div>
      <div class="segmented cameraControls" aria-label="Камера">
        <button class="active" data-camera="follow" type="button">Слежение</button>
        <button data-camera="free" type="button">Свободно</button>
        <button data-camera="nest" type="button">К гнезду</button>
      </div>
    </section>
    <aside class="panel hud">
      <div class="hudCommon">
        <div><span>Тик</span><strong id="tick">0</strong></div>
        <div><span>Население</span><strong id="population">0</strong></div>
        <div><span>Паук</span><strong id="spider-status">-</strong></div>
      </div>
      <div class="colonyGrid">
        <section class="colonyStats colonyA">
          <h2>Племя A</h2>
          <div><span>Жители</span><strong id="colony-a-workers">0</strong></div>
          <div><span>Разведка</span><strong id="colony-a-scouts">0</strong></div>
          <div><span>Еда</span><strong id="colony-a-storage">0</strong></div>
          <div><span>Глина</span><strong id="colony-a-clay">0</strong></div>
          <div><span>Дерево</span><strong id="colony-a-wood">0</strong></div>
          <div><span>Камень</span><strong id="colony-a-stone">0</strong></div>
        </section>
        <section class="colonyStats colonyB">
          <h2>Племя B</h2>
          <div><span>Жители</span><strong id="colony-b-workers">0</strong></div>
          <div><span>Разведка</span><strong id="colony-b-scouts">0</strong></div>
          <div><span>Еда</span><strong id="colony-b-storage">0</strong></div>
          <div><span>Глина</span><strong id="colony-b-clay">0</strong></div>
          <div><span>Дерево</span><strong id="colony-b-wood">0</strong></div>
          <div><span>Камень</span><strong id="colony-b-stone">0</strong></div>
        </section>
      </div>
    </aside>
    <section class="panel resourceBar" id="resource-bar">
      <span class="res"><img id="icon-food" alt="еда"><strong id="res-food">0</strong><em id="rate-food"></em></span>
      <span class="res"><img id="icon-clay" alt="глина"><strong id="res-clay">0</strong><em id="rate-clay"></em></span>
      <span class="res"><img id="icon-wood" alt="дерево"><strong id="res-wood">0</strong><em id="rate-wood"></em></span>
      <span class="res"><img id="icon-stone" alt="камень"><strong id="res-stone">0</strong><em id="rate-stone"></em></span>
      <span class="res"><img id="icon-pop" alt="жители"><strong id="res-pop">0/0</strong></span>
    </section>
    <aside class="panel tasksPanel">
      <h2>Задачи</h2>
      <div id="tasks-list"></div>
    </aside>
    <aside class="panel unitPanel" id="unit-panel" style="display: none;">
      <h2 id="unit-title">Житель</h2>
      <div class="unitRow"><span>Занятие</span><strong id="unit-job">-</strong></div>
      <div class="unitRow"><span>Силы</span>
        <div class="energyBar"><div id="unit-energy"></div></div>
      </div>
      <div class="unitRow"><span>Груз</span><strong id="unit-cargo">-</strong></div>
    </aside>
    <aside class="panel minimapPanel">
      <canvas id="minimap" width="168" height="168"></canvas>
    </aside>
    <footer class="panel status">
      <span id="status">Подключение к ws://localhost:8787</span>
      <span id="tool-hint">Клик по карте - подкинуть еду</span>
      <span class="perfStat">FPS <strong id="fps">0</strong></span>
      <span class="perfStat">Packet <strong id="packet-ms">0</strong> ms</span>
      <span class="perfStat">Payload <strong id="payload-kb">0</strong> KB</span>
      <span class="perfStat">Render <strong id="render-ms">0</strong> ms</span>
      <span class="perfStat">Ants <strong id="ants-count">0</strong></span>
    </footer>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #182018;
    color: #f5f8ef;
  }

  * { box-sizing: border-box; }

  html, body, #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  button {
    font: inherit;
  }

  .app {
    position: fixed;
    inset: 0;
    background: #15100d;
  }

  .canvasHost {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .canvasHost canvas {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
    cursor: crosshair;
  }

  .panel {
    position: absolute;
    z-index: 2;
    border: 1px solid rgb(245 248 239 / 0.22);
    border-radius: 8px;
    background: rgb(20 27 21 / 0.78);
    color: #f5f8ef;
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.22);
  }

  .topPanel {
    left: 14px;
    right: 14px;
    top: 14px;
    min-height: 52px;
    padding: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    pointer-events: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 152px;
  }

  .mark {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 38%, #f0c14b 0 16%, #6b3f24 18% 42%, #17201b 44% 100%);
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.22);
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid rgb(245 248 239 / 0.24);
    border-radius: 8px;
    overflow: hidden;
    min-height: 36px;
  }

  .segmented button {
    border: 0;
    background: rgb(255 255 255 / 0.08);
    color: #dce7d2;
    padding: 0 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .segmented button.active {
    background: #dfe9c7;
    color: #1e281d;
  }

  .cameraControls {
    margin-left: auto;
  }

  .nestControls {
    display: none;
  }

  .trampleControls {
    display: grid;
  }

  .hud {
    right: 14px;
    top: 82px;
    width: min(560px, calc(100vw - 28px));
    padding: 12px;
    display: grid;
    gap: 12px;
  }

  .hudCommon,
  .colonyGrid {
    display: grid;
    gap: 8px;
  }

  .hudCommon {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .colonyGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hudCommon div,
  .colonyStats div {
    min-height: 28px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgb(245 248 239 / 0.12);
  }

  .colonyStats {
    min-width: 0;
  }

  .colonyStats h2 {
    margin: 0 0 4px;
    font-size: 14px;
    line-height: 1.2;
    letter-spacing: 0;
    color: #fffbea;
  }

  .colonyB h2 {
    color: #ffb4aa;
  }

  .hud span {
    color: #c4d0bb;
    font-size: 13px;
  }

  .hud strong {
    color: #fffbea;
    font-size: 16px;
    letter-spacing: 0;
    text-align: right;
  }

  .resourceBar {
    left: 50%;
    transform: translateX(-50%);
    top: 82px;
    padding: 6px 14px;
    display: flex;
    align-items: center;
    gap: 18px;
    white-space: nowrap;
  }

  .resourceBar .res {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .resourceBar img {
    width: 20px;
    height: 20px;
    image-rendering: pixelated;
  }

  .resourceBar strong {
    color: #fffbea;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }

  .resourceBar em {
    font-style: normal;
    font-size: 12px;
    color: #9fd08a;
    min-width: 30px;
  }

  .resourceBar em.negative {
    color: #e59a8e;
  }

  .tasksPanel {
    left: 14px;
    top: 82px;
    width: 240px;
    padding: 10px 12px;
  }

  .tasksPanel h2 {
    margin: 0 0 6px;
    font-size: 14px;
    color: #fffbea;
  }

  .taskRow {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    border-bottom: 1px solid rgb(245 248 239 / 0.12);
    font-size: 13px;
    color: #dce7d2;
  }

  .taskRow .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
    background: #c9b458;
  }

  .taskRow.done .dot {
    background: #6fbf4f;
  }

  .taskRow.done {
    color: #9fb58f;
    text-decoration: line-through;
  }

  .taskRow .progress {
    margin-left: auto;
    color: #fffbea;
    font-variant-numeric: tabular-nums;
  }

  .unitPanel {
    left: 14px;
    bottom: 58px;
    width: 230px;
    padding: 10px 12px;
  }

  .unitPanel h2 {
    margin: 0 0 6px;
    font-size: 14px;
    color: #fffbea;
  }

  .unitRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 24px;
    font-size: 13px;
    color: #c4d0bb;
  }

  .unitRow strong {
    color: #fffbea;
  }

  .energyBar {
    flex: 1;
    height: 8px;
    max-width: 130px;
    background: rgb(255 255 255 / 0.12);
    border-radius: 4px;
    overflow: hidden;
  }

  .energyBar div {
    height: 100%;
    width: 0%;
    background: #7ec850;
    border-radius: 4px;
  }

  .minimapPanel {
    right: 14px;
    bottom: 14px;
    padding: 6px;
    line-height: 0;
  }

  .minimapPanel canvas {
    width: 168px;
    height: 168px;
    cursor: pointer;
    image-rendering: pixelated;
    border-radius: 4px;
  }

  .status {
    left: 14px;
    bottom: 14px;
    max-width: calc(100vw - 28px);
    padding: 8px 10px;
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    color: #d7e2ce;
    font-size: 13px;
  }

  .perfStat strong {
    color: #fffbea;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 760px) {
    .topPanel {
      align-items: stretch;
    }

    .brand {
      width: 100%;
    }

    .segmented,
    .cameraControls {
      width: 100%;
      margin-left: 0;
    }

    .hudCommon,
    .colonyGrid {
      grid-template-columns: 1fr;
    }

    .hud {
      top: auto;
      bottom: 58px;
      max-height: 42vh;
      overflow: auto;
    }
  }
`;
document.head.appendChild(style);

document.querySelector("[data-view='surface']")?.closest(".segmented")?.remove();
document.querySelector(".nestControls")?.remove();

const canvasHost = document.querySelector<HTMLDivElement>("#canvas-host");
const appShell = document.querySelector<HTMLElement>(".app");
const status = document.querySelector<HTMLElement>("#status");
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
const nestButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nest]"));
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));
const cameraButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"));
const btnTrample = document.querySelector<HTMLButtonElement>("#btn-trample");
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tool]"));
const toolHint = document.querySelector<HTMLElement>("#tool-hint");
const tasksList = document.querySelector<HTMLElement>("#tasks-list");
const minimapCanvas = document.querySelector<HTMLCanvasElement>("#minimap");
const unitPanel = document.querySelector<HTMLElement>("#unit-panel");
const unitTitle = document.querySelector<HTMLElement>("#unit-title");
const unitJob = document.querySelector<HTMLElement>("#unit-job");
const unitEnergy = document.querySelector<HTMLElement>("#unit-energy");
const unitCargo = document.querySelector<HTMLElement>("#unit-cargo");
let selectedAnt: string | null = null;

const CARGO_NAMES: Record<string, string> = { food: "еда", clay: "глина", wood: "дерево", stone: "камень" };

function antJobLabel(world: WorldSnapshot, ant: WorldSnapshot["ants"][number]): string {
  if (ant.state === "fight") {
    return "Дерётся!";
  }
  if (ant.job === "guard") {
    return "Охраняет лагерь";
  }
  if (ant.job === "build") {
    return ant.carrying > 0 ? "Несёт материал на стройку" : "Строит";
  }
  if (ant.job === "harvest") {
    if (ant.carrying > 0 && ant.carryKind) {
      return `Несёт: ${CARGO_NAMES[ant.carryKind] ?? ant.carryKind}`;
    }
    const node = world.surface.resourceNodes?.find((item) => item.id === ant.harvestNodeId);
    return node ? `Добывает: ${CARGO_NAMES[node.kind] ?? node.kind}` : "Добывает ресурс";
  }
  if (ant.carryingDebris) {
    return "Прибирается";
  }
  if (ant.carrying > 0) {
    return "Несёт еду";
  }
  if (ant.forageRole === "scout") {
    return "Разведка";
  }
  if (ant.state === "return") {
    return "Возвращается в лагерь";
  }
  return "Ищет еду";
}

function updateUnitPanel(world: WorldSnapshot): void {
  if (!unitPanel || !unitTitle || !unitJob || !unitEnergy || !unitCargo) {
    return;
  }
  if (!selectedAnt) {
    unitPanel.style.display = "none";
    return;
  }
  const ant = world.ants.find((item) => item.id === selectedAnt);
  if (!ant || ant.state === "dead") {
    selectedAnt = null;
    setSelectedAntId(null);
    unitPanel.style.display = "none";
    return;
  }
  unitPanel.style.display = "block";
  unitTitle.textContent = `Житель ${ant.id.replace("ant-", "№")} (${ant.colonyId === "colony-2" ? "племя B" : "племя A"})`;
  unitJob.textContent = antJobLabel(world, ant);
  const energyFraction = Math.max(0, Math.min(1, ant.energy / 900));
  unitEnergy.style.width = `${Math.round(energyFraction * 100)}%`;
  unitEnergy.style.background = energyFraction > 0.4 ? "#7ec850" : energyFraction > 0.2 ? "#d8b74a" : "#d9534f";
  unitCargo.textContent =
    ant.carrying > 0
      ? `${CARGO_NAMES[ant.carryKind ?? "food"] ?? "еда"} (${ant.carrying.toFixed(1)})`
      : ant.carryingDebris
        ? "хлам"
        : "-";
}

// Ресурс-бар племени A: иконки + значения + прирост за минуту.
const resourceBarNodes = {
  food: document.querySelector<HTMLElement>("#res-food"),
  clay: document.querySelector<HTMLElement>("#res-clay"),
  wood: document.querySelector<HTMLElement>("#res-wood"),
  stone: document.querySelector<HTMLElement>("#res-stone"),
  pop: document.querySelector<HTMLElement>("#res-pop"),
  rateFood: document.querySelector<HTMLElement>("#rate-food"),
  rateClay: document.querySelector<HTMLElement>("#rate-clay"),
  rateWood: document.querySelector<HTMLElement>("#rate-wood"),
  rateStone: document.querySelector<HTMLElement>("#rate-stone")
};
for (const [id, name] of [
  ["icon-food", "food"],
  ["icon-clay", "clay"],
  ["icon-wood", "wood"],
  ["icon-stone", "stone"],
  ["icon-pop", "pop"]
] as const) {
  const img = document.querySelector<HTMLImageElement>(`#${id}`);
  if (img) {
    img.src = spriteIconDataUrl(name);
  }
}

type StockSample = { at: number; food: number; clay: number; wood: number; stone: number };
const stockSamples: StockSample[] = [];

function formatRate(node: HTMLElement | null, delta: number): void {
  if (!node) {
    return;
  }
  const rounded = Math.round(delta);
  if (rounded === 0) {
    node.textContent = "";
    return;
  }
  node.textContent = rounded > 0 ? `+${rounded}` : String(rounded);
  node.classList.toggle("negative", rounded < 0);
}

function updateResourceBar(world: WorldSnapshot): void {
  const colony = world.colonies?.[0]?.colony ?? world.colony;
  const now = performance.now();
  stockSamples.push({
    at: now,
    food: colony.food ?? 0,
    clay: colony.clay ?? 0,
    wood: colony.wood ?? 0,
    stone: colony.stone ?? 0
  });
  while (stockSamples.length > 2 && now - stockSamples[0].at > 60000) {
    stockSamples.shift();
  }
  const first = stockSamples[0];
  const minutes = Math.max(0.25, (now - first.at) / 60000);

  if (resourceBarNodes.food) resourceBarNodes.food.textContent = String(Math.floor(colony.food ?? 0));
  if (resourceBarNodes.clay) resourceBarNodes.clay.textContent = String(Math.floor(colony.clay ?? 0));
  if (resourceBarNodes.wood) resourceBarNodes.wood.textContent = String(Math.floor(colony.wood ?? 0));
  if (resourceBarNodes.stone) resourceBarNodes.stone.textContent = String(Math.floor(colony.stone ?? 0));
  if (resourceBarNodes.pop) {
    resourceBarNodes.pop.textContent = `${colony.population.workers}/${colony.nestCapacity ?? "-"}`;
  }
  formatRate(resourceBarNodes.rateFood, ((colony.food ?? 0) - first.food) / minutes);
  formatRate(resourceBarNodes.rateClay, ((colony.clay ?? 0) - first.clay) / minutes);
  formatRate(resourceBarNodes.rateWood, ((colony.wood ?? 0) - first.wood) / minutes);
  formatRate(resourceBarNodes.rateStone, ((colony.stone ?? 0) - first.stone) / minutes);
}
const tick = document.querySelector<HTMLElement>("#tick");
const population = document.querySelector<HTMLElement>("#population");
const spiderStatus = document.querySelector<HTMLElement>("#spider-status");
const fps = document.querySelector<HTMLElement>("#fps");
const packetMs = document.querySelector<HTMLElement>("#packet-ms");
const payloadKb = document.querySelector<HTMLElement>("#payload-kb");
const renderMs = document.querySelector<HTMLElement>("#render-ms");
const antsCount = document.querySelector<HTMLElement>("#ants-count");

let trampleEnabled = true;

// Инструменты игрока: клик-еда, кисть зон, постройки.
type PlayerTool = "food" | "harvest" | "forbid" | "hut" | "storage" | "wall" | "erase";
let currentTool: PlayerTool = "food";
let isPainting = false;
let dragTool: "harvest" | "forbid" | "wall" | "erase" | null = null;
let dragStart: { x: number; y: number } | null = null;
let dragEnd: { x: number; y: number } | null = null;

const TOOL_HINTS: Record<PlayerTool, string> = {
  food: "Клик по карте - подкинуть еду",
  harvest: "Растяни прямоугольник зоны добычи (ЛКМ)",
  forbid: "Растяни прямоугольник зоны запрета (ЛКМ)",
  hut: "Клик - хижина (8 глины + 5 дерева, +4 к лимиту). Shift - ставить несколько",
  storage: "Клик - склад (6 дерева + 4 камня, точка сдачи). Shift - ставить несколько",
  wall: "Растяни линию стены (ЛКМ), 2 глины за сегмент",
  erase: "Растяни прямоугольник - сотрёт зоны и свои стены"
};

const colonyNodes = [0, 1].map((index) => {
  const key = index === 0 ? "a" : "b";
  return {
    workers: document.querySelector<HTMLElement>(`#colony-${key}-workers`),
    scouts: document.querySelector<HTMLElement>(`#colony-${key}-scouts`),
    storage: document.querySelector<HTMLElement>(`#colony-${key}-storage`),
    clay: document.querySelector<HTMLElement>(`#colony-${key}-clay`),
    wood: document.querySelector<HTMLElement>(`#colony-${key}-wood`),
    stone: document.querySelector<HTMLElement>(`#colony-${key}-stone`)
  };
});

if (
  !canvasHost ||
  !appShell ||
  !status ||
  !tick ||
  !population ||
  !spiderStatus ||
  !fps ||
  !packetMs ||
  !payloadKb ||
  !renderMs ||
  !antsCount ||
  !btnTrample ||
  colonyNodes.some((nodes) => Object.values(nodes).some((node) => !node))
) {
  throw new Error("Missing UI nodes");
}

const canvasHostNode = canvasHost;
const appShellNode = appShell;
const statusNode = status;
const tickNode = tick;
const populationNode = population;
const spiderStatusNode = spiderStatus;
const fpsNode = fps;
const packetMsNode = packetMs;
const payloadKbNode = payloadKb;
const renderMsNode = renderMs;
const antsCountNode = antsCount;
const colonyStatNodes = colonyNodes.map((nodes) => ({
  workers: nodes.workers as HTMLElement,
  scouts: nodes.scouts as HTMLElement,
  storage: nodes.storage as HTMLElement,
  clay: nodes.clay as HTMLElement,
  wood: nodes.wood as HTMLElement,
  stone: nodes.stone as HTMLElement
}));

const SURFACE_TILE_SIZE = 8;
const DEFAULT_SURFACE_ZOOM = 1.45;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 3;
let packetInterval = 100;

type CameraMode = "follow" | "free";
type AntInterp = {
  prevX: number;
  prevY: number;
  prevAngle: number;
  currX: number;
  currY: number;
  currAngle: number;
  layer: string;
};

let currentView: ViewMode = "surface";
let currentUndergroundColony = 0;
let cameraMode: CameraMode = "follow";
let currentSpeed = 1;
let camera: Camera = { x: 50, y: 50, zoom: DEFAULT_SURFACE_ZOOM };
let latestWorld: NetworkWorldSnapshot | null = null;
let lastRenderAt = 0;
let lastPacketTime = 0;
let lastPheromones: WorldSnapshot["pheromones"] | null = null;
let warnedProtocolVersion = false;
let isDragging = false;
let pointerDown = false;
let dragDistance = 0;
let lastPointer = { x: 0, y: 0 };
let framesSinceFpsUpdate = 0;
let lastFpsUpdateAt = performance.now();
let currentFps = 0;
let lastRenderCostMs = 0;
let lastPayloadKb = 0;
const antInterp = new Map<string, AntInterp>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampCamera(world: WorldSnapshot): void {
  camera.zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const marginX = pixi.screen.width / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  const marginY = pixi.screen.height / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  camera.x = marginX * 2 >= world.surface.width
    ? world.surface.width / 2
    : clamp(camera.x, marginX, world.surface.width - marginX);
  camera.y = marginY * 2 >= world.surface.height
    ? world.surface.height / 2
    : clamp(camera.y, marginY, world.surface.height - marginY);
}

function centerOnNest(world: WorldSnapshot): void {
  camera.x = world.surface.entrance.x;
  camera.y = world.surface.entrance.y;
  clampCamera(world);
}

function setCameraMode(mode: CameraMode): void {
  cameraMode = mode;
  for (const button of cameraButtons) {
    button.classList.toggle("active", button.dataset.camera === mode);
  }
}

function setUndergroundColony(index: number): void {
  currentUndergroundColony = clamp(index, 0, 1);
  for (const button of nestButtons) {
    button.classList.toggle("active", Number(button.dataset.nest) === currentUndergroundColony);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const pixi = new Application();
await pixi.init({
  background: "#15100d",
  resizeTo: window,
  antialias: false
});
await preloadEnvironmentAssets();
canvasHost.appendChild(pixi.canvas);

let lastTasksKey = "";

function updateTasks(world: WorldSnapshot): void {
  if (!tasksList) {
    return;
  }
  const objectives = world.objectives ?? [];
  const key = objectives.map((o) => `${o.id}:${Math.floor(o.progress)}:${o.done}`).join("|");
  if (key === lastTasksKey) {
    return;
  }
  lastTasksKey = key;
  tasksList.innerHTML = objectives
    .map(
      (o) =>
        `<div class="taskRow${o.done ? " done" : ""}"><span class="dot"></span>` +
        `<span>${o.text}</span><span class="progress">${Math.floor(o.progress)}/${o.target}</span></div>`
    )
    .join("");
}

function updateHud(world: WorldSnapshot): void {
  tickNode.textContent = String(world.tick);
  populationNode.textContent = String(world.ants.length);
  const spider = world.enemies.find((enemy) => enemy.type === "spider");
  spiderStatusNode.textContent = spider && spider.hp > 0 ? "жив" : "нет";

  const colonies = world.colonies?.length
    ? world.colonies
    : [{ colony: world.colony, underground: world.underground }];

  colonyStatNodes.forEach((nodes, index) => {
    const item = colonies[index];
    if (!item) {
      nodes.workers.textContent = "-";
      nodes.scouts.textContent = "-";
      nodes.storage.textContent = "-";
      nodes.clay.textContent = "-";
      nodes.wood.textContent = "-";
      nodes.stone.textContent = "-";
      return;
    }

    nodes.workers.textContent = String(item.colony.population.workers);
    nodes.scouts.textContent = String(item.colony.population.scouts ?? 0);
    nodes.storage.textContent = String(Math.floor(item.colony.food ?? 0));
    nodes.clay.textContent = String(Math.floor(item.colony.clay ?? 0));
    nodes.wood.textContent = String(Math.floor(item.colony.wood ?? 0));
    nodes.stone.textContent = String(Math.floor(item.colony.stone ?? 0));
  });
}

function updatePerfHud(world: WorldSnapshot): void {
  fpsNode.textContent = String(currentFps);
  packetMsNode.textContent = String(Math.round(packetInterval));
  payloadKbNode.textContent = String(lastPayloadKb);
  renderMsNode.textContent = lastRenderCostMs.toFixed(1);
  antsCountNode.textContent = String(world.ants.length);
}

function draw(interpT: number): void {
  if (!latestWorld) {
    return;
  }
  if (!snapshotMatchesView(latestWorld)) {
    return;
  }

  if (currentView === "surface" && cameraMode === "follow") {
    centerOnNest(latestWorld);
  } else {
    clampCamera(latestWorld);
  }

  const ants = latestWorld.ants.map((ant) => {
    const ip = antInterp.get(ant.id);
    if (!ip) {
      return ant;
    }
    const x = ip.prevX + (ip.currX - ip.prevX) * interpT;
    const y = ip.prevY + (ip.currY - ip.prevY) * interpT;
    const angle = lerpAngle(ip.prevAngle, ip.currAngle, interpT);
    return { ...ant, pos: { x, y }, heading: { x: Math.cos(angle), y: Math.sin(angle) } };
  });

  const renderStart = performance.now();
  renderWorld(
    pixi.stage,
    pixi.renderer,
    { ...latestWorld, ants },
    currentView,
    pixi.screen.width,
    pixi.screen.height,
    camera,
    currentUndergroundColony,
    trampleEnabled
  );
  lastRenderCostMs = performance.now() - renderStart;
}

function setTool(tool: PlayerTool): void {
  currentTool = tool;
  for (const button of toolButtons) {
    button.classList.toggle("active", button.dataset.tool === tool);
  }
  if (toolHint) {
    toolHint.textContent = TOOL_HINTS[tool];
  }
}

for (const button of toolButtons) {
  button.addEventListener("click", () => {
    setTool((button.dataset.tool as PlayerTool) ?? "food");
  });
}

function pointerToTile(event: PointerEvent): { x: number; y: number } | null {
  if (!latestWorld) {
    return null;
  }
  const rect = pixi.canvas.getBoundingClientRect();
  const globalX = (event.clientX - rect.left) * (pixi.screen.width / Math.max(1, rect.width));
  const globalY = (event.clientY - rect.top) * (pixi.screen.height / Math.max(1, rect.height));
  return surfaceTileFromGlobal(latestWorld, globalX, globalY);
}

function sendCellsChunked(send: (cells: number[]) => void, cells: number[], chunkSize: number): void {
  for (let index = 0; index < cells.length; index += chunkSize) {
    send(cells.slice(index, index + chunkSize));
  }
}

// Стена тянется линией (как в Казаках): клетки стенной сетки вдоль отрезка.
function wallLineCells(a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  if (!latestWorld) {
    return [];
  }
  const gridWidth = Math.ceil(latestWorld.surface.width / WALL_CELL_SIZE);
  const gridHeight = Math.ceil(latestWorld.surface.height / WALL_CELL_SIZE);
  const cells = new Set<number>();
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (WALL_CELL_SIZE * 0.45)));
  for (let index = 0; index <= steps; index += 1) {
    const x = a.x + (dx * index) / steps;
    const y = a.y + (dy * index) / steps;
    const cx = Math.floor(x / WALL_CELL_SIZE);
    const cy = Math.floor(y / WALL_CELL_SIZE);
    if (cx >= 0 && cx < gridWidth && cy >= 0 && cy < gridHeight) {
      cells.add(cy * gridWidth + cx);
    }
  }
  return [...cells];
}

// Зоны и ластик выделяются прямоугольником.
function rectCells(a: { x: number; y: number }, b: { x: number; y: number }, cellSize: number): number[] {
  if (!latestWorld) {
    return [];
  }
  const gridWidth = Math.ceil(latestWorld.surface.width / cellSize);
  const gridHeight = Math.ceil(latestWorld.surface.height / cellSize);
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) / cellSize));
  const maxX = Math.min(gridWidth - 1, Math.floor(Math.max(a.x, b.x) / cellSize));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) / cellSize));
  const maxY = Math.min(gridHeight - 1, Math.floor(Math.max(a.y, b.y) / cellSize));
  const cells: number[] = [];
  for (let cy = minY; cy <= maxY; cy += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      cells.push(cy * gridWidth + cx);
    }
  }
  return cells;
}

function commitDrag(): void {
  if (!dragTool || !dragStart || !dragEnd || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (dragTool === "wall") {
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "paintWall", cells })), wallLineCells(dragStart, dragEnd), 500);
  } else if (dragTool === "harvest" || dragTool === "forbid") {
    const zone = dragTool;
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "paintZone", zone, cells })), rectCells(dragStart, dragEnd, ZONE_CELL_SIZE), 4000);
  } else if (dragTool === "erase") {
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "eraseZone", cells })), rectCells(dragStart, dragEnd, ZONE_CELL_SIZE), 4000);
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "eraseBuild", cells })), rectCells(dragStart, dragEnd, WALL_CELL_SIZE), 500);
  }
}

// Превью растягивания: рисуется в экранных координатах поверх мира.
const dragPreview = new Graphics();

function worldToScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: pixi.screen.width * 0.5 + (x - camera.x) * SURFACE_TILE_SIZE * camera.zoom,
    y: pixi.screen.height * 0.5 + (y - camera.y) * SURFACE_TILE_SIZE * camera.zoom
  };
}

function updateDragPreview(): void {
  dragPreview.clear();
  if (!isPainting || !dragTool || !dragStart || !dragEnd) {
    return;
  }
  if (dragPreview.parent !== pixi.stage || pixi.stage.children[pixi.stage.children.length - 1] !== dragPreview) {
    pixi.stage.addChild(dragPreview);
  }
  const a = worldToScreen(dragStart.x, dragStart.y);
  const b = worldToScreen(dragEnd.x, dragEnd.y);
  if (dragTool === "wall") {
    const thickness = Math.max(3, WALL_CELL_SIZE * SURFACE_TILE_SIZE * camera.zoom);
    dragPreview.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: thickness, color: 0xbc6240, alpha: 0.55 });
    dragPreview.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0x5b281c, alpha: 0.9 });
  } else {
    const color = dragTool === "harvest" ? 0x7ec850 : dragTool === "forbid" ? 0xd9534f : 0xf5f8ef;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    dragPreview.rect(x, y, width, height).fill({ color, alpha: 0.16 });
    dragPreview.rect(x, y, width, height).stroke({ width: 2, color, alpha: 0.8 });
  }
}

btnTrample.addEventListener("click", () => {
  trampleEnabled = !trampleEnabled;
  btnTrample.classList.toggle("active", trampleEnabled);
  btnTrample.textContent = `Тропинки: ${trampleEnabled ? "Вкл" : "Выкл"}`;
});

for (const button of cameraButtons) {
  button.addEventListener("click", () => {
    if (!latestWorld) {
      return;
    }

    if (button.dataset.camera === "nest") {
      setCameraMode("free");
      centerOnNest(latestWorld);
      return;
    }

    setCameraMode(button.dataset.camera === "free" ? "free" : "follow");
  });
}

pixi.ticker.add(() => {
  const now = performance.now();
  if (now - lastRenderAt < 1000 / 30 || !latestWorld) {
    return;
  }

  const interpT = lastPacketTime > 0 ? Math.min((now - lastPacketTime) / packetInterval, 1) : 1;
  draw(interpT);
  framesSinceFpsUpdate += 1;
  if (now - lastFpsUpdateAt >= 1000) {
    currentFps = Math.round((framesSinceFpsUpdate * 1000) / Math.max(1, now - lastFpsUpdateAt));
    framesSinceFpsUpdate = 0;
    lastFpsUpdateAt = now;
    updatePerfHud(latestWorld);
  }
  lastRenderAt = now;
});

const wsHost = window.location.hostname || "localhost";
const socket = new WebSocket(`ws://${wsHost}:8787`);

function requestNetworkView(): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    type: "setView",
    mode: currentView,
    undergroundColonyIndex: currentUndergroundColony
  }));
}

function snapshotMatchesView(world: NetworkWorldSnapshot): boolean {
  return (
    world.networkView.mode === currentView &&
    world.networkView.undergroundColonyIndex === currentUndergroundColony
  );
}

function setSpeed(speed: number): void {
  currentSpeed = speed;
  for (const button of speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "setSpeed", value: speed }));
  }
}

for (const button of speedButtons) {
  button.addEventListener("click", () => {
    setSpeed(Number(button.dataset.speed ?? 1));
  });
}

pixi.canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  isDragging = false;
  dragDistance = 0;
  lastPointer = { x: event.clientX, y: event.clientY };
  pixi.canvas.setPointerCapture(event.pointerId);

  if (currentTool === "harvest" || currentTool === "forbid" || currentTool === "wall" || currentTool === "erase") {
    const tile = pointerToTile(event);
    if (tile) {
      isPainting = true;
      dragTool = currentTool;
      dragStart = tile;
      dragEnd = tile;
      updateDragPreview();
    }
  }
});

pixi.canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown || currentView !== "surface" || !latestWorld) {
    return;
  }

  if (isPainting) {
    const tile = pointerToTile(event);
    if (tile) {
      dragEnd = tile;
    }
    updateDragPreview();
    return;
  }

  if (currentTool !== "food" && currentTool !== "hut" && currentTool !== "storage") {
    return;
  }

  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  dragDistance += Math.abs(dx) + Math.abs(dy);
  lastPointer = { x: event.clientX, y: event.clientY };

  if (dragDistance <= 4) {
    return;
  }

  isDragging = true;
  setCameraMode("free");
  camera.x -= dx / (SURFACE_TILE_SIZE * camera.zoom);
  camera.y -= dy / (SURFACE_TILE_SIZE * camera.zoom);
  clampCamera(latestWorld);
});

pixi.canvas.addEventListener("pointerup", (event) => {
  pointerDown = false;
  pixi.canvas.releasePointerCapture(event.pointerId);

  if (isPainting) {
    isPainting = false;
    commitDrag();
    dragTool = null;
    dragStart = null;
    dragEnd = null;
    updateDragPreview();
    return;
  }

  if (
    (currentTool !== "food" && currentTool !== "hut" && currentTool !== "storage") ||
    isDragging ||
    currentView !== "surface" ||
    !latestWorld ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const rect = pixi.canvas.getBoundingClientRect();
  const globalX = (event.clientX - rect.left) * (pixi.screen.width / Math.max(1, rect.width));
  const globalY = (event.clientY - rect.top) * (pixi.screen.height / Math.max(1, rect.height));
  const tile = surfaceTileFromGlobal(latestWorld, globalX, globalY);
  if (!tile) {
    return;
  }

  if (currentTool === "hut" || currentTool === "storage") {
    socket.send(JSON.stringify({ type: "placeBuilding", building: currentTool, x: tile.x, y: tile.y }));
    if (!event.shiftKey) {
      setTool("food"); // одиночная постройка: режим снимается, Shift — серия
    }
    return;
  }

  // Клик по жителю — выбор; клик по пустому месту — еда (и сброс выбора).
  let nearest: { id: string; distanceSq: number } | null = null;
  for (const ant of latestWorld.ants) {
    const dx = ant.pos.x - tile.x;
    const dy = ant.pos.y - tile.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < 2.5 * 2.5 && (!nearest || distanceSq < nearest.distanceSq)) {
      nearest = { id: ant.id, distanceSq };
    }
  }
  if (nearest) {
    selectedAnt = nearest.id;
    setSelectedAntId(nearest.id);
    if (latestWorld) {
      updateUnitPanel(latestWorld);
    }
    return;
  }
  if (selectedAnt) {
    selectedAnt = null;
    setSelectedAntId(null);
    updateUnitPanel(latestWorld);
    return;
  }
  socket.send(JSON.stringify({ type: "dropFood", x: tile.x, y: tile.y }));
});

pixi.canvas.addEventListener("wheel", (event) => {
  if (currentView !== "surface" || !latestWorld) {
    return;
  }

  event.preventDefault();
  setCameraMode("free");
  const rect = pixi.canvas.getBoundingClientRect();
  const globalX = (event.clientX - rect.left) * (pixi.screen.width / Math.max(1, rect.width));
  const globalY = (event.clientY - rect.top) * (pixi.screen.height / Math.max(1, rect.height));
  const tile = surfaceTileFromGlobal(latestWorld, globalX, globalY);
  const nextZoom = clamp(camera.zoom * (event.deltaY < 0 ? 1.12 : 0.88), MIN_ZOOM, MAX_ZOOM);

  if (tile) {
    camera.zoom = nextZoom;
    camera.x = tile.x - (globalX - pixi.screen.width * 0.5) / (SURFACE_TILE_SIZE * camera.zoom);
    camera.y = tile.y - (globalY - pixi.screen.height * 0.5) / (SURFACE_TILE_SIZE * camera.zoom);
  } else {
    camera.zoom = nextZoom;
  }
  clampCamera(latestWorld);
}, { passive: false });

minimapCanvas?.addEventListener("pointerdown", (event) => {
  if (!latestWorld) {
    return;
  }
  const target = minimapClickToWorld(minimapCanvas, latestWorld, event.clientX, event.clientY);
  setCameraMode("free");
  camera.x = target.x;
  camera.y = target.y;
  clampCamera(latestWorld);
});

socket.addEventListener("open", () => {
  statusNode.textContent = "Подключено";
  setSpeed(currentSpeed);
  requestNetworkView();
});

socket.addEventListener("close", () => {
  statusNode.textContent = "Соединение закрыто";
});

socket.addEventListener("error", () => {
  statusNode.textContent = "Ошибка WebSocket";
});

function unpackSparseGrid(sparse: any, size: number): Float32Array {
  const arr = new Float32Array(size);
  if (sparse && sparse.i && sparse.v) {
    const indices = sparse.i;
    const values = sparse.v;
    const len = indices.length;
    for (let k = 0; k < len; k += 1) {
      arr[indices[k]] = values[k];
    }
  }
  return arr;
}

socket.addEventListener("message", (event) => {
  const now = performance.now();
  if (lastPacketTime > 0) {
    const diff = now - lastPacketTime;
    if (diff > 5 && diff < 300) {
      packetInterval = packetInterval * 0.8 + diff * 0.2;
    }
  }
  lastPacketTime = now;

  const rawMessage = String(event.data);
  lastPayloadKb = Math.round(new Blob([rawMessage]).size / 1024);
  const snap = JSON.parse(rawMessage) as NetworkWorldSnapshot;
  const protocolVersion = snap.protocolVersion ?? 1;
  if (!warnedProtocolVersion && protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    console.warn(`Unsupported protocolVersion ${protocolVersion}; client expects ${CURRENT_PROTOCOL_VERSION}.`);
    warnedProtocolVersion = true;
  }

  const hasNewPheromones = snap.pheromones && snap.pheromones.food && snap.pheromones.food.i && snap.pheromones.food.i.length > 0;
  if (hasNewPheromones) {
    const size = snap.pheromones.width * snap.pheromones.height;
    snap.pheromones.food = unpackSparseGrid(snap.pheromones.food, size);
    snap.pheromones.home = unpackSparseGrid(snap.pheromones.home, size);
    lastPheromones = snap.pheromones;
  } else if (lastPheromones) {
    snap.pheromones = lastPheromones;
  } else if (snap.pheromones) {
    const size = snap.pheromones.width * snap.pheromones.height;
    snap.pheromones.food = new Float32Array(size);
    snap.pheromones.home = new Float32Array(size);
  }

  const seen = new Set<string>();
  for (const ant of snap.ants) {
    seen.add(ant.id);
    const angle = Math.atan2(ant.heading.y, ant.heading.x);
    const existing = antInterp.get(ant.id);
    if (existing && existing.layer === ant.layer) {
      existing.prevX = existing.currX;
      existing.prevY = existing.currY;
      existing.prevAngle = existing.currAngle;
      existing.currX = ant.pos.x;
      existing.currY = ant.pos.y;
      existing.currAngle = angle;
    } else {
      antInterp.set(ant.id, {
        prevX: ant.pos.x,
        prevY: ant.pos.y,
        prevAngle: angle,
        currX: ant.pos.x,
        currY: ant.pos.y,
        currAngle: angle,
        layer: ant.layer
      });
    }
  }
  for (const id of antInterp.keys()) {
    if (!seen.has(id)) {
      antInterp.delete(id);
    }
  }

  latestWorld = snap;
  updateHud(snap);
  updateTasks(snap);
  updateResourceBar(snap);
  updateUnitPanel(snap);
  if (minimapCanvas) {
    drawMinimap(minimapCanvas, snap, camera, pixi.screen.width, pixi.screen.height);
  }
  updatePerfHud(snap);
  if (camera.x === 50 && camera.y === 50) {
    centerOnNest(snap);
  }
});
