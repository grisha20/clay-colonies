import type { Ant, Vec2 } from "../../../shared/types";
export type TaskMotionState = "moving"|"no-path"|"recovering"|"blocked";
type Progress = { key:string;since:number;anchor:Vec2;extent:number;recoverUntil:number;attempts:number;state:TaskMotionState;target:Vec2 };
const progress=new WeakMap<Ant,Progress>();
export function taskMotionReport(ant:Ant):{state:TaskMotionState;target:Vec2}|undefined {const p=progress.get(ant);return p?{state:p.state,target:p.target}:undefined;}
export function markTaskPath(ant:Ant,available:boolean):void {const p=progress.get(ant);if(p&&p.state!=="recovering"&&p.state!=="blocked")p.state=available?"moving":"no-path";}
/** Measures displacement over a window, not total footsteps: an A-B-A loop
 * cannot pass this check by accumulating distance. Waiting/work never calls it. */
export function watchTaskMotion(ant:Ant,tick:number,target:Vec2):"normal"|"recover"|"release" {
  const key=`${ant.job}:${ant.buildTargetId}:${ant.harvestNodeId}:${ant.fishingTargetId}:${ant.carryKind}:${ant.carrying.toFixed(3)}`;
  let p=progress.get(ant);
  if(!p||p.key!==key||tick<p.since||Math.hypot(p.target.x-target.x,p.target.y-target.y)>.5) {
    p={key,since:tick,anchor:{...ant.pos},extent:0,recoverUntil:0,attempts:0,state:"moving",target:{...target}};progress.set(ant,p);
  }
  p.extent=Math.max(p.extent,Math.hypot(ant.pos.x-p.anchor.x,ant.pos.y-p.anchor.y));
  if(p.extent>3.2){p.anchor={...ant.pos};p.since=tick;p.extent=0;p.attempts=0;}
  if(tick-p.since>=100) {
    p.since=tick;p.anchor={...ant.pos};p.extent=0;p.attempts++;
    if(p.attempts>1){p.state="blocked";return "release";}
    p.recoverUntil=tick+45;p.state="recovering";
  }
  if(tick<p.recoverUntil)return "recover";
  if(p.state==="recovering")p.state="moving";
  return "normal";
}
