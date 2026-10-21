import assert from "node:assert/strict";
import { Container, Texture } from "pixi.js";
import { CURRENT_SNAPSHOT_VERSION, type Building, type Vec2 } from "../../../shared/types";
import { fenceLayout } from "../../../client/src/render/surface/fenceLayout";
import { drawFences } from "../../../client/src/render/surface/fenceRender";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }
function wall(x: number, y: number, type: "wall" | "gate" = "wall", owner = "a", stage: Building["stage"] = "built"): Building {
  return { id: `${owner}-${x}-${y}`, type, pos: { x, y }, colonyId: owner, stage, hp: 100, maxHp: 100, progress: 1, delivered: { clay: 0, wood: 0, stone: 0 }, cost: { clay: 0, wood: 0, stone: 0 } };
}
const k = (p: Vec2) => `${p.x},${p.y}`;
check("Прямая и вертикаль: одинаковая высота опор, единая линия основания и непрерывные стыки", () => {
  for (const vertical of [false, true]) {
    const layout = fenceLayout(Array.from({ length: 8 }, (_, i) => wall(vertical ? 5 : 1 + i * 2, vertical ? 1 + i * 2 : 5)));
    assert.equal(layout.posts.length, 10); assert.equal(layout.spans.length, 9);
    assert.ok(layout.posts.every(p => p.height === 20 && (vertical ? p.pos.x : p.pos.y) === 5));
    const coordinate = layout.posts.map(p => vertical ? p.pos.y : p.pos.x).sort((a, b) => a - b);
    for (let i = 1; i < coordinate.length; i++) assert.ok(coordinate[i] - coordinate[i - 1] <= 2);
  }
});
check("Обе диагонали: все перекладины следуют одной диагонали без чередования ракурсов", () => {
  for (const sign of [-1, 1]) {
    const layout = fenceLayout(Array.from({ length: 8 }, (_, i) => wall(1 + i * 2, 21 + sign * i * 2)));
    assert.equal(layout.spans.length, 9);
    for (const span of layout.spans) assert.equal(span.to.y - span.from.y, sign * (span.to.x - span.from.x));
  }
});
check("Углы, лестница и развилка: нет срезающих угол диагоналей и дублированных опор", () => {
  for (const coords of [[[1,1],[3,1],[3,3]], [[1,1],[1,3],[3,3],[3,5],[5,5]], [[3,3],[1,3],[5,3],[3,1],[3,5]]]) {
    const layout = fenceLayout(coords.map(([x,y]) => wall(x,y)));
    for (const s of layout.spans) assert.ok(s.from.x === s.to.x || s.from.y === s.to.y);
    assert.equal(new Set(layout.posts.map(p => k(p.pos))).size, layout.posts.length);
    const edges = layout.spans.map(s => [k(s.from),k(s.to)].sort().join("|"));
    assert.equal(new Set(edges).size, edges.length);
  }
});
check("Ворота: середина прохода без столба, глины и нижних перекладин; есть верхняя балка", () => {
  const layout = fenceLayout([wall(1,5),wall(3,5,"gate"),wall(5,5)]);
  assert.ok(!layout.posts.some(p => p.pos.x === 3 && p.pos.y === 5));
  assert.ok(layout.spans.filter(s => s.gate).length === 1);
  for (const s of layout.spans.filter(s => !s.gate)) assert.ok(Math.max(s.from.x,s.to.x) <= 2 || Math.min(s.from.x,s.to.x) >= 4);
});
check("Одиночные секции и соседние ворота: две крайние опоры, стыки без дубликатов", () => {
  const solo = fenceLayout([wall(5,5)]); assert.equal(solo.posts.length,3); assert.equal(solo.spans.length,2);
  const gates = fenceLayout([wall(1,5,"gate"),wall(3,5,"gate")]);
  assert.equal(gates.posts.length,2); assert.ok(gates.spans.every(s => s.gate));
});
check("Чужие племена и незавершённые стройки не образуют общую ограду", () => {
  const layout = fenceLayout([wall(1,1),wall(3,1,"wall","b"),wall(1,3,"wall","a","site")]);
  assert.equal(layout.posts.length,6);
  for (const s of layout.spans) assert.ok(s.from.y === 1 && s.to.y === 1 && Math.abs(s.to.x-s.from.x) === 1);
});
check("Рендер: каждый столб стоит на своей земле, не наклоняется и не получает высоту целой секции", () => {
  const actors = new Container(), ground = new Container();
  const parts = { post: Texture.WHITE, rail: Texture.WHITE, clay: Texture.WHITE };
  const drawn = drawFences(actors,ground,[wall(5,5),wall(5,7),wall(5,9)],8,parts);
  const posts = drawn.sprites.filter(s => s.label === "fence_post"); assert.equal(posts.length,5);
  for (const p of posts) { assert.equal(p.rotation,0); assert.equal(p.height,20); assert.equal(p.x,40); assert.ok(Number.isInteger(p.y)); }
  assert.equal(drawn.contacts.parent,ground);
  actors.destroy({children:true}); ground.destroy({children:true});
});
check("Широкие ворота: одна арка с двумя крайними опорами в обоих направлениях", () => {
  for (const axis of ["horizontal", "vertical"] as const) {
    const b = { ...wall(9,9,"gate"), gateAxis: axis, gateSpan: 3 };
    const layout = fenceLayout([b]); assert.equal(layout.posts.length,2); assert.equal(layout.spans.length,1);
    assert.ok(layout.spans.every(s => s.gate));
    assert.equal(Math.hypot(layout.posts[0].pos.x-layout.posts[1].pos.x,layout.posts[0].pos.y-layout.posts[1].pos.y),6);
    assert.ok(layout.posts.every(p => p.height === 41));
  }
  const legacy = fenceLayout([wall(5,9,"gate"),wall(7,9,"gate"),wall(9,9,"gate")]);
  assert.equal(legacy.posts.length,2); assert.equal(legacy.spans.length,1);
  const adjacent = fenceLayout([{...wall(9,9,"gate"),id:"wide-h",gateAxis:"horizontal",gateSpan:3},{...wall(13,11,"gate"),id:"wide-v",gateAxis:"vertical",gateSpan:3}]);
  assert.equal(adjacent.spans.filter(s=>s.gate).length,2);
  assert.ok(adjacent.spans.filter(s=>s.gate).every(s=>s.from.x===s.to.x||s.from.y===s.to.y));
});

