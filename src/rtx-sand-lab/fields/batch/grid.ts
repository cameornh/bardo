// Exact f64 MAC face work. No relaxed math, SIMD reduction, or camera inputs.
@inline function ip(p:usize,i:i32):i32{return load<i32>(p+usize(i)*4);}
@inline function fp(p:usize,i:i32):f64{return load<f64>(p+usize(i)*8);}
@inline function put(p:usize,i:i32,v:f64):void{store<f64>(p+usize(i)*8,v);}
@inline function phase(p:usize,i:i32):i32{return i<0?0:load<u8>(p+usize(i));}
@inline function clip(v:f64,a:f64,b:f64):f64{return Math.max(a,Math.min(b,v));}
@inline function field(t:usize,k:i32):usize{return usize(ip(t,k));}

function sample(x:f64,y:f64,z:f64,t:usize):f64{
 const nx=ip(t,0),ny=ip(t,1),nz=ip(t,2),bx=i32(Math.floor(x)),by=i32(Math.floor(y)),bz=i32(Math.floor(z)),fx=x-f64(bx),fy=y-f64(by),fz=z-f64(bz),prior=field(t,13);
 let sum:f64=0,w:f64=0;
 for(let k=0;k<8;k++){
  const dx=k&1,dy=(k>>1)&1,dz=(k>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;
  if(ix<0||iy<0||iz<0||ix>=nx||iy>=ny||iz>=nz)continue;
  const weight=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);sum+=weight*fp(prior,ix+nx*(iy+ny*iz));w+=weight;
 }
 return w>1e-12?sum/w:0;
}

