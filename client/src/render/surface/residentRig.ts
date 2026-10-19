import { Mesh, MeshGeometry, type Sprite } from "pixi.js";
import type { Ant } from "../../../../shared/types";
import type { SpritePool } from "../types";
import type { CharacterArt } from "./characterArt";
import type { BodyMount } from "./attachment";
import { actorMotion } from "./motion";
import { residentFeet } from "./residentLayout";
import { buildFootSkin, type FootSkin } from "./footSkin";

type Skin = FootSkin;
const skins = new WeakMap<CharacterArt, Skin>();
const meshes = new WeakMap<Sprite, { mesh: Mesh; art?: CharacterArt; order?: number; ant?: Ant }>();

function skinFor(art: CharacterArt, ant: Ant): Skin {
  const cached = skins.get(art); if (cached) return cached;
  const { look, facing } = actorMotion.resident(ant), w = art.texture.width, h = art.texture.height;
  const skin = buildFootSkin(w,h,art.ground!.edge,art.ground!.bottom,look,facing,ant.carrying>0);
  skins.set(art,skin); return skin;
}

export function hideResidentRigs(pool: SpritePool): void {
  for (const sprite of pool.sprites) { const rig = meshes.get(sprite); if (rig) rig.mesh.visible = false; }
}

/** 85 vertices, batched with normal sprites. Original PNG/UV art stays intact. */
export function drawResidentRig(body: Sprite, art: CharacterArt, ant: Ant, mount: BodyMount, cell: number): void {
  const feet = residentFeet(ant,cell); if (!feet) return;
  let view=meshes.get(body);
  if (!view) {
    const geometry = new MeshGeometry({positions:new Float32Array(170),uvs:new Float32Array(170),indices:new Uint32Array(360)});
    const mesh=new Mesh({texture:art.texture,geometry});mesh.label="resident_rig";
    body.parent!.addChild(mesh); view={mesh}; meshes.set(body,view);
    body.on("destroyed",()=>{ if (!mesh.destroyed) { const geometry=mesh.geometry; mesh.destroy(); geometry.destroy(); } });
  }
  const skin=skinFor(art,ant), mesh=view.mesh;
  view.ant=ant;
  if(view.art!==art){mesh.texture=art.texture;mesh.geometry.getBuffer("aUV").data.set(skin.uvs);mesh.geometry.getBuffer("aUV").update();view.art=art;view.order=undefined;}
  const order = feet[0].y > feet[1].y ? 0 : 1;
  if(view.order!==order){mesh.geometry.indexBuffer.data=new Uint32Array([...skin.patches[1-order],...skin.patches[order],...skin.patches[2]]);mesh.geometry.indexBuffer.update();view.order=order;}
  mesh.position.copyFrom(body.position);mesh.scale.copyFrom(body.scale);mesh.rotation=body.rotation;
  mesh.pivot.set(art.anchorX*skin.width,(art.anchorY??1)*skin.height);
  mesh.zIndex=body.zIndex;mesh.tint=body.tint;mesh.alpha=body.alpha;mesh.visible=true;body.visible=false;
  const c=Math.cos(body.rotation),s=Math.sin(body.rotation);
  const shifts=feet.map((f,i)=>{
    const dx=f.x-mount.x,dy=f.y-f.lift-mount.y;
    return {x:(dx*c+dy*s)/body.scale.x+mesh.pivot.x-skin.feet[i].x,y:(dy*c-dx*s)/body.scale.y+mesh.pivot.y-skin.feet[i].y};
  });
  const buffer=mesh.geometry.getBuffer("aPosition"), vertices=buffer.data;
  for(let i=0;i<vertices.length;i+=2){
    const a=skin.weights[i],b=skin.weights[i+1];
    vertices[i]=skin.rest[i]+shifts[0].x*a+shifts[1].x*b;
    vertices[i+1]=skin.rest[i+1]+shifts[0].y*a+shifts[1].y*b;
  }
  buffer.update();
}

/** QA reads the rendered vertices, not the intended contact targets. */
export function residentRigContacts(pool: SpritePool) {
  return pool.sprites.slice(0,pool.cursor).flatMap(body=>{
    const view=meshes.get(body);if(!view?.mesh.visible||!view.ant||!view.art)return [];
    const {mesh,ant,art}=view,skin=skinFor(art,ant),pose=actorMotion.resident(ant),c=Math.cos(mesh.rotation),s=Math.sin(mesh.rotation);
    return skin.anchors.map((vertex,i)=>{
      const n=vertex*2,positions=mesh.geometry.getBuffer("aPosition").data;
      const x=(positions[n]-mesh.pivot.x)*mesh.scale.x,y=(positions[n+1]-mesh.pivot.y)*mesh.scale.y;
      return {id:`${ant.id}:${i}`,x:mesh.x+x*c-y*s,y:mesh.y+x*s+y*c,rootX:ant.pos.x,rootY:ant.pos.y,planted:pose.feet![i].planted,stamp:pose.feet![i].stamp};
    });
  });
}
