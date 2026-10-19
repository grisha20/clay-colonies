import assert from "node:assert/strict";
import { FootGait } from "../../../client/src/render/surface/footGait";
import { buildFootSkin } from "../../../client/src/render/surface/footSkin";
import { FootprintTrail } from "../../../client/src/render/surface/footprints";
import { MotionTracker, WALK_PHASE_PER_UNIT } from "../../../client/src/render/surface/motion";
let passed=0;
function check(name:string,run:()=>void){run();passed++;console.log(`PASS  ${name}`);}

check("Actual stance stays at one WORLD point, both feet, all headings/sizes/FPS",()=>{
  for(const fps of [30,60])for(const speed of [2.2,10.5,13])for(const size of [1,.53])for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,.7]){
    const gait=new FootGait(),pos={x:120,y:240},dir={x:Math.cos(angle),y:Math.sin(angle)},stride=Math.PI*2/WALK_PHASE_PER_UNIT*size;
    let phase=.31, previous:any[]=[];const contacts=[0,0],landings=[0,0];
    for(let frame=0;frame<fps*4;frame++){
      pos.x+=dir.x*speed/fps;pos.y+=dir.y*speed/fps;phase+=speed/fps*WALK_PHASE_PER_UNIT/size;
      gait.update(pos,dir,phase,stride,size,true,1/fps);
      const feet=gait.feet.map(f=>({...f,x:f.x+pos.x,y:f.y+pos.y}));
      feet.forEach((f,i)=>{
        const old=previous[i];assert.ok(Number.isFinite(f.x+f.y+f.lift));
        if(f.planted){assert.equal(f.lift,0);if(old?.planted&&old.stamp===f.stamp){assert.ok(Math.hypot(f.x-old.x,f.y-old.y)<1e-8);contacts[i]++;}}
        if(old&&f.stamp>old.stamp)landings[i]++;
      });previous=feet;
    }
    assert.ok(contacts.every(x=>x>5));assert.ok(landings.every(x=>x>=2));
  }
});
check("Turning cannot drag the supporting foot sideways",()=>{
  const gait=new FootGait(),pos={x:0,y:0};let phase=0,previous:any[]=[];
  for(let i=0;i<180;i++){
    const dir={x:Math.cos(i*.012),y:Math.sin(i*.012)};pos.x+=dir.x*.1;pos.y+=dir.y*.1;phase+=.21;
    gait.update(pos,dir,phase,Math.PI*2/2.1,1,true,1/60);
    const feet=gait.feet.map(f=>({...f,x:f.x+pos.x,y:f.y+pos.y}));
    feet.forEach((f,j)=>{const old=previous[j];if(f.planted&&old?.planted&&f.stamp===old.stamp)assert.ok(Math.hypot(f.x-old.x,f.y-old.y)<1e-8);});previous=feet;
  }
});
check("The real motion tracker preserves contact after shrinking, pauses and discards stale feet on teleport",()=>{
  const ant:any={id:"feet-test",colonyId:"one",pos:{x:120,y:240},heading:{x:1,y:0},job:"forage",carrying:0,dissolved:.6};
  const world:any={tick:0,ants:[ant],enemies:[],session:{status:"playing",speed:1},surface:{resourceNodes:[],buildings:[]},colonies:[{id:"one",colony:{}}]};
  const motion=new MotionTracker();let old:any[]=[];
  for(let i=0;i<150;i++){
    ant.pos.x+=10.5/30;world.tick++;motion.update(world,1000+i*1000/30);
    const feet=motion.resident(ant).feet?.map(f=>({...f,x:ant.pos.x+f.x,y:ant.pos.y+f.y}))??[];
    feet.forEach((f,j)=>{if(f.planted&&old[j]?.planted&&f.stamp===old[j].stamp)assert.ok(Math.hypot(f.x-old[j].x,f.y-old[j].y)<1e-8);});old=feet;
  }
  world.session.speed=0;const paused=structuredClone(motion.resident(ant).feet);motion.update(world,6100);assert.deepEqual(motion.resident(ant).feet,paused);
  world.session.speed=1;ant.pos.x+=200;motion.update(world,6200);assert.equal(motion.resident(ant).feet,undefined);
});
check("Stopping sets feet down one at a time; pause is exact and restarting is finite",()=>{
  const gait=new FootGait(),pos={x:0,y:0},dir={x:1,y:0};let phase=0;
  for(let i=0;i<50;i++){pos.x+=.15;phase+=.315;gait.update(pos,dir,phase,3,1,true,1/60);}
  const paused=structuredClone(gait.feet);gait.update(pos,dir,phase,3,1,false,0);assert.deepEqual(gait.feet,paused);
  for(let i=0;i<90;i++)gait.update(pos,dir,phase,3,1,false,1/60);
  assert.ok(gait.feet.every(f=>f.planted&&f.lift===0));
  const settled=structuredClone(gait.feet);for(let i=0;i<20;i++)gait.update(pos,dir,phase,3,1,false,1/60);assert.deepEqual(gait.feet,settled);
  pos.x+=.15;gait.update(pos,dir,phase+.315,3,1,true,1/60);assert.ok(gait.feet.every(f=>Math.hypot(f.x,f.y)<4));
});
check("Render geometry keeps rigid toes, an unchanged torso and independent leg triangles",()=>{
  for(const look of ["front","back","side"] as const)for(const facing of [-1,1])for(const carrying of [false,true]){
    const edge=Array.from({length:160},(_,x)=>({x,y:look==="side"&&(facing>0?x>100:x<60)?218:258}));
    const skin=buildFootSkin(160,260,edge,258,look,facing,carrying);
    assert.equal(skin.rest.length/2,85);assert.equal(skin.anchors.length,2);
    for(let leg=0;leg<2;leg++){
      const v=skin.anchors[leg],n=v*2;assert.ok(v!==undefined);assert.equal(skin.weights[n+leg],1);assert.equal(skin.weights[n+1-leg],0);
      for(const index of skin.patches[leg])assert.equal(Math.floor(index/35),leg);
      const target={x:skin.feet[leg].x+(leg?70:-70),y:skin.feet[leg].y+(leg?-20:3)};
      const actual={x:skin.rest[n]+(target.x-skin.feet[leg].x)*skin.weights[n+leg],y:skin.rest[n+1]+(target.y-skin.feet[leg].y)*skin.weights[n+leg]};
      assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<.0001);
    }
    for(let v=70;v<85;v++){assert.equal(skin.weights[v*2],0);assert.equal(skin.weights[v*2+1],0);}
    assert.ok([...skin.uvs].every(x=>x>=0&&x<=1));
    if(look==="side"){
      const far=skin.feet[0].y<skin.feet[1].y?0:1,indices=skin.patches[far];
      for(let i=0;i<indices.length;i+=3){
        const p=indices.slice(i,i+3).map(v=>({x:skin.rest[v*2],y:skin.rest[v*2+1]}));
        if(p.every(v=>v.y>=skin.feet[far].y+.01))assert.ok(Math.abs((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[2].x-p[0].x)*(p[1].y-p[0].y))<.001,"far leg must not steal a wedge below its sole");
      }
    }
  }
});
check("Footprints use the landing point and stay limited to FIVE per resident",()=>{
  const trail=new FootprintTrail();
  for(let stamp=0;stamp<12;stamp++)for(let leg=0;leg<2;leg++)trail.plant("worker",leg,stamp,leg,0,stamp,1,stamp*.1,true);
  assert.equal(trail.marks.length,5);assert.equal(trail.marks.at(-1)!.x,11);assert.equal(trail.marks.at(-1)!.y,1);
  const count=trail.marks.length;trail.plant("worker",1,999,999,0,11,1,2,true);assert.equal(trail.marks.length,count);
});
console.log(`${passed} foot contact scenarios passed.`);
