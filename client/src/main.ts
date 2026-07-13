import { Application, Graphics } from "pixi.js";
import {
  CURRENT_PROTOCOL_VERSION,
  WALL_CELL_SIZE,
  ZONE_CELL_SIZE,
  resourceNodeTool,
  resourceNodeYield,
  type Ant,
  type Fish,
  type NetworkWorldSnapshot,
  type WorldSnapshot
} from "../../shared/types";
import { isWaterAt } from "../../shared/surfaceTerrain";
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
    <section class="panel brandPanel">
      <img id="brand-icon" alt="">
      <strong>Clayfolk</strong>
    </section>
    <section class="panel quickPanel">
      <button id="btn-pause" class="quickBtn" type="button" title="Пауза">II</button>
      <button id="btn-speed" class="quickBtn" type="button" title="Скорость">1x</button>
      <button id="btn-settings" class="quickBtn" type="button" title="Настройки">⚙</button>
    </section>
    <div class="panel gameStateToggle" id="game-state-toggle">Состояние игры</div>
    <section class="panel settingsMenu" id="settings-menu" style="display: none;">
      <div class="settingsRow"><span>Скорость</span>
        <div class="segmented speedControls" aria-label="Скорость">
          <button data-speed="0" type="button">II</button>
          <button class="active" data-speed="1" type="button">1x</button>
          <button data-speed="5" type="button">5x</button>
          <button data-speed="20" type="button">20x</button>
          <button data-speed="50" type="button">Max</button>
        </div>
      </div>
      <div class="settingsRow"><span>Племя</span>
        <div class="segmented tribeControls" aria-label="Племя">
          <button class="active" data-tribe="0" type="button">Племя A</button>
          <button data-tribe="1" type="button">Племя B</button>
        </div>
      </div>
      <div class="settingsRow"><span>Камера</span>
        <div class="segmented cameraControls" aria-label="Камера">
          <button class="active" data-camera="follow" type="button">Слежение</button>
          <button data-camera="free" type="button">Свободно</button>
          <button data-camera="nest" type="button">К гнезду</button>
        </div>
      </div>
      <div class="settingsRow"><span>Панели</span>
        <div class="segmented panelControls" aria-label="Панели">
          <button data-panel="tasks" type="button">Задачи</button>
          <button data-panel="tribes" type="button">Племена</button>
          <button data-panel="build" type="button">Стройка</button>
          <button data-panel="minimap" type="button">Карта</button>
          <button data-panel="prio" type="button">Приоритеты</button>
        </div>
      </div>
      <div class="settingsRow"><span>Тропинки</span>
        <div class="segmented trampleControls" aria-label="Тропинки">
          <button class="active" id="btn-trample" type="button">Вкл</button>
        </div>
      </div>
    </section>
    <section class="panel toolDock" aria-label="Инструмент">
      <button class="active" data-tool="food" type="button">Еда</button>
      <button data-tool="harvest" type="button">Добыча</button>
      <button data-tool="forbid" type="button">Запрет</button>
      <button data-tool="erase" type="button">Ластик</button>
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
      <span class="res" title="Вся еда"><img id="icon-food" alt="еда"><strong id="res-food">0</strong><em id="rate-food"></em></span>
      <span class="res" title="Фрукты"><img id="icon-fruit" alt="фрукты"><strong id="res-fruit">0</strong></span>
      <span class="res" title="Рыба"><img id="icon-fish" alt="рыба"><strong id="res-fish">0</strong></span>
      <span class="res" title="Мясо"><img id="icon-meat" alt="мясо"><strong id="res-meat">0</strong></span>
      <span class="res"><img id="icon-clay" alt="глина"><strong id="res-clay">0</strong><em id="rate-clay"></em></span>
      <span class="res"><img id="icon-wood" alt="дерево"><strong id="res-wood">0</strong><em id="rate-wood"></em></span>
      <span class="res"><img id="icon-stone" alt="камень"><strong id="res-stone">0</strong><em id="rate-stone"></em></span>
      <span class="res"><img id="icon-pop" alt="жители"><strong id="res-pop">0/0</strong></span>
      <span class="res" title="Инструменты: топоры, кирки, удочки"><strong id="res-tools">Т0 К0 У0</strong></span>
      <span class="res" title="Костёр"><strong id="res-fire">100%</strong></span>
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
    <section class="panel buildBar" aria-label="Постройки">
      <button class="buildCard" data-tool="hut" type="button">
        <span class="bname">Хижина</span>
        <span class="bcost" id="cost-hut">8 глины + 5 дерева</span>
        <span class="bnote">+4 к лимиту жителей</span>
      </button>
      <button class="buildCard" data-tool="storage" type="button">
        <span class="bname">Склад</span>
        <span class="bcost" id="cost-storage">6 дерева + 4 камня</span>
        <span class="bnote">точка сдачи ресурсов</span>
      </button>
      <button class="buildCard" data-tool="workshop" type="button">
        <span class="bname">Мастерская</span>
        <span class="bcost" id="cost-workshop">8 глины + 4 дерева</span>
        <span class="bnote">топоры, кирки и удочки</span>
      </button>
      <button class="buildCard" data-tool="wall" type="button">
        <span class="bname">Стена</span>
        <span class="bcost" id="cost-wall">2 глины / сегмент</span>
        <span class="bnote">тяни линию мышью</span>
      </button>
      <button class="buildCard" data-tool="gate" type="button">
        <span class="bname">Ворота</span>
        <span class="bcost" id="cost-gate">2 глины + 1 дерево</span>
        <span class="bnote">проход только своим</span>
      </button>
      <button class="buildCard" data-tool="idol" type="button">
        <span class="bname">Идол</span>
        <span class="bcost" id="cost-idol">25 глины + 5 камня</span>
        <span class="bnote">хитрая победа</span>
      </button>
    </section>
    <aside class="panel prioPanel" id="prio-panel">
      <h2>Приоритеты</h2>
      <div class="prioStats" id="prio-stats">
        <div class="prioStat" title="Общее количество жителей колонии">
          <span class="prioStatVal" id="prio-pop">0</span>
          <span class="prioStatLabel">жителей</span>
        </div>
        <div class="prioStat" id="prio-free-container" title="Свободные жители, которых можно переназначить">
          <span class="prioStatVal" id="prio-free">0</span>
          <span class="prioStatLabel">свободно</span>
        </div>
        <div class="prioStat" title="Жители, собирающие еду">
          <span class="prioStatVal" id="prio-food">0</span>
          <span class="prioStatLabel">на еде</span>
        </div>
      </div>
      <div id="prio-rows"></div>
    </aside>
    <aside class="panel minimapPanel">
      <canvas id="minimap" width="168" height="168"></canvas>
    </aside>
    <footer class="panel status collapsed" id="status-panel">
      <span id="status">Подключение к ws://localhost:8787</span>
      <span id="tool-hint">Клик по карте - подкинуть еду</span>
      <span id="weather-label"></span>
      <div class="perfRow">
        <span class="perfStat">FPS <strong id="fps">0</strong></span>
        <span class="perfStat">Packet <strong id="packet-ms">0</strong> ms</span>
        <span class="perfStat">Payload <strong id="payload-kb">0</strong> KB</span>
      </div>
      <div class="perfRow">
        <span class="perfStat">Render <strong id="render-ms">0</strong> ms</span>
        <span class="perfStat">Ants <strong id="ants-count">0</strong></span>
      </div>
    </footer>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #2a2118;
    color: #3a2a18;
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
    border: 2px solid #8a6a44;
    border-radius: 10px;
    background: rgb(240 226 192 / 0.95);
    color: #3a2a18;
    backdrop-filter: blur(8px);
    box-shadow: 0 6px 18px rgb(30 18 8 / 0.35), inset 0 0 0 1px rgb(255 244 214 / 0.6);
  }

  .brandPanel {
    left: 14px;
    top: 14px;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 17px;
  }

  .brandPanel img {
    width: 26px;
    height: 26px;
    image-rendering: pixelated;
  }

  .quickPanel {
    right: 14px;
    top: 14px;
    padding: 6px;
    display: flex;
    gap: 6px;
  }

  .quickBtn {
    width: 42px;
    height: 42px;
    border: 1.5px solid #8a6a44;
    border-radius: 8px;
    background: rgb(255 244 214 / 0.7);
    color: #4a3520;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }

  .quickBtn.active {
    background: #b5793f;
    color: #fff6e0;
  }

  .settingsMenu {
    right: 14px;
    top: 72px;
    width: min(430px, calc(100vw - 28px));
    padding: 12px;
    display: grid;
    gap: 10px;
    z-index: 5;
  }

  .settingsRow {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .settingsRow > span {
    width: 72px;
    flex: none;
    color: #7a6647;
    font-size: 13px;
  }

  .settingsRow .segmented {
    flex: 1;
    min-width: 0;
    grid-auto-columns: minmax(0, 1fr);
  }

  .settingsRow .segmented button {
    padding: 0 6px;
    font-size: 12.5px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolDock {
    left: 14px;
    bottom: 14px;
    padding: 6px;
    display: flex;
    gap: 6px;
  }

  .toolDock button {
    border: 1.5px solid #8a6a44;
    border-radius: 8px;
    background: rgb(255 244 214 / 0.7);
    color: #4a3520;
    padding: 8px 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .toolDock button.active {
    background: #b5793f;
    color: #fff6e0;
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1.5px solid #8a6a44;
    border-radius: 8px;
    overflow: hidden;
    min-height: 36px;
  }

  .segmented button {
    border: 0;
    background: rgb(138 106 68 / 0.12);
    color: #4a3520;
    padding: 0 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .segmented button.active {
    background: #b5793f;
    color: #fff6e0;
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
    top: 72px;
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
    border-bottom: 1px solid rgb(138 106 68 / 0.3);
  }

  .colonyStats {
    min-width: 0;
  }

  .colonyStats h2 {
    margin: 0 0 4px;
    font-size: 14px;
    line-height: 1.2;
    letter-spacing: 0;
    color: #5a3d22;
  }

  .colonyB h2 {
    color: #a04430;
  }

  .hud span {
    color: #7a6647;
    font-size: 13px;
  }

  .hud strong {
    color: #3a2a18;
    font-size: 16px;
    letter-spacing: 0;
    text-align: right;
  }

  .resourceBar {
    left: 50%;
    transform: translateX(-50%);
    top: 14px;
    min-height: 46px;
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
    color: #3a2a18;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }

  .resourceBar em {
    font-style: normal;
    font-size: 12px;
    color: #4e8a2f;
    min-width: 30px;
  }

  .resourceBar em.negative {
    color: #b33f2e;
  }

  .tasksPanel {
    left: 14px;
    top: 72px;
    width: 240px;
    padding: 10px 12px;
  }

  .tasksPanel h2 {
    margin: 0 0 6px;
    font-size: 14px;
    color: #5a3d22;
  }

  .taskRow {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    border-bottom: 1px solid rgb(138 106 68 / 0.3);
    font-size: 13px;
    color: #4a3520;
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
    color: #8a9464;
    text-decoration: line-through;
  }

  .taskRow .progress {
    margin-left: auto;
    color: #3a2a18;
    font-variant-numeric: tabular-nums;
  }

  .taskSection {
    margin-top: 6px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #8a7a5c;
  }

  .taskRow.victory .dot {
    background: #b5793f;
  }

  .taskRow.victory.done .dot {
    background: #4e8a2f;
  }

  .victoryBanner {
    margin: 4px 0 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #4e8a2f;
    color: #fff6e0;
    font-weight: 600;
    font-size: 13px;
  }

  .newGameBtn {
    margin-top: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid #8a5429;
    border-radius: 6px;
    background: #f3e3c2;
    color: #4f2f16;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }

  .newGameBtn:hover {
    background: #ead1a1;
  }

  .unitPanel {
    left: 14px;
    bottom: 112px;
    width: 230px;
    padding: 10px 12px;
  }

  .unitPanel h2 {
    margin: 0 0 6px;
    font-size: 14px;
    color: #5a3d22;
  }

  .unitRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 24px;
    font-size: 13px;
    color: #7a6647;
  }

  .unitRow strong {
    color: #3a2a18;
  }

  .energyBar {
    flex: 1;
    height: 8px;
    max-width: 130px;
    background: rgb(90 61 34 / 0.2);
    border-radius: 4px;
    overflow: hidden;
  }

  .energyBar div {
    height: 100%;
    width: 0%;
    background: #7ec850;
    border-radius: 4px;
  }

  .buildBar {
    left: 50%;
    transform: translateX(-50%);
    bottom: 14px;
    padding: 8px;
    display: flex;
    gap: 8px;
  }

  .buildCard {
    border: 1.5px solid #8a6a44;
    border-radius: 8px;
    background: rgb(255 244 214 / 0.7);
    color: #3a2a18;
    padding: 6px 12px;
    cursor: pointer;
    display: grid;
    gap: 2px;
    text-align: left;
    min-width: 128px;
  }

  .buildCard .bname {
    font-weight: 600;
    font-size: 14px;
  }

  .buildCard .bcost {
    font-size: 11.5px;
    color: #7a5230;
  }

  .buildCard .bnote {
    font-size: 11px;
    color: #8a7a5c;
  }

  .buildCard.active {
    background: #b5793f;
    color: #fff6e0;
  }

  .buildCard.active .bcost,
  .buildCard.active .bnote {
    color: #ffe9c4;
  }

  .buildCard.poor {
    opacity: 0.45;
    filter: grayscale(0.6);
  }

  .prioPanel {
    right: 14px;
    bottom: 200px;
    width: 232px;
    padding: 12px;
  }

  .prioPanel h2 {
    margin: 0 0 10px;
    font-size: 14px;
    color: #5a3d22;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1.5px solid #8a6a44;
    padding-bottom: 4px;
  }

  .prioStats {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 12px;
  }

  .prioStat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgb(220 202 165 / 0.4);
    border: 1px solid #bda37e;
    border-radius: 6px;
    padding: 4px 2px;
    text-align: center;
  }

  .prioStatVal {
    font-size: 15px;
    font-weight: bold;
    color: #3a2a18;
    font-variant-numeric: tabular-nums;
  }

  .prioStatLabel {
    font-size: 9.5px;
    color: #7a6647;
    text-transform: uppercase;
    font-weight: 600;
  }

  .prioRow {
    display: grid;
    grid-template-columns: 56px 24px 14px 24px 1fr 32px;
    align-items: center;
    gap: 4px;
    height: 30px;
    font-size: 13px;
    color: #4a3520;
    border-bottom: 1px solid rgb(138 106 68 / 0.15);
  }

  .prioRow:last-child {
    border-bottom: none;
  }

  .prioRow .plabel {
    font-weight: 500;
  }

  .prioRow button {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid #8a6a44;
    border-radius: 6px;
    background: rgb(255 244 214 / 0.85);
    color: #4a3520;
    cursor: pointer;
    font-size: 15px;
    font-weight: bold;
    transition: background 0.15s, transform 0.05s;
    user-select: none;
  }

  .prioRow button:hover:not(:disabled) {
    background: #ffebb3;
    transform: scale(1.05);
  }

  .prioRow button:active:not(:disabled) {
    transform: scale(0.95);
  }

  .prioRow button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    background: rgb(200 190 170 / 0.4);
    border-color: #a09078;
  }

  .prioRow .pval {
    text-align: center;
    font-weight: 700;
    color: #3a2a18;
    font-variant-numeric: tabular-nums;
  }

  .prioRow .pcount {
    text-align: right;
    color: #8a7a5c;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .prioRow .pcount.short {
    color: #b33f2e;
    font-weight: bold;
    position: relative;
    cursor: help;
  }

  .prioRow .pcount.short::after {
    content: " ⚠️";
    font-size: 10px;
  }

  .prioRow .ptool {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-size: 12px;
    opacity: 0.85;
    white-space: nowrap;
    gap: 2px;
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
    right: 14px;
    top: 118px;
    max-width: min(440px, calc(100vw - 28px));
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: #5a4630;
    font-size: 13px;
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
    z-index: 4;
  }

  .status.collapsed {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px);
  }

  .status .perfRow {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .gameStateToggle {
    right: 14px;
    top: 82px;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: #7a6647;
    user-select: none;
    transition: all 0.15s ease-in-out;
    z-index: 4;
  }

  .gameStateToggle:hover {
    background: rgb(232 200 95 / 0.6);
    color: #3a2a18;
  }

  .gameStateToggle.active {
    background: #b5793f;
    color: #fff6e0;
    border-color: #8a6a44;
  }

  .perfStat strong {
    color: #3a2a18;
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
const statusPanel = document.querySelector<HTMLElement>("#status-panel");
const statusToggle = document.querySelector<HTMLElement>("#game-state-toggle");
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
const nestButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nest]"));
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));
const cameraButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"));
const btnTrample = document.querySelector<HTMLButtonElement>("#btn-trample");
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tool]"));
const panelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-panel]"));
const tribeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tribe]"));