export function faces(table:usize,ph:usize,config:usize,dt:f64,h:f64,relax:f64,waterViscosity:f64,airViscosity:f64):void{
 // Table: dims, n, a, b, before, weight, velocity, coefficient, valid,
 // advection indices/weights, prior, wind/wall target, delta, SI positions.
 for(let axis=0;axis<3;axis++){
  const t=table+usize(axis)*68,n=ip(t,3),nx=ip(t,0),ny=ip(t,1),nz=ip(t,2),a=field(t,4),b=field(t,5),before=field(t,6),weight=field(t,7),velocity=field(t,8),valid=field(t,10),prior=field(t,13);
  memory.fill(valid,0,usize(n));memory.copy(prior,velocity,usize(n)*8);
  for(let i=0;i<n;i++)if(fp(weight,i)>1e-9){put(before,i,fp(before,i)/fp(weight,i));store<u8>(valid+usize(i),1);}
  for(let layer=1;layer<=3;layer++)for(let i=0;i<n;i++)if(!load<u8>(valid+usize(i))&&(phase(ph,ip(a,i))==1||phase(ph,ip(b,i))==1)){
   const x=i%nx,y=(i/nx)%ny,z=i/(nx*ny);let sum:f64=0,count=0;
   // Same neighbor order as the JS reference; a newly extended face only
   // participates in the next layer, independent of traversal order.
   for(let k=0;k<6;k++){
    let j=0;
    if(k==0){if(x==0)continue;j=i-1;}
    else if(k==1){if(x+1>=nx)continue;j=i+1;}
    else if(k==2){if(y==0)continue;j=i-nx;}
    else if(k==3){if(y+1>=ny)continue;j=i+nx;}
    else if(k==4){if(z==0)continue;j=i-nx*ny;}
    else{if(z+1>=nz)continue;j=i+nx*ny;}
    const v=i32(load<u8>(valid+usize(j)));if(v>0&&v<=layer){sum+=fp(before,j);count++;}
   }
   if(count){put(before,i,sum/f64(count));store<u8>(valid+usize(i),u8(layer+1));}
  }
 }
 const limit=h*.42/dt,trace=h*.45;
 for(let axis=0;axis<3;axis++){
  const t=table+usize(axis)*68,n=ip(t,3),a=field(t,4),b=field(t,5),before=field(t,6),velocity=field(t,8),coefficient=field(t,9),indices=field(t,11),weights=field(t,12),prior=field(t,13),target=field(t,14),position=field(t,16);
  for(let i=0;i<n;i++){
   if(!fp(coefficient,i)){put(velocity,i,clip(fp(target,i),-limit,limit));continue;}
   if(phase(ph,ip(a,i))==1||phase(ph,ip(b,i))==1){put(velocity,i,fp(before,i));continue;}
   let qx:f64=0,qy:f64=0,qz:f64=0;
   for(let k=0;k<3;k++){
    let v:f64=0;const base=i*12+k*4,other=field(table+usize(k)*68,13);
    for(let j=0;j<4;j++){const at=ip(indices,base+j);if(at>=0)v+=fp(other,at)*fp(weights,base+j);}
    const q=fp(position,i*3+k)-clip(v*dt,-trace,trace),normalized=(q-fp(config,k))/fp(config,k+3);
    if(k==0)qx=normalized;else if(k==1)qy=normalized;else qz=normalized;
   }
   const x=i32(Math.floor(qx)),y=i32(Math.floor(qy)),z=i32(Math.floor(qz)),dx=i32(fp(config,6)),dy=i32(fp(config,7)),dz=i32(fp(config,8));
   const cell=x<0||y<0||z<0||x>=dx||y>=dy||z>=dz?-1:x+dx*(y+dy*z);
   const advected=cell>=0&&phase(ph,cell)==2?sample(qx-(axis==0?0:.5),qy-(axis==1?0:.5),qz-(axis==2?0:.5),t):fp(prior,i);
   const v=clip(advected+(fp(target,i)-advected)*relax,-limit,limit);put(velocity,i,v);put(before,i,v);
  }
 }
 for(let axis=0;axis<3;axis++){
  const t=table+usize(axis)*68,n=ip(t,3),nx=ip(t,0),ny=ip(t,1),nz=ip(t,2),a=field(t,4),b=field(t,5),velocity=field(t,8),coefficient=field(t,9),delta=field(t,15);
  memory.fill(delta,0,usize(n)*8);
  for(let i=0;i<n;i++)if(fp(coefficient,i)){
   const pa=phase(ph,ip(a,i)),p=pa?pa:phase(ph,ip(b,i));
   for(let k=0;k<3;k++){
    const c=k==0?i%nx:k==1?(i/nx)%ny:i/(nx*ny),d=k==0?nx:k==1?ny:nz;
    if(c+1>=d)continue;const j=i+(k==0?1:k==1?nx:nx*ny),qa=phase(ph,ip(a,j)),q=qa?qa:phase(ph,ip(b,j));
    if(!fp(coefficient,j)||q!=p)continue;
    const size=fp(config,k+3),flux=dt*(p==1?waterViscosity:airViscosity)/(size*size)*(fp(velocity,j)-fp(velocity,i));
    put(delta,i,fp(delta,i)+flux);put(delta,j,fp(delta,j)-flux);
   }
  }
  for(let i=0;i<n;i++)put(velocity,i,fp(velocity,i)+fp(delta,i));
 }
}

export function air(table:usize,ph:usize,config:usize,out:usize,valid:usize):void{
 const nx=i32(fp(config,6)),ny=i32(fp(config,7)),nz=i32(fp(config,8)),n=nx*ny*nz;
 memory.fill(out,0,usize(n)*24);memory.fill(valid,0,usize(n));
 for(let i=0;i<n;i++)if(phase(ph,i)==2){
  store<u8>(valid+usize(i),1);const x=i%nx,y=(i/nx)%ny,z=i/(nx*ny);
  for(let axis=0;axis<3;axis++){
   const t=table+usize(axis)*68,dx=ip(t,0),dy=ip(t,1),v=field(t,8),a=x+dx*(y+dy*z),stride=axis==0?1:axis==1?dx:dx*dy;
   put(out,i*3+axis,(fp(v,a)+fp(v,a+stride))*.5);
  }
 }
 for(let layer=1;layer<=2;layer++)for(let i=0;i<n;i++)if(!load<u8>(valid+usize(i))&&phase(ph,i)==1){
  let x:f64=0,y:f64=0,z:f64=0,count=0;
  for(let axis=0;axis<3;axis++)for(let sign=-1;sign<=1;sign+=2){
   const c=axis==0?i%nx:axis==1?(i/nx)%ny:i/(nx*ny),dim=axis==0?nx:axis==1?ny:nz;
   if(c+sign<0||c+sign>=dim)continue;
   const j=i+sign*(axis==0?1:axis==1?nx:nx*ny),v=i32(load<u8>(valid+usize(j)));if(!v||v>layer)continue;
   x+=fp(out,j*3);y+=fp(out,j*3+1);z+=fp(out,j*3+2);count++;
  }
  if(count){put(out,i*3,x/f64(count));put(out,i*3+1,y/f64(count));put(out,i*3+2,z/f64(count));store<u8>(valid+usize(i),u8(layer+1));}
 }
}

