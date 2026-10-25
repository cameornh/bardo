import {resolveSandContacts,bodyDistance,bodyNormal} from '../sand-lab/objects.js';
import {bodyContactPoints,bodyMass,bodyImpulse,inverseInertia,dot,cross,pointVelocity} from '../sand-lab/rigid-contacts.js';
import {shapeRadius,shapeDistance} from '../sand-lab/sand-shape.js';
import {sandAdhesion} from '../sand-lab/sand-material.js';

const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],...Array.from({length:48},(_,i)=>{
 const y=1-2*(i+.5)/48,a=i*2.399963229728653,s=Math.sqrt(1-y*y);return [s*Math.cos(a),y,s*Math.sin(a)];
})];
const samples=new WeakMap();
function surfaceSamples(p){
 const r=shapeRadius(p),aspect=p.aspect||1,old=samples.get(p);
 if(old&&old.r===r&&old.aspect===aspect&&old.cuts===p.cuts)return old.points;
 const points=[],terms=[{offset:[0,0,0],radius:r,aspect},...(p.cuts||[])];
 for(const term of terms)for(const d of directions){
  const q=d.map((v,k)=>term.offset[k]+v*Math.abs(term.radius)*(k===1?(term.aspect||1):1));
  // The boundaries of individual CSG operands are candidates only. Removed
  // portions of those boundaries must never become invisible contact walls.
  if(shapeDistance(p,q.map((v,k)=>v+p.position[k]))<=1e-8)points.push(q);
 }
 samples.set(p,{r,aspect,cuts:p.cuts,points});return points;
}
function sandNormal(p,point,b){
 const e=Math.max(1e-6,Math.min(.003,shapeRadius(p)*.02,b.radius*.02));
 const n=[0,1,2].map(k=>{const a=point.slice(),c=point.slice();a[k]+=e;c[k]-=e;return shapeDistance(p,a)-shapeDistance(p,c);});
 const length=Math.hypot(...n)||1;return n.map(v=>v/length);
}
function contacts(p,b){
 const points=bodyContactPoints(b),hits=[];
 if(b.shape!=='cup'){
  const n=sandNormal(p,b.position,b);points.unshift(b.position.map((v,k)=>v-n[k]*b.radius));
 }
 for(const point of points){const d=shapeDistance(p,point);if(d<.0002)hits.push({point,d,owner:'body',origin:b.position.slice()});}
 // Reverse surface queries catch small carved fragments entirely inside a
 // larger object. They are only needed when object-surface probes miss stock.
 if(!hits.length)for(const local of surfaceSamples(p)){
  const point=local.map((v,k)=>v+p.position[k]),d=bodyDistance(point,b);
  if(d<.0002)hits.push({point,d,owner:'sand',origin:p.position.slice()});
 }
 return hits.sort((a,b)=>a.d-b.d).slice(0,8);
}
function bodyEffectiveMass(b,point,n){
 if(b.held||b.fixed)return 0;
 const arm=point.map((v,k)=>v-b.position[k]);
 return 1/bodyMass(b)+dot(cross(inverseInertia(b,cross(arm,n)),arm),n);
}
function solve(p,b,point,n,depth){
 const relative=pointVelocity(b,point).map((v,k)=>v-p.velocity[k]),vn=dot(relative,n),adhesion=sandAdhesion(p.wet||0,p.memory||0);
 if(p.anchored&&vn<-(.02+adhesion*adhesion*12))p.anchored=false;
 const ip=p.anchored?0:1/Math.max(1e-12,p.mass*2.65),ib=b.held||b.fixed?0:1/bodyMass(b),sum=ip+ib;
 if(!sum)return;
 const impulse=Math.max(0,-vn*(vn<-.1?1.08:1))/Math.max(1e-12,ip+bodyEffectiveMass(b,point,n));
 if(impulse){
  bodyImpulse(b,point,n.map(v=>v*impulse));for(let k=0;k<3;k++)p.velocity[k]-=n[k]*impulse*ip;
  const tangent=relative.map((v,k)=>v-n[k]*vn),speed=Math.hypot(...tangent);
  if(speed>1e-9){const t=tangent.map(v=>v/speed),friction=Math.min(impulse*.5,speed/Math.max(1e-12,ip+bodyEffectiveMass(b,point,t)));
   bodyImpulse(b,point,t.map(v=>-v*friction));for(let k=0;k<3;k++)p.velocity[k]+=t[k]*friction*ip;
  }
 }
 const correction=Math.max(0,depth-1e-5)*.85;
 for(let k=0;k<3;k++){b.position[k]+=n[k]*correction*ib/sum;p.position[k]-=n[k]*correction*ip/sum;}
}

// Live-only narrow phase. Keep the cheap established path for ordinary grains;
// a carved shape uses its actual occupied CSG, never its original solid sphere.
// This is CPU contact work, bounded to nearby bodies and eight contacts/pass.
export function resolveCarvedSandContacts(parcels,bodies,dt,grid=null){
 if(!bodies.length)return {carvedPairs:0,contacts:0};
 const carved=[],ordinary=[];
 for(const p of parcels)(p.cuts?.length?carved:ordinary).push(p);
 resolveSandContacts(ordinary,bodies,dt,grid);
 if(grid&&carved.length)for(let i=0;i<bodies.length;i++)if(bodies[i].shape==='cup')grid.insert(i,bodies[i].position,bodies[i].radius*1.6);
 let pairs=0,solved=0;
 for(const p of carved){
  if(p.held||p.mass<=0)continue;
  const bound=shapeRadius(p)*Math.max(1,p.aspect||1),ids=grid?grid.query(p.position,bound):bodies.map((_,i)=>i);
  for(const i of ids){const b=bodies[i];if(Math.hypot(...p.position.map((v,k)=>v-b.position[k]))>bound+b.radius*1.6)continue;pairs++;
   // shapeDistance is conservative and 1-Lipschitz. An object whose whole
   // support fits in the void needs no surface probing at all.
   if(shapeDistance(p,b.position)>b.radius*(b.shape==='cup'?1.6:1)+.0002)continue;
   for(let pass=0;pass<3;pass++){
    const hits=contacts(p,b);if(!hits.length)break;
    for(const hit of hits){
     const owner=hit.owner==='body'?b:p,point=hit.point.map((v,k)=>v+owner.position[k]-hit.origin[k]);
     const d=hit.owner==='body'?shapeDistance(p,point):bodyDistance(point,b);if(d>=.0002)continue;
     const n=hit.owner==='body'?sandNormal(p,point,b):bodyNormal(point,b).map(v=>-v);
     solve(p,b,point,n,Math.max(0,-d));solved++;
    }
   }
   if(grid)grid.insert(i,b.position,b.radius*1.6);
  }
 }
 return {carvedPairs:pairs,contacts:solved};
}
