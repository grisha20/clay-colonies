import type { WorldSnapshot } from "../../../../shared/types";
import type { SurfaceScene } from "../types";
import { actorMotion, animationSeed } from "./motion";
import { residentPlacement, waterGunMount } from "./residentLayout";
import { creatureDimensions } from "./creatureArt";
import { isWaterAt } from "../../../../shared/surfaceTerrain";
import { updateNightVeil } from "./nightLighting";

export function drawGameplay(scene: SurfaceScene, world: WorldSnapshot, cell: number): void {
  const g = scene.gameplayGraphics;
  g.clear();
  for (const runtime of world.colonies) {
    const post = runtime.colony.defensePost;
    if (post) {
      const x = post.x * cell, y = post.y * cell;
      g.circle(x, y, 16).stroke({ color: runtime.color === "red" ? 0xe96b49 : 0xffd27a, width: 2, alpha: 0.85 });
      g.moveTo(x, y).lineTo(x, y - 34).stroke({ color: 0x735333, width: 3 });
      g.poly([x, y - 34, x + 17, y - 28, x, y - 22]).fill(runtime.color === "red" ? 0xce6142 : 0xe9be68);
    }
  }
  for (const ant of world.ants) {
    const pose = actorMotion.resident(ant);
    if ((ant.waterExposure ?? 0) > 0 && !ant.capturedBy) {
      const index = world.colonies.findIndex(c => c.id === ant.colonyId), camp = world.surface.entrances[index];
      if (camp && (world.colonies[index]?.colony.fire ?? 0) > 0.05 && Math.hypot(ant.pos.x - camp.x, ant.pos.y - camp.y) <= 12 && pose.walk < 0.2) {
        for (let i = 0; i < 3; i++) {
          const t = (actorMotion.time * 0.65 + animationSeed(ant.id) + i / 3) % 1;
          const x = ant.pos.x * cell + (i - 1) * 4, y = ant.pos.y * cell - 24 - t * 12;
          g.moveTo(x, y).quadraticCurveTo(x + Math.sin(t * 5) * 3, y - 3, x + 1, y - 6).stroke({ color: 0xf3e8ce, width: 0.9, alpha: Math.sin(t * Math.PI) * Math.min(0.3, (ant.waterExposure ?? 0) / 60) });
        }
      }
    }
    if (ant.melee && pose.attackActive && pose.attack > 0.35) {
      const x = ant.melee.to.x * cell, y = ant.melee.to.y * cell - 15;
      const alpha = Math.min(0.85, pose.attack);
      const body = residentPlacement(world, ant, cell);
      const startX = body.x + Math.cos(pose.angle) * 10, startY = body.y - 14;
      g.moveTo(startX, startY).quadraticCurveTo((startX + x) * 0.5, (startY + y) * 0.5 - 5, x, y).stroke({ color: 0xf8d98b, width: 1.5, alpha: alpha * 0.65 });
      g.moveTo(x - 4, y - 3).lineTo(x + 4, y + 3).stroke({ color: 0xffe4a4, width: 2, alpha });
      g.moveTo(x + 3, y - 4).lineTo(x - 3, y + 4).stroke({ color: 0xffbd6b, width: 1.5, alpha });
    }
    if (!ant.capturedBy && ant.shot && actorMotion.resident(ant).shotActive) {
      const { tip, target } = waterGunMount(residentPlacement(world, ant, cell), ant, cell);
      if (target) {
        g.moveTo(tip.x, tip.y).lineTo(target.x, target.y).stroke({ color: 0x8de5f7, width: 2, alpha: 0.8 });
        g.circle(target.x, target.y, 5 + actorMotion.resident(ant).recoil * 5).stroke({ color: 0xb8f3fc, width: 1.5, alpha: 0.6 });
      }
    }
    if (ant.capturedBy) {
      const body = residentPlacement(world, ant, cell);
      g.ellipse(body.x, body.groundY, 15, 6).stroke({ color: 0xf2aa59, width: 1.5, alpha: 0.7 + Math.sin(actorMotion.time * 5) * 0.2 });
    }
  }
  for (const b of world.surface.buildings) {
    if (b.stage === "built" && b.hp < b.maxHp * 0.95) {
      const x = b.pos.x * cell, y = b.pos.y * cell - 35;
      g.rect(x - 12, y, 24, 3).fill({ color: 0x44241d, alpha: 0.7 });
      g.rect(x - 12, y, 24 * Math.max(0, b.hp / b.maxHp), 3).fill(b.hp < b.maxHp * 0.4 ? 0xde6346 : 0xe6b95e);
    }
  }
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    const x = enemy.pos.x * cell, y = enemy.pos.y * cell - creatureDimensions(enemy.type).height * 0.78 - 7;
    if (enemy.type === "lakeMonster" && isWaterAt(enemy.pos.x, enemy.pos.y)) {
      const ripple = Math.sin(actorMotion.time * 3 + enemy.pos.x) * 2;
      g.ellipse(x, enemy.pos.y * cell + 5, 28 + ripple, 8 + ripple * 0.3).stroke({ color: 0xb0e1cf, width: 1, alpha: 0.24 });
    }
    g.rect(x - 16, y, 32, 4).fill({ color: 0x342528, alpha: 0.7 });
    g.rect(x - 16, y, 32 * Math.max(0, enemy.hp / enemy.maxHp), 4).fill(enemy.type === "lakeMonster" ? 0x5cbfaf : 0xd77757);
  }
  updateNightVeil(scene.nightVeil, world, cell);
}
