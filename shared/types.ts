export type Layer = "surface" | "underground";
export type DetailLevel = "full" | "aggregate";
export type NetworkViewMode = "surface" | "underground";

// v13: rectilinear lake masks replace the earlier freeform contours. Old saves may
// contain actors/resources inside the corrected water area, so reset them cleanly.
export const CURRENT_SNAPSHOT_VERSION = 13;
export const CURRENT_PROTOCOL_VERSION = 13;

export type Vec2 = {
  x: number;
  y: number;
};

export type AntState =
  | "idle"
  | "toEntrance"
  | "search"
  | "carry"
  | "return"
  | "deposit"
  | "carryBrood"
  | "feed"
  | "dig"
  | "carryDirt"
  | "fight"
  | "dead";

export type UndergroundTileType = "soil" | "tunnel" | "chamber" | "entrance";

export type UndergroundTile = {
  type: UndergroundTileType;
  roomId?: string;
  digProgress?: number;
};

export type UndergroundRoomType = "queen" | "storage" | "egg" | "nursery" | "barracks" | "waiting";

export type UndergroundRoom = {
  id: string;
  type: UndergroundRoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
  used: number;
};

export type DigTaskType = "digTunnel" | "digRoom" | "expandRoom";

export type DigTask = {
  id: string;
  type: DigTaskType;
  roomType?: UndergroundRoomType;
  roomId?: string;
  roomPlan?: { x: number; y: number; width: number; height: number };
  targetTiles: Vec2[];
  completedTiles: number;
  status: "planned" | "active" | "done";
};

export type Brood = {
  id: string;
  stage: "egg" | "larva";
  location: "queen" | "egg" | "nursery";
  pos: Vec2;
  carriedBy?: string;
  progress: number;
  isPrincess: boolean;
};

// Зоны игрока: крупные клетки 4x4 мировых единицы (сетка 120x120 для карты 480x480).
export const ZONE_CELL_SIZE = 4;
export type ZoneType = "harvest" | "forbid";

// Постройки Clayfolk. Стены сидят в клетках 2x2 мировых единицы (сетка 240x240).
export const WALL_CELL_SIZE = 2;
export type BuildingType = "hut" | "wall" | "gate" | "storage" | "idol" | "workshop";
export type BuildingStage = "site" | "inProgress" | "built";

export type Building = {
  id: string;
  colonyId: string;
  type: BuildingType;
  stage: BuildingStage;
  pos: Vec2;
  cost: { clay: number; wood: number; stone: number };
  delivered: { clay: number; wood: number; stone: number };
  progress: number;
  hp: number;
  maxHp: number;
};

// Ресурсы склада племени (что лежит в запасах и что несут жители).
export type ResourceKind = "clay" | "wood" | "stone";

// Узлы на карте: «что видишь — то можно добыть».
// tree/stick дают дерево, stone/loose-stone дают камень, clay даёт глину.
// tree и stone требуют инструмент (топор/кирку), остальное собирается руками.
export type ResourceNodeKind = "clay" | "tree" | "stone" | "loose-stone" | "stick";

// Стадии роста дерева: росток нельзя рубить, молодое и взрослое — можно.
export type TreeGrowthStage = "sapling" | "young" | "mature";

export type ResourceNode = {
  id: string;
  kind: ResourceNodeKind;
  pos: Vec2;
  amount: number;
  // Полный запас узла: клиент показывает деградацию (дерево редеет, скала мельчает).
  maxAmount: number;
  // Сколько «ударов» нужно на одну единицу ресурса (руками = 1).
  hitsPerUnit: number;
  growth?: TreeGrowthStage;
  // Тик последнего шага роста/сева (только деревья).
  grownAt?: number;
};

// Какой ресурс склада даёт узел данного вида.
export function resourceNodeYield(kind: ResourceNodeKind): ResourceKind {
  if (kind === "tree" || kind === "stick") {
    return "wood";
  }
  if (kind === "stone" || kind === "loose-stone") {
    return "stone";
  }
  return "clay";
}

// Узлы, требующие инструмент: дерево — топор, скала — кирка.
export function resourceNodeTool(kind: ResourceNodeKind): "axe" | "pick" | null {
  if (kind === "tree") {
    return "axe";
  }
  if (kind === "stone") {
    return "pick";
  }
  return null;
}

export type Ant = {
  id: string;
  colonyId: string;
  role: "worker";
  strength: number;
  job?: "forage" | "nurse" | "dig" | "carryDirt" | "idle" | "harvest" | "build" | "guard";
  carryKind?: "food" | ResourceKind;
  harvestNodeId?: string;
  // Прогресс многоударной добычи у текущего узла (в тиках «долбления»).
  harvestHits?: number;
  buildTargetId?: string;
  forageRole?: "scout" | "forager";
  preferredTask?: "dig";
  layer: Layer;
  state: AntState;
  pos: Vec2;
  energy: number;
  carrying: number;
  heading: Vec2;
  broodId?: string;
  carryingDirt?: boolean;
  dirtLoad?: number;
  digTaskId?: string;
  digTarget?: Vec2;
  digStandPos?: Vec2;
  digProgress?: number;
  foundFoodSourceId?: string;
  scoutTrail?: Vec2[];
  foundFoodTrail?: Vec2[];
  knownActiveFoodTargetId?: string;
  surfaceExitCooldown?: number;
  undergroundExitCooldown?: number;
};