// Worlds and genomes for this check are isolated from the running game.
const { mkdtemp, rm } = await import("node:fs/promises");
const os = await import("node:os"), path = await import("node:path");
const temp = await mkdtemp(path.join(os.tmpdir(),"clayfolk-fence-"));
for (const key of ["SNAPSHOT_FILE","GENOME_FILE","GENOME_FILE_B","SPIDER_GENOME_FILE"]) process.env[key] = path.join(temp,key+".json");
const { createWorld, toSnapshot, worldFromSnapshot } = await import("../sim/world");
const { randomGenome } = await import("../ai/genome");
const { randomSpiderGenome } = await import("../ai/spiderGenome");
const { placeGate, completeBuilding, isWallBlockedAt, eraseBuildCells, wallCellIndexAt, paintWallCells, rebuildWallBlocked } = await import("../sim/building");
const { gatePlacement, fenceCellCenters } = await import("../../../shared/fenceGeometry");
const { surfacePointOpen } = await import("../../../shared/surfaceNavigation");
const { isWaterAt } = await import("../../../shared/surfaceTerrain");
const { parseCommand } = await import("../net/socket");
function fresh() {
  const g = { current: randomGenome(), best:null, bestFitness:0, archive:[], generationsRun:0 };
  const w = createWorld(g,{current:randomSpiderGenome(),best:null,bestFitness:0,archive:[],generationsRun:0},structuredClone(g)); w.colonies.forEach(c => { c.colony.autoManage = false; });
  w.surface.buildings=[]; w.surface.entrances=[]; rebuildWallBlocked(w); return w;
}
try {
  check("Установка ворот одной постройкой, поворот, цена и коллизии всех трёх клеток", () => {
    for (const axis of ["horizontal","vertical"] as const) {
      const w = fresh(), owner=w.colonies[0].id; assert.equal(placeGate(w,0,41,41,axis),true);
      assert.equal(w.surface.buildings.length,1); const b=w.surface.buildings[0];
      assert.equal(b.gateAxis,axis); assert.equal(b.gateSpan,3); assert.deepEqual(b.cost,{clay:6,wood:3,stone:0}); completeBuilding(w,b);
      for (const p of fenceCellCenters(b)) {
        assert.equal(isWallBlockedAt(w,p.x,p.y,owner),false); assert.equal(isWallBlockedAt(w,p.x,p.y,"enemy"),true);
        assert.equal(surfacePointOpen(w.surface,p,owner),true); assert.equal(surfacePointOpen(w.surface,p,"enemy"),false);
      }
      eraseBuildCells(w,0,[wallCellIndexAt(fenceCellCenters(b)[0].x,fenceCellCenters(b)[0].y)]);
      assert.equal(w.surface.buildings.length,0); assert.equal(w.wallBlocked.size,0);
    }
  });
  check("Ворота заменяют свои секции, сохраняют соседние; чужие и существующие ворота защищены", () => {
    const w=fresh(), owner=w.colonies[0].id;
    for (const x of [37,39,41,43,45]) w.surface.buildings.push(wall(x,41,"wall",owner));
    rebuildWallBlocked(w); assert.equal(placeGate(w,0,41,41,"horizontal"),true);
    assert.equal(w.surface.buildings.length,3); assert.equal(w.surface.buildings.filter(b=>b.type==="gate").length,1);
    assert.equal(w.wallBlocked.size,2); assert.equal(placeGate(w,0,41,41,"horizontal"),false);
    const gate=w.surface.buildings.find(b=>b.type==="gate")!; completeBuilding(w,gate);
    paintWallCells(w,0,[wallCellIndexAt(39,41)]); assert.equal(w.surface.buildings.length,3);
    const hostile=fresh(); hostile.surface.buildings.push(wall(39,41,"wall",hostile.colonies[1].id));
    assert.equal(placeGate(hostile,0,41,41,"horizontal"),false); assert.equal(hostile.surface.buildings.length,1);
  });
  check("Проверка всей ширины: берег, край карты и площадка другого здания", () => {
    const w=fresh(),owner=w.colonies[0].id;
    assert.ok(gatePlacement(w.surface,owner,{x:1,y:41},"horizontal"));
    w.surface.buildings.push({...wall(37,41),type:"hut",colonyId:owner,stage:"site"});
    assert.equal(placeGate(w,0,41,41,"horizontal"),false); w.surface.buildings=[];
    let checked=false;
    for(let y=95;y<195&&!checked;y+=2) for(let x=165;x<295&&!checked;x+=2) {
      if(!isWaterAt(x,y) && isWaterAt(x+2,y)) { assert.equal(placeGate(w,0,x,y,"horizontal"),false); checked=true; }
    }
    assert.ok(checked,"found dry center with wet edge");
  });
  check("Сохранения v18 загружаются; v19 сохраняет ось, ширину и коллизии", () => {
    const w=fresh(); w.surface.buildings.push(wall(41,41,"gate",w.colonies[0].id));
    const old=toSnapshot(w); old.snapshotVersion=18;
    const restored=worldFromSnapshot(old,w.genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    assert.equal(restored.surface.buildings.length,1); assert.equal(fenceCellCenters(restored.surface.buildings[0]).length,1);
    assert.equal(placeGate(w,0,61,41,"vertical"),true); completeBuilding(w,w.surface.buildings[1]);
    const saved=toSnapshot(w); assert.equal(saved.snapshotVersion,CURRENT_SNAPSHOT_VERSION);
    const loaded=worldFromSnapshot(saved,w.genomeState,w.spiderGenomeState,w.colonies[1].genomeState);
    const b=loaded.surface.buildings.find(b=>b.gateSpan===3)!; assert.equal(b.gateAxis,"vertical");
    for(const p of fenceCellCenters(b)) assert.equal(isWallBlockedAt(loaded,p.x,p.y,"enemy"),true);
  });
  check("Команда ворот принимает только конечные координаты и два направления", () => {
    assert.deepEqual(parseCommand(JSON.stringify({type:"placeGate",x:41,y:41,axis:"vertical",colony:1})),{type:"placeGate",x:41,y:41,axis:"vertical",colonyIndex:1});
    for(const invalid of [{x:41,y:41,axis:"diagonal"},{x:-1,y:41,axis:"horizontal"},{x:null,y:41,axis:"vertical"}]) assert.equal(parseCommand(JSON.stringify({type:"placeGate",...invalid})),null);
  });
} finally { await rm(temp,{recursive:true,force:true}); }
console.log(`${passed} fence scenarios passed.`);
