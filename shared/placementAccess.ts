import type { Building, Vec2 } from "./types";
import { SurfaceAccess } from "./surfaceAccess";
import type { SurfaceObstacles } from "./surfaceNavigation";
import { buildingServicePoint } from "./buildingGeometry";
import { fenceContains } from "./fenceGeometry";
const results=new Map<string,string|null>();
const baselines=new Map<string,{surface:SurfaceObstacles;access:SurfaceAccess;camp:Vec2;exits:Vec2[]}>();
/** Soft warning: the player may deliberately close a fort. Planned sites count
 * as finished, so the warning arrives before workers seal the last section. */
export function placementAccessWarning(surface:SurfaceObstacles,owner:string,plans:Building[]):string|null {
  if(!plans.length)return null;
  const baseKey=`${surface.width}:${surface.height}:${owner}:`+surface.entrances.map(p=>`${p.x},${p.y}`).join("|")+surface.buildings.map(b=>`${b.id}:${b.type}:${b.colonyId}:${b.pos.x}:${b.pos.y}:${b.gateAxis}:${b.gateSpan}`).join("|");
  const key=baseKey+"/"+plans.map(b=>`${b.type}:${b.pos.x}:${b.pos.y}:${b.gateAxis}:${b.gateSpan}`).join("|");
  if(results.has(key))return results.get(key)!;
  let base=baselines.get(baseKey);
  if(!base){
    const index=owner==="colony-2"?1:0,camp=surface.entrances[index];if(!camp)return null;
    const planned={...surface,buildings:surface.buildings.map(b=>({...b,stage:"built" as const}))};
    const access=new SurfaceAccess(planned,owner,{center:camp,radius:64});
    const exits=Array.from({length:16},(_,i)=>({x:camp.x+Math.cos(i*Math.PI/8)*52,y:camp.y+Math.sin(i*Math.PI/8)*52})).filter(p=>!!access.approach(camp,p));
    base={surface:planned,access,camp,exits};baselines.set(baseKey,base);if(baselines.size>4)baselines.delete(baselines.keys().next().value!);
  }
  const retained=base.surface.buildings.filter(b=>!plans.some(p=>p.type==="gate"&&b.type==="wall"&&b.colonyId===owner&&fenceContains(p,b.pos)));
  const afterSurface={...surface,buildings:[...retained,...plans.map(b=>({...b,stage:"built" as const}))]};
  const after=new SurfaceAccess(afterSurface,owner,{center:base.camp,radius:64});
  let warning:string|null=null;
  if(base.exits.length&&!base.exits.some(p=>after.approach(base!.camp,p)))warning="Ограда перекроет выход из лагеря. Оставь проход или поставь ворота";
  if(!warning)for(const b of base.surface.buildings.filter(b=>b.type==="storage"&&b.colonyId===owner&&Math.hypot(b.pos.x-base!.camp.x,b.pos.y-base!.camp.y)<48)){
    const point=buildingServicePoint(b);
    if(base.access.approach(base.camp,point,3)&&!after.approach(base.camp,point,3)){warning="Постройка перекроет подход к складу";break;}
  }
  results.set(key,warning);if(results.size>64)results.delete(results.keys().next().value!);
  return warning;
}
