import {bodySupport,cupContains,cupCapacity} from './objects.js';

// Sample the same local parcel index used by sand and bodies. Eight exterior
// sectors estimate the surrounding free surface without treating the dry cup
// cavity as a hole in the ocean. Interior parcels retain their simulated mass.
export function cupWaterState(body,positions,spacing,index,neighborCounts=null){
 const r=body.radius,reach=index.reach,outer=Math.max(bodySupport(body,[1,0,0]),bodySupport(body,[-1,0,0]),bodySupport(body,[0,0,1]),bodySupport(body,[0,0,-1])),horizontal=outer+spacing*2.5,vertical=bodySupport(body,[0,1,0])+bodySupport(body,[0,-1,0])+spacing*2;
 const lo=body.position.map((v,k)=>Math.floor((v-(k===1?vertical:horizontal))/reach)),hi=body.position.map((v,k)=>Math.floor((v+(k===1?vertical:horizontal))/reach)),heights=new Float64Array(8).fill(-Infinity),counts=new Uint16Array(8);let waterVolume=0;
 for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)for(const i of index.bins.get((x+512)+(y+512)*1024+(z+512)*1048576)||[]){
  const o=i*4,p=[positions[o],positions[o+1],positions[o+2]];
  if(cupContains(p,body)){waterVolume+=spacing**3;continue;}
  const dx=p[0]-body.position[0],dz=p[2]-body.position[2],distance=Math.hypot(dx,dz);if(distance<outer+spacing*.1||distance>horizontal||neighborCounts&&neighborCounts[i]<8)continue;
  const sector=Math.min(7,Math.floor((Math.atan2(dz,dx)+Math.PI)/(Math.PI*2)*8));heights[sector]=Math.max(heights[sector],p[1]+spacing*.45);counts[sector]++;
 }
 const supported=Array.from(heights).filter((v,i)=>counts[i]>=3).sort((a,b)=>a-b),trim=Math.floor(supported.length/4),middle=supported.slice(trim,supported.length-trim);
 const surface=middle.length?middle.reduce((a,b)=>a+b,0)/middle.length:-Infinity;
 return {surface,waterVolume:Math.min(cupCapacity(body),waterVolume),sectors:supported.length};
}
