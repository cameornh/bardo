import {BoundsGrid} from './spatial-bounds.js';
import {shapeRadius} from './sand-shape.js';

// A settling pass moves deposits sequentially. Update both indices after
// each move so the next parcel sees the same supports as the reference scan.
export class SandContactIndex {
 constructor(parcels){
  this.parcels=parcels.filter(p=>p.anchored&&!p.held&&p.mass>0);
  this.ids=new Map(this.parcels.map((p,i)=>[p,i]));
  this.spatial=new BoundsGrid(.25);this.columns=new BoundsGrid(.25);
  for(const p of this.parcels)this.update(p);
 }
 update(p){
  const i=this.ids.get(p);if(i===undefined)return;
  if(!p.anchored||p.held||p.mass<=0){this.spatial.remove(i);this.columns.remove(i);return;}
  const r=shapeRadius(p);this.spatial.insert(i,p.position,r);this.columns.insert(i,[p.position[0],0,p.position[2]],r);
 }
 near(p,r){return this.spatial.query(p,Math.max(0,r)).map(i=>this.parcels[i]);}
 column(x,z){return this.columns.query([x,0,z],0).map(i=>this.parcels[i]);}
}

// The world resolution also bounds *new* settling subdivisions. Tiny wind
// packets already resolve their footprint; splitting each into 25 smaller
// physics parcels caused an escalating workload. Stock and moisture remain
// in the same material; visible fine grains still use the GPU particle layer.
export function settlingPatchLimit(parcel,dx,dz,limit=25){
 const spacing=Math.min(dx,dz)*.25,r=shapeRadius(parcel);
 return Math.min(limit,Math.max(1,Math.floor(Math.PI*r*r/(spacing*spacing))));
}

// Coalesce overlapping sub-resolution wind deposits, never user-cut/held
// stock. This retains grain volume, pore volume, moisture, plastic history
// and centre of mass. Airborne packets and the fine GPU grains are untouched.
export function mergeWindDeposits(bed){
 const cell=Math.min(bed.dx,bed.dz),grid=new BoundsGrid(cell),items=[];
 let merged=0;
 for(const p of bed.parcels){
  if(!p.windborne||!p.anchored||p.held||p.userEdited||p.cuts?.length||p.mass<=0||shapeRadius(p)>cell)continue;
  const r=shapeRadius(p),candidates=grid.query(p.position,Math.max(r,cell*.65));
  let receiver=null,slot=-1;
  for(const i of candidates){const q=items[i],s=shapeRadius(q);
   if(s>cell||Math.abs(q.wet-p.wet)>.12||Math.abs((q.memory||0)-(p.memory||0))>.12||Math.hypot(...p.position.map((v,k)=>v-q.position[k]))>Math.max(r+s,cell*.65)||Math.abs(p.position[1]-q.position[1])>Math.max(r+s,cell*.25))continue;
   receiver=q;slot=i;break;
  }
  if(!receiver){items.push(p);grid.insert(items.length-1,p.position,r);continue;}
  const q=receiver,a=q.mass,b=p.mass,total=a+b,volume=a/q.packing+b/p.packing;
  for(let k=0;k<3;k++){q.position[k]=(q.position[k]*a+p.position[k]*b)/total;q.velocity[k]=(q.velocity[k]*a+p.velocity[k]*b)/total;}
  q.wet=(q.wet*a+p.wet*b)/total;q.memory=((q.memory||0)*a+(p.memory||0)*b)/total;
  q.aspect=((q.aspect||1)*a+(p.aspect||1)*b)/total;q.packing=total/volume;q.mass=total;q.shapeRadius=undefined;
  q.looseResolved=true;p.mass=0;grid.insert(slot,q.position,shapeRadius(q));merged++;
 }
 if(merged){bed.dirty=true;bed.mergedWindDeposits=(bed.mergedWindDeposits||0)+merged;}
 return merged;
}

// Wind packets resolve transport, not permanent terrain topology. Once a
// sub-cell packet rests directly on matching bed material, rasterize its
// conserved stock back into the same columns. Keep unlike layers, sculptures,
// cuts, held stock and raised deposits explicit.
export function returnWindDeposits(bed){
 let returned=0;
 const cell=Math.min(bed.dx,bed.dz);
 for(const p of bed.parcels){
  if(!p.windborne||!p.anchored||p.held||p.userEdited||p.cuts?.length||p.mass<=0||shapeRadius(p)>cell)continue;
  const [x,y,z]=p.position,r=shapeRadius(p),ground=bed.height(x,z),wet=bed.sample(x,z);
  if(y-r*(p.aspect||1)>ground+.012||Math.abs(wet-p.wet)>.12)continue;
  for(const [k,w] of bed.weights(x,z)){
   const amount=p.mass*w,before=bed.mass[k],total=before+amount;
   if(amount<=0)continue;
   bed.wet[k]=(before*bed.wet[k]+amount*p.wet)/total;
   bed.memory[k]=(before*bed.memory[k]+amount*(p.memory||0))/total;
   bed.packing[k]=total/(before/bed.packing[k]+amount/p.packing);bed.mass[k]=total;
  }
  p.mass=0;returned++;bed.dirty=true;
 }
 bed.returnedWindDeposits=(bed.returnedWindDeposits||0)+returned;return returned;
}
