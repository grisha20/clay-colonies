import type { Ant } from "./types";
/** The same bound protects both authoritative lures and stale/interpolated
 * client snapshots. A rod carried while running is not an active cast. */
export function fishingCastActive(ant:Ant):boolean {
  return ant.layer==="surface"&&ant.job==="fish"&&!ant.capturedBy&&ant.state==="idle"&&ant.carrying<=0&&(ant.fishingTicks??0)>0&&!!ant.fishingStandPos&&!!ant.fishingLurePos&&
    Math.hypot(ant.pos.x-ant.fishingStandPos.x,ant.pos.y-ant.fishingStandPos.y)<=2&&Math.hypot(ant.pos.x-ant.fishingLurePos.x,ant.pos.y-ant.fishingLurePos.y)<=8;
}
