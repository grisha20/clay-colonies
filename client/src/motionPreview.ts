import { Application, Container, Sprite, Text, TilingSprite } from "pixi.js";
import type { Ant, Enemy, Fish, FishSpecies, WorldSnapshot } from "../../shared/types";
import { getEnvironmentTextures, preloadEnvironmentAssets } from "./render/surface/environment";
import { preloadGardenArt } from "./render/surface/gardenArt";
import { preloadCharacterArt } from "./render/surface/characterArt";
import { preloadCreatureArt } from "./render/surface/creatureArt";
import { preloadEquipmentArt } from "./render/surface/equipmentArt";
import { preloadFishArt } from "./render/surface/fishArt";
import { actorMotion } from "./render/surface/motion";
import { updateSurfaceResidents } from "./render/surface/residents";
import { updateSurfaceEnemies, updateSurfaceFish, updateSurfaceShadows, updateFishingEffects } from "./render/surface/entities";
import { residentPlacement, waterGunMount } from "./render/surface/residentLayout";
import { createSpritePool } from "./render/spritePool";
import { createSurfaceScene, updateSurfaceEntrances, updateFireGlow, updateBuildings } from "./render/surface/scene";
import { drawGameplay } from "./render/surface/gameplay";
import { preloadBuildingArt } from "./render/surface/buildingArt";
import { royalWalk } from "./render/surface/royals";
import { drawSurfaceGround } from "./render/surface/ground";
import { lakeLilyPads } from "../../shared/lakeHabitat";
import { updateLakeDetails } from "./render/surface/lakeArt";
import { updateFootprints, footprintCount } from "./render/surface/footprints";
import { BuildingGhost } from "./render/surface/buildingGhost";
import { FencePreview } from "./render/surface/fencePreview";
import { campShelterPoints } from "../../shared/campShelter";

const app = new Application();
await app.init({ width: 1024, height: 690, background: 0x555e3b, antialias: true });
await Promise.all([preloadEnvironmentAssets(), preloadCharacterArt(), preloadCreatureArt(), preloadEquipmentArt(), preloadFishArt(), preloadBuildingArt(), preloadGardenArt()]);
document.querySelector("#preview")!.append(app.canvas);
const campScene = createSurfaceScene();
const shadows = campScene.shadowLayer, actors = campScene.dynamicLayer, fishLayer = campScene.fishLayer;
const effects = campScene.fishingGraphics, selection = campScene.selectionGraphics, labels = new Container();
actors.sortableChildren = true;
app.stage.addChild(campScene.root, labels);
const people = createSpritePool(actors, () => new Sprite()), props = createSpritePool(actors, () => new Sprite());
const enemies = createSpritePool(actors, () => new Sprite()), loot = createSpritePool(actors, () => new Sprite());
const fishes = createSpritePool(fishLayer, () => new Sprite());
const cell = 8, bounds = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
let world: WorldSnapshot, elapsed = 0, lastStatusAt = 0, scale = 2, frameCount = 0, measuredFps = 0, lastFpsAt = performance.now();
let packetSeconds = 0, packetTicks = 0;
const homes = new Map<string, { x: number; y: number; walking: boolean }>();
const group = document.querySelector<HTMLSelectElement>("#group")!, direction = document.querySelector<HTMLSelectElement>("#direction")!;
const speed = document.querySelector<HTMLSelectElement>("#speed")!, pause = document.querySelector<HTMLButtonElement>("#pause")!;
const light = document.querySelector<HTMLSelectElement>("#light")!;
const campLike = () => group.value === "camp" || group.value === "drying";

function setLight() {
  if (!campLike()) return;
  world.tick = light.value === "night" || light.value === "off" ? 4800 : light.value === "morning" ? 600 : light.value === "evening" ? 3600 : 2100;
  for (const c of world.colonies) c.colony.fire = light.value === "off" ? 0 : 1;
}
light.onchange = setLight;

