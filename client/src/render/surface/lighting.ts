import type { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { dayCycle } from "../../../../shared/dayCycle";

export type CampLight = { x: number; y: number; radius: number; fire: number };
export type SurfaceLighting = { darkness: number; sunX: number; sunLength: number; lights: CampLight[] };

export function surfaceLighting(world: WorldSnapshot, cell: number): SurfaceLighting {
  const sun = dayCycle(world.tick);
  return { darkness: sun.darkness, sunX: -Math.sin(sun.sunAngle), sunLength: 0.3 + Math.abs(Math.sin(sun.sunAngle)) * 0.7,
    lights: world.surface.entrances.map((p, index) => {
      const fire = Math.max(0, Math.min(1, world.colonies[index]?.colony.fire ?? 0));
      return { x: p.x * cell, y: p.y * cell, radius: (7 + fire * 9) * cell, fire };
    }).filter(light => light.fire > 0.05) };
}

export function castShadow(lighting: SurfaceLighting, x: number, y: number, height: number): { dx: number; dy: number; alpha: number } {
  let dx = lighting.sunX * height * lighting.sunLength * 0.65;
  let dy = height * lighting.sunLength * 0.25;
  let alpha = 0.17 * (1 - lighting.darkness);
  let strongest = 0;
  for (const light of lighting.lights) {
    const vx = x - light.x, vy = y - light.y, distance = Math.hypot(vx, vy);
    const influence = Math.max(0, 1 - distance / light.radius) ** 2 * light.fire * lighting.darkness;
    if (influence <= strongest || distance < 1) continue;
    strongest = influence;
    const length = Math.min(height * 0.6, distance * 0.4);
    dx = dx * (1 - influence) + vx / distance * length * influence;
    dy = dy * (1 - influence) + vy / distance * length * 0.55 * influence;
  }
  alpha += strongest * 0.2;
  return { dx, dy, alpha };
}

export function nightOpacityAt(lighting: SurfaceLighting, x: number, y: number): number {
  let illumination = 0;
  for (const light of lighting.lights) {
    const t = Math.min(1, Math.hypot(x - light.x, y - light.y) / light.radius);
    illumination = Math.max(illumination, (1 - t * t * (3 - 2 * t)) * Math.min(1, light.fire * 1.8));
  }
  return lighting.darkness * 0.47 * (1 - illumination);
}

/** Contact stays at the ground root; the softer cast extends from it. */
export function shadowOutline(x: number, y: number, rx: number, ry: number, dx: number, dy: number, spread = 1): number[] {
  // Sweep a horizontal footprint along the light vector. Rotating an ellipse
  // here turns wide foundations into vertical cigars around noon.
  const points: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const far = c * dx / Math.max(1, rx) + s * dy / Math.max(1, ry) > 0;
    points.push(x + c * rx * spread + (far ? dx : 0), y + s * ry * spread + (far ? dy : 0));
  }
  return points;
}

export function drawGroundShadow(g: Graphics, lighting: SurfaceLighting, x: number, y: number, rx: number, ry: number, height = 0, opacity = 1): void {
  if (height > 0) {
    const cast = castShadow(lighting, x, y, height);
    for (let band = 3; band >= 1; band--) {
      g.poly(shadowOutline(x, y, rx, ry, cast.dx, cast.dy, 1 + band * 0.08)).fill({ color: 0x453927, alpha: cast.alpha * opacity * 0.22 });
    }
  }
  const contact = (0.18 - lighting.darkness * 0.035) * opacity;
  g.ellipse(x, y, rx * 1.12, ry * 1.15).fill({ color: 0x251b14, alpha: contact * 0.25 });
  g.ellipse(x, y, rx * 0.84, ry * 0.85).fill({ color: 0x251b14, alpha: contact * 0.48 });
  g.ellipse(x, y, rx * 0.48, ry * 0.5).fill({ color: 0x251b14, alpha: contact * 0.65 });
}