export type Queen = {
  pos: Vec2;
  alive: boolean;
  layCooldown: number;
  starve: number;
  stress: number;
  hp: number;
  age: number;
};

export type Princess = {
  id: string;
  pos: Vec2;
};

export type Underground = {
  width: number;
  height: number;
  gridVersion: number;
  roomsVersion: number;
  digTasksVersion: number;
  grid: UndergroundTile[][];
  rooms: UndergroundRoom[];
  digTasks: DigTask[];
  dirtMound: number;
  queen: Queen;
  brood: Brood[];
  carrion: FoodSource[];
  foodStorage: number;
  entrance: Vec2;
  junction: Vec2;
  queenChamber: Vec2;
  nursery: Vec2;
  storage: Vec2;
  barracksA: Vec2;
  barracksB: Vec2;
  princesses: Princess[];
  ants: string[];
};

export type Colony = {
  id: string;
  foundedTick: number;
  knownFood: { id: string; pos: Vec2; lastSeenTick: number; trail?: Vec2[] }[];
  activeFoodTargetId?: string;
  food: number;
  clay: number;
  wood: number;
  stone: number;
  // Уровень костра 0..1: костёр ест дрова, при слабом огне жители медленнее.
  fire: number;
  // Общий запас инструментов племени: лимитируют число дровосеков и каменотёсов.
  axes: number;
  picks: number;
  // Приоритеты работ: ЦЕЛЕВОЕ ЧИСЛО ЛЮДЕЙ на занятии (не веса).
  // «+» берёт человека из свободных, «−» возвращает. Свободные — на еде.
  priorities: {
    clay: number;
    wood: number;
    stone: number;
    build: number;
    guard: number;
  };
  zones?: {
    version: number;
    harvest: number[];
    forbid: number[];
  };
  population: {
    workers: number;
    scouts: number;
    nurses: number;
    eggs: number;
    larvae: number;
  };
  queenAlive: boolean;
  queenStress: number;
  queenAge: number;
  reproductionCooldown: number;
  princesses: number;
  nestCapacity: number;
  detailLevel: DetailLevel;
  generation: number;
  generationsRun: number;
  bestFitness: number;
  spiderGeneration: number;
  spiderGenerationsRun: number;
};

export type FoodSource = {
  id: string;
  pos: Vec2;
  amount: number;
  kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass";
  createdAt?: number;
};

export type Enemy = {
  id: string;
  type: "spider";
  pos: Vec2;
  hp: number;
  maxHp: number;
  hunger: number;
  lair: Vec2;
  carrying: number;
  hoard: number;
  sprintLeft: number;
  tiredLeft: number;
};

export type Surface = {
  width: number;
  height: number;
  entrance: Vec2;
  entrances: Vec2[];
  foodSources: FoodSource[];
  carrion: FoodSource[];
  resourceNodes: ResourceNode[];
  buildings: Building[];
};

export type SparseGrid = {
  i: number[];
  v: number[];
};

export type PheromoneSnapshot = {
  width: number;
  height: number;
  food: any;
  home: any;
};

// Задачи партии (панель Tasks): прогресс считает сервер, done защёлкивается.
export type Objective = {
  id: string;
  text: string;
  target: number;
  progress: number;
  done: boolean;
  // Победная цель (один из путей завершить партию) или обучающая.
  victory?: boolean;
};

// Погода: ясно -> предупреждение -> дождь -> ясно. Дождь размывает стены,
// мочит жителей вне укрытий и притушает костры.
export type WeatherState = "clear" | "warning" | "rain";

export type Weather = {
  state: WeatherState;
  until: number;
  // Большой дождь — заранее объявленное испытание партии.
  bigRainAt?: number;
  bigRainActive?: boolean;
  bigRainDone?: boolean;
  bigRainSurvived?: boolean;
};

export type WorldSnapshot = {
  snapshotVersion: number;
  protocolVersion: number;
  tick: number;
  surface: Surface;
  underground: Underground;
  colony: Colony;
  colonies: Array<{
    id: string;
    color: "dark" | "red";
    underground: Underground;
    colony: Colony;
    ants: Ant[];
  }>;
  ants: Ant[];
  enemies: Enemy[];
  pheromones: PheromoneSnapshot;
  objectives: Objective[];
  weather: Weather;
};

export type DurableWorldSnapshot = WorldSnapshot;
export type NetworkViewState = {
  mode: NetworkViewMode;
  undergroundColonyIndex: number;
};

export type NetworkWorldSnapshot = WorldSnapshot & {
  networkView: NetworkViewState;
};
