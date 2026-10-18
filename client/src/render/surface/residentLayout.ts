import type { Ant, WorldSnapshot } from "../../../../shared/types";
import { actorMotion, residentScale } from "./motion";
import { attachItem, itemPoint, type BodyMount } from "./attachment";
import { getEquipmentArt } from "./equipmentArt";
import { offsetSettings } from "./editor";
import { visualIndex } from "./visualIndex";

export function residentPlacement(world: WorldSnapshot, ant: Ant, cell: number): BodyMount & { captive: "beetle" | "lakeMonster" | null } {
  const pose = actorMotion.resident(ant), captor = ant.capturedBy ? visualIndex(world).enemies.get(ant.capturedBy) : undefined;
  const capture = captor?.type === "beetle" || captor?.type === "lakeMonster" ? captor.type : null;
  const direction = captor ? actorMotion.enemy(captor).angle : 0;
  const offset = capture === "beetle" ? 23 : capture ? 37 : 0;
  const lunge = !captor ? pose.attack * 3 : 0;
  const x = (captor?.pos.x ?? ant.pos.x) * cell + Math.cos(direction) * offset + Math.cos(pose.angle) * lunge;
  const groundY = (captor?.pos.y ?? ant.pos.y) * cell + Math.sin(direction) * offset;
  return { x, groundY, y: groundY + (capture === "lakeMonster" ? -6 : capture ? -2 : pose.bob + Math.sin(pose.angle) * lunge), size: residentScale(ant), facing: pose.look === "side" ? pose.facing : 1,
    rotation: capture === "lakeMonster" ? direction - Math.PI / 2 : capture ? 0 : pose.lean, stretch: capture ? 1 : pose.stretch, captive: capture };
}

export function fishingRodMount(body: BodyMount, ant: Ant) {
  const settings = offsetSettings.fishingRod;
  const art = getEquipmentArt("fishingRod", 31 * body.size / 1.85 * settings.scale / 1.45);
  const mount = attachItem(body, settings.offsetX / 1.85, -6 + (settings.offsetY - 8) * 0.25, art.scale, settings.rotation - 0.08, 0.12, 0.88);
  return { ...art, mount, tip: itemPoint(mount, art.texture.width, art.texture.height, 0.97, 0.03) };
}

export function waterGunMount(body: BodyMount, ant: Ant, cell: number) {
  const pose = actorMotion.resident(ant), art = getEquipmentArt("waterGun", 18 * body.size / 1.85);
  const base = attachItem(body, 4.5 - pose.recoil * 1.5, -9, art.scale, 0, 0.55, 0.32);
  const shot = pose.shotActive ? ant.shot : undefined;
  const target = shot ? { x: shot.to.x * cell, y: shot.to.y * cell - 10 } : undefined;
  const angle = target ? Math.atan2(target.y - base.y, target.x - base.x) : pose.angle;
  const localRotation = (angle - (body.facing < 0 ? Math.PI : 0) - body.rotation) * body.facing;
  const mount = { ...base, rotation: body.rotation + localRotation * body.facing };
  return { ...art, mount, target, tip: itemPoint(mount, art.texture.width, art.texture.height, 0.98, 0.32) };
}