// Каким племенем управляем (горячая смена для одного клиента; настоящий мультиплеер — Фаза 8).
let currentColonyIndex = 0;

for (const button of tribeButtons) {
  button.addEventListener("click", () => {
    currentColonyIndex = Number(button.dataset.tribe) === 1 ? 1 : 0;
    for (const item of tribeButtons) {
      item.classList.toggle("active", Number(item.dataset.tribe) === currentColonyIndex);
    }
    if (latestWorld) {
      updateResourceBar(latestWorld);
      updateBuildCards(latestWorld);
    }
  });
}

// Скрываемые панели: чтобы экран не был загромождён. Выбор запоминается в браузере.
const PANEL_TARGETS: Record<string, string> = {
  tasks: ".tasksPanel",
  tribes: ".hud",
  build: ".buildBar",
  minimap: ".minimapPanel",
  prio: ".prioPanel"
};
const panelVisibility: Record<string, boolean> = {
  tasks: true,
  tribes: false, // подробности племён по умолчанию скрыты: главное дублирует ресурс-бар
  build: true,
  minimap: true,
  prio: true
};
try {
  const saved = JSON.parse(window.localStorage.getItem("clayfolk.panels") ?? "{}") as Record<string, boolean>;
  for (const key of Object.keys(PANEL_TARGETS)) {
    if (typeof saved[key] === "boolean") {
      panelVisibility[key] = saved[key];
    }
  }
} catch {
  // localStorage недоступен — работаем с настройками по умолчанию
}

