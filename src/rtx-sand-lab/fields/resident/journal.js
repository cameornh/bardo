// CPU arrays are feature mirrors, not the next GPU input. Compare their bits
// with the last published state so arbitrary existing tools can still edit
// them. A reset, count change or intervening CPU step starts a new epoch.
export class WaterStateJournal {
 plan(context,lab,grid){
  const n=context.old.length/4,reset=!this.baseline||this.count!==n||this.grid!==grid||this.generation!==context.generation||this.nextStep!==lab.steps;
  const arrays=[context.old,lab.velocities,lab.chem],bits=arrays.map(a=>new Uint32Array(a.buffer,a.byteOffset,a.length)),changed=[];
  for(let i=0;i<n;i++){
   let dirty=reset;
   if(!dirty)for(let a=0;a<3&&!dirty;a++)for(let k=0;k<4;k++)if(bits[a][i*4+k]!==this.baseline[a*n*4+i*4+k]){dirty=true;break;}
   if(dirty)changed.push(i);
  }
  const patches=new Float32Array(changed.length*16);
  for(let j=0;j<changed.length;j++){const i=changed[j],o=j*16;patches[o]=i;for(let a=0;a<3;a++)for(let k=0;k<4;k++)patches[o+1+a*4+k]=arrays[a][i*4+k];patches[o+13]=lab.neighborCounts?.[i]??0;}
  this.pending={n,grid,generation:context.generation,nextStep:lab.steps===undefined?undefined:lab.steps+1};
  return {n,reset,patches,changed:changed.length};
 }
 commit(data){const p=this.pending;this.count=p.n;this.grid=p.grid;this.generation=p.generation;this.nextStep=p.nextStep;this.baseline=new Uint32Array(data.buffer,data.byteOffset,p.n*12).slice();}
 invalidate(){this.baseline=null;}
}

export function decodeWaterMirror(data,n){
 if(data.length!==n*20||!data.every(Number.isFinite))throw Error('Invalid resident water result');
 // GPU publishes SoA: these are views of one transferred buffer, not seven
 // JS deinterleaving loops. Counts remain numeric, as in all consumers.
 return {positions:data.subarray(0,n*4),transport:{velocities:data.subarray(n*4,n*8),chem:data.subarray(n*8,n*12),metrics:data.subarray(n*12,n*16),counts:data.subarray(n*16,n*17),activity:data.subarray(n*17,n*19),breakup:data.subarray(n*19,n*20)}};
}
