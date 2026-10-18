import type { Ant, Enemy, Vec2, WorldSnapshot } from "../../../../shared/types";
import { visualIndex } from "./visualIndex";
import { isWaterAt } from "../../../../shared/surfaceTerrain";

export const RESIDENT_SCALE = 1.85;
export const RESIDENT_HEIGHT = 19;
export const WALK_PHASES = 7;
// 2π / 2.1 world units ≈ 24 screen px per cycle at cell=8, matching the soles.
export const WALK_PHASE_PER_UNIT = 2.1;
export type LookDirection = "front" | "back" | "side";
export type ResidentPose = {
  phase: number; walk: number; facing: number; look: LookDirection;
  bob: number; lean: number; stretch: number; work: number; legFrame: number;
  recoil: number; spin: number;
  angle: number; working: number;
  shotActive: boolean;
  attack: number; attackActive: boolean;
};
type Motion = {
  x: number; y: number; phase: number; walk: number; facing: number;
  work: number; seed: number; pose: ResidentPose;
  capturedBy?: string;
  shotSampled?: boolean; lastShotUntil?: number; shotTimer?: number;
  meleeSampled?: boolean; lastMeleeUntil?: number; meleeTimer?: number;
};

export function residentScale(ant: Ant): number {
  return RESIDENT_SCALE * Math.max(0.22, 1 - (ant.dissolved ?? 0) * 0.78);
}

function hash(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return (value >>> 0) / 4294967296 * Math.PI * 2;
}
export const animationSeed = hash;

/** Large legitimate packet deltas at 50x are not teleports. */
export function positionDiscontinuity(distance: number, ticksElapsed: number, maxStep: number): boolean {
  return distance > Math.max(12, Math.max(0, ticksElapsed) * maxStep * 1.3 + 2);
}

export function canWork(world: WorldSnapshot, ant: Ant): boolean {
  if (ant.carrying > 0 || ant.capturedBy) return false;
  if ((world.weather && world.weather.state !== "clear") || (ant.waterExposure ?? 0) > 0) return false;
  const index = visualIndex(world), colony = index.colonies.get(ant.colonyId);
  if (colony?.alarm) return false;
  if (ant.job === "harvest") {
    const node = index.nodes.get(ant.harvestNodeId ?? "");
    return !!node && node.amount > 0 && ant.state === "idle" && Math.hypot(node.pos.x - ant.pos.x, node.pos.y - ant.pos.y) <= 1.6 && (ant.harvestHits ?? 0) > 0;
  }
  if (ant.job === "build") {
    const site = index.buildings.get(ant.buildTargetId ?? "");
    return !!site && site.stage === "inProgress" && ant.state === "idle" && Math.hypot(site.pos.x - ant.pos.x, site.pos.y - ant.pos.y) <= 2.6;
  }
  return false;
}

/** Presentation only. Positions are read, never changed. Gait is driven by
 * distance, capped at a readable cadence even at 50x simulation speed. */
export class MotionTracker {
  private residents = new Map<string, Motion>();
  private creatures = new Map<string, Motion>();
  private lastTime = 0;
  private lastTick = -1;
  private clock = 0;
  get time(): number { return this.clock; }

  reset(): void {
    this.residents.clear(); this.creatures.clear(); this.lastTime = 0; this.lastTick = -1; this.clock = 0;
  }