function applyPanelVisibility(): void {
  for (const [key, selector] of Object.entries(PANEL_TARGETS)) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) {
      node.style.display = panelVisibility[key] ? "" : "none";
    }
  }
  for (const button of panelButtons) {
    button.classList.toggle("active", !!panelVisibility[button.dataset.panel ?? ""]);
  }
}

for (const button of panelButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.panel ?? "";
    panelVisibility[key] = !panelVisibility[key];
    try {
      window.localStorage.setItem("clayfolk.panels", JSON.stringify(panelVisibility));
    } catch {
      // ок, просто не запомним
    }
    applyPanelVisibility();
  });
}

applyPanelVisibility();
const toolHint = document.querySelector<HTMLElement>("#tool-hint");
const tasksList = document.querySelector<HTMLElement>("#tasks-list");
const weatherLabel = document.querySelector<HTMLElement>("#weather-label");
const minimapCanvas = document.querySelector<HTMLCanvasElement>("#minimap");
const unitPanel = document.querySelector<HTMLElement>("#unit-panel");
const unitTitle = document.querySelector<HTMLElement>("#unit-title");
const unitJob = document.querySelector<HTMLElement>("#unit-job");
const unitEnergy = document.querySelector<HTMLElement>("#unit-energy");
const unitCargo = document.querySelector<HTMLElement>("#unit-cargo");
let selectedAnt: string | null = null;

