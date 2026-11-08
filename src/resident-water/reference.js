import {BeachFieldGrid} from '../rtx-sand-lab/fields/grid.js';
import {referenceParticles} from '../rtx-sand-lab/fields/particles/verify.js';
import {boundaryMetric} from '../sand-lab/water-lab-model.js';
import {bodyDistance} from '../sand-lab/objects.js';
import {gridPlan,LIMITS,unpackState,outputState} from './model.js';

// Independent CPU implementation of the prototype's free-surface projection.
// The contact/viscosity oracle is the existing JavaScript reference, not WGSL
// translated to JavaScript and not the GPU's own readback treated as truth.
export function referenceStep(f,state,{wind=0}={}){
 const {positions:old,velocities,chem}=unpackState(state),predicted=old.slice(),s=f.spacing,scale=f.scale,dt=f.dt,n=old.length/4;
 for(let i=0;i<n;i++){const o=i*4,v=Array.from(velocities.subarray(o,o+3));v[1]-=9.81/scale*dt;if(state[i*20+16]<22)for(let k=0;k<3;k++){const relative=(k===0?wind/scale:0)-v[k];v[k]+=dt*.0015*relative*Math.abs(relative);}const cap=Math.min(1,s*.45/dt/Math.max(1e-8,Math.hypot(...v)));for(let k=0;k<3;k++)predicted[o+k]=old[o+k]+(old[o+3]?0:v[k]*cap*dt);}
 const g=gridPlan(f),grid=new BeachFieldGrid({dims:g.dims,h:Math.min(...g.cell)*scale,origin:g.origin.map(v=>v*scale),extent:g.extent.map(v=>v*scale)});
 const solid=p=>Math.min((p[1]-f.sand.height(p[0],p[2]))*.65,5.5-Math.abs(p[0]),4.9-Math.abs(p[2]),9-p[1],...f.balls.map(b=>bodyDistance(p,b)));
 // Build authoritative occupancy and exact interpolation weights with the
 // existing CPU code, then replace its pressure solve with the bounded oracle.
 grid.deposit(old,predicted,dt,scale,s,p=>solid(p.map(v=>v/scale)),()=>[0,0,0]);
 for(const face of grid.faces){const sums=new Float64Array(face.before.length),weights=sums.slice();for(let i=0;i<n;i++){
  if(old[i*4+3]||grid.phase[grid.particleCell[i]]!==1)continue;
  for(let k=0;k<8;k++){const at=i*24+face.axis*8+k,j=grid.stencilIndices[at];if(j<0)continue;const w=grid.stencilWeights[at];sums[j]+=w*(predicted[i*4+face.axis]-old[i*4+face.axis])*scale/dt;weights[j]+=w;}}
  for(let j=0;j<sums.length;j++){const a=grid.phase[face.a[j]]||0,b=grid.phase[face.b[j]]||0,wet=a===1||b===1;face.before[j]=wet?sums[j]/Math.max(1e-12,weights[j]):0;face.velocity[j]=a>0&&b>0&&wet?face.before[j]:0;}
 }
 const rhs=new Float64Array(g.count),diag=rhs.slice(),neighbors=Array.from({length:g.count},()=>[]);
 for(const face of grid.faces)for(let j=0;j<face.a.length;j++){const a=face.a[j],b=face.b[j],pa=grid.phase[a]||0,pb=grid.phase[b]||0,h=g.cell[face.axis];if(pa===1)rhs[a]-=face.velocity[j]/h;if(pb===1)rhs[b]+=face.velocity[j]/h;const w=1/h**2;if(pa===1&&pb>0){diag[a]+=w;if(pb===1)neighbors[a].push([b,w]);}if(pb===1&&pa>0){diag[b]+=w;if(pa===1)neighbors[b].push([a,w]);}}
 let pressure=rhs.slice().fill(0),next=pressure.slice();for(let it=0;it<LIMITS.iterations;it++){for(let i=0;i<g.count;i++)next[i]=(rhs[i]+neighbors[i].reduce((s,[j,w])=>s+pressure[j]*w,0))/Math.max(1e-12,diag[i]);[pressure,next]=[next,pressure];}
 for(const face of grid.faces)for(let j=0;j<face.a.length;j++){const a=face.a[j],b=face.b[j],pa=grid.phase[a]||0,pb=grid.phase[b]||0;if(pa>0&&pb>0&&(pa===1||pb===1))face.velocity[j]-=(pressure[b]-pressure[a])/g.cell[face.axis];}
 const lab={spacing:s,spec:{scale},velocities,chem,solid,collide:p=>{p=p.slice();for(let k=0;k<3;k++){const m=boundaryMetric(p,solid,s*.12);if(m.distance>=s*.12)break;p=p.map((v,j)=>v+m.normal[j]*(s*.12-m.distance));}return p;}};
 const result=referenceParticles({context:{old,predicted,s,scale,dt},lab,grid});const output=outputState({...f,positions:result.positions,velocities:result.transport.velocities,chem:result.transport.chem});for(let i=0;i<n;i++){output.set(result.transport.metrics.subarray(i*4,i*4+4),i*20+12);output.set([result.transport.counts[i],result.transport.activity[i*2],result.transport.activity[i*2+1],result.transport.breakup[i]],i*20+16);}
 const divAfter=grid.divergence();return {state:output,grid,pressure,rhs,divergence:Math.hypot(...Array.from(divAfter,(v,i)=>grid.phase[i]===1?v:0)),before:Math.hypot(...rhs)/scale};
}
export function compareState(a,b){const errors={position:0,velocity:0,chemistry:0,normal:0,count:0};for(let i=0;i<a.length;i++){const c=i%20;const key=c<4?'position':c<8?'velocity':c<12?'chemistry':c<16?'normal':c===16?'count':null;if(key)errors[key]=Math.max(errors[key],Math.abs(a[i]-b[i]));}return {pass:a.every(Number.isFinite)&&errors.position<.0005&&errors.velocity<.015&&errors.chemistry<.0005&&errors.count===0,errors};}
