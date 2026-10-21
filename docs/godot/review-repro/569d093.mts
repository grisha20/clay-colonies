// Diagnostic reproductions for review 569d093; findings print even though the command exits 0.
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const state=path.resolve('tmp/qa/review-569d093');
mkdirSync(state,{recursive:true});
process.env.SNAPSHOT_FILE=path.join(state,'snapshot.json');
process.env.GENOME_FILE=path.join(state,'genome-a.json');
process.env.GENOME_FILE_B=path.join(state,'genome-b.json');
process.env.SPIDER_GENOME_FILE=path.join(state,'spider-genome.json');
const {loadGenome}=await import('../../../server/src/ai/genome.ts');
const {loadSpiderGenome}=await import('../../../server/src/ai/spiderGenome.ts');
const {createWorld,toSnapshot,worldFromSnapshot}=await import('../../../server/src/sim/world.ts');
const {placePointBuilding,completeBuilding}=await import('../../../server/src/sim/building.ts');
const {updateKilns}=await import('../../../server/src/sim/kiln.ts');
const {buildingServicePoint}=await import('../../../shared/buildingGeometry.ts');
const {updateObjectives}=await import('../../../server/src/sim/objectives.ts');
const {CONFIG}=await import('../../../server/src/config.ts');
const g=await loadGenome(), sp=await loadSpiderGenome(), gb=await loadGenome(process.env.GENOME_FILE_B);
const w=createWorld(g,sp,gb);
w.enemies=[];
const saved=toSnapshot(w);
delete saved.surface.springs;
if (saved.surface.terrain) delete saved.surface.terrain.springs;
const old=worldFromSnapshot(saved,g,sp,gb);
updateObjectives(old);
console.log('OLD_SAVE_OBJECTIVE', JSON.stringify({springs:old.surface.springs?.length??0,goal:old.objectives.find(x=>x.id==='spring-1')}));
const rt=w.colonies[0], c=rt.colony, camp=rt.surfaceEntrance;
c.autoManage=false;c.wood=50;c.alarm=false;c.firingPaused=false;w.weather.state='clear';
let kiln;
for(let r=14;r<40&&!kiln;r+=4)for(let i=0;i<16&&!kiln;i++){
 const a=i*Math.PI/8;
 if(placePointBuilding(w,0,'kiln',Math.round(camp.x+Math.cos(a)*r),Math.round(camp.y+Math.sin(a)*r))){kiln=w.surface.buildings.at(-1);completeBuilding(w,kiln);}
}
if(!kiln)throw Error('No kiln site');
for(const ant of rt.ants){ant.job='forage';ant.carrying=0;ant.fired=false;}
updateKilns(w);
const called=rt.ants.find(a=>a.kilnId===kiln.id);
if(!called)throw Error('No resident called');
called.pos={...buildingServicePoint(kiln)};
updateKilns(w);
const before=kiln.firing?.progress;
c.firingPaused=true;
for(let i=0;i<CONFIG.kilnFiringTicks;i++)updateKilns(w);
console.log('PAUSED_KILN',JSON.stringify({paused:c.firingPaused,before,fired:called.fired,firedTotal:c.firedTotal}));
const {updateSettlementAI}=await import('../../../server/src/sim/settlementAI.ts');
const alarmWorld=createWorld(g,sp,gb);
const player=alarmWorld.colonies[0];player.colony.autoManage=true;player.colony.alarm=false;
const foe={...alarmWorld.enemies[0],type:'spider',hp:50,pos:{x:player.surfaceEntrance.x+6,y:player.surfaceEntrance.y}};
alarmWorld.enemies=[foe];alarmWorld.tick=100;updateSettlementAI(alarmWorld);
const raised=player.colony.alarm;
const alarmSave=JSON.parse(JSON.stringify(toSnapshot(alarmWorld)));
const reloaded=worldFromSnapshot(alarmSave,g,sp,gb);reloaded.enemies=[];reloaded.tick=200;updateSettlementAI(reloaded);
alarmWorld.enemies=[];alarmWorld.tick=200;updateSettlementAI(alarmWorld);
console.log('ALARM_SAVE_RELOAD',JSON.stringify({raised,beforeReloadClears:!player.colony.alarm,afterReloadAlarm:reloaded.colonies[0].colony.alarm,autoManage:reloaded.colonies[0].colony.autoManage,threats:reloaded.enemies.length}));