const CARGO_NAMES: Record<string, string> = { food: "еда", fruit: "фрукты", fish: "рыба", meat: "мясо", clay: "глина", wood: "дерево", stone: "камень" };

// Панель приоритетов: веса 0..5 распределяют ограниченных жителей по занятиям.
// Еда — все остальные. Авторитет — сервер (colony.priorities из снапшота).
const PRIO_KEYS = ["clay", "wood", "stone", "build", "guard", "fish"] as const;
type PrioKey = (typeof PRIO_KEYS)[number];
const PRIO_LABELS: Record<PrioKey, string> = {
  clay: "Глина",
  wood: "Дерево",
  stone: "Камень",
  build: "Стройка",
  guard: "Стража",
  fish: "Рыбак"
};
const prioRows = document.querySelector<HTMLElement>("#prio-rows");
const prioPop = document.querySelector<HTMLElement>("#prio-pop");
const prioFree = document.querySelector<HTMLElement>("#prio-free");
const prioFood = document.querySelector<HTMLElement>("#prio-food");
const prioFreeContainer = document.querySelector<HTMLElement>("#prio-free-container");
let lastPrioKey = "";

function sendPriorities(priorities: Record<PrioKey, number>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "setPriorities", colony: currentColonyIndex, priorities }));
  }
}

function countJobs(world: WorldSnapshot): Record<PrioKey, number> & { food: number } {
  const counts = { clay: 0, wood: 0, stone: 0, build: 0, guard: 0, fish: 0, food: 0 };
  const colonyId = currentColonyIndex === 1 ? "colony-2" : "colony-1";
  for (const ant of world.ants) {
    if (ant.colonyId !== colonyId) {
      continue;
    }
    if (ant.job === "build") {
      counts.build += 1;
    } else if (ant.job === "guard") {
      counts.guard += 1;
    } else if (ant.job === "fish") {
      counts.fish += 1;
    } else if (ant.job === "harvest") {
      const kind =
        (ant.carryKind === "clay" || ant.carryKind === "wood" || ant.carryKind === "stone" ? ant.carryKind : undefined) ??
        (() => {
          const node = world.surface.resourceNodes?.find((item) => item.id === ant.harvestNodeId);
          return node ? resourceNodeYield(node.kind) : undefined;
        })();
      if (kind === "clay" || kind === "wood" || kind === "stone") {
        counts[kind] += 1;
      }
    } else {
      counts.food += 1;
    }
  }
  return counts;
}

function updatePriorityPanel(world: WorldSnapshot): void {
  if (!prioRows || !prioPop || !prioFree || !prioFood || !prioFreeContainer) {
    return;
  }
  const colonyId = currentColonyIndex === 1 ? "colony-2" : "colony-1";
  const colony = world.colonies?.[currentColonyIndex]?.colony ?? world.colony;
  const priorities = colony.priorities ?? { clay: 0, wood: 0, stone: 0, build: 0, guard: 0, fish: 0 };
  const counts = countJobs(world);

  // Раздача целей ограничена населением; но показываем ФАКТ: кто реально на еде.
  const population = world.ants.filter((ant) => ant.colonyId === colonyId).length;
  const scouts = world.ants.filter((ant) => ant.colonyId === colonyId && ant.forageRole === "scout").length;
  const assignedTotal = PRIO_KEYS.reduce((sum, k) => sum + (priorities[k] ?? 0), 0);
  const freeForPlus = Math.max(0, population - scouts - assignedTotal);

  // Есть ли на карте живой источник данного ресурса (для подсветки «нет источника»).
  const nodesAlive: Record<string, boolean> = { clay: false, wood: false, stone: false, fish: false };
  for (const node of world.surface.resourceNodes ?? []) {
    if (node.amount > 0) {
      nodesAlive[resourceNodeYield(node.kind)] = true;
    }
  }
  nodesAlive.fish = (world.surface.fish ?? []).some((fish) => fish.state !== "respawning");

  const key =
    currentColonyIndex + "|" + PRIO_KEYS.map((k) => `${priorities[k]}:${counts[k]}:${nodesAlive[k] ? 1 : 0}`).join("|") +
    `|${freeForPlus}|${counts.food}|${population}|${colony.axes ?? 0}|${colony.picks ?? 0}|${colony.rods ?? 0}`;
  if (key === lastPrioKey) {
    return;
  }
  lastPrioKey = key;

  prioRows.innerHTML = PRIO_KEYS.map((k) => {
    const target = priorities[k] ?? 0;
    // Цель есть, людей нет и источник иссяк — честно показываем причину.
    const short = (k === "clay" || k === "wood" || k === "stone" || k === "fish") && target > counts[k] && !nodesAlive[k];
    
    let toolHtml = "";
    if (k === "wood") {
      toolHtml = `<div class="ptool" title="Топоры в поселении: ${colony.axes ?? 0}">🪓${colony.axes ?? 0}</div>`;
    } else if (k === "stone") {
      toolHtml = `<div class="ptool" title="Кирки в поселении: ${colony.picks ?? 0}">⛏️${colony.picks ?? 0}</div>`;
    } else if (k === "fish") {
      toolHtml = `<div class="ptool" title="Удочки в поселении: ${colony.rods ?? 0}">🎣${colony.rods ?? 0}</div>`;
    } else {
      toolHtml = `<div class="ptool"></div>`;
    }

    return (
      `<div class="prioRow">` +
      `<span class="plabel">${PRIO_LABELS[k]}</span>` +
      `<button data-prio="${k}" data-delta="-1" type="button"${target <= 0 ? " disabled" : ""}>−</button>` +
      `<span class="pval">${target}</span>` +
      `<button data-prio="${k}" data-delta="1" type="button"${freeForPlus <= 0 ? " disabled" : ""}>+</button>` +
      `<span class="pcount${short ? " short" : ""}" ${short ? 'title="Источник иссяк — люди пока на еде"' : ""}>${counts[k]}</span>` +
      `${toolHtml}` +
      `</div>`
    );
  }).join("");

  // Обновляем статистику в шапке
  prioPop.textContent = String(population);
  prioFree.textContent = String(freeForPlus);
  prioFood.textContent = String(counts.food);

  // Подробный тултип для свободных жителей
  prioFreeContainer.title = `Свободно для назначения: ${freeForPlus}\n(Всего жителей: ${population}, разведчики: ${scouts}, назначено на задачи: ${assignedTotal})`;

  for (const button of prioRows.querySelectorAll<HTMLButtonElement>("[data-prio]")) {
    button.addEventListener("click", () => {
      const k = button.dataset.prio as PrioKey;
      const delta = Number(button.dataset.delta) || 0;
      if (delta > 0 && freeForPlus <= 0) {
        return; // нет свободных — сначала освободи кого-то минусом
      }
      const next = { ...priorities, [k]: Math.max(0, (priorities[k] ?? 0) + delta) };
      sendPriorities(next);
    });
  }
}

