import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Building, Vec2 } from "../../../../shared/types";
import { fenceLayout, FENCE_GATE_BEAM_HEIGHT } from "./fenceLayout";
import { getFenceParts } from "./buildingArt";

/** All heights are screen vertical above a shared world-ground position. */
export function drawFences(actors: Container, ground: Container, buildings: Building[], cell: number, parts = getFenceParts()): { sprites: Sprite[]; contacts: Graphics } {
  const { posts, spans } = fenceLayout(buildings), sprites: Sprite[] = [];
  const contacts = new Graphics();
  const size = cell / 8;
  function beam(from: Vec2, to: Vec2, texture: Texture, height: number, thickness: number, owner: string, base = false): void {
    const dx = (to.x - from.x) * cell, dy = (to.y - from.y) * cell, sprite = new Sprite(texture);
    sprite.anchor.set(0.5); sprite.width = Math.hypot(dx, dy) + 1; sprite.height = thickness * size;
    sprite.rotation = Math.atan2(dy, dx);
    sprite.position.set((from.x + to.x) / 2 * cell, (from.y + to.y) / 2 * cell - height * size);
    sprite.zIndex = Math.max(from.y, to.y) * cell + 0.02;
    sprite.tint = owner === "colony-2" ? 0xffe6d8 : 0xffffff;
    sprite.label = "fence_beam"; (base ? ground : actors).addChild(sprite); sprites.push(sprite);
  }
  for (const span of spans) {
    if (span.gate) {
      beam(span.from, span.to, parts.rail, FENCE_GATE_BEAM_HEIGHT, 7, span.owner);
    } else {
      beam(span.from, span.to, parts.clay, 0, 5.5, span.owner, true);
      beam(span.from, span.to, parts.rail, 7, 2.8, span.owner);
      beam(span.from, span.to, parts.rail, 15, 2.8, span.owner);
    }
  }
  for (const post of posts) {
    if (post.height > 20) beam({ x: post.pos.x - 0.7, y: post.pos.y }, { x: post.pos.x + 0.7, y: post.pos.y }, parts.clay, 0, 7, post.owner, true);
    contacts.ellipse(post.pos.x * cell, post.pos.y * cell, 3.7 * size, 1.35 * size).fill({ color: 0x39271c, alpha: 0.22 });
    contacts.ellipse(post.pos.x * cell, post.pos.y * cell - 0.2 * size, 2.6 * size, 0.6 * size).fill({ color: 0x251b14, alpha: 0.25 });
    const sprite = new Sprite(parts.post); sprite.anchor.set(0.5, 1);
    sprite.height = post.height * size; sprite.width = (post.height > 20 ? 9.5 : 5.4) * size;
    sprite.position.set(post.pos.x * cell, post.pos.y * cell); sprite.zIndex = sprite.y + 0.1;
    sprite.tint = post.owner === "colony-2" ? 0xffe6d8 : 0xffffff;
    sprite.label = "fence_post"; actors.addChild(sprite); sprites.push(sprite);
  }
  ground.addChild(contacts);
  return { sprites, contacts };
}
