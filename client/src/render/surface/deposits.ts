import { Container, Sprite, Text, Texture } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import type { ViewBounds } from "../types";
import { DEPOSIT_RX, DEPOSIT_RY, depositContains, depositRemaining } from "../../../../shared/resourceDeposits";
import { getHoveredGround } from "./interaction";

export const depositArtUrls = ["/assets/environment/deposits/clay-pit.png", "/assets/environment/deposits/stone-quarry.png"];
const views = new WeakMap<Container, Map<string, { image: Sprite; label: Text }>>();
/** Open excavation floors belong to terrain, below every resident and footprint. */
export function updateDeposits(root: Container, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  let cache = views.get(root); if (!cache) { cache = new Map(); views.set(root, cache); }
  const live = new Set<string>(), hover = getHoveredGround();
  for (const d of world.surface.deposits ?? []) {
    live.add(d.id); let view = cache.get(d.id);
    if (!view) {
      const texture = Texture.from(depositArtUrls[d.kind === "clay" ? 0 : 1]); texture.source.scaleMode = "linear";
      const image = new Sprite(texture); image.anchor.set(.5, .6); image.scale.set(DEPOSIT_RX * 2 * cell / texture.width);
      const label = new Text({ text: "", style: { fontFamily: "system-ui", fontSize: 11, fill: 0xfff0cb, stroke: { color: 0x493224, width: 3 }, align: "center" } });
      label.anchor.set(.5, 0); root.addChild(image, label); view = { image, label }; cache.set(d.id, view);
    }
    const visible = d.pos.x > bounds.left - 14 && d.pos.x < bounds.right + 14 && d.pos.y > bounds.top - 14 && d.pos.y < bounds.bottom + 14;
    view.image.position.set(d.pos.x * cell, d.pos.y * cell); view.image.visible = visible;
    const remaining = Math.floor(depositRemaining(world.surface, d.id));
    view.image.tint = remaining > 0 ? 0xffffff : 0xa89f93;
    view.label.visible = visible && !!hover && depositContains(d, hover, 2);
    if (view.label.visible) {
      view.label.text = `${d.kind === "clay" ? "Глиняный карьер" : "Каменный карьер"} · ${remaining} / ${d.capacity}\n${remaining <= 0 ? "Истощён" : d.kind === "stone" ? "6 рабочих мест · нужна кирка" : "6 рабочих мест · добыча руками"}`;
      view.label.position.set(d.pos.x * cell, (d.pos.y + DEPOSIT_RY) * cell + 4);
    }
  }
  for (const [id, view] of cache) if (!live.has(id)) { view.image.destroy(); view.label.destroy(); cache.delete(id); }
}