// Именные жители: имя и черта детерминированы id — партию запоминают по «Храброму Малому».
const FIRST_NAMES = ["Комок", "Малой", "Глинко", "Круглый", "Шмяк", "Лепень", "Тюха", "Крепыш", "Юркий", "Пузырь"];
const TRAITS = ["Храбрый", "Кривой", "Сонный", "Шустрый", "Упрямый", "Тихий", "Весёлый", "Ворчливый"];

function antName(id: string): string {
  const numeric = Number(id.replace("ant-", "")) || 0;
  const first = FIRST_NAMES[numeric % FIRST_NAMES.length];
  const trait = TRAITS[Math.floor(numeric / FIRST_NAMES.length) % TRAITS.length];
  return `${trait} ${first}`;
}

function antJobLabel(world: WorldSnapshot, ant: WorldSnapshot["ants"][number]): string {
  if (ant.state === "fight") {
    return "Дерётся!";
  }
  if (ant.job === "guard") {
    return "Охраняет лагерь";
  }
  if (ant.job === "fish") {
    if (ant.carrying > 0 && ant.carryKind === "fish") {
      return "Несёт улов на склад";
    }
    if ((ant.fishingTicks ?? 0) > 0) {
      return "Рыбачит у озера";
    }
    return "Идёт на рыбалку";
  }
  if (ant.job === "build") {
    return ant.carrying > 0 ? "Несёт материал на стройку" : "Строит";
  }
  if (ant.job === "harvest") {
    if (ant.carrying > 0 && ant.carryKind) {
      return `Несёт: ${CARGO_NAMES[ant.carryKind] ?? ant.carryKind}`;
    }
    const node = world.surface.resourceNodes?.find((item) => item.id === ant.harvestNodeId);
    return node ? `Добывает: ${CARGO_NAMES[resourceNodeYield(node.kind)] ?? node.kind}` : "Добывает ресурс";
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
  unitTitle.textContent = `${antName(ant.id)} (${ant.colonyId === "colony-2" ? "племя B" : "племя A"})`;
  unitJob.textContent = antJobLabel(world, ant);
  const energyFraction = Math.max(0, Math.min(1, ant.energy / 900));
  unitEnergy.style.width = `${Math.round(energyFraction * 100)}%`;
  unitEnergy.style.background = energyFraction > 0.4 ? "#7ec850" : energyFraction > 0.2 ? "#d8b74a" : "#d9534f";
  unitCargo.textContent =
    ant.carrying > 0
      ? `${CARGO_NAMES[ant.carryKind ?? "food"] ?? "еда"} (${ant.carrying.toFixed(1)})`
      : "-";
}

// Ресурс-бар племени A: иконки + значения + прирост за минуту.
const resourceBarNodes = {
  food: document.querySelector<HTMLElement>("#res-food"),
  fruit: document.querySelector<HTMLElement>("#res-fruit"),
  fish: document.querySelector<HTMLElement>("#res-fish"),
  meat: document.querySelector<HTMLElement>("#res-meat"),
  clay: document.querySelector<HTMLElement>("#res-clay"),
  wood: document.querySelector<HTMLElement>("#res-wood"),
  stone: document.querySelector<HTMLElement>("#res-stone"),
  pop: document.querySelector<HTMLElement>("#res-pop"),
  rateFood: document.querySelector<HTMLElement>("#rate-food"),
  rateClay: document.querySelector<HTMLElement>("#rate-clay"),
  rateWood: document.querySelector<HTMLElement>("#rate-wood"),
  rateStone: document.querySelector<HTMLElement>("#rate-stone"),
  tools: document.querySelector<HTMLElement>("#res-tools"),
  fire: document.querySelector<HTMLElement>("#res-fire")
};
for (const [id, name] of [
  ["icon-food", "food"],
  ["icon-fruit", "fruit"],
  ["icon-fish", "fish"],
  ["icon-meat", "meat"],
  ["icon-clay", "clay"],
  ["icon-wood", "wood"],
  ["icon-stone", "stone"],
  ["icon-pop", "pop"],
  ["brand-icon", "pop"]
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

// Цены построек (дублируют server/src/config.ts: hutCost/storageCost/wallCost).
const BUILD_COSTS: Record<string, { clay: number; wood: number; stone: number }> = {
  hut: { clay: 8, wood: 5, stone: 0 },
  storage: { clay: 0, wood: 6, stone: 4 },
  workshop: { clay: 8, wood: 4, stone: 0 },
  idol: { clay: 25, wood: 0, stone: 5 },
  wall: { clay: 2, wood: 0, stone: 0 },
  gate: { clay: 2, wood: 1, stone: 0 }
};

function updateBuildCards(world: WorldSnapshot): void {
  const colony = world.colonies?.[currentColonyIndex]?.colony ?? world.colony;
  for (const button of toolButtons) {
    const tool = button.dataset.tool ?? "";
    const cost = BUILD_COSTS[tool];
    if (!cost) {
      continue;
    }
    const poor =
      (colony.clay ?? 0) < cost.clay || (colony.wood ?? 0) < cost.wood || (colony.stone ?? 0) < cost.stone;
    button.classList.toggle("poor", poor);
  }
}

function updateResourceBar(world: WorldSnapshot): void {
  const colony = world.colonies?.[currentColonyIndex]?.colony ?? world.colony;
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
  if (resourceBarNodes.fruit) resourceBarNodes.fruit.textContent = String(Math.floor(colony.foodStock?.fruit ?? colony.food ?? 0));
  if (resourceBarNodes.fish) resourceBarNodes.fish.textContent = String(Math.floor(colony.foodStock?.fish ?? 0));
  if (resourceBarNodes.meat) resourceBarNodes.meat.textContent = String(Math.floor(colony.foodStock?.meat ?? 0));
  if (resourceBarNodes.clay) resourceBarNodes.clay.textContent = String(Math.floor(colony.clay ?? 0));
  if (resourceBarNodes.wood) resourceBarNodes.wood.textContent = String(Math.floor(colony.wood ?? 0));
  if (resourceBarNodes.stone) resourceBarNodes.stone.textContent = String(Math.floor(colony.stone ?? 0));
  if (resourceBarNodes.pop) {
    resourceBarNodes.pop.textContent = `${colony.population.workers}/${colony.nestCapacity ?? "-"}`;
  }
  if (resourceBarNodes.tools) {
    resourceBarNodes.tools.textContent = `Т${colony.axes ?? 0} К${colony.picks ?? 0} У${colony.rods ?? 0}`;
  }
  if (resourceBarNodes.fire) {
    const fire = Math.round(((colony.fire ?? 1) as number) * 100);
    resourceBarNodes.fire.textContent = `Огонь ${fire}%`;
    resourceBarNodes.fire.style.color = fire < 35 ? "#b33f2e" : fire < 70 ? "#b5793f" : "#4e8a2f";
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
type PlayerTool = "food" | "harvest" | "forbid" | "hut" | "storage" | "workshop" | "idol" | "wall" | "gate" | "erase";
let currentTool: PlayerTool = "food";
let isPainting = false;
let dragTool: "harvest" | "forbid" | "wall" | "gate" | "erase" | null = null;
let dragStart: { x: number; y: number } | null = null;
let dragEnd: { x: number; y: number } | null = null;

const TOOL_HINTS: Record<PlayerTool, string> = {
  food: "Клик по карте - подкинуть еду",
  harvest: "Растяни прямоугольник зоны добычи (ЛКМ)",
  forbid: "Растяни прямоугольник зоны запрета (ЛКМ)",
  hut: "Клик - хижина (8 глины + 5 дерева, +4 к лимиту). Shift - ставить несколько",
  storage: "Клик - склад (6 дерева + 4 камня, точка сдачи). Shift - ставить несколько",
  workshop: "Клик - мастерская (8 глины + 4 дерева, делает топоры и кирки). Shift - ставить несколько",
  idol: "Клик - Идол (25 глины + 5 камня). Достроишь - хитрая победа партии",
  wall: "Растяни линию стены (ЛКМ), 2 глины за сегмент",
  gate: "Растяни линию ворот (ЛКМ): 2 глины + 1 дерево за сегмент, проходят только свои",
  erase: "Растяни прямоугольник - сотрёт зоны, свои стены и ворота"
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
type FishInterp = Omit<AntInterp, "layer"> & { state: Fish["state"] };

let currentView: ViewMode = "surface";
let currentUndergroundColony = 0;
let cameraMode: CameraMode = "follow";
let currentSpeed = 1;
let camera: Camera = { x: 50, y: 50, zoom: DEFAULT_SURFACE_ZOOM };
let latestWorld: NetworkWorldSnapshot | null = null;
let interpolatedWorld: NetworkWorldSnapshot | null = null;
const interpolatedAnts: Ant[] = [];
const interpolatedAntById = new Map<string, Ant>();
const interpolatedFish: Fish[] = [];
const interpolatedFishById = new Map<string, Fish>();
let lastPanelUpdateAt = 0;
let lastMinimapUpdateAt = 0;
let lastRenderAt = 0;
let lastPacketTime = 0;
let lastPheromones: WorldSnapshot["pheromones"] | null = null;
const pheromoneBuffers: Array<{ food: Float32Array; home: Float32Array }> = [];
let pheromoneBufferIndex = 0;
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
const fishInterp = new Map<string, FishInterp>();

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

function taskRowHtml(o: WorldSnapshot["objectives"][number]): string {
  return (
    `<div class="taskRow${o.done ? " done" : ""}${o.victory ? " victory" : ""}"><span class="dot"></span>` +
    `<span>${o.text}</span><span class="progress">${Math.floor(o.progress)}/${o.target}</span></div>`
  );
}

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

  const victories = objectives.filter((o) => o.victory);
  const tutorial = objectives.filter((o) => !o.victory);
  const won = victories.some((o) => o.done);
  tasksList.innerHTML =
    (won ? `<div class="victoryBanner">ПОБЕДА! Партия сыграна — начни новую!</div>` : "") +
    `<div class="taskSection">Пути победы (достаточно одного)</div>` +
    victories.map(taskRowHtml).join("") +
    `<div class="taskSection">Обучение</div>` +
    tutorial.map(taskRowHtml).join("") +
    `<button class="newGameBtn" id="new-game-btn" type="button">Новая партия</button>`;

  const newGameButton = tasksList.querySelector<HTMLButtonElement>("#new-game-btn");
  if (newGameButton) {
    newGameButton.addEventListener("click", () => {
      if (
        confirm("Начать новую партию? Мир будет создан заново (обучение и геномы сохранятся).") &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.send(JSON.stringify({ type: "newGame" }));
      }
    });
  }
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
  if (!latestWorld || !interpolatedWorld) {
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

  for (const ant of interpolatedAnts) {
    const ip = antInterp.get(ant.id);
    if (!ip) {
      continue;
    }
    ant.pos.x = ip.prevX + (ip.currX - ip.prevX) * interpT;
    ant.pos.y = ip.prevY + (ip.currY - ip.prevY) * interpT;
    const angle = lerpAngle(ip.prevAngle, ip.currAngle, interpT);
    ant.heading.x = Math.cos(angle);
    ant.heading.y = Math.sin(angle);
  }
  for (const fish of interpolatedFish) {
    const ip = fishInterp.get(fish.id);
    if (!ip) {
      continue;
    }
    fish.pos.x = ip.prevX + (ip.currX - ip.prevX) * interpT;
    fish.pos.y = ip.prevY + (ip.currY - ip.prevY) * interpT;
    const angle = lerpAngle(ip.prevAngle, ip.currAngle, interpT);
    fish.heading.x = Math.cos(angle);
    fish.heading.y = Math.sin(angle);
  }

  const renderStart = performance.now();
  renderWorld(
    pixi.stage,
    pixi.renderer,
    interpolatedWorld,
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

function resourceNodeLabel(world: WorldSnapshot, x: number, y: number): string | null {
  const colony = world.colonies?.[currentColonyIndex]?.colony ?? world.colony;
  let nearest: WorldSnapshot["surface"]["resourceNodes"][number] | null = null;
  let bestDistanceSq = 3.2 * 3.2;
  for (const node of world.surface.resourceNodes ?? []) {
    if (node.amount <= 0) {
      continue;
    }
    const dx = node.pos.x - x;
    const dy = node.pos.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      nearest = node;
    }
  }
  if (!nearest) {
    return null;
  }
  const yieldKind = resourceNodeYield(nearest.kind);
  const names: Record<string, string> = {
    clay: "Глина",
    tree: nearest.growth === "sapling" ? "Росток" : nearest.growth === "young" ? "Молодое дерево" : "Дерево",
    stone: "Скала",
    "loose-stone": "Камешки",
    stick: "Ветки"
  };
  const tool = resourceNodeTool(nearest.kind);
  const toolText =
    tool === "axe"
      ? ` Нужен топор (есть ${colony.axes ?? 0})`
      : tool === "pick"
        ? ` Нужна кирка (есть ${colony.picks ?? 0})`
        : "";
  const stageText = nearest.kind === "tree" && nearest.growth === "sapling" ? " Ещё растёт." : "";
  return `${names[nearest.kind] ?? CARGO_NAMES[yieldKind]}: ${Math.ceil(nearest.amount)} ед.${toolText}.${stageText}`;
}

function updateHoverHint(event: PointerEvent): void {
  if (!toolHint || currentView !== "surface" || !latestWorld) {
    return;
  }
  const tile = pointerToTile(event);
  const label = tile ? resourceNodeLabel(latestWorld, tile.x, tile.y) : null;
  toolHint.textContent = label ?? TOOL_HINTS[currentTool];
}

let lastRawTile: { x: number; y: number } | null = null;

function snapToAngles(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absY < 0.414 * absX) {
    return { x: b.x, y: a.y };
  } else if (absX < 0.414 * absY) {
    return { x: a.x, y: b.y };
  } else {
    const dist = Math.max(absX, absY);
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    return { x: a.x + dist * signX, y: a.y + dist * signY };
  }
}

function updateDragEnd(shiftPressed: boolean): void {
  if (!dragStart || !lastRawTile) {
    return;
  }
  if (shiftPressed && (dragTool === "wall" || dragTool === "gate")) {
    dragEnd = snapToAngles(dragStart, lastRawTile);
  } else {
    dragEnd = lastRawTile;
  }
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
  const colony = currentColonyIndex;
  if (dragTool === "wall" || dragTool === "gate") {
    const commandType = dragTool === "gate" ? "paintGate" : "paintWall";
    const gridWidth = Math.ceil(latestWorld!.surface.width / WALL_CELL_SIZE);
    const dryCells = wallLineCells(dragStart, dragEnd).filter((index) => {
      const x = (index % gridWidth) * WALL_CELL_SIZE + WALL_CELL_SIZE * 0.5;
      const y = Math.floor(index / gridWidth) * WALL_CELL_SIZE + WALL_CELL_SIZE * 0.5;
      return !isWaterAt(x, y);
    });
    if (dryCells.length === 0 && toolHint) {
      toolHint.textContent = "Вода: здесь нельзя строить";
    }
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: commandType, cells, colony })), dryCells, 500);
  } else if (dragTool === "harvest" || dragTool === "forbid") {
    const zone = dragTool;
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "paintZone", zone, cells, colony })), rectCells(dragStart, dragEnd, ZONE_CELL_SIZE), 4000);
  } else if (dragTool === "erase") {
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "eraseZone", cells, colony })), rectCells(dragStart, dragEnd, ZONE_CELL_SIZE), 4000);
    sendCellsChunked((cells) => socket.send(JSON.stringify({ type: "eraseBuild", cells, colony })), rectCells(dragStart, dragEnd, WALL_CELL_SIZE), 500);
  }
}