function home(id: string, index: number, walking: boolean, crowd = false) {
  const columns = crowd ? 25 : 4, x = crowd ? 22 + index % columns * 40 : 128 + index % columns * 256;
  const y = crowd ? 37 + Math.floor(index / columns) * 30 : 163 + Math.floor(index / columns) * 210;
  const pos = { x: x / cell / scale, y: y / cell / scale };
  homes.set(id, { ...pos, walking }); return pos;
}
function label(text: string, index: number) {
  const view = new Text({ text, style: { fontFamily: "system-ui", fontSize: 15, fill: group.value === "royals" ? 0x50412b : 0xf4e4bd } });
  view.anchor.set(0.5); view.position.set(128 + index % 4 * 256, (group.value === "creatures" ? 228 : 197) + Math.floor(index / 4) * 210); labels.addChild(view);
}
function ant(index: number, name: string, options: Partial<Ant> = {}, walking = false, crowd = false) {
  const id = `preview-${index}`, actor = { id, colonyId: "colony-1", layer: "surface", state: "idle", job: "forage", carrying: 0,
    forageRole: "forager", strength: 1, energy: 100, heading: { x: 1, y: 0 }, pos: home(id, index, walking, crowd), ...options } as Ant;
  world.ants.push(actor); if (!crowd) label(name, index); return actor;
}
function enemy(index: number, type: Enemy["type"], name: string, walking = true, options: Partial<Enemy> = {}) {
  const id = `creature-${index}`, actor = { id, type, hp: 100, maxHp: 100, carrying: 0, sprintLeft: 0, hunger: 0, hoard: 0, tiredLeft: 0,
    pos: home(id, index, walking), lair: { x: -1000, y: -1000 }, ...options } as Enemy;
  world.enemies.push(actor); label(name, index); return actor;
}
function loadGroup() {
  campScene.root.position.set(0, 0);
  campScene.lakeDetails.visible = group.value === "lake"; campScene.lakeRipples.clear();
  campScene.footGround.clear();
  for (const child of actors.children.filter(c => c.label === "preview_ghost")) child.destroy({ children: true });
  elapsed = 0; lastStatusAt = 0; actorMotion.reset(); homes.clear();
  packetSeconds = 0; packetTicks = 0;
  for (const child of campScene.staticLayer.removeChildren()) child.destroy({ children: true });
  for (const child of actors.children.filter(c => c.label === "static_prop")) child.destroy({ children: true });
  for (const child of labels.removeChildren()) child.destroy();
  const crowd = group.value.startsWith("crowd"); scale = crowd ? 1 : group.value === "royals" ? 3 : 2;
  campScene.root.scale.set(scale);
  light.disabled = !campLike();
  // Minimal, isolated rendering fixture; never connects to the game server.
  world = { tick: 0, ants: [], enemies: [], session: { status: "playing", speed: pause.textContent === "Пауза" ? Number(speed.value) : 0 },
    colonies: ["colony-1", "colony-2", "water"].map(id => ({ id, colony: { alarm: false, axes: 1, picks: 1, rods: 1, food: 80, clay: 20, wood: 20, stone: 20, fire: 1, waterWeapons: id === "water" } })),
    surface: { width: 480, height: 480, entrances: [], resourceNodes: [], buildings: [], fish: [], foodSources: [], carrion: [] }
  } as unknown as WorldSnapshot;
  if (crowd) {
    const count = group.value === "crowd500" ? 500 : 100;
    for (let i = 0; i < count; i++) ant(i, "", { colonyId: i % 2 ? "colony-1" : "colony-2", carrying: i % 3 ? 1 : 0, carryKind: ["wood", "clay", "stone"][i % 3] as Ant["carryKind"] }, true, true);
  } else if (group.value === "royals") {
    for (const [i, name] of ["Вперёд", "Вправо", "Назад", "Влево"].entries()) {
      const h = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }][i];
      for (const [j, role] of ["king", "queen"].entries()) {
        const actor = ant(i + j * 4, `${role === "king" ? "Король" : "Королева"} · ${name}`, { heading: h }, true);
        const root = homes.get(actor.id)!; homes.delete(actor.id); actor.id = `royal-${role}-preview-${i}`; homes.set(actor.id, root);
      }
    }
  } else if (group.value === "lake") {
    const padIndex = 2, pad = lakeLilyPads("north")[padIndex];
    campScene.root.position.set(360 - pad.x * cell * scale, 340 - pad.y * cell * scale);
    const water = new TilingSprite({ texture: getEnvironmentTextures().terrain.lakeShallowFrames[0], width: 480 * cell, height: 480 * cell });
    water.tint = 0xb3c7ad; campScene.staticLayer.addChild(water);
    const rest = enemy(0, "lakeMonster", "", false, { lakeId: "north", pos: { ...pad }, lakePadIndex: padIndex, lakeRestUntil: 1e9 }); homes.delete(rest.id);
    const swim = enemy(1, "lakeMonster", "", true, { lakeId: "north", pos: { x: pad.x + 15, y: pad.y + 11 } });
    homes.set(swim.id, { ...swim.pos, walking: true });
    for (const child of labels.removeChildren()) child.destroy();
  } else if (group.value === "fences" || group.value === "fence-stress" || group.value === "fence-build" || group.value === "placement") {
    const add = (type: "hut" | "wall" | "gate", x: number, y: number) => world.surface.buildings.push({ id: `fixture-${x}-${y}`, type, colonyId: "colony-1", pos: { x, y }, stage: "built", hp: 100, maxHp: 100, progress: 1, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 } });
    if (group.value === "fence-stress") {
      for (let y = 10; y <= 34; y += 2) add("wall", 7, y);
      for (let x = 17; x <= 57; x += 2) add(x === 37 ? "gate" : "wall", x, 10);
      for (let i = 0; i < 8; i++) { add("wall", 17 + i * 2, 18 + i * 2); add("wall", 39 + i * 2, 32 - i * 2); }
      for (const [x,y] of [[35,36],[37,36],[37,38],[39,38],[39,40],[41,40],[57,36]]) add("wall", x, y);
      add("gate", 49, 37);
      for (const [i, pos] of [{x:25,y:12},{x:37,y:12},{x:7,y:37}].entries()) { const a=ant(i, "", {pos}); homes.delete(a.id); }
    } else if (group.value === "fence-build") {
      for (let x = 9; x <= 55; x += 2) if (x < 29 || x > 33) add("wall",x,15);
      add("gate",31,15); Object.assign(world.surface.buildings.at(-1)!,{gateAxis:"horizontal",gateSpan:3});
      // Saved legacy gates should also form a single wide opening.
      for (let x=9;x<=33;x+=2) add(x>=19&&x<=23?"gate":"wall",x,39);
      const ghost = new FencePreview();
      const base = world.surface.buildings[0];
      const plans = Array.from({length:12},(_,i)=>({...base,id:`ghost-${i}`,pos:{x:9+i*2,y:26}}));
      plans.push({...base,id:"ghost-gate",type:"gate",pos:{x:47,y:29},gateAxis:"horizontal",gateSpan:3});
      ghost.show(plans); ghost.label="preview_ghost"; ghost.zIndex=9999; actors.addChild(ghost);
      for (const [i,pos] of [{x:31,y:17},{x:21,y:40}].entries()) { const a=ant(i,"",{pos}); homes.delete(a.id); }
    } else if (group.value === "fences") {
      for (let x = 17; x <= 47; x += 2) add(x === 33 ? "gate" : "wall", x, 23);
      for (let y = 25; y <= 37; y += 2) add("wall", 17, y);
      for (let i = 0; i < 4; i++) { const a = ant(i, "", { pos: { x: 25 + i * 5, y: i % 2 ? 26 : 22 } }); homes.delete(a.id); }
    } else {
      add("hut", 16, 28); add("hut", 48, 28);
      for (const [x, y] of [[32, 18], [48, 28]]) {
        const ghost = new BuildingGhost(); ghost.show(world, "hut", { x, y }, "colony-1");
        ghost.position.set(x * cell, y * cell); ghost.zIndex = y * cell + 90; ghost.label = "preview_ghost"; actors.addChild(ghost);
      }
    }
    for (const child of labels.removeChildren()) child.destroy();
  } else if (group.value === "steps") {
    for (let i = 0; i < 6; i++) { const a = ant(i, "", { pos: { x: 12 + i * 7, y: 17 + i % 2 * 9 } }, true); homes.set(a.id, { ...a.pos, walking: true }); }
    for (const child of labels.removeChildren()) child.destroy();
  } else if (group.value === "buildings") {
    for (const [i, type] of (["hut", "storage", "workshop", "idol"] as const).entries()) {
      const x = i % 2 ? 48 : 16, y = i < 2 ? 18 : 36;
      world.surface.buildings.push({ id: `art-${type}`, type, colonyId: "colony-1", pos: { x, y }, stage: "built", hp: 100, maxHp: 100, progress: 1, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 } });
      const view = new Text({ text: ["Хижина", "Склад", "Мастерская", "Идол"][i], style: { fontFamily: "system-ui", fontSize: 15, fill: 0xf4e4bd } }); view.anchor.set(0.5); view.position.set(x * cell * scale, y * cell * scale + 60); labels.addChild(view);
    }
  } else if (group.value === "combat") {
    const e = enemy(0, "spider", "", false, { pos: { x: 32, y: 22 }, maxHp: 1400, hp: 1000 }); homes.delete(e.id);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3, pos = { x: e.pos.x + Math.cos(angle) * 4, y: e.pos.y + Math.sin(angle) * 4 };
      const a = ant(i, "", { pos, state: "fight", job: i % 2 ? "forage" : "guard", heading: { x: -Math.cos(angle), y: -Math.sin(angle) } }); homes.delete(a.id);
    }
    for (const child of labels.removeChildren()) child.destroy();
  } else if (campLike()) {
    world.surface.entrances = [{ x: 16, y: 18.75 }, { x: 48, y: 18.75 }];
    for (let i = 0; i < 2; i++) {
      const camp = world.surface.entrances[i];
      ant(i * 3, "", { pos: { x: camp.x, y: camp.y - 3 }, carrying: 1, carryKind: "wood" });
      ant(i * 3 + 1, "", { pos: { x: camp.x, y: camp.y + 3 }, carrying: 1, carryKind: "stone" });
      ant(i * 3 + 2, "", { pos: { x: camp.x - 3.6, y: camp.y + 0.5 } });
      const pos = { x: camp.x, y: 35 };
      world.surface.buildings.push({ id: `preview-hut-${i}`, type: "hut", colonyId: `colony-${i + 1}`, pos, stage: "built", hp: 100, maxHp: 100, progress: 1, cost: { clay: 0, wood: 0, stone: 0 }, delivered: { clay: 0, wood: 0, stone: 0 } });
      ant(6 + i, "", { pos: { x: pos.x - 3, y: pos.y + 4 } });
    }
    for (const a of world.ants) homes.delete(a.id);
    for (const child of labels.removeChildren()) child.destroy();
    for (const [x, y, text] of [[256, 420, "Перед очагом и за ним"], [768, 420, "Обход очага и куч"], [256, 660, "Проход перед хижиной"], [768, 660, "Проход за хижиной"]] as const) {
      const view = new Text({ text, style: { fontFamily: "system-ui", fontSize: 15, fill: 0xf4e4bd } }); view.anchor.set(0.5); view.position.set(x, y); labels.addChild(view);
    }
    setLight();
    if (group.value === "drying") {
      world.weather = { state: "rain", until: world.tick + 900 };
      world.ants = [];
      for (const [i, camp] of world.surface.entrances.entries()) {
        const points = campShelterPoints(camp, world.surface.buildings, world.surface.width, world.surface.height, world.colonies[i].id).slice(2, 18);
        points.forEach((pos, j) => {
          const d = Math.hypot(pos.x - camp.x, pos.y - camp.y);
          ant(i * 20 + j, "", { colonyId: world.colonies[i].id, pos: { ...pos }, waterExposure: 30, heading: { x: (camp.x - pos.x) / d, y: (camp.y - pos.y) / d } });
        });
      }
      homes.clear(); for (const child of labels.removeChildren()) child.destroy();
    }
  } else if (group.value === "roles") {
    ant(0, "Покой"); ant(1, "Ходьба", {}, true);
    for (const [i, kind, name] of [[2, "tree", "Дровосек"], [3, "stone", "Шахтёр"], [11, "clay", "Глина руками"]] as const) {
      const a = ant(i, name, { job: "harvest", harvestNodeId: `node-${i}`, harvestHits: 1 });
      world.surface.resourceNodes.push({ id: `node-${i}`, pos: { ...a.pos }, kind, amount: 10 } as WorldSnapshot["surface"]["resourceNodes"][number]);
    }
    const builder = ant(4, "Строитель", { job: "build", buildTargetId: "site" });
    world.surface.buildings.push({ id: "site", pos: { ...builder.pos }, stage: "inProgress", hp: 1, maxHp: 10 } as WorldSnapshot["surface"]["buildings"][number]);
    ant(5, "Копейщик", { job: "guard" }, true); ant(6, "Водомёт", { job: "guard", colonyId: "water" });
    const fisher = ant(7, "Рыбак", { job: "fish", fishingTicks: 1 }); fisher.fishingLurePos = { x: fisher.pos.x + 4, y: fisher.pos.y + 2 };
    ant(8, "Разведчик", { forageRole: "scout" }, true); ant(9, "Племя B", { colonyId: "colony-2" }, true);
    ant(10, "Размокший", { dissolved: 0.45, waterExposure: 30 }, true);
  } else if (group.value === "cargo") {
    const resources = [["clay", "Глина"], ["wood", "Дерево"], ["stone", "Камень"], ["fruit", "Томат"], ["meat", "Мясо"]] as const;
    resources.forEach(([kind, name], i) => ant(i, name, { carrying: 1, carryKind: kind }, true));
    (["gold", "blue", "silver", "red"] as FishSpecies[]).forEach((species, i) => ant(5 + i, `Рыба: ${["золотая", "синяя", "серебряная", "красная"][i]}`, { carrying: 1, carryKind: "fish", caughtFishSpecies: species }, true));
    ant(9, "Груз в покое", { carrying: 1, carryKind: "wood" });
    ant(10, "Груз и растворение", { carrying: 1, carryKind: "stone", dissolved: 0.6 }, true);
  } else if (group.value === "creatures") {
    enemy(0, "spider", "Паук в покое", false); enemy(1, "spider", "Паук идёт"); enemy(2, "spider", "Бросок паука", true, { sprintLeft: 10 });
    enemy(3, "beetle", "Жук в покое", false); enemy(4, "beetle", "Жук идёт"); enemy(5, "lakeMonster", "Озёрный монстр");
    for (const [i, type, name] of [[6, "beetle", "Жук катит пленника"], [7, "lakeMonster", "Монстр тащит жителя"]] as const) {
      const e = enemy(i, type, name), id = `captive-${i}`; e.captiveId = id;
      world.ants.push({ id, colonyId: "colony-1", layer: "surface", state: "idle", job: "forage", carrying: 0, pos: { ...e.pos }, heading: { x: 1, y: 0 }, capturedBy: e.id } as Ant);
    }
    enemy(8, "spider", "Паук с добычей", true, { carrying: 1 }); enemy(9, "lakeMonster", "Раненый монстр", true, { hp: 15 });
  } else {
    (["gold", "blue", "silver", "red"] as FishSpecies[]).forEach((species, i) => {
      for (let state = 0; state < 2; state++) {
        const index = i + state * 4, id = `fish-${index}`;
        world.surface.fish.push({ id, species, state: state ? "lured" : "swimming", pos: home(id, index, false), heading: { x: 0, y: -1 }, lakeId: "north" } as Fish);
        label(`${["Золотая", "Синяя", "Серебряная", "Красная"][i]}${state ? " у приманки" : ""}`, index);
      }
    });
  }
}
function loadGround() {
  if (campLike() || ["buildings", "royals", "steps", "fences", "fence-stress", "fence-build", "placement"].includes(group.value) || group.value.startsWith("crowd")) {
    const terrain = { ...world, surface: { ...world.surface, entrances: world.surface.entrances.length ? world.surface.entrances : [{ x: 32, y: 24 }] } };
    drawSurfaceGround(campScene.staticLayer, actors, terrain, cell, { left: 0, right: 64, top: 0, bottom: 44 }, false);
  }
}
group.onchange = () => { loadGroup(); loadGround(); };
pause.onclick = () => { world.session.speed = world.session.speed ? 0 : Number(speed.value); pause.textContent = world.session.speed ? "Пауза" : "Продолжить"; };
speed.onchange = () => { if (world.session.speed) world.session.speed = Number(speed.value); };
loadGroup(); loadGround();
app.ticker.maxFPS = 60;
app.ticker.add(ticker => {
  const start = performance.now(), dt = Math.min(0.05, ticker.deltaMS / 1000), running = world.session.speed ?? 1;
  if (running) {
    elapsed += dt; packetSeconds += dt; packetTicks += dt * 10 * running;
    if (packetSeconds >= 0.1) { const ticks = Math.floor(packetTicks); world.tick += ticks; packetTicks -= ticks; packetSeconds %= 0.1; }
  }
  const directions = ["front", "right", "back", "left"], choice = direction.value === "auto" ? directions[Math.floor(elapsed / 3) % 4] : direction.value;
  const heading = choice === "front" ? { x: 0, y: 1 } : choice === "back" ? { x: 0, y: -1 } : choice === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const all = [...world.ants, ...world.enemies, ...world.surface.fish];
  if (group.value === "camp" && running) {
    for (let i = 0; i < 2; i++) {
      const camp = world.surface.entrances[i], walker = world.ants.find(a => a.id === `preview-${i * 3 + 2}`)!;
      const x = camp.x + Math.sin(elapsed * 0.9) * 3.6, y = camp.y + Math.cos(elapsed * 0.9) * 3;
      walker.heading = { x: (x - walker.pos.x) / Math.max(0.001, Math.hypot(x - walker.pos.x, y - walker.pos.y)), y: (y - walker.pos.y) / Math.max(0.001, Math.hypot(x - walker.pos.x, y - walker.pos.y)) }; walker.pos = { x, y };
      const passer = world.ants.find(a => a.id === `preview-${6 + i}`)!;
      passer.pos = { x: camp.x + Math.sin(elapsed * 0.75) * 5, y: 35 + (i === 0 ? 4 : -1) };
      passer.heading = { x: Math.cos(elapsed * 0.75), y: 0 };
    }
  }
  for (const actor of all) {
    if ("heading" in actor && running && group.value !== "combat" && !campLike() && group.value !== "royals") actor.heading = { ...heading };
    if ("waterExposure" in actor && group.value === "drying") actor.waterExposure = Math.max(0, 30 - elapsed % 8 * 6);
    const root = homes.get(actor.id);
    if (root?.walking && running) {
      const h = group.value === "royals" && "heading" in actor ? actor.heading : heading;
      const pace = group.value === "royals" ? 2.2 : 6;
      actor.pos.x += h.x * dt * pace * running; actor.pos.y += h.y * dt * pace * running;
    }
  }
  const guard = world.ants.find(a => a.colonyId === "water");
  if (group.value === "combat" && running) {
    for (const [i, a] of world.ants.entries()) if ((elapsed + i * 0.15) % 1 < dt) a.melee = { to: { ...world.enemies[0].pos }, until: world.tick + 6 };
    world.enemies[0].hp = 1400 - elapsed % 12 * 65;
  }
  if (guard && running && elapsed % 2 < dt) guard.shot = { from: { ...guard.pos }, to: { x: guard.pos.x + heading.x * 4, y: guard.pos.y + heading.y * 4 }, until: world.tick + 4 };
  const normalResidents = world.ants;
  if (campLike()) world.ants = [...normalResidents, ...royalWalk.update(world, start)];
  actorMotion.update(world, start);
  for (const a of world.ants) if (!a.capturedBy && !campLike() && group.value !== "combat" && group.value !== "royals") actorMotion.setFacing(a.id, heading, "resident");
  for (const e of world.enemies) actorMotion.setFacing(e.id, heading, "creature");
  const positions = all.map(a => ({ ...a.pos }));
  for (const actor of all) { const root = homes.get(actor.id); if (root && group.value !== "steps" && !group.value.startsWith("crowd")) actor.pos = { x: root.x, y: root.y }; }
  for (const a of world.ants) if (a.capturedBy) { const captor = world.enemies.find(e => e.id === a.capturedBy); if (captor) a.pos = { ...captor.pos }; }
  if (group.value === "lake") updateLakeDetails(campScene.lakeDetails, campScene.lakeRipples, world, cell, bounds);
  if (document.querySelector<HTMLInputElement>("#footprints")!.checked) updateFootprints(campScene.footGround, world, cell, bounds);
  else campScene.footGround.clear();
  updateSurfaceShadows(shadows, world.surface.resourceNodes.length ? { ...world, surface: { ...world.surface, resourceNodes: [] } } : world, cell, bounds);
  updateSurfaceEntrances(campScene, world, cell, JSON.stringify(world.surface.entrances));
  updateFireGlow(campScene.fireGlow, world, cell);
  updateBuildings(campScene, campLike() || ["buildings", "fences", "fence-stress", "fence-build", "placement"].includes(group.value) ? world : { ...world, surface: { ...world.surface, buildings: [] } }, cell);
  drawGameplay(campScene, world, cell);
  updateSurfaceFish(fishes, world, cell, bounds);
  updateSurfaceEnemies(enemies, loot, world, cell, bounds);
  updateSurfaceResidents(people, props, selection, world, cell, bounds);
  updateFishingEffects(effects, world, cell, bounds);
  if (guard?.shot && actorMotion.resident(guard).shotActive) {
    const gun = waterGunMount(residentPlacement(world, guard, cell), guard, cell);
    if (gun.target) effects.moveTo(gun.tip.x, gun.tip.y).lineTo(gun.target.x, gun.target.y).stroke({ color: 0x8de5f7, width: 2 });
  }
  all.forEach((a, i) => { a.pos = positions[i]; if (group.value === "steps" && a.pos.x > 59) a.pos.x = 5; });
  world.ants = normalResidents;
  frameCount++;
  if (start - lastFpsAt >= 1000) { measuredFps = Math.round(frameCount * 1000 / (start - lastFpsAt)); frameCount = 0; lastFpsAt = start; }
  if (start - lastStatusAt > 300) {
    document.querySelector("#status")!.textContent = `${world.ants.length} жителей · ${world.enemies.length} существ · ${world.surface.fish.length} рыб · ${footprintCount(campScene.footGround)} следов · ${measuredFps} FPS · подготовка кадра ${(performance.now() - start).toFixed(1)} мс`;
    lastStatusAt = start;
  }
});
