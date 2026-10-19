import type { Graphics, Sprite } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { resourceNodeTool } from "../../../../shared/types";
import { acquireSprite, beginPool, endPool } from "../spritePool";
import type { SpritePool, ViewBounds } from "../types";
import { offsetSettings } from "./editor";
import { actorMotion } from "./motion";
import { getCaptiveHeadArt } from "./characterArt";
import { getEquipmentArt, type EquipmentKind } from "./equipmentArt";
import { attachItem, type ItemMount } from "./attachment";
import { fishingRodMount, residentArt, residentPlacement, waterGunMount } from "./residentLayout";
import { visualIndex } from "./visualIndex";
import { getFishArt } from "./fishArt";
import { royalKind } from "./royals";
import { getRoyalHeadgear, royalHeadgearMount } from "./royalHeadgear";

let selectedAntId: string | null = null;
export function setSelectedAntId(id: string | null): void { selectedAntId = id; }

export function applyItemMount(sprite: Sprite, mount: ItemMount): void {
  sprite.anchor.set(mount.anchorX, mount.anchorY); sprite.position.set(mount.x, mount.y);
  sprite.scale.set(mount.scaleX, mount.scaleY); sprite.rotation = mount.rotation;
}

export function updateSurfaceResidents(pool: SpritePool, items: SpritePool, selection: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool); beginPool(items); selection.clear();
  const { nodes, colonies } = visualIndex(world);
  for (const ant of world.ants) {
    if (ant.layer !== "surface" || ant.pos.x < bounds.left - 8 || ant.pos.x > bounds.right + 8 || ant.pos.y < bounds.top - 8 || ant.pos.y > bounds.bottom + 8) continue;
    const pose = actorMotion.resident(ant), mount = residentPlacement(world, ant, cell);
    const { x, y, groundY, size, facing } = mount;
    const carried = ant.carrying > 0 && !ant.capturedBy;
    const item = (kind: EquipmentKind, extent: number, localX: number, localY: number, rotation = 0, anchorX = 0.5, anchorY = 0.5, behind = false) => {
      const art = getEquipmentArt(kind, extent * size / 1.85);
      const sprite = acquireSprite(items); sprite.texture = art.texture;
      applyItemMount(sprite, attachItem(mount, localX, localY, art.scale, rotation, anchorX, anchorY));
      sprite.zIndex = groundY + (behind ? -0.1 : 0.1); sprite.alpha = 1; sprite.tint = 0xffffff;
      return sprite;
    };
    if (mount.captive === "beetle") {
      const ball = item("ball", 23, 0, -4);
      ball.rotation = pose.spin;
    }
    const body = acquireSprite(pool);
    const art = mount.captive === "beetle" ? getCaptiveHeadArt() : residentArt(ant);
    body.texture = art.texture;
    body.anchor.set(art.anchorX, mount.captive === "beetle" ? 0.65 : art.anchorY ?? 1);
    body.position.set(x, y - (mount.captive === "beetle" ? 8 * size / 1.85 : 0));
    const bodyScale = size * art.scale * (mount.captive === "beetle" ? 0.7 : 1);
    body.scale.set(bodyScale * (2 - mount.stretch), bodyScale * mount.stretch);
    body.rotation = mount.rotation;
    const base = ant.colonyId === "colony-2" ? 0xffb8a0 : 0xffffff, wet = Math.min(1, (ant.waterExposure ?? 0) / 30);
    const appearanceTint = [16, 8, 0].reduce((color, shift) => color | Math.round(((base >> shift) & 255) * (1 - wet) + ((0xa9cbd4 >> shift) & 255) * wet) << shift, 0);
    const palette = art.tint ?? 0xffffff;
    body.tint = [16, 8, 0].reduce((color, shift) => color | Math.round(((appearanceTint >> shift) & 255) * ((palette >> shift) & 255) / 255) << shift, 0);
    body.alpha = mount.captive === "lakeMonster" ? 0.92 : 1;
    const captor = ant.capturedBy ? visualIndex(world).enemies.get(ant.capturedBy) : undefined;
    body.zIndex = mount.captive === "lakeMonster" && captor ? Math.max(groundY, captor.pos.y * cell + 14) : groundY + (mount.captive === "beetle" ? 0.2 : 0);

    if (!ant.capturedBy) {
      const royal = royalKind(ant);
      if (royal) {
        for (const part of getRoyalHeadgear(royal, pose.look)) {
          const crown = acquireSprite(items); crown.texture = part.texture;
          applyItemMount(crown, royalHeadgearMount(mount, art.head ?? { x: 0, y: -14, width: 10.5 }, part.fullWidth, part.anchorX, part.anchorY));
          if (part.mirror) crown.scale.x *= -1;
          crown.zIndex = groundY + (part.behind ? -0.05 : 0.05); crown.alpha = body.alpha; crown.tint = appearanceTint;
        }
      }
      if (ant.forageRole === "scout" && ant.job === "forage") item("satchel", 9, -5.5, -7, 0.1, 0.5, 0.5, pose.look !== "back");
      if (carried) {
        const kind = ant.carryKind ?? "food";
        const key = kind === "fruit" || kind === "meat" ? "food" : kind;
        const settings = key === "fish" ? offsetSettings.fish : offsetSettings[key] ?? offsetSettings.food;
        const cargo: EquipmentKind = kind === "clay" || kind === "wood" || kind === "stone" || kind === "fish" || kind === "meat" ? kind : "tomato";
        const defaultScale = key === "fish" ? 0.38 : key === "food" ? 1.25 : 2.2;
        const cargoSprite = item(cargo, (cargo === "wood" ? 13 : cargo === "tomato" ? 8 : 11) * settings.scale / defaultScale,
          settings.offsetX + (pose.look === "side" ? 3.5 : 0), -7.8 + settings.offsetY - (key === "fish" ? 2.2 : 2.5), Math.sin(pose.phase) * pose.walk * 0.035, 0.5, 0.5, pose.look === "back");
        if (cargo === "fish") {
          const fish = getFishArt(ant.caughtFishSpecies ?? "blue", 0, true, 12 * size / 1.85 * settings.scale / defaultScale);
          cargoSprite.texture = fish.texture; cargoSprite.scale.set(fish.scale * facing, fish.scale);
        }
      } else {
        const node = nodes.get(ant.harvestNodeId ?? ""), colony = colonies.get(ant.colonyId);
        const tool = ant.job === "build" ? "hammer" : ant.job === "harvest" && node ? resourceNodeTool(node.kind) : null;
        const available = tool === "hammer" || tool === "axe" && (colony?.axes ?? 0) > 0 || tool === "pick" && (colony?.picks ?? 0) > 0;
        if (tool && available) {
          const work = pose.attackActive ? pose.attack : pose.work, blend = pose.attackActive ? 1 : pose.working;
          const readyX = pose.look === "front" ? -7 : pose.look === "back" ? 7 : -5;
          const strikeX = pose.look === "front" ? -2 : pose.look === "back" ? 2 : 6;
          const localX = 6 * (1 - blend) + (readyX + (strikeX - readyX) * work) * blend;
          item(tool, tool === "hammer" ? 15 : 18, localX, -7 * (1 - blend) + (-13 + work * 7) * blend, -0.3 + work * 1.65, 0.5, 0.86);
        } else if (ant.job === "guard") {
          if (colony?.waterWeapons) {
            const gun = waterGunMount(mount, ant, cell), sprite = acquireSprite(items);
            sprite.texture = gun.texture; applyItemMount(sprite, gun.mount); sprite.zIndex = groundY + 0.1; sprite.alpha = 1; sprite.tint = 0xffffff;
          } else {
            const settings = offsetSettings.spear;
            item("spear", 30 * settings.scale / 1.1, settings.offsetX / 2, -7 + (settings.offsetY - 8.9) * 0.25,
              settings.rotation + Math.sin(pose.phase) * pose.walk * 0.06 - pose.attack * 0.65, settings.anchorX, settings.anchorY, pose.look === "back");
          }
        } else if (ant.job === "fish") {
          const rod = fishingRodMount(mount, ant), sprite = acquireSprite(items);
          sprite.texture = rod.texture; applyItemMount(sprite, rod.mount); sprite.zIndex = groundY + 0.1; sprite.alpha = 1; sprite.tint = 0xffffff;
        }
      }
    }
    if (ant.id === selectedAntId) {
      selection.ellipse(x, groundY + 1, 10 * size / 1.85, 4 * size / 1.85).stroke({ width: 1.5, color: 0xfff3c4, alpha: 0.95 });
      selection.ellipse(x, groundY + 1, 12 * size / 1.85, 5 * size / 1.85).stroke({ width: 1, color: 0xfff3c4, alpha: 0.3 });
    }
  }
  endPool(pool); endPool(items);
}