// Превью растягивания: рисуется в экранных координатах поверх мира.
const dragPreview = new Graphics();

// Дождь: затемнение + косые штрихи в экранных координатах.
const rainOverlay = new Graphics();

function updateRainOverlay(): void {
  rainOverlay.clear();
  const state = latestWorld?.weather?.state ?? "clear";
  if (state === "clear") {
    return;
  }
  if (rainOverlay.parent !== pixi.stage) {
    pixi.stage.addChild(rainOverlay);
  }
  const width = pixi.screen.width;
  const height = pixi.screen.height;
  if (state === "warning") {
    rainOverlay.rect(0, 0, width, height).fill({ color: 0x2b3a4a, alpha: 0.08 });
    return;
  }
  rainOverlay.rect(0, 0, width, height).fill({ color: 0x24384a, alpha: 0.16 });
  const t = performance.now() * 0.4;
  const drops = 70;
  for (let index = 0; index < drops; index += 1) {
    const seed = index * 97.13;
    const x = ((seed * 13.7 + t * (1.5 + (index % 3) * 0.4)) % (width + 200)) - 100;
    const y = ((seed * 7.3 + t * (6 + (index % 5))) % (height + 80)) - 40;
    rainOverlay
      .moveTo(x, y)
      .lineTo(x - 5, y + 14)
      .stroke({ width: 1.2, color: 0xbfd8e8, alpha: 0.35 });
  }
}

