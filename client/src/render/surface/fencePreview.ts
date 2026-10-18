import { Container, Graphics } from "pixi.js";
import { WALL_CELL_SIZE, type Building } from "../../../../shared/types";
import { fenceCellCenters } from "../../../../shared/fenceGeometry";
import { drawFences } from "./fenceRender";

/** Shares finished geometry; rebuilds only when the planned cells change. */
export class FencePreview extends Container {
  private key = "";
  constructor() { super(); this.eventMode = "none"; }
  show(plans: Building[], invalid: Set<string> = new Set(), cell = 8, warning=false): void {
    const key = `${cell}:${warning}:` + plans.map(b => `${b.id}:${b.type}:${b.colonyId}:${b.pos.x}:${b.pos.y}:${b.gateAxis}:${b.gateSpan}`).join("|") + [...invalid].join(",");
    if (key !== this.key) {
      for (const child of this.removeChildren()) child.destroy({ children: true });
      this.key = key;
      const ground = new Container(), actors = new Container(), marks = new Graphics();
      actors.sortableChildren = true; actors.alpha = 0.5; ground.alpha = 0.35;
      this.addChild(ground, marks, actors);
      const drawn = drawFences(actors, ground, plans, cell);
      if (invalid.size === plans.length) for (const sprite of drawn.sprites) sprite.tint = 0xef8373;
      for (const b of plans) for (const p of fenceCellCenters(b)) {
        const color = invalid.has(b.id) ? 0xe65e46 : warning ? 0xf1bb55 : 0xc2d78a;
        marks.rect((p.x - WALL_CELL_SIZE / 2) * cell, (p.y - WALL_CELL_SIZE / 2) * cell, WALL_CELL_SIZE * cell, WALL_CELL_SIZE * cell)
          .fill({ color, alpha: 0.12 }).stroke({ color, width: 0.8, alpha: 0.8 });
      }
    }
    this.visible = true;
  }
}
