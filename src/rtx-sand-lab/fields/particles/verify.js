import {BeachFieldGrid} from '../grid.js';
import {FieldNeighbors} from '../neighbors.js';
import {surfaceConstraints} from '../surface-constraints.js';
import {transportFluid} from '../../../sand-lab/water-lab-transport.js';
import {shapeDistance} from '../../../sand-lab/sand-shape.js';
import {FieldTransport} from '../native-transport.js';
import {bodyDistance} from '../../../sand-lab/objects.js';
import {boundaryMetric,rotate} from '../../../sand-lab/water-lab-model.js';
export function particleFixture({nx=7,ny=4,nz=5,objects=true,held=true,carved=false,player=false,offset=[0,0,0]}={}){
 const s=.23,scale=10,dt=1/30,n=nx*ny*nz,old=new Float32Array(n*4),predicted=old.slice(),chem=old.slice(),velocities=old.slice();
 const balls=objects?[{position:[-.5,.45,0],radius:.33,shape:'sphere'},{position:[.8,.28,0],radius:.35,shape:'cup',tilt:.4,pitch:.3,spin:.2}]:[];
 for(let z=0,i=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++,i++){
  const o=i*4;old.set([(x-(nx-1)/2)*s,.03+y*s,(z-(nz-1)/2)*s,held&&i%41===0?1:0],o);
  chem.set([.1+(i%5)*.02,.2+(i%3)*.01,.04,.1],o);
  for(let k=0;k<3;k++){velocities[o+k]=Math.sin(i*.31+k)*.06;predicted[o+k]=old[o+k]+(old[o+3]?0:velocities[o+k]*dt-(k===1?9.81/scale*dt*dt:0));}predicted[o+3]=old[o+3];
 }
 if(offset.some(Boolean))for(let o=0;o<old.length;o+=4)for(let k=0;k<3;k++){old[o+k]+=offset[k];predicted[o+k]+=offset[k];}
 const parcel={position:[0,.1,0],shapeRadius:.7,aspect:.8,cuts:[{offset:[0,.45,0],radius:.5}],surfaceBlend:.08};
 const terrain=p=>{let d=p[1]*.65;if(carved){const q=shapeDistance(parcel,p),h=Math.max(.08-Math.abs(d-q),0)/.08;d=Math.min(d,q)-h*h*.08*.25;}return d;};
 const capsule=p=>Math.hypot(p[0]+.2,p[1]-.1-Math.max(0,Math.min(.8,p[1]-.1)),p[2])-.22;
 const solid=p=>Math.min(player?capsule(p):Infinity,terrain(p),5.5-Math.abs(p[0]),4.9-Math.abs(p[2]),9-p[1],...balls.map(b=>bodyDistance(p,b)));
 const lab={spacing:s,spec:{scale},count:n,balls,velocities,chem,sand:{n:2},u:{uSandBins:{value:{image:{data:new Float32Array(4096)}}}},solid,playerDistance:capsule,collide:p=>{p=p.slice();for(let k=0;k<3;k++){const m=boundaryMetric(p,solid,s*.12);if(m.distance>=s*.12)break;p=p.map((v,j)=>v+m.normal[j]*(s*.12-m.distance));}return p;}};
 const grid=new BeachFieldGrid({dims:[14,8,12],h:8,origin:[-55,-5,-49],extent:[110,60,98]});const rhs=grid.deposit(old,predicted,dt,scale,s,p=>solid(p.map(v=>v/scale))*scale,()=>[0,0,0]);grid.solve(rhs,dt);
 const base=32+4+balls.length*16+1024,geometry=new Float32Array(base+(carved?4100+13:0));geometry.set([2,11,9.8,balls.length,0,0,0,0,0,32,36]);
 if(player)geometry.set([-.2,.1,0,.22,.8],4);
 balls.forEach((b,i)=>{const o=36+i*16,axes=[[1,0,0],[0,1,0],[0,0,1]].map(p=>rotate(p,b.tilt||0,b.spin||0,true,b.pitch||0));geometry.set([...b.position,b.radius,b.shape==='cup'?1:0],o);for(let row=0;row<3;row++)for(let col=0;col<3;col++)geometry[o+5+row*3+col]=axes[col][row];});
 if(carved){const shapes=base+4100;geometry.set([-3,-3,-3,3,3,3],12);geometry[19]=shapes;geometry[20]=base;for(let i=0;i<1024;i++)geometry[base+i*4+1]=1;geometry.set([...parcel.position,.7,.8,.08,shapes+8,1,...parcel.cuts[0].offset,.5,1],shapes);}
 return {lab,grid,geometry,context:{old,predicted,s,scale,dt}};
}
export function referenceParticles({context,lab,grid},{optimized=false}={}){
 const t=performance.now(),p=grid.transfer(context.old,context.predicted,context.dt,context.scale,context.s),neighbors=(optimized?(lab.benchmarkNeighbors??=new FieldNeighbors()):new FieldNeighbors()).build(p,context.s,{native:optimized,reuse:optimized});
 if(neighbors.overflow)throw Error('Reference neighbor budget exceeded');
 const surface=surfaceConstraints(lab,p,neighbors.data,grid,{native:optimized}),old=context.old.slice(),pred=context.predicted.slice();for(let o=0;o<old.length;o+=4)for(let k=0;k<3;k++){old[o+k]+=surface.shift[o+k];pred[o+k]+=surface.shift[o+k];}
 return {transferred:p,shift:surface.shift,lambda:surface.lambda,wall:surface.wall,neighbors:neighbors.data,positions:surface.positions,transport:optimized?(lab.benchmarkTransport??=new FieldTransport()).solve(old,surface.positions,lab.velocities,lab.chem,neighbors.data,context.s,context.scale,context.dt,pred,true):transportFluid(old,surface.positions,lab.velocities,lab.chem,neighbors.data,context.s,context.scale,context.dt,pred),milliseconds:performance.now()-t};
}
export function compareParticles(actual,expected){
 const errors={};let finite=true;
 for(const key of ['positions','velocities','chem','metrics','counts','activity','breakup']){const a=key==='positions'?actual.positions:actual.transport[key],b=key==='positions'?expected.positions:expected.transport[key];let error=0;for(let i=0;i<b.length;i++){finite&&=Number.isFinite(a[i]);error=Math.max(error,Math.abs(a[i]-b[i]));}errors[key]=error;}
 const intermediate={position:0,shift:0,neighbors:0};if(actual.intermediate){const w=actual.intermediate.work,ns=actual.intermediate.neighbors;for(let i=0;i<expected.positions.length/4;i++){for(let k=0;k<3;k++){intermediate.position=Math.max(intermediate.position,Math.abs(w[i*16+k]-expected.transferred[i*4+k]));intermediate.shift=Math.max(intermediate.shift,Math.abs(w[i*16+8+k]-expected.shift[i*4+k]));}const a=new Set(ns.subarray(i*129,i*129+ns[i*129+128]));for(let k=0;k<128;k++){const j=expected.neighbors[i*128+k];if(j<0)break;if(!a.delete(j))intermediate.neighbors++;}intermediate.neighbors+=a.size;}}
 const diagnostics=[];if(actual.intermediate){const w=actual.intermediate.work;for(let i=0;i<expected.lambda.length;i++){const e=Math.abs(w[i*16+12]-expected.lambda[i]);if(e>1e-6)diagnostics.push({i,e,gpuLambda:w[i*16+12],cpuLambda:expected.lambda[i],gpuWall:Array.from(w.subarray(i*16+4,i*16+8)),cpuWall:Array.from(expected.wall.subarray(i*4,i*4+4))});}}const worst=[];for(let o=0;o<expected.positions.length;o+=4){const d=Math.hypot(...[0,1,2].map(k=>actual.positions[o+k]-expected.positions[o+k]));if(d>.0001)worst.push({i:o/4,error:d,cpu:Array.from(expected.positions.subarray(o,o+4)),gpu:Array.from(actual.positions.subarray(o,o+4))});}
 return {diagnostics:diagnostics.sort((a,b)=>b.e-a.e).slice(0,5),intermediate,worst:worst.sort((a,b)=>b.error-a.error).slice(0,5),pass:finite&&errors.positions<.0003&&errors.velocities<.01&&errors.chem<.0001&&errors.metrics<.02&&errors.counts===0&&errors.activity<.03&&errors.breakup<.02,errors};
}
export async function verifyParticles(pipeline){
 const rows=[];for(const options of [{nx:4,ny:3,nz:4,objects:false},{nx:7,ny:4,nz:5},{nx:12,ny:5,nz:9},{nx:7,ny:4,nz:5,objects:false,carved:true},{nx:4,ny:3,nz:4,objects:false,offset:[5.2,0,4.6]},{nx:7,ny:4,nz:5,objects:false,player:true}]){
  const f=particleFixture(options),reference=referenceParticles(f),actual=await pipeline.solve(f.context,f.lab,f.grid,{geometry:f.geometry,debug:true});rows.push({particles:f.lab.count,...compareParticles(actual,reference),cpuReferenceMs:reference.milliseconds,...actual.stats});
  if(!rows.at(-1).pass||pipeline.disabled)break;
 }
 let overflowGuard=false;if(rows.length===6&&rows.every(r=>r.pass)){const f=particleFixture({nx:8,ny:4,nz:4,objects:false});f.context.old.fill(0);f.context.predicted.fill(0);try{await pipeline.solve(f.context,f.lab,f.grid,{geometry:f.geometry});}catch(e){overflowGuard=/bucket full/.test(e.message)&&!pipeline.disabled;}}
 pipeline.validated=rows.length===6&&rows.every(r=>r.pass)&&overflowGuard&&!pipeline.disabled;return {pass:pipeline.validated,overflowGuard,rows};
}
