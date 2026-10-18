import type { Vec2 } from "../../../../shared/types";
let hoveredGround:Vec2|null=null;
export function setHoveredGround(p:Vec2|null):void {hoveredGround=p;}
export function getHoveredGround():Vec2|null{return hoveredGround;}