function updateWeatherLabel(): void {
  if (!weatherLabel) {
    return;
  }
  const state = latestWorld?.weather?.state ?? "clear";
  if (state === "warning") {
    weatherLabel.textContent = "Собирается дождь...";
    weatherLabel.style.color = "#b5793f";
  } else if (state === "rain") {
    weatherLabel.textContent = "ДОЖДЬ! Стены плывут, жители мокнут";
    weatherLabel.style.color = "#b33f2e";
  } else {
    weatherLabel.textContent = "";
  }
}

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
  if (dragTool === "wall" || dragTool === "gate") {
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
  btnTrample.textContent = trampleEnabled ? "Вкл" : "Выкл";
});

if (statusPanel && statusToggle) {
  statusToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isCollapsed = statusPanel.classList.toggle("collapsed");
    statusToggle.classList.toggle("active", !isCollapsed);
  });
}

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
  updateRainOverlay();
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
(window as any).socket = socket;

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

const btnPause = document.querySelector<HTMLButtonElement>("#btn-pause");
const btnSpeedCycle = document.querySelector<HTMLButtonElement>("#btn-speed");
const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings");
const settingsMenu = document.querySelector<HTMLElement>("#settings-menu");
let lastRunSpeed = 1;
const SPEED_LABELS: Record<number, string> = { 1: "1x", 5: "5x", 20: "20x", 50: "Max" };

function updateQuickButtons(): void {
  btnPause?.classList.toggle("active", currentSpeed === 0);
  if (btnSpeedCycle) {
    btnSpeedCycle.textContent = SPEED_LABELS[currentSpeed === 0 ? lastRunSpeed : currentSpeed] ?? "1x";
  }
}

function setSpeed(speed: number): void {
  currentSpeed = speed;
  if (speed > 0) {
    lastRunSpeed = speed;
  }
  for (const button of speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  }
  updateQuickButtons();

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "setSpeed", value: speed }));
  }
}

btnPause?.addEventListener("click", () => {
  setSpeed(currentSpeed === 0 ? lastRunSpeed : 0);
});

btnSpeedCycle?.addEventListener("click", () => {
  const order = [1, 5, 20, 50];
  const base = currentSpeed === 0 ? lastRunSpeed : currentSpeed;
  const next = order[(order.indexOf(base) + 1) % order.length];
  setSpeed(next);
});

