import {makeBody,bodyDistance} from './objects.js';

// Opt-in scenery for the current beach; numerical/snapshot fixtures keep
// their original empty layout. These use the existing solid-rock path.
export function beachBoulders(sand,scale=10){
 const size=10/scale;
 return [
  {x:-3.5,z:3.65,r:.68,color:[.34,.32,.29]},
  {x:2.55,z:3.95,r:.74,color:[.39,.35,.29]},
  {x:-.65,z:2.7,r:.54,color:[.29,.31,.32]},
 ].map(b=>({...b,x:b.x*size,z:b.z*size,r:b.r*size})).filter(b=>Math.abs(b.x)+b.r<5.5&&Math.abs(b.z)+b.r<4.9).map(({x,z,r,color})=>Object.assign(makeBody('rock','sphere',r,[x,sand.height(x,z)-r*.25,z]),{fixed:true,scenery:'boulder',color}));
}
export function installBeachBoulders(lab){
 const rocks=beachBoulders(lab.sand,lab.physicalResolution?lab.spec.scale:10);lab.balls.push(...rocks);
 // Start with water outside the embedded rock, rather than asking the first
 // simulation frame to explosively eject overlapping seed particles.
 const keep=[];for(let i=0;i<lab.count;i++){const p=Array.from(lab.positions.subarray(i*4,i*4+3));if(rocks.every(b=>bodyDistance(p,b)>=lab.spacing*.12))keep.push(i);}
 for(const name of ['positions','velocities','chem']){const source=lab[name],next=new Float32Array(keep.length*4);keep.forEach((id,i)=>next.set(source.subarray(id*4,id*4+4),i*4));lab[name]=next;}
 lab.neighborCounts=new Uint16Array(keep.length);lab.initialVolume=lab.volume;
}
