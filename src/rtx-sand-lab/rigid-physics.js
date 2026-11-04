import {rotate} from '../sand-lab/water-lab-model.js';
import {bodyDistance,bodyNormal,bodySupport} from '../sand-lab/objects.js';
import {bodyContactPoints,solveContact} from '../sand-lab/rigid-contacts.js';
import {BoundsGrid} from '../sand-lab/spatial-bounds.js';
import {TerrainCollider} from './terrain-collider.js';
const pose=b=>[...b.position,b.tilt||0,b.pitch||0,b.spin||0,b.radius,b.shape];
const same=(a,b)=>a?.length===b.length&&a.every((v,k)=>v===b[k]);
const moved=(a,b,r)=>!a||a.slice(0,3).some((v,k)=>Math.abs(v-b[k])>r*.015)||a.slice(3,6).some((v,k)=>Math.abs(v-b[k+3])>.015)||a[6]!==b[6]||a[7]!==b[7];
const localSamples=new Map();
function points(b,indices=null){
 let local=localSamples.get(b.shape);if(!local){local=bodyContactPoints({...b,position:[0,0,0],radius:1,tilt:0,spin:0,pitch:0});localSamples.set(b.shape,local);}
 return (indices||local.map((_,i)=>i)).map(i=>({i,p:rotate(local[i].map(v=>v*b.radius),b.tilt,b.spin,false,b.pitch).map((v,k)=>v+b.position[k])}));
}
export class LiveRigidPhysics{
 constructor(options={}){this.terrainCache=new TerrainCollider(options);this.states=new WeakMap();this.pairCache=new WeakMap();this.grid=new BoundsGrid();this.stats={};}
 state(b){let s=this.states.get(b);if(!s){s={quiet:0,sleep:false};this.states.set(b,s);}return s;}
 wake(b){const s=this.state(b);s.sleep=false;s.quiet=0;}
 begin(lab,dt){
  if(this.bed!==lab.sand){this.states=new WeakMap();this.pairCache=new WeakMap();this.bed=lab.sand;}
  this.lab=lab;this.dt=dt;this.flags=lab.optimizations||{};this.links=[];this.stats={testedPairs:0,contacts:0,terrainProbes:0,reusedContacts:0,sleeping:0};
  this.terrainCache.begin(lab.sand,lab.balls.filter(b=>!b.fixed&&!b.held),dt,this.flags.collisionMesh!==false);
  for(const b of lab.balls){const s=this.state(b);s.support=false;if(b.fixed||b.held){this.wake(b);s.field=null;continue;}
   const field=this.terrainCache.forBody(b);s.field=field;
   if(this.flags.rigidSleep===false||b.held||b.fixed||!same(s.pose,pose(b))||!same(s.velocity,[...b.velocity,...b.omega])||s.terrainToken!==field.token||s.wind!==lab.wind||lab.jet)this.wake(b);
   if(s.sleep){
    // Sleeping saves contact/rigid work, not environmental responsiveness.
    // Check the full shell so a wave reaching one side wakes a resting cup.
    const wet=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(axis=>lab.waterAt(b.position.map((v,k)=>v+axis[k]*(bodySupport(b,axis)+lab.spacing*.35))).density>.01)
     ||b.shape==='cup'&&[0,-.75,.75].some(y=>lab.waterAt(rotate([0,y*b.radius,0],b.tilt,b.spin,false,b.pitch).map((v,k)=>v+b.position[k])).density>.01);
    if(wet)this.wake(b);else this.stats.sleeping++;
   }
  }
  const alive=new Set(lab.balls);for(const b of lab.balls){const s=this.state(b);if(s.sleep&&s.island?.some(peer=>!alive.has(peer)||!this.sleeping(peer)))for(const peer of s.island)this.wake(peer);}
 }
 sleeping(b){return this.state(b).sleep;}
 terrain(b,dt){
  if(b.fixed||b.held||this.sleeping(b))return 0;
  const s=this.state(b);if(!s.field?.valid())s.field=this.terrainCache.forBody(b);let field=s.field;
  if(field.plane&&!this.lab.sand.dirty){
   const {normal:n,offset}=field.plane;let maximum=0;
   const offsets=[];
   if(b.shape==='cup'){
    const local=rotate(n,b.tilt,b.spin,true,b.pitch),angle=Math.atan2(local[2],local[0]);
    // A parallel base/rim has a centred resultant. Applying its symmetric
    // points sequentially introduces torque and makes an upright cup walk.
    if(Math.hypot(local[0],local[2])<1e-5)offsets.push(rotate([0,(local[1]>0?-1.16:1)*b.radius,0],b.tilt,b.spin,false,b.pitch));
    else for(const y of [-1.16,1])for(let i=0;i<4;i++){const a=angle+i*Math.PI/2;offsets.push(rotate([Math.cos(a)*b.radius,y*b.radius,Math.sin(a)*b.radius],b.tilt,b.spin,false,b.pitch));}
   }else offsets.push(n.map(v=>-v*b.radius));
   for(let i=0;i<5;i++){let found=false;for(const offsetPoint of offsets){const p=b.position.map((v,k)=>v+offsetPoint[k]),depth=offset-p.reduce((v,q,k)=>v+q*n[k],0);this.stats.terrainProbes++;
    if(depth<-.0002)continue;found=true;s.support=n[1]>.5;maximum=Math.max(maximum,depth);solveContact(b,null,p,n,Math.max(0,depth),dt);
   }if(!found)break;}return maximum;
  }
  if(field.distance(b.position)>b.radius*1.6)return 0;
  let maximum=0;const current=pose(b),cache=s.contacts;
  const reuse=this.flags.rigidReuse!==false&&cache&&cache.token===field.token&&!moved(cache.pose,current,b.radius)&&cache.age<4&&cache.ids.length;
  let ids=reuse?cache.ids:null;if(reuse){cache.age++;this.stats.reusedContacts++;}
  const retained=new Set();
  for(let iteration=0;iteration<5;iteration++){
   if(!field.valid())field=s.field=this.terrainCache.forBody(b);
   const origin=b.position.slice(),samples=points(b,ids);
   if(b.shape!=='cup'){const n=field.normal(b.position);samples.unshift({i:-1,p:b.position.map((v,k)=>v-n[k]*b.radius)});}
   this.stats.terrainProbes+=samples.length;
   let hits=samples.map(q=>({...q,d:field.distance(q.p)})).filter(q=>q.d<.0002).sort((a,b)=>a.d-b.d).slice(0,12);
   if(!hits.length){if(ids){ids=null;continue;}break;}
   for(const hit of hits){const p=hit.p.map((v,k)=>v+b.position[k]-origin[k]),d=field.exact(p);if(d>.0002)continue;
    const n=field.normal(p);if(n[1]>.5)s.support=true;maximum=Math.max(maximum,-d);if(hit.i>=0)retained.add(hit.i);
    solveContact(b,null,p,n,Math.max(0,-d),dt);
   }
  }
  if(!reuse)s.contacts={ids:[...retained],pose:pose(b),token:field.token,age:0};
  return maximum;
 }
 pairState(a,b){let m=this.pairCache.get(a);if(!m){m=new WeakMap();this.pairCache.set(a,m);}let p=m.get(b);if(!p){p={age:0};m.set(b,p);}return p;}
 narrow(a,b,dt){
  const delta=a.position.map((v,k)=>v-b.position[k]),d=Math.hypot(...delta);
  if(d>(a.radius+b.radius)*1.6)return 0;
  if(a.shape!=='cup'&&b.shape!=='cup'){
   const depth=a.radius+b.radius-d;if(depth<=0)return 0;const n=d>1e-12?delta.map(v=>v/d):[1,0,0];
   solveContact(a,b,a.position.map((v,k)=>v-n[k]*(a.radius-depth*.5)),n,depth,dt);this.links.push({a,b,normal:n});return 1;
  }
  if(a.shape===b.shape&&Math.abs(a.radius-b.radius)<a.radius*.001&&d<Math.min(a.radius,b.radius)*.001)solveContact(a,b,a.position.slice(),[1,0,0],(bodySupport(a,[-1,0,0])+bodySupport(b,[1,0,0])+.0001)/.85,dt);
  let count=0;
  for(const [first,other] of [[a,b],[b,a]]){
   const cache=this.pairState(first,other),pa=pose(first),pb=pose(other),reuse=this.flags.rigidReuse!==false&&cache.ids?.length&&cache.age<4&&!moved(cache.a,pa,first.radius)&&!moved(cache.b,pb,other.radius),origin=first.position.slice();
   const sample=ids=>{const list=points(first,ids);if(first.shape!=='cup'){const n=bodyNormal(first.position,other);list.unshift({i:-1,p:first.position.map((v,k)=>v-n[k]*first.radius)});}return list.map(q=>({...q,d:bodyDistance(q.p,other)})).filter(q=>q.d<0).sort((a,b)=>a.d-b.d).slice(0,8);};
   let hits=sample(reuse?cache.ids:null);if(reuse&&!hits.length)hits=sample(null);
   if(reuse){cache.age++;this.stats.reusedContacts++;}else Object.assign(cache,{ids:hits.filter(q=>q.i>=0).map(q=>q.i),a:pa,b:pb,age:0});
   for(const hit of hits){const p=hit.p.map((v,k)=>v+first.position[k]-origin[k]),depth=-bodyDistance(p,other);if(depth<=0)continue;
    const n=bodyNormal(p,other);solveContact(first,other,p,n,depth,dt);this.links.push({a:first,b:other,normal:n});count++;
   }
  }return count;
 }
 pairs(bodies,dt){
  let tested=0,contacts=0;const broad=this.flags.rigidBroadphase!==false;
  if(broad)this.grid.build(bodies,b=>b.radius*1.6);
  const encountered=new Set();
  for(let iteration=0;iteration<4;iteration++)for(let i=0;i<bodies.length;i++){
   const a=bodies[i];let ids=broad?this.grid.query(a.position,a.radius*1.6):bodies.map((_,j)=>j),last=i;
   while(true){const j=ids.find(j=>j>last);if(j===undefined)break;last=j;const b=bodies[j];
    if((a.fixed||a.held)&&(b.fixed||b.held)||(a.fixed||this.sleeping(a))&&(b.fixed||this.sleeping(b)))continue;
    if(Math.hypot(...a.position.map((v,k)=>v-b.position[k]))>(a.radius+b.radius)*1.6)continue;
    tested++;const count=this.narrow(a,b,dt);if(!count)continue;contacts+=count;encountered.add(`${i}:${j}`);
    if(this.sleeping(a))this.wake(a);if(this.sleeping(b))this.wake(b);
    if(broad){this.grid.insert(i,a.position,a.radius*1.6);this.grid.insert(j,b.position,b.radius*1.6);ids=this.grid.query(a.position,a.radius*1.6);}
   }
  }
  // Retain the established recovery for invalid deeply interlocked spawns.
  // Only actual colliding cup pairs need this expensive check.
  for(const key of encountered){const [i,j]=key.split(':').map(Number),a=bodies[i],b=bodies[j];if(a.shape!=='cup'&&b.shape!=='cup')continue;
   let deepest=0,point=null;for(const [f,o] of [[a,b],[b,a]])for(const {p} of points(f)){const d=bodyDistance(p,o);if(d<deepest){deepest=d;point=p;}}
   if(deepest>=-Math.min(a.radius,b.radius)*.04)continue;
   const delta=a.position.map((v,k)=>v-b.position[k]),d=Math.hypot(...delta),axis=d>1e-9?delta.map(v=>v/d):[1,0,0],depth=bodySupport(a,axis.map(v=>-v))+bodySupport(b,axis)-d;
   if(depth>0)solveContact(a,b,point,axis,(depth+.0001)/.85,dt);
  }
  this.stats.testedPairs+=tested;this.stats.contacts+=contacts;return {tested,contacts};
 }
 end(){
  // Support travels through actual upward contacts; a stack sleeps as one
  // connected group so waking one body cannot leave another frozen above it.
  for(let i=0;i<this.lab.balls.length;i++){let changed=false;for(const {a,b,normal:n} of this.links){
   if(n[1]>.5&&(b.fixed||this.state(b).support)&&!this.state(a).support){this.state(a).support=true;changed=true;}
   if(n[1]<-.5&&(a.fixed||this.state(a).support)&&!this.state(b).support){this.state(b).support=true;changed=true;}
  }if(!changed)break;}
  for(const b of this.lab.balls){const s=this.state(b);if(b.held||b.fixed)continue;
   if(!s.sleep){const scale=this.lab.spec.scale,speed=(Math.hypot(...b.velocity)+Math.hypot(...b.omega)*b.radius)*scale;
    const p=pose(b),anchor=s.restPose;
    const drift=anchor?Math.hypot(...p.slice(0,3).map((v,k)=>v-anchor[k]))*scale+Math.hypot(...p.slice(3,6).map((v,k)=>v-anchor[k+3]))*b.radius*scale:Infinity;
    if(drift>.008){s.restPose=p;s.quiet=0;}
    const still=s.support&&(b.submerged||0)<.001&&!this.lab.jet&&this.lab.wind<=8&&speed<.25;
    s.quiet=still?s.quiet+this.dt:0;
   }
   s.pose=pose(b);s.velocity=[...b.velocity,...b.omega];s.terrainToken=this.terrainCache.forBody(b).token;s.wind=this.lab.wind;
  }
  if(this.flags.rigidSleep!==false){const visited=new Set();for(const body of this.lab.balls){if(body.fixed||body.held||visited.has(body)||this.sleeping(body))continue;
   const island=[body];visited.add(body);for(const b of island)for(const link of this.links){const other=link.a===b?link.b:link.b===b?link.a:null;if(other&&!other.fixed&&!other.held&&!visited.has(other)){visited.add(other);island.push(other);}}
   if(island.every(b=>this.state(b).quiet>.75))for(const b of island){const s=this.state(b);s.sleep=true;s.island=island;b.velocity.fill(0);b.omega.fill(0);s.velocity=[...b.velocity,...b.omega];}
  }}
 }
 dispose(){this.terrainCache.dispose();}
}
