// Same reciprocal particle transport as water-lab-transport.js. This CPU kernel
// keeps the hybrid solver's already-CPU state off the GPU readback round trip.
@inline function get(p: usize,i: i32): f64 { return load<f32>(p+usize(i)*4); }
@inline function put(p: usize,i: i32,v: f64): void { store<f32>(p+usize(i)*4,f32(v)); }
@inline function read(p:usize,i:i32,k:i32):f64{return load<f64>(p+usize(i*12+k)*8);}
@inline function add(p:usize,i:i32,k:i32,v:f64):void{const at=p+usize(i*12+k)*8;store<f64>(at,load<f64>(at)+v);}
export function transport(n:i32,old:usize,next:usize,previous:usize,chem:usize,neighbors:usize,predicted:usize,raw:usize,vel:usize,out:usize,metrics:usize,counts:usize,activity:usize,breakup:usize,accum:usize,reciprocal:bool,s:f64,scale:f64,dt:f64,viscosity:f64,capillary:f64,surfaceTension:f64,density:f64):void {
 const h=2*s,invH2=1/(h*h),w0=315/(512*Math.PI),diff=Math.min(.006,dt*.12),threshold=Math.max(.08,.3*Math.sqrt(9.81*s*scale));
 for(let i=0;i<n;i++){const o=i*4;for(let k=0;k<3;k++)put(raw,o+k,get(old,o+3)>0?0:(get(next,o+k)-get(old,o+k))/dt);}
 memory.fill(accum,0,usize(n)*12*8);
 for(let i=0;i<n;i++)for(let a=0;a<128;a++){
  const j=i32(get(neighbors,i*128+a));if(j<0)break;if(reciprocal&&j<i)continue;
  const o=i*4,q=j*4,x=get(next,o)-get(next,q),y=get(next,o+1)-get(next,q+1),z=get(next,o+2)-get(next,q+2),r2=x*x+y*y+z*z;if(r2>=h*h)continue;
  const v=1-r2*invH2,w=w0*v*v*v,r=Math.sqrt(r2),vx=get(raw,q)-get(raw,o),vy=get(raw,q+1)-get(raw,o+1),vz=get(raw,q+2)-get(raw,o+2),radial=(vx*x+vy*y+vz*z)/Math.max(r,1e-8),d=(1-r/h)*diff;
  add(accum,i,0,w);add(accum,i,1,vx*w);add(accum,i,2,vy*w);add(accum,i,3,vz*w);
  add(accum,i,4,x*w);add(accum,i,5,y*w);add(accum,i,6,z*w);add(accum,i,7,radial*radial*w);add(accum,i,8,r<s*1.9?1:0);
  for(let k=0;k<3;k++){const c=(get(chem,q+k)-get(chem,o+k))*d;add(accum,i,9+k,c);if(reciprocal)add(accum,j,9+k,-c);}
  if(reciprocal){add(accum,j,0,w);add(accum,j,1,-vx*w);add(accum,j,2,-vy*w);add(accum,j,3,-vz*w);
   add(accum,j,4,-x*w);add(accum,j,5,-y*w);add(accum,j,6,-z*w);add(accum,j,7,radial*radial*w);add(accum,j,8,r<s*1.9?1:0);}
 }
 for(let i=0;i<n;i++){
  const o=i*4,weight=read(accum,i,0),ax=read(accum,i,1),ay=read(accum,i,2),az=read(accum,i,3),nx=read(accum,i,4),ny=read(accum,i,5),nz=read(accum,i,6),strain=read(accum,i,7),count=i32(read(accum,i,8)),c0=read(accum,i,9),c1=read(accum,i,10),c2=read(accum,i,11);
  const ix=predicted?(get(predicted,o)-get(old,o))/dt:get(previous,o),iy=predicted?(get(predicted,o+1)-get(old,o+1))/dt:get(previous,o+1)-9.81/scale*dt,iz=predicted?(get(predicted,o+2)-get(old,o+2))/dt:get(previous,o+2);
  const rx=get(raw,o),ry=get(raw,o+1),rz=get(raw,o+2),lost=Math.sqrt(Math.max(0,ix*ix+iy*iy+iz*iz-rx*rx-ry*ry-rz*rz)),tx=ix-rx,ty=iy-ry,tz=iz-rz,impactSpeed=Math.max(lost,Math.sqrt(tx*tx+ty*ty+tz*tz))*scale;
  const normalLength=Math.sqrt(nx*nx+ny*ny+nz*nz),inv=1/Math.max(normalLength,1e-8),surface=Math.min(1,normalLength/s*12),deformation=Math.sqrt(strain/Math.max(.2,weight))*scale;
  const breaking=Math.max(0,deformation-threshold*.9)/(threshold+.35),impact=Math.max(0,impactSpeed-threshold*1.2)/(threshold+.35),energy=surface*Math.min(1,weight/.18)*Math.min(5,breaking*.8+impact*.7),smooth=.012+viscosity/Math.max(.1,weight),cap=capillary*dt*surface;
  const held=get(old,o+3)>0;put(vel,o,held?0:rx+ax*smooth-nx*inv*cap);put(vel,o+1,held?0:ry+ay*smooth-ny*inv*cap);put(vel,o+2,held?0:rz+az*smooth-nz*inv*cap);put(vel,o+3,0);
  const outward=-(ax*nx+ay*ny+az*nz)*inv/Math.max(.02,weight)*scale,capillarySpeed=Math.sqrt(surfaceTension/(density*s*scale));
  put(breakup,i,held?0:surface*Math.min(1,weight/.12)*Math.min(3,Math.max(0,outward-Math.max(4*capillarySpeed,threshold*.5))/Math.max(.15,threshold)));
  put(activity,i*2,Math.max(deformation,Math.max(0,outward)));put(activity,i*2+1,impactSpeed);store<u16>(counts+usize(i)*2,u16(count));
  put(out,o,get(chem,o)+c0);put(out,o+1,get(chem,o+1)+c1);put(out,o+2,get(chem,o+2)+c2);put(out,o+3,Math.min(1,get(chem,o+3)*Math.exp(-dt*.65)+energy*dt*.3));
  put(metrics,o,nx*inv);put(metrics,o+1,ny*inv);put(metrics,o+2,nz*inv);put(metrics,o+3,held?0:energy);
 }
}
