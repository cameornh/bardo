import {shapeRadius,shapeDistance,shapeBlend} from './sand-shape.js';
import {sandFeet,supportsSand,hasSandBond} from './sand-support.js';
import {sandAdhesion,sandMaterial,SAND_AIR_RESPONSE} from './sand-material.js';
import {SandShapeStamp} from './sand-cache.js';
import {BoundsGrid} from './spatial-bounds.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
// Physical load units: newtons, metres, pascals. Deliberately strong artistic
// capillary bonds; this is a lumped fracture model, not an elastic FEM solve.
export const SAND_STRENGTH=1600000;
export function sandWindForce(p,wind,scale){
 const r=shapeRadius(p),reach=r+Math.max(.045,Math.min(.3,r*.3));
 // The centre lies inside the obstacle's no-flow region. Probe its exposed
 // faces, retaining shelter from the shared air lattice around other solids.
 const air=[0,0,0];let best=0;
 for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,0,1],[0,0,-1]]){
  const v=wind(p.position.map((x,k)=>x+axis[k]*reach)),speed=Math.hypot(...v);
  if(speed>best){best=speed;for(let k=0;k<3;k++)air[k]=v[k];}
 }
 const relative=air.map((v,k)=>(v-(p.velocity?.[k]||0))*scale),speed=Math.hypot(...relative);
 const area=Math.PI*(r*scale)**2*Math.max(.3,p.aspect||1);
 return relative.map(v=>.5*1.225*.9*SAND_AIR_RESPONSE*area*speed*v);
}
function joint(p,q,bed){
 const r=shapeRadius(p);if(!q){const feet=sandFeet(p).filter(f=>p.position[1]+f[1]<=bed.height(p.position[0]+f[0],p.position[2]+f[2])+.002);
  return {point:[p.position[0],Math.min(...feet.map(f=>p.position[1]+f[1])),p.position[2]],axis:[0,1,0],radius:r*.8};}
 const s=shapeRadius(q),delta=sub(p.position,q.position),d=Math.hypot(...delta)||1,axis=delta.map(v=>v/d),point=q.position.map((v,k)=>v+delta[k]*s/(r+s));
 const min=Math.min(r,s),neck=Math.min(min*.9,Math.sqrt(Math.max(0,min*(r+s-d)))+min*.55);
 // Cuts can remove most of a load-bearing neck; sample real material rather
 // than the brush bounds. Smooth-union tolerance represents the welded seam.
 const u=cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0]),ul=Math.hypot(...u);for(let k=0;k<3;k++)u[k]/=ul;const v=cross(axis,u);
 let material=0;for(let i=0;i<16;i++){const a=i*2.3999632297,t=neck*Math.sqrt((i+.5)/16),x=point.map((x,k)=>x+t*(u[k]*Math.cos(a)+v[k]*Math.sin(a)));
  if(shapeDistance(p,x)<=shapeBlend(p)&&shapeDistance(q,x)<=shapeBlend(q))material++;}
 return {point,axis,radius:neck*Math.sqrt(Math.max(.06,material/16))};
}
export class SandStress{
 constructor(){this.stamp=new SandShapeStamp();this.damage=new Map();this.failures=0;this.maxLoad=0;this.broken=new Map();}
 graph(bed){
  const nodes=bed.parcels.filter(p=>p.anchored&&!p.held&&p.mass>0),changed=this.stamp.changed(nodes),bonds=nodes.map(hasSandBond).join(',');
  if(!changed&&!bed.dirty&&this.bedRevision===bed.bedGeometryRevision&&bonds===this.bonds)return this.nodes;
  this.bedRevision=bed.bedGeometryRevision;this.bonds=bonds;this.rebuilds=(this.rebuilds||0)+1;
  const liveIds=new Set(nodes.map(p=>p.id));for(const [key,pair] of this.broken)if(pair.some(p=>!liveIds.has(p.id)))this.broken.delete(key);
  const data=new Map(nodes.map(p=>[p,{p,parents:[],depth:Infinity}])),queue=[];
  for(const n of data.values())if(sandFeet(n.p).some(f=>n.p.position[1]+f[1]<=bed.height(n.p.position[0]+f[0],n.p.position[2]+f[2])+.002)){n.depth=0;n.parents=[{node:null,...joint(n.p,null,bed)}];queue.push(n);}
  const grid=nodes.length>8?new BoundsGrid().build(nodes,p=>shapeRadius(p)+.04):null;
  for(const n of queue)for(const p of grid?grid.query(n.p.position,shapeRadius(n.p)+.04).map(i=>nodes[i]):nodes){const other=data.get(p);
   if(other.depth<n.depth+1||this.broken.has([n.p.id,p.id].sort((a,b)=>a-b).join(':'))||!supportsSand(n.p,p))continue;
   if(other.depth===Infinity){other.depth=n.depth+1;queue.push(other);}
   other.parents.push({node:n,...joint(p,n.p,bed)});
  }
  // Multiple paths at the same depth share their transmitted load by area.
  this.nodes=queue;return queue;
 }
 step(bed,dt,wind,scale,sampleWater){
  const nodes=this.graph(bed);this.maxLoad=0;if(!nodes?.length)return;
  // Forces matter only if this node or an ancestor has a tensile/bending
  // bond to test. Dry compression-only ground piles cannot fracture a bond,
  // but dry weight on a wet structure must still propagate into that bond.
  for(const n of nodes){n.needsForce=bed.optimizations?.stressPruning===false||n.parents.some(e=>(hasSandBond(n.p)&&(!e.node||hasSandBond(e.node.p)))||e.node?.needsForce);}
  // Geometry stays fixed throughout these force probes; one exact local
  // spatial index can serve the whole load calculation.
  if(nodes.some(n=>n.needsForce))wind.beginBatch?.();try{for(const n of nodes){if(!n.needsForce){n.force=[0,0,0];n.moment=[0,0,0];continue;}const p=n.p,immersed=clamp((sampleWater?.(p.position).density||0)*1.6,0,1),weight=p.mass*2650*scale**3*9.81;
   n.force=sandWindForce(p,wind,scale).map(v=>v*(1-immersed));n.force[1]-=weight*(1-immersed/1.7);n.moment=[0,0,0];}}finally{wind.endBatch?.();}
  let failure=null;
  for(let i=nodes.length-1;i>=0;i--){const n=nodes[i],p=n.p,totalArea=n.parents.reduce((s,e)=>s+e.radius**2,0)||1;
   for(const edge of n.parents){const fraction=edge.radius**2/totalArea,force=n.force.map(v=>v*fraction),arm=sub(p.position,edge.point).map(v=>v*scale),moment=cross(arm,force).map((v,k)=>v+n.moment[k]*fraction),radius=Math.max(.00001,edge.radius*scale),area=Math.PI*radius**2;
    const normal=dot(force,edge.axis),shear=Math.sqrt(Math.max(0,dot(force,force)-normal**2));
    const bending=Math.hypot(...moment.map((v,k)=>v-edge.axis[k]*dot(moment,edge.axis))),adhesion=Math.min(sandAdhesion(p.wet,p.memory||0),edge.node?sandAdhesion(edge.node.p.wet,edge.node.p.memory||0):1);
    // Compression/friction can support dry stock. Tensile and bending loads
    // require a bond and continuously weaken with retained moisture.
    const strength=SAND_STRENGTH*Math.max(1e-8,adhesion),compression=Math.max(0,-normal)/area;
    const load=hasSandBond(p)&&(!edge.node||hasSandBond(edge.node.p))?Math.max(0,normal)/area/strength + Math.max(0,shear-sandMaterial(p.wet,p.memory||0).friction*Math.max(0,-normal))/area/(strength*.75) + bending/(Math.PI*radius**3*.25)/strength + compression/2e6:0;
    const key=`${p.id}:${edge.node?.p.id||0}`,old=this.damage.get(key)||0;
    const damage=load>1?old+dt*Math.min(8,(load-1)**1.35):Math.max(0,old-dt*.8);this.damage.set(key,damage);
    this.maxLoad=Math.max(this.maxLoad,load);
    if(damage>=1&&(!failure||load>failure.load))failure={n,edge,moment,load,key};
    if(edge.node){const parent=edge.node,offset=sub(edge.point,parent.p.position).map(v=>v*scale),torque=cross(offset,force);
     for(let k=0;k<3;k++){parent.force[k]+=force[k];parent.moment[k]+=moment[k]+torque[k];}}
   }
  }
  const live=new Set(nodes.flatMap(n=>n.parents.map(e=>`${n.p.id}:${e.node?.p.id||0}`)));for(const key of this.damage.keys())if(!live.has(key))this.damage.delete(key);
  if(!failure)return;
  // Release the branch below a failed load path. Other independent supports
  // remain valid; a single broken edge cannot drop a multiply supported bridge.
  const released=new Set([failure.n]),cut=failure.n;cut.parents=cut.parents.filter(e=>e!==failure.edge);
  if(failure.edge.node)this.broken.set([cut.p.id,failure.edge.node.p.id].sort((a,b)=>a-b).join(':'),[cut.p,failure.edge.node.p]);
  if(cut.parents.length){this.failures++;this.damage.set(failure.key,0);return;}
  for(const n of nodes)if(n.parents.length&&n.parents.every(e=>e.node&&released.has(e.node)))released.add(n);
  const pieces=[...released].map(n=>n.p),fixed=nodes.filter(n=>!released.has(n)&&pieces.some(p=>supportsSand(n.p,p)||supportsSand(p,n.p))).map(n=>n.p.id),batch=bed.nextBatch++,mass=pieces.reduce((s,p)=>s+p.mass,0),center=[0,1,2].map(k=>pieces.reduce((s,p)=>s+p.mass*p.position[k],0)/mass);
  const torque=failure.moment,length=Math.hypot(...torque)||1,omega=torque.map(v=>v/length*Math.min(1.4,.2*Math.sqrt(failure.load)));
  for(const p of pieces){p.anchored=false;p.batch=batch;p.fractureIgnore=new Set(fixed);p.fractureTime=.65;
   // A coherent collection of spherical clumps can tumble after fracture.
   // Non-spherical CSG fragments retain their own shape during translation.
   const spin=cross(omega,sub(p.position,center));p.velocity=spin.map((v,k)=>v+(k===1?-.02:0));}
  this.failures++;this.damage.delete(failure.key);this.stamp=new SandShapeStamp();bed.dirty=true;
 }
}
