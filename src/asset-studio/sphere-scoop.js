import {Vector3} from 'three';
import {CELL,MAX_CUTS} from './ground-tools.js';

// Integrate a clipped sphere on a polar mesh. The same prisms supply the
// removed volume, the handheld mesh and the spatial distribution of loose grains.
export function sphereScoop(sim,point,radius){
 const tris=[],nodes=new Map(),samples=[],rings=[],center=point.clone(),sides=16,bands=5;
 const height=(x,z)=>sim.matter.groundHeight(sim,x,z);
 function vertex(dx,dz,span){
  const top=Math.max(-span,Math.min(span,height(point.x+dx,point.z+dz)-point.y));
  return [new Vector3(dx,top,dz),new Vector3(dx,-span,dz)];
 }
 for(let k=0;k<=bands;k++){
  const angle=Math.PI*.5*k/bands,r=radius*Math.sin(angle);
  rings.push(Array.from({length:sides},(_,i)=>vertex(r*Math.cos(i*2*Math.PI/sides),r*Math.sin(i*2*Math.PI/sides),radius*Math.cos(angle))));
 }
 function face(a,b,c){
  const [u,v,w]=[a[0],b[0],c[0]],area=Math.abs((v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x))*.5;
  const vol=area*((u.y-a[1].y)+(v.y-b[1].y)+(w.y-c[1].y))/3;
  if(vol<1e-12)return;
  tris.push(...u.toArray(),...w.toArray(),...v.toArray(),...a[1].toArray(),...b[1].toArray(),...c[1].toArray());
  const sample=u.clone().add(v).add(w).add(a[1]).add(b[1]).add(c[1]).multiplyScalar(1/6);
  samples.push({sample,vol,points:[u,v,w,a[1],b[1],c[1]]});
  const x=(center.x+sample.x)/CELL,z=(center.z+sample.z)/CELL,i=Math.floor(x),j=Math.floor(z),fx=x-i,fz=z-j;
  for(const [di,dj,weight] of [[0,0,Math.max(0,1-fx-fz)],[1,0,Math.min(fx,1-fz)],[0,1,Math.min(fz,1-fx)],[1,1,Math.max(0,fx+fz-1)]]){
   if(weight<1e-10)continue;
   const key=(i+di)+','+(j+dj),n=nodes.get(key)??{i:i+di,j:j+dj,depth:0};
   n.depth+=vol*weight/(CELL*CELL);nodes.set(key,n);
  }
 }
 for(let k=0;k<bands;k++)for(let i=0;i<sides;i++){
  const j=(i+1)%sides;face(rings[k][i],rings[k+1][i],rings[k+1][j]);
  if(k)face(rings[k][i],rings[k+1][j],rings[k][j]);
 }
 if(!samples.length)return null;
 if(!sim.sandTerrain){
  let count=sim.cuts.nodes.size;
  for(const [key,n] of nodes){const existing=sim.cuts.nodes.get(key);if(!existing)count++;if((existing?.depth??0)+n.depth>4)return null;}
  if(count>MAX_CUTS)return null;
 }
 for(const n of nodes.values()){
  if(sim.sandTerrain)sim.sandTerrain.change(n.i,n.j,-n.depth);
  else sim.cuts.node(n.i*CELL,n.j*CELL).depth+=n.depth;
 }
 if(!sim.sandTerrain)sim.cuts.version++;
 return {top:center,radius,depth:radius,ring:rings.at(-1).map(p=>p[0]),vertices:tris,samples,volume:samples.reduce((v,s)=>v+s.vol,0)};
}
export function sampledPackets(c,m,origin,count){
 let cumulative=c.samples[0].vol,j=0;const volume=c.volume/count;
 return Array.from({length:count},(_,i)=>{
  while(j<c.samples.length-1&&cumulative<(i+.5)*volume)cumulative+=c.samples[++j].vol;
  return {position:origin.clone().add(c.samples[j].sample),radius:Math.cbrt(volume*3/(4*Math.PI))*.87,volume,material:m};
 });
}
