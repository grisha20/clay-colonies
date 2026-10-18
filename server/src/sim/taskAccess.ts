import type { Colony, Vec2 } from "../../../shared/types";
import { SurfaceAccess, surfaceGeometryKey } from "../../../shared/surfaceAccess";
import type { World } from "./world";
const caches=new WeakMap<Colony,{key:string;access:SurfaceAccess;points:Map<string,Vec2|undefined>}>();
export function taskApproach(world:World,target:Vec2,radius=0):Vec2|undefined {
  const key=surfaceGeometryKey(world.surface);let cache=caches.get(world.colony);
  if(!cache||cache.key!==key){cache={key,access:new SurfaceAccess(world.surface,world.colony.id),points:new Map()};caches.set(world.colony,cache);}
  const query=`${target.x}:${target.y}:${radius}`;
  if(!cache.points.has(query))cache.points.set(query,cache.access.approach(world.surface.entrance,target,radius));
  return cache.points.get(query);
}
