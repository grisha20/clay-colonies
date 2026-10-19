import type { Vec2 } from "../../../../shared/types";

export type FootSkin = { width: number; height: number; hip: number; feet: [Vec2, Vec2]; rest: Float32Array; weights: Float32Array; uvs: Float32Array; patches: number[][]; anchors: number[] };
export const legProgress = (y: number, hip: number, sole: number, height: number) => Math.max(0, Math.min(1, (y - hip) / Math.max(1, sole - height * .055 - hip)));

/** Disconnected leg patches cannot fold each other's triangles when crossing. */
export function buildFootSkin(w: number, h: number, edge: Vec2[], bottom: number, look: "front" | "back" | "side", facing: number, carried: boolean): FootSkin {
  const xs = look === "side" ? [.4, carried ? .66 : .72] : [.28, .72];
  if (look === "side" && facing < 0) { xs[0] = carried ? .33 : .28; xs[1] = .6; }
  const feet = xs.map(u => {
    const x = u * w, samples = edge.filter(p => Math.abs(p.x - x) < w * .025);
    return { x, y: Math.max(h * .8, samples.length ? Math.max(...samples.map(p => p.y)) : bottom) };
  }) as [Vec2, Vec2];
  if (look === "back") feet.reverse();
  const skin: FootSkin = { width:w, height:h, hip:h*.72, feet, rest:new Float32Array(170), weights:new Float32Array(170), uvs:new Float32Array(170), patches:[], anchors:[] };
  let vertex=0;
  const near=feet[0].y>feet[1].y?0:1, far=feet[1-near];
  const cut=(y:number,belowSole:boolean)=>{
    if(look!=="side")return w*.5;
    // The far leg stops at its own sole. A tapered cut below it steals a
    // wedge of the near foot and turns that texture into a moving sliver.
    if(belowSole)return facing>0?w:0;
    return w*(facing>0?.64:.36);
  };
  for(const leg of [0,1,-1]){
    const first=vertex,indices:number[]=[];
    const rows=leg<0?[0,.45*h,skin.hip]:[skin.hip,.77*h,far.y,far.y,.93*h,feet[near].y,h].sort((a,b)=>a-b);
    rows.forEach((y,j)=>{
      const belowSole=y>far.y||(y===far.y&&j>=3);
      const left=leg<0||feet[leg].x<feet[1-leg].x?0:cut(y,belowSole);
      const right=leg<0||feet[leg].x>feet[1-leg].x?w:cut(y,belowSole);
      const footX=leg<0?w*.5:Math.max(left,Math.min(right,feet[leg].x));
      const columns=[left,left+(right-left)*.25,footX,left+(right-left)*.75,right].sort((a,b)=>a-b);
      columns.forEach((x,i)=>{
        const n=vertex*2;skin.rest[n]=x;skin.rest[n+1]=y;skin.uvs[n]=x/w;skin.uvs[n+1]=y/h;
        if(leg>=0){
          skin.weights[n+leg]=legProgress(y,skin.hip,feet[leg].y,h);
          if(Math.abs(x-feet[leg].x)<.01&&Math.abs(y-feet[leg].y)<.01)skin.anchors[leg]=vertex;
        }
        if(j<rows.length-1&&i<4){const a=first+j*5+i;indices.push(a,a+1,a+5,a+1,a+6,a+5);}
        vertex++;
      });
    });
    skin.patches.push(indices);
  }
  return skin;
}