  update(world: WorldSnapshot, nowMs: number): void {
    if (world.tick < this.lastTick) this.reset();
    const dt = this.lastTime > 0 ? Math.max(0, Math.min(0.05, (nowMs - this.lastTime) / 1000)) : 0;
    this.lastTime = nowMs;
    this.lastTick = world.tick;
    const running = world.session.status === "playing" && world.session.speed !== 0;
    const elapsed = running ? dt : 0;
    this.clock += elapsed;
    const live = new Set<string>();
    for (const ant of world.ants) {
      live.add(ant.id);
      const old = this.residents.get(ant.id);
      if (old && old.capturedBy !== ant.capturedBy) this.residents.delete(ant.id);
      const motion = this.advance(this.residents, ant.id, ant.pos, ant.heading, elapsed, true, world.session.speed ?? 1, residentScale(ant) / RESIDENT_SCALE);
      motion.capturedBy = ant.capturedBy;
      const shotUntil = ant.shot?.until;
      if (shotUntil !== motion.lastShotUntil) {
        const fresh = motion.shotSampled || (shotUntil ?? -Infinity) >= world.tick;
        motion.shotTimer = fresh && ant.shot && !ant.capturedBy ? 0.16 : 0;
        motion.lastShotUntil = shotUntil;
      }
      motion.shotSampled = true;
      motion.shotTimer = Math.max(0, (motion.shotTimer ?? 0) - elapsed);
      motion.pose.recoil = motion.shotTimer / 0.16;
      motion.pose.shotActive = motion.shotTimer > 0;
      const meleeUntil = ant.melee?.until;
      if (meleeUntil !== motion.lastMeleeUntil) {
        const fresh = motion.meleeSampled || (meleeUntil ?? -Infinity) >= world.tick;
        if (!fresh || !ant.melee || ant.capturedBy || ant.carrying > 0) motion.meleeTimer = 0;
        else if (!(motion.meleeTimer && motion.meleeTimer > 0)) motion.meleeTimer = 0.42;
        motion.lastMeleeUntil = meleeUntil;
      }
      motion.meleeSampled = true;
      if (ant.capturedBy || ant.carrying > 0) motion.meleeTimer = 0;
      motion.meleeTimer = Math.max(0, (motion.meleeTimer ?? 0) - elapsed);
      motion.pose.attackActive = motion.meleeTimer > 0;
      motion.pose.attack = motion.meleeTimer ? Math.sin((1 - motion.meleeTimer / 0.42) * Math.PI) : 0;
      if (!running) continue;
      const working = canWork(world, ant) && motion.walk < 0.4;
      motion.work += (Number(working) - motion.work) * (1 - Math.exp(-elapsed * 16));
      const work = Math.max(0, Math.sin(this.clock * 11 + motion.seed)) * motion.work;
      const recoil = motion.pose.recoil;
      const pose = motion.pose;
      pose.work = work;
      pose.working = motion.work;
      pose.recoil = recoil;
      pose.bob = -Math.abs(Math.sin(motion.phase)) * 0.45 * motion.walk;
      pose.lean = Math.sin(motion.phase) * 0.022 * motion.walk + work * 0.13 * motion.facing - recoil * 0.1 * motion.facing + pose.attack * 0.16 * motion.facing;
      pose.stretch = 1 + Math.sin(this.clock * 2.2 + motion.seed) * 0.008 * (1 - motion.walk) - Math.cos(motion.phase * 2) * 0.006 * motion.walk;
      pose.spin = ant.capturedBy ? this.clock * 7 + motion.seed : 0;
      if (ant.capturedBy) { pose.bob = -3; pose.legFrame = 0; pose.lean = 0; }
    }
    for (const key of this.residents.keys()) if (!live.has(key)) this.residents.delete(key);
    const enemies = new Set<string>();
    for (const enemy of world.enemies) {
      enemies.add(enemy.id);
      const old = this.creatures.get(enemy.id);
      const dx = old ? enemy.pos.x - old.x : 0, dy = old ? enemy.pos.y - old.y : 0;
      const length = Math.hypot(dx, dy);
      const heading = length > 0.0001 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
      const motion = this.advance(this.creatures, enemy.id, enemy.pos, heading, elapsed, false);
      if (running) {
        motion.pose.bob = enemy.type === "lakeMonster" && isWaterAt(enemy.pos.x,enemy.pos.y) ? 0 : Math.sin(motion.phase * 2) * 0.7 * motion.walk;
        motion.pose.lean = Math.sin(motion.phase) * (enemy.type === "beetle" ? 0.1 : 0.045) * motion.walk;
        motion.pose.stretch = enemy.type === "lakeMonster" && isWaterAt(enemy.pos.x,enemy.pos.y) ? 1 : 1 + Math.sin(this.clock * 2.3 + motion.seed) * 0.018;
      }
    }
    for (const key of this.creatures.keys()) if (!enemies.has(key)) this.creatures.delete(key);
  }

