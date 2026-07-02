// Поведенческая проверка вертикального среза Clayfolk (Фазы 2-4).
// Запуск: npm run check:slice
// Прогоняет мир headless и проверяет: добычу глины/дерева, зону добычи,
// зону запрета, постройку хижины, лимит населения и стены.
export {}; // файл — модуль, чтобы работал top-level await

// Тестовые файлы: не трогаем настоящие genome.json / spider_genome.json / snapshot.json.
process.env.SNAPSHOT_FILE = "./.slice-snapshot.json";
process.env.GENOME_FILE = "./.slice-genome-a.json";
process.env.GENOME_FILE_B = "./.slice-genome-b.json";
process.env.SPIDER_GENOME_FILE = "./.slice-genome-spider.json";

// Динамические импорты: env выставлен ДО чтения config.ts.
const { loadGenome } = await import("../ai/genome");
const { loadSpiderGenome } = await import("../ai/spiderGenome");
const { createWorld, toSnapshot, worldFromSnapshot } = await import("../sim/world");
const { step } = await import("../sim/step");
const { paintColonyZone, zoneIndexAt } = await import("../sim/zones");
const { placeHut, paintWallCells, wallCellIndexAt, completeBuilding } = await import("../sim/building");

let failures = 0;

function check(name: string, ok: boolean, details = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` (${details})` : ""}`);
  if (!ok) {
    failures += 1;
  }
}

const genome = await loadGenome();
const genomeB = await loadGenome(process.env.GENOME_FILE_B);
const spiderGenome = await loadSpiderGenome();
const world = createWorld(genome, spiderGenome, genomeB);
const colonyA = world.colonies[0];
const entrance = colonyA.surfaceEntrance;

// --- Фаза 2: экономика глины и дерева ---
for (let i = 0; i < 6000; i += 1) {
  step(world);
}
check("Фаза 2: глина добывается", colonyA.colony.clay > 10, `clay=${colonyA.colony.clay.toFixed(1)}`);
check("Фаза 2: дерево добывается", colonyA.colony.wood > 5, `wood=${colonyA.colony.wood.toFixed(1)}`);
check("Фаза 2: еда не пострадала", colonyA.colony.food > 100, `food=${colonyA.colony.food.toFixed(0)}`);

// --- Фаза 3: зона добычи переключает цель ---
const far = [...colonyA.colony.knownFood].sort((a, b) => {
  const da = (a.pos.x - entrance.x) ** 2 + (a.pos.y - entrance.y) ** 2;
  const db = (b.pos.x - entrance.x) ** 2 + (b.pos.y - entrance.y) ** 2;
  return db - da;
})[0];
if (far) {
  const cells: number[] = [];
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      cells.push(zoneIndexAt(far.pos.x + dx * 4, far.pos.y + dy * 4));
    }
  }
  paintColonyZone(world, 0, "harvest", cells);
  for (let i = 0; i < 30; i += 1) {
    step(world);
  }
  check("Фаза 3: зона добычи переключает цель", colonyA.colony.activeFoodTargetId === far.id);
} else {
  check("Фаза 3: зона добычи переключает цель", false, "нет известной еды — нужно проверить фуражировку");
}

// --- Фаза 4: хижина строится и поднимает лимит ---
const hutPlaced = placeHut(world, 0, entrance.x + 15, entrance.y + 10);
check("Фаза 4: хижина ставится", hutPlaced);
const hut = world.surface.buildings.find((building) => building.type === "hut");
for (let i = 0; i < 9000 && hut && hut.stage !== "built"; i += 1) {
  step(world);
}
check("Фаза 4: хижина построена жителями", hut?.stage === "built", `stage=${hut?.stage}`);
check("Фаза 4: лимит вырос", colonyA.colony.nestCapacity > 15, `cap=${colonyA.colony.nestCapacity}`);

// --- Фаза 4: стены блокируют ---
const wallY = entrance.y + 20;
const wallCells: number[] = [];
for (let x = entrance.x - 30; x <= entrance.x + 30; x += 2) {
  wallCells.push(wallCellIndexAt(x, wallY));
}
paintWallCells(world, 0, wallCells);
for (const building of world.surface.buildings) {
  if (building.type === "wall") {
    building.delivered.clay = building.cost.clay;
    completeBuilding(world, building);
  }
}
let crossings = 0;
const wasAbove = new Map<string, boolean>();
for (const ant of world.ants) {
  wasAbove.set(ant.id, ant.pos.y < wallY - 1);
}
for (let i = 0; i < 1500; i += 1) {
  step(world);
  for (const ant of colonyA.ants) {
    const above = ant.pos.y < wallY - 1;
    const prev = wasAbove.get(ant.id);
    if (prev !== undefined && prev !== above) {
      if (ant.pos.x > entrance.x - 30 && ant.pos.x < entrance.x + 30) {
        crossings += 1;
      }
    }
    wasAbove.set(ant.id, above);
  }
}
check("Фаза 4: стена почти непроходима", crossings <= 3, `пересечений=${crossings}`);

// --- Снапшот: мир переживает сохранение/загрузку ---
const snapshot = JSON.parse(JSON.stringify(toSnapshot(world, false)));
const reloaded = worldFromSnapshot(snapshot, genome, spiderGenome, genomeB);
check(
  "Снапшот: постройки и запасы переживают загрузку",
  reloaded.surface.buildings.length === world.surface.buildings.length &&
    Math.abs(reloaded.colonies[0].colony.clay - colonyA.colony.clay) < 0.01
);
for (let i = 0; i < 300; i += 1) {
  step(reloaded);
}
check("Снапшот: мир живёт после загрузки", reloaded.ants.length > 0);

console.log(failures === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\nПРОВАЛОВ: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
