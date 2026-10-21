import assert from "node:assert/strict";
import { MotionTracker, canWork, residentScale, positionDiscontinuity, WALK_PHASES, WALK_PHASE_PER_UNIT } from "../../../client/src/render/surface/motion";
import { attachItem, itemPoint } from "../../../client/src/render/surface/attachment";
import { surfaceLighting, castShadow, nightOpacityAt, shadowOutline } from "../../../client/src/render/surface/lighting";
import { RoyalWalk } from "../../../client/src/render/surface/royals";
import { buildingFootprint, insideBuilding } from "../../../shared/buildingGeometry";
import { insideHearth } from "../../../shared/campGeometry";
import type { Enemy } from "../../../shared/types";
import { createWorld, toSnapshot } from "../sim/world";
import { randomGenome } from "../ai/genome";
import { randomSpiderGenome } from "../ai/spiderGenome";
import { royalHeadgearFrame, royalHeadgearMount } from "../../../client/src/render/surface/royalHeadgear";
import { readFileSync } from "node:fs";
import { alphaGroundProfile, plantedOffset } from "../../../client/src/render/surface/spriteGrounding";

const g = { current: randomGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
const s = { current: randomSpiderGenome(), best: null, bestFitness: 0, archive: [], generationsRun: 0 };
const world = toSnapshot(createWorld(g, s, structuredClone(g)));
world.colonies.forEach(c => { c.colony.autoManage = false; });
const ant = world.ants[0];
world.ants = [ant]; world.enemies = []; world.session.speed = 1;
ant.layer = "surface"; ant.heading = { x: 1, y: 0 }; ant.carrying = 0;
const tracker = new MotionTracker();
let now = 1000;
function frame(dx = 0, dy = 0) {
  ant.pos.x += dx; ant.pos.y += dy;
  now += 1000 / 60; world.tick++;
  tracker.update(world, now);
  return tracker.resident(ant);
}
let passed = 0;
function scenario(name: string, run: () => void) { run(); passed++; console.log(`PASS  ${name}`); }

scenario("Idle: no gait or cargo sway without displacement", () => {
  frame(); const phase = tracker.resident(ant).phase;
  for (let i = 0; i < 120; i++) frame();
  assert.equal(tracker.resident(ant).phase, phase);
  assert.equal(tracker.resident(ant).walk, 0);
  assert.equal(tracker.resident(ant).legFrame, 0);
});
scenario("Walk starts from displacement, alternates feet, stops at an obstacle", () => {
  const legs = new Set<number>();
  for (let i = 0; i < 120; i++) legs.add(frame(0.12).legFrame);
  assert.deepEqual([...legs].filter(f => f > 0).sort(), Array.from({ length: WALK_PHASES }, (_, i) => i + 1));
  assert.ok(tracker.resident(ant).walk > 0.95);
  const phase = tracker.resident(ant).phase;
  for (let i = 0; i < 100; i++) frame();
  assert.ok(tracker.resident(ant).walk < 0.001);
  assert.equal(tracker.resident(ant).phase, phase);
  assert.equal(tracker.resident(ant).legFrame, 0);
});
scenario("Pause freezes pose, including work and breathing", () => {
  world.session.speed = 0;
  const pose = { ...tracker.resident(ant) };
  for (let i = 0; i < 50; i++) frame();
  assert.deepEqual(tracker.resident(ant), pose);
  world.session.speed = 1;
});
scenario("50x movement keeps a readable cadence; teleports never create a stride", () => {
  world.session.speed = 50;
  const before = tracker.resident(ant).phase;
  frame(3);
  const delta = (tracker.resident(ant).phase - before + Math.PI * 2) % (Math.PI * 2);
  assert.ok(delta <= 18 / 60 + 0.00001);
  const phase = tracker.resident(ant).phase;
  frame(40);
  assert.equal(tracker.resident(ant).walk, 0);
  assert.equal(tracker.resident(ant).phase, phase);
  world.session.speed = 1;
});
scenario("Ordinary game speed has distance-matched strides at both 30 and 60 FPS", () => {
  for (const fps of [30, 60]) for (const speed of [2.2, 6, 10.5, 13]) {
    const w = structuredClone(world), a = w.ants[0], motion = new MotionTracker();
    w.session.status = "playing"; w.session.speed = 1; a.capturedBy = undefined; a.dissolved = 0; a.pos = { x: 120, y: 240 };
    motion.update(w, 1000); let travelled = 0, phase = motion.resident(a).phase, advanced = 0;
    for (let i = 1; i <= fps; i++) {
      a.pos.x += speed / fps; travelled += speed / fps; w.tick++;
      motion.update(w, 1000 + i * 1000 / fps); const next = motion.resident(a).phase;
      advanced += (next - phase + Math.PI * 2) % (Math.PI * 2); phase = next;
    }
    assert.ok(Math.abs(advanced - travelled * WALK_PHASE_PER_UNIT) < 1e-6, `${fps} FPS, ${speed} u/s: gait fell behind position`);
  }
});
scenario("Work only plays at an active resource, with empty hands and no alarm", () => {
  const node = world.surface.resourceNodes.find(n => n.kind === "tree")!;
  ant.pos = { ...node.pos }; ant.job = "harvest"; ant.harvestNodeId = node.id; ant.harvestHits = 1;
  ant.state = "idle";
  assert.equal(canWork(world, ant), true);
  ant.carrying = 1; assert.equal(canWork(world, ant), false); ant.carrying = 0;
  const colony = world.colonies.find(c => c.id === ant.colonyId)!;
  colony.colony.alarm = true; assert.equal(canWork(world, ant), false); colony.colony.alarm = false;
  ant.pos.x += 10; assert.equal(canWork(world, ant), false);
  ant.pos = { ...node.pos }; frame();
  let maxWork = 0;
  for (let i = 0; i < 120; i++) maxWork = Math.max(maxWork, frame().work);
  assert.ok(maxWork > 0.95);
});
scenario("Vertical heading retains side orientation; new paused residents face correctly", () => {
  ant.heading = { x: -1, y: 0 }; frame();
  ant.heading = { x: 0.01, y: -1 }; frame();
  assert.equal(tracker.resident(ant).facing, -1);
  assert.equal(tracker.resident(ant).look, "back");
  tracker.reset(); world.session.speed = 0; frame();
  assert.equal(tracker.resident(ant).look, "back");
});
scenario("New match clears stale gait; dissolved scale stays positive", () => {
  world.session.speed = 1; frame(0.15);
  world.tick = 0; now += 100; tracker.update(world, now);
  assert.equal(tracker.resident(ant).walk, 0);
  assert.equal(tracker.resident(ant).work, 0);
  ant.dissolved = 1; assert.ok(residentScale(ant) > 0 && residentScale(ant) < 0.5);
});
scenario("Packet jumps at 50x interpolate; impossible jumps and zero-tick jumps snap", () => {
  assert.equal(positionDiscontinuity(52, 50, 1.8), false);
  assert.equal(positionDiscontinuity(52, 1, 1.8), true);
  assert.equal(positionDiscontinuity(20, 0, 1.8), true);
  assert.equal(positionDiscontinuity(200, 50, 1.8), true);
});
scenario("Small enemy displacements turn left; resting keeps the previous view", () => {
  const e = { id: "test-beetle", type: "beetle", pos: { x: 130, y: 240 } } as Enemy;
  world.enemies = [e]; tracker.reset(); world.session.speed = 1; frame();
  e.pos.x -= 0.01; frame();
  assert.equal(tracker.enemy(e).facing, -1);
  assert.equal(tracker.enemy(e).look, "side");
  const angle = tracker.enemy(e).angle;
  for (let i = 0; i < 120; i++) frame();
  assert.equal(tracker.enemy(e).angle, angle);
  assert.equal(tracker.enemy(e).look, "side");
});
scenario("Capture and rescue discard stale walking/working poses", () => {
  ant.job = "forage";
  ant.capturedBy = "test-beetle"; frame(0.2);
  assert.equal(tracker.resident(ant).walk, 0);
  assert.equal(tracker.resident(ant).legFrame, 0);
  ant.capturedBy = undefined; frame(0.2);
  assert.equal(tracker.resident(ant).walk, 0);
  assert.equal(tracker.resident(ant).spin, 0);
  assert.equal(tracker.resident(ant).working, 0);
});
scenario("Attachments and their tips follow body rotation, mirror and shrink", () => {
  const body = { x: 100, y: 80, groundY: 80, size: 2, facing: -1, rotation: Math.PI / 2, stretch: 1 };
  const mount = attachItem(body, 3, -4, 0.5, 0, 0.5, 0.5);
  assert.ok(Math.abs(mount.x - 108) < 1e-9 && Math.abs(mount.y - 74) < 1e-9);
  const tip = itemPoint(mount, 20, 10, 1, 0.5);
  assert.ok(Math.abs(tip.x - 108) < 1e-9 && Math.abs(tip.y - 69) < 1e-9);
  const small = attachItem({ ...body, size: 1 }, 3, -4, 0.25);
  assert.ok(Math.abs(small.x - 104) < 1e-9 && Math.abs(small.y - 77) < 1e-9);
});
scenario("The presentation clock freezes on pause and at the match outcome", () => {
  const time = tracker.time; world.session.speed = 0;
  for (let i = 0; i < 60; i++) frame();
  assert.equal(tracker.time, time);
  world.session.speed = 1; world.session.status = "victory"; frame();
  assert.equal(tracker.time, time); world.session.status = "playing";
});
scenario("A newly observed shot remains visible at high speed; stale snapshots never replay it", () => {
  ant.shot = undefined; frame();
  ant.shot = { from: { ...ant.pos }, to: { x: ant.pos.x + 10, y: ant.pos.y }, until: world.tick - 1 };
  frame(); assert.equal(tracker.resident(ant).shotActive, true);
  const recoil = tracker.resident(ant).recoil;
  world.session.speed = 0; frame(); assert.equal(tracker.resident(ant).recoil, recoil);
  world.session.speed = 1;
  for (let i = 0; i < 30; i++) frame();
  assert.equal(tracker.resident(ant).shotActive, false);
  tracker.reset(); frame(); assert.equal(tracker.resident(ant).shotActive, false);
});
scenario("Transparent gutters and isolated speckles never become the soles", () => {
  const width = 40, height = 60, rgba = new Uint8ClampedArray(width * height * 4);
  for (const [left, right, bottom] of [[7, 15, 51], [25, 33, 48]]) {
    for (let y = 37; y < bottom; y++) for (let x = left; x <= right; x++) rgba[(y * width + x) * 4 + 3] = 255;
  }
  rgba[((height - 1) * width + 20) * 4 + 3] = 255;
  const profile = alphaGroundProfile(rgba, width, height);
  assert.equal(profile.bottom, 51);
  assert.equal(profile.feet.length, 2);
  assert.deepEqual(profile.feet.map(p => p.y), [51, 48]);
  assert.ok(profile.feet.every(p => p.rx > 2));
});
scenario("A support sole stays on the ground through tilt, breathing, mirroring and shrinking", () => {
  const profile = { bottom: 50, edge: [], feet: [{ x: 10, y: 50, rx: 4 }, { x: 30, y: 47, rx: 4 }] };
  for (const angle of [-.16, -.022, 0, .022, .16]) for (const scale of [.22, 1, 1.85]) for (const mirror of [-1, 1]) {
    const sx = scale * mirror, sy = scale * 1.01, offset = plantedOffset(profile, .5, 40, sx, sy, angle);
    const soles = profile.feet.map(p => -offset + (p.x - 20) * sx * Math.sin(angle) + (p.y - 50) * sy * Math.cos(angle));
    assert.ok(Math.abs(Math.max(...soles)) < 1e-8);
    assert.ok(soles.every(y => y <= 1e-8), "no sole penetrates the ground");
  }
});
scenario("Day shadows match the models' upper-left light; night shadows point away from the hearth", () => {
  world.tick = 600;
  assert.ok(castShadow(surfaceLighting(world, 8), 100, 100, 30).dx > 0);
  world.tick = 3600;
  assert.ok(castShadow(surfaceLighting(world, 8), 100, 100, 30).dx > 0);
  world.tick = 4800;
  world.colonies.forEach(c => { c.colony.fire = 1; });
  const light = surfaceLighting(world, 8), camp = light.lights[0];
  assert.ok(castShadow(light, camp.x + 30, camp.y, 30).dx > 0);
  assert.ok(castShadow(light, camp.x - 30, camp.y, 30).dx < 0);
  const below = castShadow(light, camp.x, camp.y + 30, 30);
  assert.ok(below.dy > 0 && below.alpha > 0);
  const above = castShadow(light, camp.x, camp.y - 30, 30);
  assert.ok(above.dy < 0);
});
scenario("An extinguished camp emits neither light nor a directional night shadow", () => {
  world.tick = 4800; world.colonies.forEach(c => { c.colony.fire = 0; });
  const light = surfaceLighting(world, 8);
  assert.equal(light.lights.length, 0);
  assert.equal(castShadow(light, 100, 100, 30).alpha, 0);
});
scenario("Night light falls off continuously; overlapping lights never darken each other", () => {
  world.tick = 4800; world.colonies.forEach(c => { c.colony.fire = 1; });
  const light = surfaceLighting(world, 8), camp = light.lights[0];
  assert.equal(nightOpacityAt(light, camp.x, camp.y), 0);
  let previous = 0;
  const isolated = { ...light, lights: [camp] };
  for (let i = 1; i <= 100; i++) {
    const alpha = nightOpacityAt(isolated, camp.x + camp.radius * i / 100, camp.y);
    assert.ok(alpha >= previous && alpha - previous < 0.008);
    previous = alpha;
  }
  const overlapping = { ...isolated, lights: [camp, { ...camp, x: camp.x + 40 }] };
  assert.ok(nightOpacityAt(overlapping, camp.x + 40, camp.y) <= nightOpacityAt(isolated, camp.x + 40, camp.y));
  assert.equal(nightOpacityAt({ ...light, lights: [] }, camp.x, camp.y), 0.47);
});
scenario("Melee strikes animate once, freeze on pause, and stale saved strikes do not replay", () => {
  tracker.reset(); world.tick = 100; world.session.speed = 1; ant.melee = undefined; ant.carrying = 0; frame();
  ant.melee = { to: { x: ant.pos.x + 3, y: ant.pos.y }, until: world.tick + 6 }; frame();
  assert.equal(tracker.resident(ant).attackActive, true);
  for (let i = 0; i < 8; i++) frame();
  assert.ok(tracker.resident(ant).attack > 0.5);
  world.session.speed = 0; const pose = { ...tracker.resident(ant) }; frame(); assert.deepEqual(tracker.resident(ant), pose);
  world.session.speed = 1; for (let i = 0; i < 40; i++) frame();
  assert.equal(tracker.resident(ant).attackActive, false);
  tracker.reset(); frame(); assert.equal(tracker.resident(ant).attackActive, false);
});
scenario("King and queen patrol outside foundations and hearths; pause freezes both", () => {
  const walk = new RoyalWalk(); world.tick = 1800; world.enemies = []; world.session.speed = 1;
  world.colonies.forEach(c => { c.colony.alarm = false; });
  let previous = walk.update(world), travelled = 0;
  assert.equal(previous.length, world.colonies.length * 2);
  for (let i = 0; i < 160; i++) {
    world.tick += 5; const current = walk.update(world);
    current.forEach((a, j) => {
      travelled += Math.hypot(a.pos.x - previous[j].pos.x, a.pos.y - previous[j].pos.y);
      for (const b of world.surface.buildings) { const f = buildingFootprint(b); if (f) assert.equal(insideBuilding(a.pos.x, a.pos.y, f), false); }
      for (const camp of world.surface.entrances) assert.equal(insideHearth(a.pos.x, a.pos.y, camp), false);
    }); previous = current;
  }
  assert.ok(travelled > 30);
  world.session.speed = 0; assert.deepEqual(walk.update(world), previous);
});
scenario("Frequent strikes at 50x finish their visible swing; picking up cargo cancels the swing", () => {
  tracker.reset(); world.session.speed = 50; ant.melee = undefined; ant.carrying = 0; ant.job = "forage"; frame();
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    if (i % 6 === 0) ant.melee = { to: { x: ant.pos.x + 3, y: ant.pos.y }, until: world.tick - 1 };
    peak = Math.max(peak, frame().attack);
  }
  assert.ok(peak > 0.98);
  ant.carrying = 1; frame(); assert.equal(tracker.resident(ant).attackActive, false);
});
scenario("Royal patrols move continuously between 10 Hz packets, stop on pause and disconnection", () => {
  const w = toSnapshot(createWorld(g, s, structuredClone(g))); w.enemies = []; w.colonies.forEach(c => { c.colony.autoManage = false; }); w.weather.state = "clear"; w.tick = 1800;
  w.colonies.forEach(c => { c.colony.alarm = false; }); w.session.speed = 1;
  const walk = new RoyalWalk(), poses = new MotionTracker(); let ms = 1000;
  let previous = walk.update(w, ms), still = 0, minimum = Infinity, maximum = 0;
  for (let frame = 1; frame <= 42; frame++) {
    ms += 1000 / 60; if (frame % 6 === 0) w.tick++;
    const current = walk.update(w, ms), a = current[0];
    const delta = Math.hypot(a.pos.x - previous[0].pos.x, a.pos.y - previous[0].pos.y);
    if (delta < 0.001) still++;
    assert.ok(delta < 0.045, `single frame moved ${delta}`);
    poses.update({ ...w, ants: current }, ms);
    if (frame > 24) { minimum = Math.min(minimum, poses.resident(a).walk); maximum = Math.max(maximum, poses.resident(a).walk); }
    previous = current;
  }
  assert.equal(still, 0); assert.ok(maximum - minimum < 0.025);
  w.session.speed = 0; ms += 1000; assert.deepEqual(walk.update(w, ms), previous);
  w.session.speed = 1;
  for (let i = 0; i < 60; i++) { ms += 1000 / 60; walk.update(w, ms); }
  const stopped = walk.update(w, ms); ms += 1000; assert.deepEqual(walk.update(w, ms), stopped);
});
scenario("Shadow footprints keep their horizontal width at noon and sweep in every direction", () => {
  for (const [dx, dy] of [[0, 20], [0, -20], [30, 10], [-30, -10]]) {
    const polygon = shadowOutline(0, 0, 32, 14, dx, dy);
    const xs = polygon.filter((_, i) => i % 2 === 0), ys = polygon.filter((_, i) => i % 2 === 1);
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 63.9);
    assert.ok(Math.min(...xs) <= -31.9 && Math.max(...xs) >= 31.9);
    assert.ok(Math.max(...ys) - Math.min(...ys) <= 28 + Math.abs(dy) + 0.01);
  }
});
scenario("Rain brings both royals back to separate places at the hearth", () => {
  const w = toSnapshot(createWorld(g, s, structuredClone(g))); w.enemies = []; w.colonies.forEach(c => { c.colony.autoManage = false; }); w.weather.state = "warning"; w.tick = 1800; w.session.speed = 1;
  w.colonies.forEach(c => { c.colony.alarm = false; c.colony.fire = 1; }); const walk = new RoyalWalk();
  let residents = walk.update(w);
  for (let i = 0; i < 150; i++) { w.tick += 5; residents = walk.update(w); }
  for (const [i, camp] of w.surface.entrances.entries()) {
    const pair = residents.filter(a => a.colonyId === w.colonies[i].id);
    pair.forEach(a => assert.ok(Math.hypot(a.pos.x - camp.x, a.pos.y - camp.y) < 8));
    assert.ok(Math.hypot(pair[0].pos.x - pair[1].pos.x, pair[0].pos.y - pair[1].pos.y) >= 2);
  }
});
scenario("Slow walking uses every intermediate phase, without exaggerated bob or body rotation", () => {
  const w = structuredClone(world), a = w.ants[0], motion = new MotionTracker();
  w.session.speed = 1; w.session.status = "playing"; a.job = "forage"; a.carrying = 0; a.melee = undefined; a.shot = undefined; a.capturedBy = undefined;
  a.pos = { x: 120, y: 240 }; a.heading = { x: 1, y: 0 }; const frames = new Set<number>();
  motion.update(w, 1000);
  for (let i = 1; i <= 1200; i++) {
    a.pos.x += 0.5 / 60; w.tick++; motion.update(w, 1000 + i * 1000 / 60);
    const pose = motion.resident(a); if (pose.legFrame) frames.add(pose.legFrame);
    assert.ok(Math.abs(pose.bob) <= 0.45 && Math.abs(pose.lean) <= 0.02201);
  }
  assert.equal(frames.size, WALK_PHASES);
  const frozen = { ...motion.resident(a) }; w.session.speed = 0; motion.update(w, 25000); assert.deepEqual(motion.resident(a), frozen);
});
scenario("Crowns follow front/side/back and the current head offset, including a mirrored left view", () => {
  assert.deepEqual(["front", "side", "back"].map(look => royalHeadgearFrame("king", look as "front")), [0, 1, 2]);
  assert.deepEqual(["front", "side", "back"].map(look => royalHeadgearFrame("queen", look as "front")), [3, 4, 5]);
  const body = { x: 100, y: 80, groundY: 80, size: 2, facing: -1, rotation: 0, stretch: 1 };
  const head = { x: -0.8, y: -16, width: 10 };
  const crown = royalHeadgearMount(body, head, 400, 0.5, 1);
  assert.ok(Math.abs(crown.x - 98.4) < 1e-9); assert.equal(crown.y, 48); assert.ok(crown.scaleX < 0);
  assert.equal(royalHeadgearMount({ ...body, facing: 1 }, head, 400, 0.5, 1).x, crown.x);
});
scenario("Walking atlases and the extra contact pose cover every direction with registered heads and stable heights", () => {
  for (const file of ["resident-walk-v2", "resident-carry-walk-v2", "resident-opposite-step-v3", "resident-side-walk-v4"]) {
    const data = JSON.parse(readFileSync(`client/public/assets/characters/clayfolk/${file}.json`, "utf8"));
    const phases = file === "resident-side-walk-v4" ? 4 : file === "resident-opposite-step-v3" ? 2 : WALK_PHASES - 1;
    assert.equal(data.rows, phases); assert.equal(data.columns, 4); assert.equal(data.frames.length, phases * 4);
    const heights = data.frames.map((f: { height: number }) => f.height);
    assert.ok(Math.max(...heights) / Math.min(...heights) < 1.08);
    for (const f of data.frames) {
      assert.ok(f.head && f.head.x > 0 && f.head.x < f.width && f.head.width > 0);
      assert.ok(f.y + f.height <= data.imageHeight && f.x + f.width <= data.imageWidth);
    }
  }
});
scenario("Expanded resident cycles retain the creatures' own three-frame gait", () => {
  const w = structuredClone(world), motion = new MotionTracker();
  const e = { id: "gait-spider", type: "spider", pos: { x: 130, y: 240 } } as Enemy;
  w.enemies = [e]; w.session.speed = 1; w.session.status = "playing"; motion.update(w, 1000);
  const phases = new Set<number>();
  for (let i = 1; i <= 240; i++) { e.pos.x += 0.12; w.tick++; motion.update(w, 1000 + i * 1000 / 60); phases.add(motion.enemy(e).legFrame); }
  assert.deepEqual([...phases].sort(), [0, 1, 2]);
});
console.log(`${passed} motion scenarios passed.`);
