import type { Vec2 } from "../../../../shared/types";

export type GaitFoot = { x: number; y: number; lift: number; planted: boolean; stamp: number };
type Leg = GaitFoot & { phase: number; from: Vec2; to: Vec2; settle: number; swingStart: number; stopLift: number };
const cycle = Math.PI * 2;
const smooth = (x: number) => x * x * (3 - 2 * x);
const fraction = (x: number) => ((x % 1) + 1) % 1;

/** Contact positions are stored in WORLD coordinates. Moving the torso, turning
 * or breathing must never move a planted foot. Only a new landing replaces it. */
export class FootGait {
  private legs?: [Leg, Leg];
  readonly feet: [GaitFoot, GaitFoot] = [0, 1].map(() => ({ x: 0, y: 0, lift: 0, planted: true, stamp: 0 })) as [GaitFoot, GaitFoot];
  update(pos: Vec2, direction: Vec2, phase: number, stride: number, size: number, moving: boolean, dt: number): void {
    if (dt <= 0) return;
    const home = (side: number): Vec2 => ({ x: pos.x - direction.y * .6 * size * side, y: pos.y + direction.x * .27 * size * side });
    if (!this.legs) this.legs = [1, -1].map((side, i) => {
      const p = home(side);
      return { ...p, lift: 0, planted: true, stamp: 0, phase: fraction(phase / cycle + i * .5), from: { ...p }, to: { ...p }, settle: -1, swingStart: .6, stopLift: 0 };
    }) as [Leg, Leg];
    let settling = this.legs.findIndex(f => f.settle >= 0 || !f.planted);
    if (!moving && settling < 0) settling = this.legs.findIndex((f, i) => Math.hypot(f.x - home(i ? -1 : 1).x, f.y - home(i ? -1 : 1).y) > .12 * size);
    for (const [i, f] of this.legs.entries()) {
      const u = fraction(phase / cycle + i * .5), rest = home(i ? -1 : 1);
      // A discontinuity / accelerated travel cannot stretch a leg across the map.
      if (Math.hypot(f.x - pos.x, f.y - pos.y) > stride * 1.2) {
        f.x = rest.x; f.y = rest.y; f.planted = true; f.lift = 0; f.settle = -1;
      }
      if (moving) {
        f.settle = -1;
        const contact = u < .6;
        if (f.planted && !contact) {
          f.from = { x: f.x, y: f.y };
          f.swingStart = u;
          // Predict the next landing once, rather than dragging the swing's
          // destination forward with the body every display frame.
          f.to = { x: rest.x + direction.x * stride * (1 - u + .3), y: rest.y + direction.y * stride * (1 - u + .3) };
          f.planted = false;
        }
        if (!f.planted && contact) {
          f.x = f.to.x; f.y = f.to.y; f.lift = 0; f.planted = true; f.stamp++;
        } else if (!contact) {
          const t = Math.max(0, (u - f.swingStart) / (1 - f.swingStart)), blend = smooth(t);
          f.x = f.from.x + (f.to.x - f.from.x) * blend;
          f.y = f.from.y + (f.to.y - f.from.y) * blend;
          f.lift = Math.sin(Math.PI * t) ** 2 * .48 * size;
        }
      } else if (i === settling) {
        if (f.settle < 0) { f.from = { x: f.x, y: f.y }; f.to = rest; f.settle = 0; f.stopLift = f.lift; }
        f.settle = Math.min(1, f.settle + dt / .17);
        const blend = smooth(f.settle);
        f.x = f.from.x + (f.to.x - f.from.x) * blend; f.y = f.from.y + (f.to.y - f.from.y) * blend;
        f.lift = f.stopLift * (1 - blend) + Math.sin(Math.PI * f.settle) ** 2 * .28 * size; f.planted = false;
        if (f.settle === 1) { f.planted = true; f.lift = 0; f.stamp++; f.settle = -1; }
      }
      f.phase = u;
      Object.assign(this.feet[i], { x: f.x - pos.x, y: f.y - pos.y, lift: f.lift, planted: f.planted, stamp: f.stamp });
    }
  }
}
