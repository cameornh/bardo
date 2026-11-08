// Exact CPU MAC scatter/gather. Same Float64 accumulation and Float32 particle
// rounding as grid.js; no approximate math, particle thinning or changed dt.
@inline function get32(p:usize,i:i32):f64{return load<f32>(p+usize(i)*4);}
@inline function get64(p:usize,i:i32):f64{return load<f64>(p+usize(i)*8);}
@inline function i32at(p:usize,i:i32):i32{return load<i32>(p+usize(i)*4);}
@inline function add(p:usize,i:i32,x:f64):void{const at=p+usize(i)*8;store<f64>(at,load<f64>(at)+x);}
export function scatter(n:i32,positions:usize,predicted:usize,cells:usize,phase:usize,indices:usize,weights:usize,config:usize,faces:usize,dt:f64,scale:f64):void{
 for(let i=0;i<n;i++){
  const o=i*4,cell=i32at(cells,i);if(get32(positions,o+3)!=0||cell<0||load<u8>(phase+usize(cell))!=1)continue;
  const x=(get32(positions,o)*scale-get64(config,0))/get64(config,3),y=(get32(positions,o+1)*scale-get64(config,1))/get64(config,4),z=(get32(positions,o+2)*scale-get64(config,2))/get64(config,5);
  for(let axis=0;axis<3;axis++){
   const table=axis*8,dx=i32at(faces,table),dy=i32at(faces,table+1),dz=i32at(faces,table+2),before=usize(i32at(faces,table+3)),weight=usize(i32at(faces,table+4));
   const px=x-(axis==0?0:.5),py=y-(axis==1?0:.5),pz=z-(axis==2?0:.5),bx=i32(Math.floor(px)),by=i32(Math.floor(py)),bz=i32(Math.floor(pz)),fx=px-bx,fy=py-by,fz=pz-bz,v=(get32(predicted,o+axis)-get32(positions,o+axis))*scale/dt,base=i*24+axis*8;
   for(let k=0;k<8;k++){const a=k&1,b=(k>>1)&1,c=(k>>2)&1,ix=bx+a,iy=by+b,iz=bz+c;if(ix<0||iy<0||iz<0||ix>=dx||iy>=dy||iz>=dz)continue;
    const at=ix+dx*(iy+dy*iz),w=(a?fx:1-fx)*(b?fy:1-fy)*(c?fz:1-fz);store<i32>(indices+usize(base+k)*4,at);store<f64>(weights+usize(base+k)*8,w);add(before,at,w*v);add(weight,at,w);
   }
  }
 }
}
export function gather(n:i32,positions:usize,predicted:usize,cells:usize,phase:usize,indices:usize,weights:usize,faces:usize,result:usize,dt:f64,scale:f64,spacing:f64):i32{
 const pic=1-Math.exp(-dt*1.5),limit=spacing*.45;let coupled=0;memory.copy(result,predicted,usize(n)*16);
 for(let i=0;i<n;i++){
  const o=i*4,cell=i32at(cells,i);if(get32(positions,o+3)!=0||cell<0||load<u8>(phase+usize(cell))!=1)continue;coupled++;let length2:f64=0;
  for(let axis=0;axis<3;axis++){
   const table=axis*8,before=usize(i32at(faces,table+3)),vel=usize(i32at(faces,table+5)),a=usize(i32at(faces,table+6)),b=usize(i32at(faces,table+7)),base=i*24+axis*8;
   let delta:f64=0,velocity:f64=0,weight:f64=0;
   for(let k=0;k<8;k++){const at=i32at(indices,base+k);if(at<0)continue;const ca=i32at(a,at),cb=i32at(b,at);if((ca<0||load<u8>(phase+usize(ca))!=1)&&(cb<0||load<u8>(phase+usize(cb))!=1))continue;
    const w=get64(weights,base+k);weight+=w;delta+=(get64(vel,at)-get64(before,at))*w;velocity+=get64(vel,at)*w;
   }
   const inv=weight>1e-12?1/weight:0,flip=get32(predicted,o+axis)-get32(positions,o+axis)+delta*inv*dt/scale,move=(1-pic)*flip+pic*velocity*inv*dt/scale;
   store<f32>(result+usize(o+axis)*4,f32(move));length2+=move*move;
  }
  const cap=Math.min(1,limit/Math.max(1e-12,Math.sqrt(length2)));for(let axis=0;axis<3;axis++)store<f32>(result+usize(o+axis)*4,f32(get32(positions,o+axis)+get32(result,o+axis)*cap));
 }return coupled;
}