// Materials: density / heat capacity / conductivity, indexed by phase.
// Ledger updates stay in reference face/cell order, including the reservoir.
export function scalars(table:usize,ph:usize,config:usize,materials:usize,temp:usize,humidity:usize,heat:usize,vapour:usize,dilation:usize,ledger:usize,dt:f64,volume:f64,boundaryHumidity:f64):i32{
 let courant:f64=0;
 for(let axis=0;axis<3;axis++){const t=table+usize(axis)*68,n=ip(t,3),v=field(t,8);let max:f64=0;for(let i=0;i<n;i++)max=Math.max(max,Math.abs(fp(v,i)));courant+=max/fp(config,axis+3);}
 const steps=i32(Math.max(1,Math.ceil(dt*courant/.45)));if(steps>16)return -1;
 const sub=dt/f64(steps),n=i32(fp(config,6)*fp(config,7)*fp(config,8));
 for(let step=0;step<steps;step++){
  memory.fill(heat,0,usize(n)*8);memory.fill(vapour,0,usize(n)*8);memory.fill(dilation,0,usize(n)*8);
  for(let axis=0;axis<3;axis++){
   const t=table+usize(axis)*68,fn=ip(t,3),ap=field(t,4),bp=field(t,5),v=field(t,8),coefficient=field(t,9),size=fp(config,axis+3);
   for(let k=0;k<fn;k++){
    const a=ip(ap,k),b=ip(bp,k),pa=a<0?2:phase(ph,a),pb=b<0?2:phase(ph,b);if(!fp(coefficient,k)||!pa||!pb)continue;
    const ca=fp(materials,pa*3)*fp(materials,pa*3+1)*volume;
    if(pa==pb){
     const velocity=fp(v,k),donor=velocity>=0?a:b,temperature=donor<0?293.15:fp(temp,donor),q=donor<0?boundaryHumidity:fp(humidity,donor),flow=sub*velocity/size;
     const energy=flow*ca*(temperature-273.15),water=pa==2?flow*fp(materials,6)*volume*q:0;
     if(a>=0){put(heat,a,fp(heat,a)-energy);put(vapour,a,fp(vapour,a)-water);}else{put(ledger,0,fp(ledger,0)+energy);put(ledger,1,fp(ledger,1)+water);}
     if(b>=0){put(heat,b,fp(heat,b)+energy);put(vapour,b,fp(vapour,b)+water);}else{put(ledger,0,fp(ledger,0)-energy);put(ledger,1,fp(ledger,1)-water);}
     if(a>=0)put(dilation,a,fp(dilation,a)+flow);if(b>=0)put(dilation,b,fp(dilation,b)-flow);
    }
    if(a>=0&&b>=0){const ka=fp(materials,pa*3+2),kb=fp(materials,pb*3+2),energy=sub*2*ka*kb/(ka+kb)*volume/(size*size)*(fp(temp,b)-fp(temp,a));put(heat,a,fp(heat,a)+energy);put(heat,b,fp(heat,b)-energy);}
   }
  }
  for(let i=0;i<n;i++)if(phase(ph,i)){
   const p=phase(ph,i),density=fp(materials,p*3),capacity=density*fp(materials,p*3+1)*volume,remap=fp(dilation,i)*capacity*(fp(temp,i)-273.15),waterRemap=p==2?fp(dilation,i)*density*volume*fp(humidity,i):0;
   put(heat,i,fp(heat,i)+remap);put(vapour,i,fp(vapour,i)+waterRemap);put(ledger,2,fp(ledger,2)+remap);put(ledger,3,fp(ledger,3)+waterRemap);
   put(temp,i,fp(temp,i)+fp(heat,i)/capacity);if(p==2)put(humidity,i,fp(humidity,i)+fp(vapour,i)/(density*volume));
  }
 }
 return steps;
}
