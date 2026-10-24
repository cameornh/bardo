export {metric,contact} from './contact-geometry';
// Reciprocal particle pairs: evaluate a kernel once, reuse for both endpoints
// and both PBF passes. f64 accumulation; f32 lambda/iteration boundaries.
export function pairs(n:i32,pos:usize,neighbors:usize,cache:usize,accum:usize,s:f64):i32 {
 const h=s*2,h2=h*h,volume=s*s*s,w=315/(64*Math.PI*h*h*h),g=-45/(Math.PI*Math.pow(h,6)),ref=w*Math.pow(1-.3*.3,3);
 memory.fill(accum,0,usize(n)*40);
 for(let i=0;i<n;i++)store<f64>(accum+usize(i)*40,volume*w);
 let count=0;
 for(let i=0;i<n;i++){
  const o=pos+usize(i)*16,px=f64(load<f32>(o)),py=f64(load<f32>(o+4)),pz=f64(load<f32>(o+8)),ai=accum+usize(i)*40;
  for(let a=0;a<128;a++){
   const j=i32(load<f32>(neighbors+usize(i*128+a)*4));if(j<0)break;if(j<=i)continue;
   const k=pos+usize(j)*16,x=px-f64(load<f32>(k)),y=py-f64(load<f32>(k+4)),z=pz-f64(load<f32>(k+8)),r2=x*x+y*y+z*z;
   if(r2>=h2)continue;const r=Math.sqrt(r2),q=Math.max(0,1-r*r/h2),weight=w*q*q*q,aj=accum+usize(j)*40;
   store<f64>(ai,load<f64>(ai)+volume*weight);store<f64>(aj,load<f64>(aj)+volume*weight);
   if(r<1e-6)continue;
   const c=g*(h-r)*(h-r)/r*volume,gx=x*c,gy=y*c,gz=z*c,sum=gx*gx+gy*gy+gz*gz;
   store<f64>(ai+8,load<f64>(ai+8)+sum);store<f64>(aj+8,load<f64>(aj+8)+sum);
   store<f64>(ai+16,load<f64>(ai+16)+gx);store<f64>(aj+16,load<f64>(aj+16)-gx);
   store<f64>(ai+24,load<f64>(ai+24)+gy);store<f64>(aj+24,load<f64>(aj+24)-gy);
   store<f64>(ai+32,load<f64>(ai+32)+gz);store<f64>(aj+32,load<f64>(aj+32)-gz);
   const at=cache+usize(count++)*40,ratio=weight/ref,ratio2=ratio*ratio;
   store<i32>(at,i);store<i32>(at+4,j);store<f64>(at+8,gx);store<f64>(at+16,gy);store<f64>(at+24,gz);store<f64>(at+32,-.00015*ratio2*ratio2);
  }
 }
 return count;
}
export function density(n:i32,accum:usize,wall:usize,lambda:usize,s:f64):void {
 const h=s*2;
 for(let i=0;i<n;i++){
  const a=accum+usize(i)*40,b=wall+usize(i)*32,rho=load<f64>(a)+load<f64>(b+24);
  const gx=load<f64>(a+16)+load<f64>(b),gy=load<f64>(a+24)+load<f64>(b+8),gz=load<f64>(a+32)+load<f64>(b+16);
  store<f32>(lambda+usize(i)*4,f32(-Math.max(0,rho-1)/(load<f64>(a+8)+gx*gx+gy*gy+gz*gz+.04/(h*h))));
 }
}
export function correction(n:i32,count:i32,pos:usize,cache:usize,wall:usize,lambda:usize,delta:usize,s:f64):void {
 for(let i=0;i<n;i++){
  const b=wall+usize(i)*32,d=delta+usize(i)*24,l=f64(load<f32>(lambda+usize(i)*4));
  store<f64>(d,l*f64(f32(load<f64>(b))));store<f64>(d+8,l*f64(f32(load<f64>(b+8))));store<f64>(d+16,l*f64(f32(load<f64>(b+16))));
 }
 for(let a=0;a<count;a++){
  const at=cache+usize(a)*40,i=load<i32>(at),j=load<i32>(at+4),di=delta+usize(i)*24,dj=delta+usize(j)*24;
  const force=f64(load<f32>(lambda+usize(i)*4))+f64(load<f32>(lambda+usize(j)*4))+load<f64>(at+32);
  for(let k=0;k<3;k++){
   const offset=usize(k)*8,d=force*load<f64>(at+8+offset);
   store<f64>(di+offset,load<f64>(di+offset)+d);store<f64>(dj+offset,load<f64>(dj+offset)-d);
  }
 }
 for(let i=0;i<n;i++){
  const o=pos+usize(i)*16,d=delta+usize(i)*24,dx=load<f64>(d),dy=load<f64>(d+8),dz=load<f64>(d+16);
  const limit=Math.min(1,s*.2/Math.max(1e-300,Math.sqrt(dx*dx+dy*dy+dz*dz)));
  store<f64>(d,f64(load<f32>(o))+dx*limit);store<f64>(d+8,f64(load<f32>(o+4))+dy*limit);store<f64>(d+16,f64(load<f32>(o+8))+dz*limit);
 }
}
