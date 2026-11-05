import * as THREE from 'three';
import {QUAD_VERTEX} from '../../shaders.js';
import {readLabPixelsAsync} from '../../sand-lab/water-lab-readback.js';
import {multiply,norm,solveMultigrid,vcycle} from './multigrid.js';
const WIDTH=128;
// Generic sparse stencil, never a scene/SDF shader. All V-cycle intermediate
// pressure, residual, restriction and prolongation textures remain on the GPU.
const fragment=`precision highp float;precision highp int;
uniform sampler2D uX,uB,uRows,uEdges,uMap,uCoarse,uChildren;
uniform int uCount,uMode;out vec4 result;
ivec2 uv(int i){return ivec2(i%128,i/128);}float val(sampler2D t,int i){return texelFetch(t,uv(i),0).r;}
void main(){int i=int(gl_FragCoord.x)+128*int(gl_FragCoord.y);result=vec4(0);if(i>=uCount||uMode==4)return;
 vec4 row=texelFetch(uRows,uv(i),0);float x=val(uX,i),b=val(uB,i);
 if(uMode==2){int p=int(val(uMap,i));result.r=x+val(uCoarse,p);return;}
 if(uMode==3){vec4 range=texelFetch(uChildren,uv(i),0);float s=0.;for(int k=0;k<32;k++){if(k>=int(range.y))break;int j=int(val(uEdges,int(range.x)+k));s+=val(uX,j);}result.r=s;return;}
 float sum=0.;for(int k=0;k<64;k++){if(k>=int(row.z))break;vec4 e=texelFetch(uEdges,uv(int(row.y)+k),0);sum+=e.y*val(uX,int(e.x));}
 result.r=uMode==1?b-row.x*x+sum:(row.x>0.?x+.7*((b+sum)/row.x-x):0.);
}`;
function texture(values,channels=1){const height=Math.max(1,Math.ceil(values.length/channels/WIDTH)),data=new Float32Array(WIDTH*height*4);for(let i=0;i<values.length/channels;i++)for(let k=0;k<channels;k++)data[i*4+k]=values[i*channels+k];const t=new THREE.DataTexture(data,WIDTH,height,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;}
const target=n=>new THREE.WebGLRenderTarget(WIDTH,Math.ceil(n/WIDTH),{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
export class GPUMultigrid {
 constructor(renderer){
  this.renderer=renderer;this.disabled=false;this.busy=false;this.validated=false;this.u={};for(const k of ['uX','uB','uRows','uEdges','uMap','uCoarse','uChildren'])this.u[k]={value:null};this.u.uCount={value:0};this.u.uMode={value:0};
  this.material=new THREE.ShaderMaterial({name:'live-field-multigrid',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});this.material.userData.rtxOptionalCompute=true;this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();
 }
 configure(levels){
  if(this.levels===levels)return;this.clear();this.levels=levels;
  this.resources=levels.map((g,l)=>{
   if(g.n>12288||g.offset.some((v,i)=>i<g.n&&g.offset[i+1]-v>64)||(g.children||[]).some(c=>c.length>32))throw Error('GPU field stencil exceeds work budget');
   const rows=[],edges=[];for(let i=0;i<g.n;i++)rows.push(g.diag[i],g.offset[i],g.offset[i+1]-g.offset[i],0);for(let k=0;k<g.column.length;k++)edges.push(g.column[k],g.weight[k],0,0);
   const r={n:g.n,rows:texture(rows,4),edges:texture(edges.length?edges:[0,0,0,0],4),map:texture(g.parent||new Int32Array(g.n)),x:[target(g.n),target(g.n)],residual:target(g.n),b:target(g.n),cursor:0};
   if(l<levels.length-1){const ranges=[],children=[];for(const ids of g.children){ranges.push(children.length,ids.length,0,0);children.push(...ids);}r.ranges=texture(ranges,4);r.children=texture(children);}return r;
  });
 }
 draw(r,mode,out,{x=r.x[r.cursor].texture,b=r.b.texture,edges=r.edges,coarse=x,children=r.rows,count=r.n}={}){
  const u=this.u;u.uX.value=x;u.uB.value=b;u.uRows.value=r.rows;u.uEdges.value=edges;u.uMap.value=r.map;u.uCoarse.value=coarse;u.uChildren.value=children;u.uCount.value=count;u.uMode.value=mode;
  this.renderer.setRenderTarget(out);this.renderer.render(this.scene,this.camera);this.draws++;
 }
 smooth(l,b,passes){const r=this.resources[l];for(let i=0;i<passes;i++){this.draw(r,0,r.x[1-r.cursor],{b});r.cursor=1-r.cursor;}}
 cycle(l,b){
  const r=this.resources[l];if(l===this.resources.length-1){this.smooth(l,b,32);return;}
  this.smooth(l,b,3);this.draw(r,1,r.residual,{b});const child=this.resources[l+1];
  this.draw(r,3,child.b,{x:r.residual.texture,edges:r.children,children:r.ranges,count:child.n});
  this.draw(child,4,child.x[child.cursor],{x:child.b.texture});this.cycle(l+1,child.b.texture);
  this.draw(r,2,r.x[1-r.cursor],{coarse:child.x[child.cursor].texture});r.cursor=1-r.cursor;this.smooth(l,b,3);
 }
 async solve(levels,rhs,{cycles=2,correct=true}={}){
  if(this.busy||this.disabled)throw Error('GPU field solve unavailable');this.busy=true;
  const renderer=this.renderer,old=renderer.getRenderTarget(),start=performance.now();let input;
  try{
   this.configure(levels);this.draws=0;input=texture(rhs);const r=this.resources[0];
   // Explicit zero texture avoids inheriting the scene clear color.
   this.draw(r,4,r.x[r.cursor],{x:input});
   for(let i=0;i<cycles;i++)this.cycle(0,input);
   const data=new Float32Array(WIDTH*r.x[r.cursor].height*4),pending=readLabPixelsAsync(renderer,r.x[r.cursor],WIDTH,r.x[r.cursor].height,data,{eager:true});renderer.setRenderTarget(old);
   await pending;const potential=Float64Array.from({length:r.n},(_,i)=>data[4*i]);
   let relativeResidual=norm(multiply(levels[0],potential).map((v,i)=>v-rhs[i]))/Math.max(norm(rhs),1e-12);
   if(!potential.every(Number.isFinite)||!Number.isFinite(relativeResidual))throw Error('Non-finite GPU field pressure');
   let result={potential,relativeResidual,absoluteResidual:relativeResidual*Math.max(norm(rhs),1e-12),iterations:cycles,levels:levels.length,backend:'GPU resident multigrid'};
   if(correct&&relativeResidual>2e-5)result={...solveMultigrid(levels,rhs,{initial:potential}),backend:'GPU multigrid + CPU residual correction'};
   result.milliseconds=performance.now()-start;result.draws=this.draws;result.readbacks=1;
   // Expensive/failed work is never resubmitted in a loop. The reference stays usable.
   if(this.validated&&result.milliseconds>500)this.disabled=true;
   return result;
  }catch(error){this.disabled=true;throw error;}finally{input?.dispose();renderer.setRenderTarget(old);this.busy=false;}
 }
 async verify(levels,rhs){
  const expected=vcycle(levels,rhs),actual=await this.solve(levels,rhs,{cycles:1,correct:false});let max=0;
  for(let i=0;i<rhs.length;i++)max=Math.max(max,Math.abs(actual.potential[i]-expected[i]));
  const cyclePass=max<2e-4*Math.max(1,...expected.map(Math.abs));
  if(!cyclePass){this.disabled=true;return {pass:false,maxPotentialError:max};}
  // Validate the complete solve too, including the residual correction used
  // by the beach. One V-cycle alone is intentionally not a converged solve.
  const solved=await this.solve(levels,rhs),reference=solveMultigrid(levels,rhs,{tolerance:1e-9,iterations:120});
  const relativePressureError=norm(solved.potential.map((v,i)=>v-reference.potential[i]))/Math.max(norm(reference.potential),1e-12);
  const pass=solved.relativeResidual<3e-5&&relativePressureError<5e-4;this.validated=pass;
  if(!pass)this.disabled=true;return {pass,maxPotentialError:max,relativePressureError,relativeResidual:solved.relativeResidual,draws:solved.draws,coldMilliseconds:actual.milliseconds,milliseconds:solved.milliseconds,readbacks:solved.readbacks};
 }
 clear(){for(const r of this.resources||[])for(const v of Object.values(r)){if(Array.isArray(v))v.forEach(t=>t?.dispose?.());else v?.dispose?.();}this.resources=null;this.levels=null;}
 dispose(){this.clear();this.geometry.dispose();this.material.dispose();}
}