btnSettings?.addEventListener("click", () => {
  if (settingsMenu) {
    const hidden = settingsMenu.style.display === "none";
    settingsMenu.style.display = hidden ? "grid" : "none";
    btnSettings.classList.toggle("active", hidden);
  }
});

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

  if (currentTool === "harvest" || currentTool === "forbid" || currentTool === "wall" || currentTool === "gate" || currentTool === "erase") {
    const tile = pointerToTile(event);
    if (tile) {
      isPainting = true;
      dragTool = currentTool;
      dragStart = tile;
      lastRawTile = tile;
      updateDragEnd(event.shiftKey);
      updateDragPreview();
    }
  }
});

pixi.canvas.addEventListener("pointermove", (event) => {
  updateHoverHint(event);
  if (!pointerDown || currentView !== "surface" || !latestWorld) {
    return;
  }

  if (isPainting) {
    const tile = pointerToTile(event);
    if (tile) {
      lastRawTile = tile;
      updateDragEnd(event.shiftKey);
    }
    updateDragPreview();
    return;
  }

  if (currentTool !== "food" && currentTool !== "hut" && currentTool !== "storage" && currentTool !== "workshop" && currentTool !== "idol") {
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
    lastRawTile = null;
    updateDragPreview();
    return;
  }

  if (
    (currentTool !== "food" && currentTool !== "hut" && currentTool !== "storage" && currentTool !== "workshop" && currentTool !== "idol") ||
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

  if (currentTool === "hut" || currentTool === "storage" || currentTool === "workshop" || currentTool === "idol") {
    if (isWaterAt(tile.x, tile.y)) {
      if (toolHint) {
        toolHint.textContent = "Вода: здесь нельзя строить";
      }
      return;
    }
    socket.send(JSON.stringify({ type: "placeBuilding", building: currentTool, x: tile.x, y: tile.y, colony: currentColonyIndex }));
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

function unpackSparseGrid(sparse: any, arr: Float32Array): Float32Array {
  arr.fill(0);
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
  // Network snapshots are JSON and overwhelmingly ASCII; string length gives
  // an accurate HUD estimate without allocating a Blob for every packet.
  lastPayloadKb = Math.round(rawMessage.length / 1024);
  const snap = JSON.parse(rawMessage) as NetworkWorldSnapshot;
  const protocolVersion = snap.protocolVersion ?? 1;
  if (!warnedProtocolVersion && protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    console.warn(`Unsupported protocolVersion ${protocolVersion}; client expects ${CURRENT_PROTOCOL_VERSION}.`);
    warnedProtocolVersion = true;
  }

  const hasNewPheromones = snap.pheromones && snap.pheromones.food && snap.pheromones.food.i && snap.pheromones.food.i.length > 0;
  if (hasNewPheromones) {
    const size = snap.pheromones.width * snap.pheromones.height;
    pheromoneBufferIndex = (pheromoneBufferIndex + 1) % 2;
    let buffers = pheromoneBuffers[pheromoneBufferIndex];
    if (!buffers || buffers.food.length !== size) {
      buffers = { food: new Float32Array(size), home: new Float32Array(size) };
      pheromoneBuffers[pheromoneBufferIndex] = buffers;
    }
    snap.pheromones.food = unpackSparseGrid(snap.pheromones.food, buffers.food);
    snap.pheromones.home = unpackSparseGrid(snap.pheromones.home, buffers.home);
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

  interpolatedAnts.length = 0;
  for (const ant of snap.ants) {
    let renderAnt = interpolatedAntById.get(ant.id);
    if (!renderAnt) {
      renderAnt = { ...ant, pos: { ...ant.pos }, heading: { ...ant.heading } };
      interpolatedAntById.set(ant.id, renderAnt);
    } else {
      const pos = renderAnt.pos;
      const heading = renderAnt.heading;
      Object.assign(renderAnt, ant);
      renderAnt.pos = pos;
      renderAnt.heading = heading;
    }
    interpolatedAnts.push(renderAnt);
  }
  for (const id of interpolatedAntById.keys()) {
    if (!seen.has(id)) {
      interpolatedAntById.delete(id);
    }
  }
  const seenFish = new Set<string>();
  interpolatedFish.length = 0;
  for (const fish of snap.surface.fish ?? []) {
    seenFish.add(fish.id);
    const angle = Math.atan2(fish.heading.y, fish.heading.x);
    const existing = fishInterp.get(fish.id);
    const teleported = existing && Math.hypot(fish.pos.x - existing.currX, fish.pos.y - existing.currY) > 8;
    if (existing && existing.state === fish.state && !teleported) {
      existing.prevX = existing.currX;
      existing.prevY = existing.currY;
      existing.prevAngle = existing.currAngle;
      existing.currX = fish.pos.x;
      existing.currY = fish.pos.y;
      existing.currAngle = angle;
    } else {
      fishInterp.set(fish.id, {
        prevX: fish.pos.x,
        prevY: fish.pos.y,
        prevAngle: angle,
        currX: fish.pos.x,
        currY: fish.pos.y,
        currAngle: angle,
        state: fish.state
      });
    }

    let renderFish = interpolatedFishById.get(fish.id);
    if (!renderFish) {
      renderFish = { ...fish, pos: { ...fish.pos }, heading: { ...fish.heading } };
      interpolatedFishById.set(fish.id, renderFish);
    } else {
      const pos = renderFish.pos;
      const heading = renderFish.heading;
      Object.assign(renderFish, fish);
      renderFish.pos = pos;
      renderFish.heading = heading;
    }
    interpolatedFish.push(renderFish);
  }
  for (const id of fishInterp.keys()) {
    if (!seenFish.has(id)) {
      fishInterp.delete(id);
      interpolatedFishById.delete(id);
    }
  }

  latestWorld = snap;
  interpolatedWorld = {
    ...snap,
    surface: { ...snap.surface, fish: interpolatedFish },
    ants: interpolatedAnts
  };
  if (now - lastPanelUpdateAt >= 250) {
    updateHud(snap);
    updateTasks(snap);
    updateResourceBar(snap);
    updateBuildCards(snap);
    updateUnitPanel(snap);
    updatePriorityPanel(snap);
    updateWeatherLabel();
    lastPanelUpdateAt = now;
  }
  if (minimapCanvas && now - lastMinimapUpdateAt >= 200) {
    drawMinimap(minimapCanvas, snap, camera, pixi.screen.width, pixi.screen.height);
    lastMinimapUpdateAt = now;
  }
  updatePerfHud(snap);
  if (camera.x === 50 && camera.y === 50) {
    centerOnNest(snap);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Shift" && isPainting && (dragTool === "wall" || dragTool === "gate")) {
    updateDragEnd(true);
    updateDragPreview();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Shift" && isPainting && (dragTool === "wall" || dragTool === "gate")) {
    updateDragEnd(false);
    updateDragPreview();
  }
});
