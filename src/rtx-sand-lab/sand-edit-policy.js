import {cutShape,shapeRadius,shapeHeight,shapeDistance} from '../sand-lab/sand-shape.js';
import {loosePatches} from '../sand-lab/sand-support.js';
import {BoundsGrid} from '../sand-lab/spatial-bounds.js';

export const EDIT_CUT_LIMIT=12;
const similar=(a,b)=>Math.abs(a.wet-b.wet)<=.06&&Math.abs((a.memory||0)-(b.memory||0))<=.06;
const volume=p=>p.mass/p.packing;

// Live editing has a finite geometry budget per portion. Historical SandBed
// fixtures keep the original CSG path unless this policy is explicitly installed.
export class SandEditPolicy {
 constructor(){this.rebuilt=0;this.merged=0;this.returned=0;}
 cut(p,point,radius){
  const whole=Math.hypot(...point.map((v,k)=>v-p.position[k]))+shapeRadius(p)<=radius;
  const q=cutShape(p,point,radius,512);
  // A handful carries stock and material, not a copy of every past operation.
  // Keep whole-object pickups intact; round only a newly intersected scoop.
  if(q&&!whole&&q.cuts?.length){loosePatches(q,()=>q.id,1,0);q.cuts=undefined;q.shapeRadius=undefined;}
  return q;
 }
 maintain(bed){
  const cell=Math.min(bed.dx,bed.dz),next=[];
  for(const p of bed.parcels){
   if(p.mass<=0)continue;
   if(!p.held&&(p.cuts?.length||0)>EDIT_CUT_LIMIT){next.push(...this.rebuild(p,bed,cell));this.rebuilt++;}
   else next.push(p);
  }
  bed.parcels=next;
  this.consolidate(bed,cell);
 }
 rebuild(p,bed,cell){
  const radius=shapeRadius(p),extent=[radius,shapeHeight(p),radius];
  const counts=extent.map(e=>Math.max(1,Math.min(5,Math.ceil(2*e/cell))));
  const width=extent.map((e,k)=>2*e/counts[k]),bins=[];
  // At most 125 cells and eight samples per cell, regardless of edit count.
  // Only occupied stock contributes. A cell's portions share the original
  // material and cohesive batch; unsupported portions still obey gravity.
  for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++){
   const points=[];
   for(const dz of [.25,.75])for(const dy of [.25,.75])for(const dx of [.25,.75]){
    const point=[x+dx,y+dy,z+dz].map((v,k)=>p.position[k]-extent[k]+v*width[k]);
    if(shapeDistance(p,point)<=0)points.push(point);
   }
   if(!points.length)continue;
   let center=[0,1,2].map(k=>points.reduce((n,q)=>n+q[k],0)/points.length);
   if(shapeDistance(p,center)>0)center=points.reduce((a,b)=>Math.hypot(...a.map((v,k)=>v-center[k]))<Math.hypot(...b.map((v,k)=>v-center[k]))?a:b);
   bins.push({center,weight:points.length});
  }
  // Thin residual lenses may miss the coarse volume stencil. The column
  // sampler locates their actual remaining support without dropping stock.
  if(!bins.length){const patches=loosePatches(p,()=>bed.nextId++,8,0);if(patches.length)return patches;p.cuts=undefined;p.shapeRadius=undefined;return [p];}
  const total=bins.reduce((n,b)=>n+b.weight,0),stock=p.mass,source={...p,batch:p.batch??bed.nextBatch++};let assigned=0;
  return bins.map((b,i)=>{
   const mass=i===bins.length-1?stock-assigned:stock*b.weight/total;assigned+=mass;
   const q={...source,id:i?bed.nextId++:p.id,mass,position:b.center,velocity:p.velocity.slice(),
    aspect:1,cuts:undefined,shapeRadius:undefined,looseResolved:true,spreadRemaining:0,
    surfaceBlend:Math.min(.08,cell*.4),layerGroup:source.layerGroup??source.id};
   if(i===0){Object.assign(p,q);return p;}return q;
  });
 }
 consolidate(bed,cell){
  const grid=new BoundsGrid(cell),items=[];
  for(const p of bed.parcels){
   const r=shapeRadius(p);
   if(!p.anchored||p.held||p.mass<=0||p.cuts?.length||p.fractureTime>0||r>cell*.65)continue;
   const [x,y,z]=p.position,ground=bed.height(x,z);
   const material={wet:bed.sample(x,z),memory:bed.sample(x,z,bed.memory)};
   // Rasterize only small, directly grounded, matching deposits. Keep raised
   // sculptures and unlike wet/dry layers explicit instead of swallowing them.
   if(y-shapeHeight(p)<=ground+.004&&similar(p,material)){
    for(const [k,w] of bed.weights(x,z)){
     const amount=p.mass*w,a=bed.mass[k],total=a+amount;if(amount<=0)continue;
     bed.wet[k]=(a*bed.wet[k]+amount*p.wet)/total;
     bed.memory[k]=(a*bed.memory[k]+amount*(p.memory||0))/total;
     bed.packing[k]=total/(a/bed.packing[k]+amount/p.packing);bed.mass[k]=total;
    }
    p.mass=0;bed.dirty=true;this.returned++;continue;
   }
   let slot=-1;
   for(const i of grid.query(p.position,r)){
    const q=items[i],s=shapeRadius(q),combined=volume(p)+volume(q);
    if(!similar(p,q)||Math.hypot(...p.position.map((v,k)=>v-q.position[k]))>r+s||
       Math.cbrt(combined/(4*Math.PI/3*Math.min(p.aspect||1,q.aspect||1)))>cell*.75)continue;
    slot=i;break;
   }
   if(slot<0){items.push(p);grid.insert(items.length-1,p.position,r);continue;}
   const q=items[slot],a=q.mass,b=p.mass,total=a+b,occupied=volume(q)+volume(p);
   for(let k=0;k<3;k++){q.position[k]=(a*q.position[k]+b*p.position[k])/total;q.velocity[k]=(a*q.velocity[k]+b*p.velocity[k])/total;}
   q.wet=(a*q.wet+b*p.wet)/total;q.memory=(a*(q.memory||0)+b*(p.memory||0))/total;
   q.aspect=(a*(q.aspect||1)+b*(p.aspect||1))/total;q.packing=total/occupied;q.mass=total;
   q.shapeRadius=undefined;q.looseResolved=true;p.mass=0;bed.dirty=true;this.merged++;
   grid.insert(slot,q.position,shapeRadius(q));
  }
 }
}
