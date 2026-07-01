import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import { hash2 } from "./ground";

function drawShadow(g: Graphics, x: number, y: number, rx: number, ry: number, alpha = 0.24): void {
  g.ellipse(x + rx * 0.08, y + ry * 0.2, rx, ry).fill({ color: 0x1d120b, alpha });
  g.ellipse(x, y, rx * 0.58, ry * 0.54).fill({ color: 0x1d120b, alpha: alpha * 0.35 });
}

function drawClayFigure(g: Graphics, x: number, y: number, scale: number, tint: number, accent: number, crown = false): void {
  const dark = tint === 0xd65b31 ? 0x7c291c : 0x70401e;
  const light = tint === 0xd65b31 ? 0xf18a5f : 0xdf8955;

  drawShadow(g, x, y + 25 * scale, 9 * scale, 3.8 * scale, 0.24);
  g.ellipse(x, y + 11 * scale, 6.8 * scale, 10 * scale).fill({ color: dark, alpha: 1 });
  g.ellipse(x, y + 8 * scale, 7.6 * scale, 10.8 * scale).fill({ color: tint, alpha: 1 });
  g.ellipse(x - 2.2 * scale, y + 2 * scale, 2.8 * scale, 3.8 * scale).fill({ color: light, alpha: 0.55 });

  g.circle(x, y - 5 * scale, 8.1 * scale).fill({ color: dark, alpha: 1 });
  g.circle(x, y - 6.2 * scale, 7.6 * scale).fill({ color: tint, alpha: 1 });
  g.circle(x - 2.8 * scale, y - 9 * scale, 2.7 * scale).fill({ color: light, alpha: 0.34 });
  g.circle(x - 2.7 * scale, y - 6.8 * scale, 0.8 * scale).fill(0x2f1812);
  g.circle(x + 2.8 * scale, y - 6.8 * scale, 0.8 * scale).fill(0x2f1812);

  g.rect(x - 7.6 * scale, y + 6 * scale, 3.1 * scale, 11 * scale).fill({ color: dark, alpha: 0.96 });
  g.rect(x + 4.5 * scale, y + 6 * scale, 3.1 * scale, 11 * scale).fill({ color: dark, alpha: 0.96 });
  g.rect(x - 5.7 * scale, y + 18 * scale, 3.7 * scale, 7.5 * scale).fill({ color: dark, alpha: 0.98 });
  g.rect(x + 2 * scale, y + 18 * scale, 3.7 * scale, 7.5 * scale).fill({ color: dark, alpha: 0.98 });

  g.rect(x - 8.5 * scale, y + 9.5 * scale, 17 * scale, 2.4 * scale).fill({ color: accent, alpha: 0.95 });
  if (crown) {
    g.rect(x - 6.6 * scale, y - 18.5 * scale, 13.2 * scale, 2.4 * scale).fill(0xe8c85f);
    g.circle(x - 5.6 * scale, y - 20 * scale, 2.4 * scale).fill(0xf3d874);
    g.circle(x, y - 21.5 * scale, 2.7 * scale).fill(0xf3d874);
    g.circle(x + 5.6 * scale, y - 20 * scale, 2.4 * scale).fill(0xf3d874);
  }
}

export function drawSurfaceEntranceAt(root: Container, pos: Vec2, cell: number, color: "dark" | "red", foodStorage = 0): void {
  const x = Math.round(pos.x * cell);
  const y = Math.round(pos.y * cell);
  const camp = new Graphics();
  const clay = color === "red" ? 0xd65b31 : 0xbe6b35;
  const clayDark = color === "red" ? 0xa9442c : 0x9b5528;
  const accent = color === "red" ? 0x6f3325 : 0x6f4a25;
  const ground = color === "red" ? 0x8e5a35 : 0x80603a;

  drawShadow(camp, x, y + 24, 62, 22, 0.16);
  camp.ellipse(x, y + 11, 56, 34).fill({ color: 0x8a6a3c, alpha: 0.22 });
  camp.ellipse(x, y + 9, 44, 25).fill({ color: ground, alpha: 0.18 });

  drawShadow(camp, x, y + 18, 18, 7, 0.26);
  camp.ellipse(x, y + 15, 14, 7).fill(0x3e2818);
  camp.rect(x - 13, y + 10, 26, 5).fill(0x5b341b);
  camp.rect(x - 12, y + 8, 24, 4).fill(0x7a4a24);
  camp.circle(x, y + 6, 9).fill(0xf1b23c);
  camp.circle(x - 2, y + 3, 5).fill(0xff6f2e);
  camp.circle(x + 2, y + 1, 3.5).fill(0xffe07a);
  camp.circle(x + 1, y + 9, 5).fill({ color: 0xff8b34, alpha: 0.75 });

  drawClayFigure(camp, x - 30, y - 8, 2.15, clay, accent, true);
  drawClayFigure(camp, x + 33, y - 7, 2.05, clayDark, 0xd7b25e, true);

  const pile = Math.max(4, Math.min(18, Math.ceil(foodStorage / 12)));
  drawShadow(camp, x - 48, y + 26, 23, 8, 0.22);
  camp.ellipse(x - 48, y + 21, 20, 9).fill({ color: 0x6e351e, alpha: 0.8 });
  for (let index = 0; index < pile; index += 1) {
    const px = x - 62 + hash2(pos.x + index, pos.y, 51) * 30;
    const py = y + 10 + hash2(pos.x, pos.y + index, 52) * 17;
    const size = 3 + hash2(index, pos.x, 53) * 3.6;
    camp.circle(px, py + 2, size).fill({ color: 0x7f3e22, alpha: 1 });
    camp.circle(px, py, size * 0.88).fill({ color: 0xa9552c, alpha: 1 });
    camp.circle(px - size * 0.25, py - size * 0.3, size * 0.35).fill({ color: 0xd98346, alpha: 0.82 });
  }

  root.addChild(camp);
}

export function drawSurfaceEntrance(root: Container, world: WorldSnapshot, cell: number): void {
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  entrances.forEach((entrance, index) => {
    const colony = world.colonies?.[index];
    drawSurfaceEntranceAt(root, entrance, cell, index === 1 ? "red" : "dark", colony?.colony.food ?? world.colony.food);
  });
}
