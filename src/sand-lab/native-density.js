import {rotate,boundaryMetric,boundaryKernel} from './water-lab-model.js';
let module;
export const densityKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./kernels/density.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(async bytes=>{module=await WebAssembly.compile(bytes);return true;}).catch(()=>false);
export async function setDensityKernel(bytes){module=await WebAssembly.compile(bytes);}
export const nativeDensityAvailable=()=>!!module;
// This accelerates CPU arithmetic only. Each iteration still evaluates the
// actual sand, player and rigid-body geometry, including thin tilted cups.
// No object constraint shader is compiled or submitted to the GPU.
export class NativeDensity {
 constructor(){this.instance=new WebAssembly.Instance(module,{});this.capacity=0;}
 allocate(n,geometrySize=0){
  if(n<=this.capacity&&geometrySize<=this.geometryCapacity)return;this.capacity=Math.max(this.capacity,2**Math.ceil(Math.log2(Math.max(64,n))));this.geometryCapacity=Math.max(this.geometryCapacity||0,geometrySize);
  // Reserve the first page for compiler tables (notably double-precision pow).
  let offset=65536;const reserve=(count,Type)=>{offset=Math.ceil(offset/8)*8;const start=offset;offset+=count*Type.BYTES_PER_ELEMENT;return {start,count,Type};};
  const c=this.capacity,layout={positions:reserve(c*4,Float32Array),neighbors:reserve(c*128,Float32Array),wall:reserve(c*4,Float64Array),lambda:reserve(c,Float32Array),delta:reserve(c*3,Float64Array),pairs:reserve(c*64*5,Float64Array),accum:reserve(c*5,Float64Array),geometry:reserve(this.geometryCapacity,Float64Array),metric:reserve(4,Float64Array)};
  const memory=this.instance.exports.memory,pages=Math.ceil(offset/65536),current=memory.buffer.byteLength/65536;if(pages>current)memory.grow(pages-current);
  this.offsets={};for(const [key,{start,count,Type}] of Object.entries(layout)){this.offsets[key]=start;this[key]=new Type(memory.buffer,start,count);}
 }

 prepareGeometry(lab){
  const a=this.geometry,s=lab.sand,p=lab.player,binOffset=32+s.n*s.n+lab.balls.length*16;a.fill(0);a.set([s.n,s.dx,s.dz,lab.balls.length,...(p?.base||[0,0,0]),p?.radius||0,p?.height||0,32,32+s.n*s.n,lab.u.uSandCount.value>0?1:0,...lab.u.uSandMin.value.toArray(),...lab.u.uSandMax.value.toArray(),binOffset]);a.set(lab.terrainHeights,32);
  const bins=lab.u.uSandBins.value.image.data;for(let i=0;i<1024;i++)a[binOffset+i]=bins[i*4+1];
  lab.balls.forEach((b,i)=>{const o=32+s.n*s.n+i*16,axes=[[1,0,0],[0,1,0],[0,0,1]].map(p=>rotate(p,b.tilt||0,b.spin||0,true,b.pitch||0));a.set([...b.position,b.radius,b.shape==='cup'?1:0],o);for(let row=0;row<3;row++)for(let col=0;col<3;col++)a[o+5+row*3+col]=axes[col][row];});
 }
 solve(positions,neighbors,spacing,iterations=3,collide=p=>p,boundary=null,lab=null){
  const n=positions.length/4;if(!n)return positions.slice();const geometry=lab?.sand&&lab.optimizations?.terrainCache!==false?lab:null;
  geometry?.syncSandUniforms();this.allocate(n,geometry?32+geometry.sand.n**2+geometry.balls.length*16+1024:0);if(geometry)this.prepareGeometry(geometry);this.positions.set(positions);this.neighbors.set(neighbors);const o=this.offsets,h=spacing*2;
  for(let iteration=0;iteration<iterations;iteration++){
   if(boundary)for(let i=0;i<n;i++){
    const at=i*4,p=[this.positions[at],this.positions[at+1],this.positions[at+2]],fast=geometry&&this.instance.exports.metric(...p,h,o.geometry,o.metric)===0,metric=fast?{normal:this.metric,distance:this.metric[3]}:boundaryMetric(p,boundary,h),b=boundaryKernel(metric.distance,h),f=b.density>1e-6?b.gradient:0;
    this.wall[at]=metric.normal[0]*f;this.wall[at+1]=metric.normal[1]*f;this.wall[at+2]=metric.normal[2]*f;this.wall[at+3]=b.density;
   }else this.wall.fill(0,0,n*4);
   const pairs=this.instance.exports.pairs(n,o.positions,o.neighbors,o.pairs,o.accum,spacing);
   this.instance.exports.density(n,o.accum,o.wall,o.lambda,spacing);
   this.instance.exports.correction(n,pairs,o.positions,o.pairs,o.wall,o.lambda,o.delta,spacing);
   for(let i=0;i<n;i++){
    const at=i*4;if(this.positions[at+3]>.5)continue;const point=[this.delta[i*3],this.delta[i*3+1],this.delta[i*3+2]],fast=geometry&&this.instance.exports.contact(...point,spacing*.12,o.geometry,o.metric)===0,p=fast?this.metric:collide(point);
    this.positions[at]=p[0];this.positions[at+1]=p[1];this.positions[at+2]=p[2];
   }
  }
  return this.positions.slice(0,n*4);
 }
}