  private advance(map: Map<string, Motion>, id: string, pos: Vec2, heading: Vec2, dt: number, resident = true, playback = 1, strideScale = 1): Motion {
    let m = map.get(id);
    if (!m) {
      const seed = hash(id);
      m = { x: pos.x, y: pos.y, phase: seed, walk: 0, facing: heading.x < -0.35 ? -1 : 1, work: 0, seed,
        pose: { phase: seed, walk: 0, facing: heading.x < -0.35 ? -1 : 1,
          look: Math.hypot(heading.x, heading.y) < 0.001 ? "front" : Math.abs(heading.y) > Math.abs(heading.x) * 1.25 ? heading.y < 0 ? "back" : "front" : "side",
          bob: 0, lean: 0, stretch: 1, work: 0, legFrame: 0, recoil: 0, spin: 0,
          angle: Math.hypot(heading.x, heading.y) < 0.001 ? Math.PI / 2 : Math.atan2(heading.y, heading.x), working: 0, shotActive: false, attack: 0, attackActive: false } };
      map.set(id, m);
    }
    const distance = Math.hypot(pos.x - m.x, pos.y - m.y);
    m.x = pos.x; m.y = pos.y;
    if (dt <= 0) return m;
    const teleport = distance > Math.max(12, dt * 1800);
    const speed = teleport ? 0 : distance / dt;
    const target = Math.min(1, speed / (resident ? 2.2 : 5));
    m.walk += (target - m.walk) * (1 - Math.exp(-dt * 18));
    if (teleport) m.walk = 0;
    // The old 10 rad/s cap already truncated ordinary 1× movement (~10.5 u/s),
    // so roots advanced almost three times farther than the visible strides.
    const phasePerUnit = resident ? WALK_PHASE_PER_UNIT / strideScale : 1.3;
    const maxRate = resident ? playback > 1 ? 18 : 32 : 15;
    m.phase = (m.phase + Math.min(distance * phasePerUnit, dt * maxRate) * Number(!teleport)) % (Math.PI * 2);
    this.orient(m, heading);
    m.pose.walk = m.walk;
    m.pose.phase = m.phase;
    m.pose.facing = m.facing;
    m.pose.legFrame = resident
      ? m.walk > 0.025 ? 1 + Math.floor(m.phase / (Math.PI * 2) * WALK_PHASES) % WALK_PHASES : 0
      : m.walk > 0.15 ? [0, 1, 0, 2][Math.floor(m.phase / (Math.PI * 2) * 4) % 4] : 0;
    return m;
  }

  private orient(m: Motion, heading: Vec2): void {
    if (Math.hypot(heading.x, heading.y) > 0.001) {
      if (Math.abs(heading.x) > 0.35) m.facing = heading.x < 0 ? -1 : 1;
      const threshold = m.pose.look === "side" ? 1.45 : 1.05;
      const vertical = Math.abs(heading.y) > Math.abs(heading.x) * threshold;
      m.pose.look = vertical ? heading.y < 0 ? "back" : "front" : "side";
      m.pose.angle = Math.atan2(heading.y, heading.x);
      m.pose.facing = m.facing;
    }
  }

  /** Explicit pose inspection can change the view without advancing time. */
  setFacing(id: string, heading: Vec2, kind: "resident" | "creature"): void {
    const motion = (kind === "resident" ? this.residents : this.creatures).get(id);
    if (motion) this.orient(motion, heading);
  }

  resident(ant: Ant): ResidentPose { return this.residents.get(ant.id)?.pose ?? idlePose; }
  enemy(enemy: Enemy): ResidentPose { return this.creatures.get(enemy.id)?.pose ?? idlePose; }
}

const idlePose: ResidentPose = { phase: 0, walk: 0, facing: 1, look: "front", bob: 0, lean: 0, stretch: 1, work: 0, legFrame: 0, recoil: 0, spin: 0, angle: 0, working: 0, shotActive: false, attack: 0, attackActive: false };
export const actorMotion = new MotionTracker();
