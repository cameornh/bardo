import {SandAirGeometry} from '../sand-lab/sand-air-geometry.js';
import {shapeRadius,shapeBlend,sandIsTracer,shapeDistance} from '../sand-lab/sand-shape.js';
import {hasSandBond} from '../sand-lab/sand-support.js';
import {ParcelQueryTree} from './parcel-query-tree.js';

export class LiveSandAirGeometry extends SandAirGeometry {
 constructor(...args){super(...args);this.tree=new ParcelQueryTree();this.candidates=[];this.slots=new Map();}
 updateItem(q,p){q.parcel=p;q.position=p.position;q.x=p.position[0];q.y=p.position[1];q.z=p.position[2];q.r=shapeRadius(p);q.a=p.aspect||1;q.s=Math.min(1,q.a);q.k=shapeBlend(p);q.expansion=Math.max(1,q.a)/q.s;q.radius=q.r*Math.max(1,q.a)+q.k*q.expansion;}
 beginMoving(){this.moving=false;this.refresh();this.moving=true;this.changed=new Set();}
 endMoving(){this.moving=false;}
 moved(group){for(const p of group)this.changed?.add(p);}
 refresh(){
  // Only the just-integrated group mutates during SandBed's movement loop.
  // New/removed stock invalidates membership; otherwise refit those leaves,
  // not every deposited parcel again for each individual moving grain.
  if(this.moving&&this.members===this.bed.parcels.length){
   const ids=[];let valid=true;
   for(const p of this.changed){const i=this.slots.get(p);if(i===undefined||p.mass<=0||p.held||sandIsTracer(p)){valid=false;break;}this.updateItem(this.items[i],p);this.maxExpansion=Math.max(this.maxExpansion,this.items[i].expansion);ids.push(i);}
   if(valid){if(this.index)this.tree.refit(ids,this.items);this.changed.clear();return;}
  }
  this.slots.clear();this.changed?.clear();this.members=this.bed.parcels.length;
  let n=0;this.maxExpansion=1;
  for(const p of this.bed.parcels){if(p.held||p.mass<=0||sandIsTracer(p))continue;
   const q=this.items[n]||(this.items[n]={});this.updateItem(q,p);this.slots.set(p,n);this.maxExpansion=Math.max(this.maxExpansion,q.expansion);n++;
  }
  this.items.length=n;this.count=n;
  if(n<24){this.index=null;this.tree.refresh([]);return;}
  this.tree.refresh(this.items);
  this.index={query:(p,r)=>this.tree.query(p,r,this.candidates)};
 }
}

// Build once before each moving group's swept contacts. Deposits from the
// previous group are included; no stale collider can keep a removed support.
export function installSandContactQueries(bed,enabled){
 const reference=bed.contactDistance.bind(bed),tree=new ParcelQueryTree(),items=[],out=[];
 bed.refreshContactQueries=()=>{
  if(!enabled()||bed.parcels.length<64){items.length=0;tree.refresh(items);bed.contactQueryReady=false;return;}
  let n=0;for(const p of bed.parcels)if(p.anchored&&!p.held&&p.mass>0){const q=items[n]||(items[n]={});q.parcel=p;q.position=p.position;q.radius=shapeRadius(p);n++;}items.length=n;tree.refresh(items);bed.contactQueryReady=true;
 };
 bed.contactDistance=(p,radius,exclude=null,ceiling=Infinity,looseGroup=null)=>{
  if(!enabled()||bed.layerContactIndex||!bed.contactQueryReady)return reference(p,radius,exclude,ceiling,looseGroup);
  let d=(p[1]-radius-bed.height(p[0],p[2]))*.65;
  for(const i of tree.query(p,radius+d+.08,out)){const a=items[i].parcel;
   if(!a.anchored||a.held||a.mass<=0||(a.id===exclude||exclude?.has?.(a.id))||a.position[1]>ceiling||(looseGroup&&a.layerGroup===looseGroup&&!hasSandBond(a)))continue;
   const r=shapeRadius(a);if(Math.hypot(p[0]-a.position[0],p[1]-a.position[1],p[2]-a.position[2])-r-radius>d+.08)continue;
   const sd=shapeDistance(a,p)-radius,k=Math.min(.08,r*.5),h=Math.max(k-Math.abs(d-sd),0)/Math.max(k,.00001);d=Math.min(d,sd)-h*h*k*.25;
  }return d;
 };
 const step=bed.stepParcels.bind(bed);
 bed.stepParcels=(...args)=>{try{return step(...args);}finally{bed.contactQueryReady=false;}};
 bed.contactQueryTree=tree;
}
