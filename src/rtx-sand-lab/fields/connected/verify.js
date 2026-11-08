import {particleFixture,referenceParticles,compareParticles} from '../particles/verify.js';
import {BeachFieldGrid} from '../grid.js';
export const freshGrid=g=>new BeachFieldGrid({dims:g.dims,h:g.h,origin:g.origin,extent:g.cellSize.map((v,k)=>v*g.dims[k])});
export async function verifyConnected(pipeline){
 const rows=[];const cases=[{nx:4,ny:3,nz:4,objects:false},{nx:7,ny:4,nz:5},{nx:12,ny:5,nz:9},{nx:7,ny:4,nz:5,objects:false,carved:true},{nx:4,ny:3,nz:4,objects:false,offset:[5.2,0,4.6]},{nx:7,ny:4,nz:5,objects:false,player:true},{nx:12,ny:5,nz:9,objects:false,enclosed:true}];
 for(const options of cases){
  const f=particleFixture(options),grid=freshGrid(f.grid),cpu=freshGrid(f.grid),{context:c,lab}=f;
  const environment={solid:options.enclosed?()=>-1:p=>lab.solid(p.map(v=>v/c.scale))*c.scale,wind:p=>[1+Math.sin(p[2]*.07),.1,Math.cos(p[0]*.05)],wall:p=>[.03,0,.01]};
  for(let a=0;a<3;a++)for(let i=0;i<grid.faces[a].velocity.length;i++)grid.faces[a].velocity[i]=cpu.faces[a].velocity[i]=Math.sin(i*.17+a)*.1;
  const start=performance.now(),rhs=cpu.deposit(c.old,c.predicted,c.dt,c.scale,c.s,environment.solid,environment.wind,environment.wall),pressure=cpu.solve(rhs,c.dt),expected=referenceParticles({...f,grid:cpu}),cpuMs=performance.now()-start;
  const actual=await pipeline.solve(c,lab,grid,{environment,geometry:f.geometry,debug:true});let faceError=0,beforeError=0,rhsError=0,at=0;
  for(const face of cpu.faces)for(let i=0;i<face.velocity.length;i++,at++){faceError=Math.max(faceError,Math.abs(face.velocity[i]-actual.fieldResult.faces[at*4]));beforeError=Math.max(beforeError,Math.abs(face.before[i]-actual.fieldResult.faces[at*4+1]));}
  for(let i=0;i<rhs.length;i++)rhsError=Math.max(rhsError,Math.abs(rhs[i]-actual.fieldResult.rhs[i]));
  const comparison=compareParticles(actual,expected);rows.push({case:options.enclosed?'sealed field':options.carved?'carved terrain':options.player?'player contact':options.offset?'boundary':'open field',closedComponents:grid.closed.length,particles:lab.count,...comparison,pass:comparison.pass&&faceError<.003&&beforeError<.0001&&rhsError<.001,faceError,beforeError,rhsError,relativeResidual:actual.fieldResult.relativeResidual,cpuMs,gpu:actual.stats});if(!rows.at(-1).pass)break;
 }
 let overflowGuard=false;
 if(rows.length===cases.length&&rows.every(r=>r.pass)){
  const f=particleFixture({nx:8,ny:4,nz:4,objects:false});f.context.old.fill(0);f.context.predicted.fill(0);
  try{await pipeline.solve(f.context,f.lab,freshGrid(f.grid),{geometry:f.geometry});}
  catch(e){overflowGuard=/bucket full/.test(e.message)&&!pipeline.disabled;}
 }
 pipeline.validated=rows.length===cases.length&&rows.every(r=>r.pass)&&overflowGuard&&!pipeline.disabled;return {pass:pipeline.validated,overflowGuard,rows};
}
