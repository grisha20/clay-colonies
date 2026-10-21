import { WALL_CELL_SIZE, type Building, type Vec2 } from "./types";
import { buildingFootprint, crossesBuilding, insideBuilding } from "./buildingGeometry";
import { insideHearth, crossesHearth, outsideHearth } from "./campGeometry";
import { fenceCellCenters } from "./fenceGeometry";
import { isWaterAt, isTerrainBlockedAt, surfaceTerrainRevision } from "./surfaceTerrain";
import { surfaceLineOpen, surfacePointOpen, type SurfaceObstacles } from "./surfaceNavigation";

export function surfaceGeometryKey(surface: SurfaceObstacles): string {
  // Terrain revision: a different world (lakes, mountains) invalidates cached regions.
  return surfaceTerrainRevision()+"#"+surface.buildings.filter(b=>b.stage==="built").map(b=>`${b.id}:${b.type}:${b.colonyId}:${b.pos.x}:${b.pos.y}:${b.gateAxis}:${b.gateSpan}`).join("|");
}
/** Settlement-level connected regions. Build once per geometry/owner; no A*
 * search for every resource/worker pair, and no per-tick resident planner. */
export class SurfaceAccess {
  private width: number;
  private height: number;
  private blocked: Uint8Array;
  private labels: Int32Array;
  private nextLabel = 0;
  private solids: NonNullable<ReturnType<typeof buildingFootprint>>[];
  constructor(private surface: SurfaceObstacles, private owner: string, area?:{center:Vec2;radius:number}) {
    this.width=Math.ceil(surface.width/WALL_CELL_SIZE);this.height=Math.ceil(surface.height/WALL_CELL_SIZE);
    this.blocked=new Uint8Array(this.width*this.height);this.labels=new Int32Array(this.blocked.length);
    this.solids=surface.buildings.map(buildingFootprint).filter((f):f is NonNullable<typeof f>=>!!f);
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++) if((x+.5)*2>=surface.width-1||(y+.5)*2>=surface.height-1||area&&(Math.abs((x+.5)*2-area.center.x)>area.radius||Math.abs((y+.5)*2-area.center.y)>area.radius)||isTerrainBlockedAt((x+.5)*2,(y+.5)*2))this.blocked[y*this.width+x]=1;
    for(const b of surface.buildings)if(b.stage==="built"&&(b.type==="wall"||b.type==="gate"&&b.colonyId!==owner))for(const p of fenceCellCenters(b))this.mark(p.x,p.y);
    for(const f of this.solids)this.cover(f.x-f.rx,f.y-f.ry,f.x+f.rx,f.y+f.ry,(p)=>insideBuilding(p.x,p.y,f));
    for(const c of surface.entrances)this.cover(c.x-3,c.y-2,c.x+3,c.y+2,p=>insideHearth(p.x,p.y,c));
  }
  private mark(x:number,y:number):void {const cx=Math.floor(x/2),cy=Math.floor(y/2);if(cx>=0&&cy>=0&&cx<this.width&&cy<this.height)this.blocked[cy*this.width+cx]=1;}
  private point(id:number):Vec2{return {x:(id%this.width+.5)*2,y:(Math.floor(id/this.width)+.5)*2};}
  private cover(x0:number,y0:number,x1:number,y1:number,inside:(p:Vec2)=>boolean):void {
    for(let y=Math.max(0,Math.floor(y0/2));y<=Math.min(this.height-1,Math.floor(y1/2));y++)for(let x=Math.max(0,Math.floor(x0/2));x<=Math.min(this.width-1,Math.floor(x1/2));x++){const id=y*this.width+x;if(inside(this.point(id)))this.blocked[id]=1;}
  }
  private component(start:number):number {
    if(this.labels[start])return this.labels[start];
    const label=++this.nextLabel,queue=[start];this.labels[start]=label;
    for(let head=0;head<queue.length;head++) {
      const id=queue[head],x=id%this.width,y=Math.floor(id/this.width),p=this.point(id);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=this.width||ny>=this.height)continue;
        const n=ny*this.width+nx;if(this.blocked[n]||this.labels[n])continue;const q=this.point(n);
        if(this.solids.some(f=>crossesBuilding(p,q,f))||this.surface.entrances.some(c=>crossesHearth(p.x,p.y,q.x,q.y,c)))continue;
        this.labels[n]=label;queue.push(n);
      }
    }
    return label;
  }
  private connectors(p:Vec2):number[] {
    const result:number[]=[],cx=Math.floor(p.x/2),cy=Math.floor(p.y/2);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=this.width||y>=this.height)continue;const id=y*this.width+x;
      if(!this.blocked[id]&&surfaceLineOpen(this.surface,p,this.point(id),this.owner))result.push(id);
    }
    return result;
  }
  approach(from:Vec2,target:Vec2,radius=0):Vec2|undefined {
    let origin=from;for(const camp of this.surface.entrances)if(insideHearth(origin.x,origin.y,camp))origin=outsideHearth(origin,camp);
    const starts=this.connectors(origin);if(!starts.length)return undefined;
    const labels=new Set(starts.map(id=>this.component(id)));
    const candidates=[target];
    if(radius>0)for(let i=0;i<16;i++){const angle=i*Math.PI/8;candidates.push({x:target.x+Math.cos(angle)*radius*.9,y:target.y+Math.sin(angle)*radius*.9});}
    candidates.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y));
    for(const p of candidates)if(surfacePointOpen(this.surface,p,this.owner)&&this.connectors(p).some(id=>labels.has(this.labels[id])))return {...p};
    return undefined;
  }
}
