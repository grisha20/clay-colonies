import { lakePoints, lakeRoute } from "./lakeNavigation";
import { lakeIdAt, surfaceTerrainRevision, type LakeId, isMountainAt } from "./surfaceTerrain";
import { surfaceRoute, surfacePointOpen, type SurfaceObstacles } from "./surfaceNavigation";
import { surfaceGridLineOpen } from "./surfaceGrid";
import { buildingFootprint, crossesBuilding } from "./buildingGeometry";
import { crossesHearth } from "./campGeometry";
import { fenceContains } from "./fenceGeometry";
import type { Vec2 } from "./types";
export type ShorePortal={water:Vec2;land:Vec2};
const portals=new Map<LakeId,ShorePortal[]>();
let portalsRevision=-1;
export function lakeShorePortals(id:LakeId):ShorePortal[] {
  if(portalsRevision!==surfaceTerrainRevision()){portals.clear();portalsRevision=surfaceTerrainRevision();}
  let result=portals.get(id);if(result)return result;result=[];
  for(const p of lakePoints(id))for(const [dx,dy] of [[4,0],[-4,0],[0,4],[0,-4]]) {const land={x:p.x+dx,y:p.y+dy};if(!lakeIdAt(land.x,land.y))result.push({water:p,land});}
  portals.set(id,result);return result;
}
export function nearLakeShore(p:Vec2,id:LakeId):boolean {
  if(lakeIdAt(p.x,p.y)===id)return true;
  for(const r of [4,8,12])for(let i=0;i<8;i++)if(lakeIdAt(p.x+Math.cos(i*Math.PI/4)*r,p.y+Math.sin(i*Math.PI/4)*r)===id)return true;
  return false;
}
export function amphibianLineOpen(surface:SurfaceObstacles,from:Vec2,to:Vec2,id:LakeId):boolean {
  if(to.x<1||to.y<1||to.x>=surface.width-1||to.y>=surface.height-1)return false;
  if(surface.entrances.some(c=>crossesHearth(from.x,from.y,to.x,to.y,c)))return false;
  if(surface.buildings.some(b=>{const f=buildingFootprint(b);return f&&crossesBuilding(from,to,f);}))return false;
  const fences=surface.buildings.filter(b=>b.stage==="built"&&(b.type==="wall"||b.type==="gate"));
  return surfaceGridLineOpen(from,to,(x,y)=>{const lake=lakeIdAt(x,y);return (!lake||lake===id)&&!isMountainAt(x,y)&&nearLakeShore({x,y},id)&&!fences.some(b=>fenceContains(b,{x,y}));});
}
export function amphibianRoute(surface:SurfaceObstacles,from:Vec2,to:Vec2,id:LakeId):Vec2[]|null {
  if(!nearLakeShore(to,id))return null;
  if(amphibianLineOpen(surface,from,to,id))return [{...to}];
  const fromWater=lakeIdAt(from.x,from.y)===id,toWater=lakeIdAt(to.x,to.y)===id;
  if(fromWater&&toWater)return lakeRoute(id,from,to);
  const valid=(points:Vec2[]|null,start:Vec2)=>{if(!points)return false;let prev=start;for(const p of points){if(!amphibianLineOpen(surface,prev,p,id))return false;prev=p;}return true;};
  if(!fromWater&&!toWater){const route=surfaceRoute(surface,from,to,"enemy");return valid(route,from)?route:null;}
  const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.y-b.y);
  const options=lakeShorePortals(id).filter(p=>surfacePointOpen(surface,p.land,"enemy")&&amphibianLineOpen(surface,p.water,p.land,id))
    .sort((a,b)=>distance(from,fromWater?a.water:a.land)+distance(to,toWater?a.water:a.land)-distance(from,fromWater?b.water:b.land)-distance(to,toWater?b.water:b.land)).slice(0,12);
  for(const portal of options){
    const water=lakeRoute(id,fromWater?from:portal.water,toWater?to:portal.water);
    const land=surfaceRoute(surface,fromWater?portal.land:from,toWater?portal.land:to,"enemy");
    if(!water||!land)continue;
    const route=fromWater?[...water,portal.land,...land]:[...land,portal.water,...water];
    if(valid(route,from))return route;
  }
  return null;
}
