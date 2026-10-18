import {shapeRadius,shapeBlend,sandIsTracer} from './sand-shape.js';

const cell=(v,axis)=>Math.max(0,Math.min(31,Math.floor((v+(axis===0?5.5:4.9))/(axis===0?11:9.8)*32)));
export const sandCell=p=>cell(p[0],0)+32*cell(p[2],2);
// The ellipsoid distance scales by min(1, aspect). Its blend therefore reaches
// farther sideways than radius + blend on a flattened deposit. Include a
// normal/contact margin too; cuts can shrink these bounds, never enlarge them.
export function sandExtent(p){
 const a=p.aspect||1,r=shapeRadius(p),padding=(shapeBlend(p)+.1)/Math.min(1,a);
 return [r+padding,(r+padding)*a,r+padding];
}
// Packed variable-length lists. A busy cell never falls back to scanning every
// sand parcel in the scene, and no layer is discarded when a cell gets crowded.
export function buildSandBins(parcels){
 const cells=Array.from({length:1024},()=>[]),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 parcels.forEach((p,i)=>{
  if(p.mass<=0||sandIsTracer(p))return;
  const e=sandExtent(p);
  for(let z=cell(p.position[2]-e[2],2);z<=cell(p.position[2]+e[2],2);z++)for(let x=cell(p.position[0]-e[0],0);x<=cell(p.position[0]+e[0],0);x++)cells[z*32+x].push(i);
  for(let k=0;k<3;k++){min[k]=Math.min(min[k],p.position[k]-e[k]);max[k]=Math.max(max[k],p.position[k]+e[k]);}
 });
 const headers=new Float32Array(1024*4),count=cells.reduce((n,c)=>n+c.length,0),indices=new Float32Array(Math.max(256,Math.ceil(count/256)*256));let offset=0,maxCount=0;
 cells.forEach((c,i)=>{headers[i*4]=offset;headers[i*4+1]=c.length;indices.set(c,offset);offset+=c.length;maxCount=Math.max(maxCount,c.length);});
 const data=new Float32Array(Math.ceil((headers.length+count)/1024)*1024);data.set(headers);data.set(indices.subarray(0,count),headers.length);
 return {data,headers,indices,min:Number.isFinite(min[0])?min:[0,0,0],max:Number.isFinite(max[0])?max:[0,0,0],maxCount};
}
