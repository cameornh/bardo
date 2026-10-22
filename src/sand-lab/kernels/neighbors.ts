// AssemblyScript, compiled with the command in build-neighbors.mjs.
// Same reciprocal traversal, cutoff, insertion order and overflow policy as
// PackedNeighbors. Double precision arithmetic preserves JS cutoff decisions.
@inline function pairRange(i:i32, begin:i32, end:i32, positions:usize, indices:usize, starts:usize, data:usize, counts:usize, sorted:usize, capacity:i32, radius2:f64):i32 {
 const p=positions+usize(i)*16, px=f64(load<f32>(p)),py=f64(load<f32>(p+4)),pz=f64(load<f32>(p+8));
 const row=data+usize(i)*512;let count=load<i32>(counts+usize(i)*4),overflow=0;
 for(let b=begin;b<end;b++){
  const x=px-f64(load<f32>(sorted+usize(b)*4));if(x*x>=radius2)continue;
  const y=py-f64(load<f32>(sorted+usize(capacity+b)*4)),xy=x*x+y*y;if(xy>=radius2)continue;
  const z=pz-f64(load<f32>(sorted+usize(capacity*2+b)*4));if(xy+z*z>=radius2)continue;
  const j=load<i32>(indices+usize(b)*4),other=load<i32>(counts+usize(j)*4);
  if(count==128||other==128){overflow++;continue;}
  store<f32>(row+usize(count)*4,f32(j));count++;
  store<f32>(data+usize(j)*512+usize(other)*4,f32(i));store<i32>(counts+usize(j)*4,other+1);
 }
 store<i32>(counts+usize(i)*4,count);return overflow;
}
@inline function cell(x:i32,y:i32,z:i32,table:usize,xyz:usize,mask:i32):i32 {
 let slot=((x*73856093)^(y*19349663)^(z*83492791))&mask;
 while(load<i32>(table+usize(slot)*4)!=0){const i=load<i32>(table+usize(slot)*4)-1,o=xyz+usize(i)*12;
  if(load<i32>(o)==x&&load<i32>(o+4)==y&&load<i32>(o+8)==z)return i;slot=(slot+1)&mask;
 }return -1;
}
export function build(n:i32,capacity:i32,cells:i32,reach:f64,positions:usize,table:usize,xyz:usize,starts:usize,indices:usize,data:usize,counts:usize,sorted:usize):i32 {
 memory.fill(counts,0,usize(n)*4);
 for(let i=0;i<n*128;i++)store<f32>(data+usize(i)*4,-1);
 for(let a=0;a<n;a++){const o=positions+usize(load<i32>(indices+usize(a)*4))*16;
  store<f32>(sorted+usize(a)*4,load<f32>(o));store<f32>(sorted+usize(capacity+a)*4,load<f32>(o+4));store<f32>(sorted+usize(capacity*2+a)*4,load<f32>(o+8));
 }
 const radius2=reach*reach;let overflow=0;
 for(let c=0;c<cells;c++){
  const start=load<i32>(starts+usize(c)*4),end=load<i32>(starts+usize(c+1)*4),o=xyz+usize(c)*12;
  for(let a=start;a<end;a++)overflow+=pairRange(load<i32>(indices+usize(a)*4),a+1,end,positions,indices,starts,data,counts,sorted,capacity,radius2);
  for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
   if(z<0||z==0&&y<0||z==0&&y==0&&x<=0)continue;
   const other=cell(load<i32>(o)+x,load<i32>(o+4)+y,load<i32>(o+8)+z,table,xyz,capacity*4-1);if(other<0)continue;
   const ox=f64(load<i32>(xyz+usize(other)*12))*reach,oy=f64(load<i32>(xyz+usize(other)*12+4))*reach,oz=f64(load<i32>(xyz+usize(other)*12+8))*reach;
   for(let a=start;a<end;a++){
    const i=load<i32>(indices+usize(a)*4),p=positions+usize(i)*16;
    const dx=Math.max(ox-f64(load<f32>(p)),Math.max(0,f64(load<f32>(p))-ox-reach));
    const dy=Math.max(oy-f64(load<f32>(p+4)),Math.max(0,f64(load<f32>(p+4))-oy-reach));
    const dz=Math.max(oz-f64(load<f32>(p+8)),Math.max(0,f64(load<f32>(p+8))-oz-reach));
    if(dx*dx+dy*dy+dz*dz>=radius2)continue;
    overflow+=pairRange(i,load<i32>(starts+usize(other)*4),load<i32>(starts+usize(other+1)*4),positions,indices,starts,data,counts,sorted,capacity,radius2);
   }
  }
 }return overflow;
}
