import {AIR,WATER} from '../grid.js';
import {MATERIAL} from '../../../fluid-fields/model.js';
import {physicalCoefficients,WATER_SURFACE_TENSION,WATER_DENSITY} from '../../../sand-lab/water-lab-transport.js';
import {validateParticleInput,PARTICLE_LIMITS} from '../particles/pipeline.js';

// Occupancy and exact moving geometry remain CPU-owned. No interpolation
// stencils, face deposition or pressure arithmetic run here.
export function prepareOccupancy(g,context,solid){
 const {old,scale,s}=context,n=old.length/4,mass=g.fill;mass.fill(0);
 if(g.particleCell?.length!==n){g.particleCell=new Int32Array(n);g.stencilIndices=new Int32Array(n*24);g.stencilWeights=new Float64Array(n*24);}
 const counts=new Uint32Array(g.count),volume=(s*scale)**3/g.volume;
 for(let i=0;i<n;i++){const o=i*4,c=g.cellXYZ(old[o]*scale,old[o+1]*scale,old[o+2]*scale);g.particleCell[i]=c;if(c>=0&&!old[o+3]){mass[c]+=volume;counts[c]++;}}
 if(Math.max(...counts)>2048)throw Error('Field particle bin exceeds bounded work budget');
 const phase=new Uint8Array(g.count);for(let i=0;i<g.count;i++)phase[i]=mass[i]>.25?WATER:solid(g.position(i))<0?0:AIR;
 g.setPhase(phase);
 const bins=new Uint32Array(g.count+1+n),offset=new Uint32Array(g.count);for(let i=0;i<g.count;i++)bins[i+1]=bins[i]+counts[i];
 for(let i=0;i<n;i++){const c=g.particleCell[i];if(c>=0&&!old[i*4+3])bins[g.count+1+bins[c]+offset[c]++]=i;}
 return bins;
}
export function connectivity(g){
 const graph=g.levels[0],nodes=new Float32Array(g.count*4),links=new Float32Array(graph.column.length*2);
 for(let i=0;i<g.count;i++)nodes.set([graph.diag[i],graph.offset[i],graph.offset[i+1],g.phase[i]],i*4);
 for(let k=0;k<graph.column.length;k++)links.set([graph.column[k],graph.weight[k]],k*2);
 // Closed components have compatible RHS, without any artificial outlet.
 const closed=new Float32Array(g.count*2+g.closed.reduce((s,c)=>s+c.length,0));let at=g.count*2;
 for(const cells of g.closed){for(const i of cells){closed[i*2]=at;closed[i*2+1]=cells.length;}closed.set(cells,at);at+=cells.length;}
 return {nodes,links,closed};
}
export function packConnected(context,lab,g,geometry,bins,wind,wall,particlePacker=null){
 const n=validateParticleInput(context,lab,g),input=particlePacker?particlePacker(context,lab,g):new Float32Array(n*17),config=new Float32Array(32),offsets=[];let faces=0;
 for(const f of g.faces){offsets.push(faces);faces+=f.velocity.length;}
 const bandOffset=faces*4,geometryOffset=bandOffset+g.count,field=new Float32Array(geometryOffset+geometry.length),faceMeta=(g.connectedFaceMeta??=new Float32Array(faces*16)),band=new Uint8Array(g.count);
 if(geometry.length>PARTICLE_LIMITS.geometryFloats||!geometry.every(Number.isFinite))throw Error('Invalid GPU collision geometry');
 for(let i=0;i<g.count;i++)if(g.phase[i]!==WATER)band[i]=1;
 const limit=g.h*.42/context.dt,changed=g.connectedFaceVersion!==g.topologyVersion;
 for(const f of g.faces)for(let i=0;i<f.a.length;i++){
  const a=f.a[i],b=f.b[i],j=offsets[f.axis]+i,at=j*16,pa=g.phase[a],pb=g.phase[b],wet=pa===WATER||pb===WATER,phase=pa||pb||AIR,p=f.position[i];
  if(changed){
   faceMeta[at]=a;faceMeta[at+1]=b;faceMeta[at+2]=f.axis;faceMeta[at+3]=i;
   const d=f.dims;faceMeta[at+4]=i%d[0];faceMeta[at+5]=Math.floor(i/d[0])%d[1];faceMeta[at+6]=Math.floor(i/(d[0]*d[1]));
   faceMeta[at+7]=f.coefficient[i];faceMeta[at+8]=phase;faceMeta[at+9]=wet?1:0;faceMeta[at+13]=MATERIAL[phase].viscosity;
  }
  faceMeta[at+10]=!f.coefficient[i]||wet?0:wind(p)[f.axis];
  faceMeta[at+11]=!f.coefficient[i]?Math.max(-limit,Math.min(limit,wall(p)[f.axis])):0;
  faceMeta[at+12]=f.velocity[i];
  field[j*4+2]=wet?1:0;if(pa!==WATER&&b>=0)band[b]=1;if(pb!==WATER&&a>=0)band[a]=1;
 }
 g.connectedFaceVersion=g.topologyVersion;
 let coupled=0;for(let i=0;i<n;i++){const o=i*17;if(!particlePacker){input.set(context.old.subarray(i*4,i*4+4),o);input.set(context.predicted.subarray(i*4,i*4+4),o+4);input.set(lab.velocities.subarray(i*4,i*4+4),o+8);input.set(lab.chem.subarray(i*4,i*4+4),o+12);}const c=g.particleCell[i];if(!context.old[i*4+3]&&c>=0&&g.phase[c]===WATER){if(!particlePacker)input[o+16]=1;coupled++;}}
 g.coupled=coupled;field.set(band,bandOffset);field.set(geometry,geometryOffset);
 const coeff=physicalCoefficients(context.s,context.scale,context.dt);
 config.set([n,context.s,context.scale,context.dt,1-Math.exp(-context.dt*1.5),coeff.viscosity,coeff.capillary,WATER_SURFACE_TENSION/WATER_DENSITY,...g.origin,0,...g.cellSize,0,geometryOffset,bandOffset,0,0,...g.dims,0]);
 const fieldConfig=new Float32Array([n,g.count,faces,context.dt,...g.dims,g.h,...g.origin,context.scale,...g.cellSize,1-Math.exp(-context.dt*2),...offsets,0]);
 if(!faceMeta.every(Number.isFinite))throw Error('Non-finite field forcing');
 return {n,input,config,field,faceMeta,bins,fieldConfig};
}
