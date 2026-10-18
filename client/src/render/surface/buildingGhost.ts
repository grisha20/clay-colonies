import { Container, Graphics, Sprite } from "pixi.js";
import { buildingFootprint } from "../../../../shared/buildingGeometry";
import { pointBuildingPlacement, type PointBuilding } from "../../../../shared/buildingPlacement";
import type { Building, Vec2, WorldSnapshot } from "../../../../shared/types";
import { getBuildingArt } from "./buildingArt";
import { placementAccessWarning } from "../../../../shared/placementAccess";

/** Uses the finished building's exact texture, size and ground root. */
export class BuildingGhost extends Container {
  private outline = new Graphics();
  private image = new Sprite();
  constructor() { super(); this.addChild(this.outline, this.image); this.eventMode = "none"; }
  show(world: WorldSnapshot, type: PointBuilding, pos: Vec2, owner: string, cell = 8): string | null {
    const reason = pointBuildingPlacement(world.surface, owner, type, pos);
    const warning=reason?null:placementAccessWarning(world.surface,owner,[{type,pos,colonyId:owner,id:"ghost",stage:"built"} as Building]);
    const f = buildingFootprint({ type, pos, stage: "built" } as Building)!;
    const art = getBuildingArt(type, f.rx * 2 * cell * 1.12);
    this.image.texture = art.texture; this.image.anchor.set(art.anchorX, art.anchorY); this.image.scale.set(art.scale);
    this.image.position.set(0, (f.y + f.ry - pos.y) * cell); this.image.alpha = 0.5;
    this.image.tint = reason ? 0xef8373 : 0xffffff;
    const color = reason ? 0xe65e46 : warning ? 0xf1bb55 : 0xc2d78a;
    this.outline.clear().ellipse(0, (f.y - pos.y) * cell, f.rx * cell, f.ry * cell)
      .fill({ color, alpha: 0.14 }).stroke({ color, width: 1.5, alpha: 0.95 });
    this.outline.moveTo(-5, (f.y + f.ry - pos.y) * cell + 5).lineTo(0, (f.y + f.ry - pos.y) * cell + 1).lineTo(5, (f.y + f.ry - pos.y) * cell + 5).stroke({ color, width: 1.5 });
    this.visible = true; return reason??warning;
  }
}
