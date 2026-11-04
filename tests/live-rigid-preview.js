import {SandBed} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {bodyContactPoints} from '../src/sand-lab/rigid-contacts.js';
import {rotate} from '../src/sand-lab/water-lab-model.js';
import {shapeDistance} from '../src/sand-lab/sand-shape.js';
import {LiveRigidPhysics} from '../src/rtx-sand-lab/rigid-physics.js';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),result=document.querySelector('#result');
const at=p=>[(p[0]+2)*150,420-(p[1]+.8)*100];
let live,reference,frame=0,running=false,background;
function make(live){
 const sand=new SandBed(33);sand.base.fill(-.7);sand.mass.fill(0);
 sand.parcels=[{id:1,position:[0,.7,0],velocity:[0,0,0],mass:.56*4*Math.PI/3,packing:.56,shapeRadius:1,wet:1,memory:1,anchored:true,cuts:[{offset:[0,.7,0],radius:.8},...Array.from({length:3},(_,i)=>({offset:[3+i,0,0],radius:.1}))]}];sand.update();
 return {sand,balls:[makeBody('rock','sphere',.18,[.1,2.4,0]),makeBody('rock','cup',.2,[2,.3,0])],optimizations:{},spec:{scale:10},spacing:.03,wind:0,air:{},waterAt:()=>({density:0,velocity:[0,0,0]}),positions:new Float32Array(),fluidIndex:{bins:new Map()},indexFluid(){},rigidContacts:live?new LiveRigidPhysics():null};
}
function backdrop(){
 background=document.createElement('canvas');background.width=900;background.height=450;const g=background.getContext('2d');g.fillStyle='#22343e';g.fillRect(0,0,900,450);g.fillStyle='#a78c61';
 const p=live.sand.parcels[0];for(let y=0;y<450;y+=2)for(let x=0;x<900;x+=2){const q=[x/150-2,(420-y)/100-.8,0];if(q[1]<-.7||shapeDistance(p,q)<0)g.fillRect(x,y,2,2);}
}
function draw(){
 ctx.drawImage(background,0,0);const entry=live.rigidContacts.terrainCache.valid(live.sand.parcels[0]);ctx.strokeStyle='#b9c0ba';ctx.lineWidth=1;
 if(entry)for(const t of entry.mesh.triangles){const points=[];for(const [a,b] of [[t.a,t.b],[t.b,t.c],[t.c,t.a]])if((a[2]<0)!==(b[2]<0)){const f=a[2]/(a[2]-b[2]);points.push(at(a.map((v,k)=>v+(b[k]-v)*f+live.sand.parcels[0].position[k])));}if(points.length===2){ctx.beginPath();ctx.moveTo(...points[0]);ctx.lineTo(...points[1]);ctx.stroke();}}
 for(const [lab,color] of [[reference,'#ffdb80'],[live,'#78deef']])for(const b of lab.balls){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
  if(b.shape==='cup'){const p=[[-1,-1.16],[1,-1.16],[1,1],[.68,1],[.68,-.84],[-.68,-.84],[-.68,1],[-1,1]].map(([x,y])=>at(rotate([x*b.radius,y*b.radius,0],b.tilt,b.spin,false,b.pitch).map((v,k)=>v+b.position[k])));ctx.moveTo(...p[0]);for(const q of p.slice(1))ctx.lineTo(...q);ctx.closePath();}
  else{const p=at(b.position);ctx.ellipse(...p,b.radius*150,b.radius*100,0,0,Math.PI*2);}ctx.stroke();
 }
 const r=live.rigidContacts;
 const report={running,simulatedSeconds:frame/120,backend:r.terrainCache.backend,readyMeshes:[...r.terrainCache.entries.values()].filter(e=>e.mesh).length,minimumClearance:Math.min(...live.balls.flatMap(b=>bodyContactPoints(b).map(p=>live.sand.distance(p)))),mesh:r.terrainCache.stats,solver:r.stats,centers:live.balls.map(b=>b.position)};
 window.collisionReport=report;result.textContent=JSON.stringify(report,null,2);
}
function reset(){live?.rigidContacts.dispose();live=make(true);reference=make(false);frame=0;running=false;live.rigidContacts.begin(live,.3);backdrop();draw();}
document.querySelector('#reset').onclick=reset;
document.querySelector('#run').onclick=()=>{frame=0;running=true;};
document.querySelector('#edit').onclick=()=>{for(const lab of [live,reference]){lab.sand.parcels[0].cuts[0].radius+=.15;lab.sand.update();}backdrop();frame=0;running=true;};
let last=0,drawKey='';function tick(t){requestAnimationFrame(tick);if(t-last<1000/60)return;last=t;if(running){for(let i=0;i<4&&frame<480;i++,frame++){SandLab.prototype.stepBodies.call(reference,1/120);SandLab.prototype.stepBodies.call(live,1/120);}if(frame>=480)running=false;}
 const key=[frame,live.rigidContacts.terrainCache.stats.built].join(':');if(key!==drawKey){draw();drawKey=key;}}
window.addEventListener('pagehide',()=>live.rigidContacts.dispose());reset();requestAnimationFrame(tick);
