import {CELL,groundWedge} from './ground-tools.js';
import {bedKey} from './material-bed.js';
import {SAND_SIDE,repose,entrainment} from './wind-sand.js';

const N=SAND_SIDE,area=CELL*CELL;
const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
// Signed heights are local to the world. A triangular nodal basis integrates to one
// cell area, so an excavation, airborne parcel and deposit use the same volume.
export class SandTerrain{
 constructor(base,material){
  this.base=base;this.limit=repose(material)*CELL;this.tiles=new Map();this.active=new Map();
  this.mobile=new Map();this.contactRevisions=new Map();this.windThreshold=entrainment(material);
  this.version=0;this.clock=0;this.maxOffset=0;
 }
 tile(x,z){return this.tiles.get(bedKey(x,z));}
 node(i,j){
  const x=Math.floor(i/N),z=Math.floor(j/N);
  return this.tile(x,z)?.heights[(j-z*N)*N+i-x*N]||0;
 }
 change(i,j,delta){
  if(!delta)return;
  const x=Math.floor(i/N),z=Math.floor(j/N),key=bedKey(x,z);
  let tile=this.tiles.get(key);
  if(!tile){tile={heights:new Float64Array(N*N),version:0};this.tiles.set(key,tile);}
  const h=tile.heights[(j-z*N)*N+i-x*N]+=delta;this.maxOffset=Math.max(this.maxOffset,Math.abs(h));tile.version=++this.version;
  const point=bedKey(i,j),coords=[i,j];
  this.active.set(point,coords);
  if(Math.abs(h)>.0004)this.mobile.set(point,coords);else this.mobile.delete(point);
  this.contactRevisions.set(key,this.version);
  if(i===x*N)this.contactRevisions.set(bedKey(x-1,z),this.version);
  if(j===z*N)this.contactRevisions.set(bedKey(x,z-1),this.version);
  if(i===x*N&&j===z*N)this.contactRevisions.set(bedKey(x-1,z-1),this.version);
 }
 // A heightfield also owns the samples on its two positive edges.
 revision(x,z){return this.contactRevisions.get(bedKey(x,z))||0;}
 addTileHeights(heights,x,z){
  for(let dz=0;dz<=1;dz++)for(let dx=0;dx<=1;dx++){
   const tile=this.tile(x+dx,z+dz);if(!tile)continue;
   const cols=dx?1:N,rows=dz?1:N;
   for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)
    heights[(i+dx*N)*(N+1)+j+dz*N]+=tile.heights[j*N+i];
  }
 }
 offset(x,z){
  const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  return this.node(i+1,j)*Math.min(a,1-b)+this.node(i,j+1)*Math.min(b,1-a)
   +(a+b<=1?this.node(i,j)*(1-a-b):this.node(i+1,j+1)*(a+b-1));
 }
 height(x,z){return this.base.height(x,z)+this.offset(x,z);}
 extract(x,z,depth,height){
  const i=Math.round(x/CELL),j=Math.round(z/CELL);
  const cut=groundWedge(i*CELL,j*CELL,depth,height);this.change(i,j,-depth);return cut;
 }
 deposit(x,z,volume){
  const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,h=volume/area;
  // The same barycentric weights used to sample the slope transfer the load back.
  this.change(i,j,h*Math.max(0,1-a-b));this.change(i+1,j,h*Math.min(a,1-b));
  this.change(i,j+1,h*Math.min(b,1-a));this.change(i+1,j+1,h*Math.max(0,a+b-1));
 }
 // Transport the local excess (or deficit) relative to the background dune flux.
 // A fixed work budget keeps distant edits from creating recurring full-world scans.
 blow(wind){
  const excess=(wind?.speed||0)-this.windThreshold;
  if(excess<=0||!this.mobile.size)return;
  const rad=wind.heading*Math.PI/180,x=Math.cos(rad),z=Math.sin(rad),norm=Math.abs(x)+Math.abs(z);
  const fraction=Math.min(.15,excess*.0015),batch=[];
  for(const [key,[i,j]] of this.mobile){
   batch.push([key,i,j,this.node(i,j)*fraction]);
   if(batch.length===96)break;
  }
  for(const [key,i,j,amount] of batch){
   this.mobile.delete(key);
   this.change(i,j,-amount);
   if(Math.abs(x)>1e-8)this.change(i+Math.sign(x),j,amount*Math.abs(x)/norm);
   if(Math.abs(z)>1e-8)this.change(i,j+Math.sign(z),amount*Math.abs(z)/norm);
  }
 }
 advance(dt,wind){
  this.clock+=dt;if(this.clock<.05)return;this.clock%=.05;
  this.blow(wind);
  const take=Math.min(160,this.active.size);
  for(let k=0;k<take;k++){
   const [key,[i,j]]=this.active.entries().next().value;this.active.delete(key);
   let h=this.height(i*CELL,j*CELL);
   for(const [di,dj] of directions){
    const x=i+di,z=j+dj,diff=h-this.height(x*CELL,z*CELL);
    const over=Math.abs(diff)-this.limit*(di&&dj?Math.SQRT2:1);
    if(over<.0005)continue;
    const transfer=.27*Math.sign(diff)*over;
    this.change(i,j,-transfer);this.change(x,z,transfer);h-=transfer;
   }
  }
 }
}
