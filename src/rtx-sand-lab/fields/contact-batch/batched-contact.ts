import {metric,contact} from './contact-geometry';
// One call for the whole parcel array. Only occupied edited-sand bins return
// to the general JS CSG reference; all other contact arithmetic stays native.
export function boundaryBatch(n:i32,pos:usize,wall:usize,g:usize,out:usize,missing:usize,h:f64,last:usize,reuse:bool):i32 {
 let count=0;
 for(let i=0;i<n;i++){
  const p=pos+usize(i)*16,w=wall+usize(i)*32,old=last+usize(i)*16;
  // Geometry is fixed during one solve. Reuse only bit-identical positions;
  // the first iteration always refreshes after moving bodies or terrain edits.
  if(reuse && load<u64>(p)==load<u64>(old) && load<u32>(p+8)==load<u32>(old+8))continue;
  memory.copy(old,p,12);
  if(metric(f64(load<f32>(p)),f64(load<f32>(p+4)),f64(load<f32>(p+8)),h,g,out)){store<i32>(missing+usize(count++)*4,i);continue;}
  const q=Math.max(0,Math.min(1,load<f64>(out+24)/h)),q2=q*q,rho=.5-315./256.*q*(1.-q2*(4./3.-q2*(6./5.-q2*(4./7.-q2/9.)))),a=1.-q2,a2=a*a,f=rho>1e-6?-315./(256.*h)*a2*a2:0.;
  store<f64>(w,load<f64>(out)*f);store<f64>(w+8,load<f64>(out+8)*f);store<f64>(w+16,load<f64>(out+16)*f);store<f64>(w+24,rho);
 }
 return count;
}
export function contactBatch(n:i32,pos:usize,delta:usize,g:usize,out:usize,missing:usize,r:f64):i32 {
 let count=0;
 for(let i=0;i<n;i++){
  const p=pos+usize(i)*16;if(load<f32>(p+12)>.5)continue;const d=delta+usize(i)*24;
  if(contact(load<f64>(d),load<f64>(d+8),load<f64>(d+16),r,g,out)){store<i32>(missing+usize(count++)*4,i);continue;}
  store<f32>(p,f32(load<f64>(out)));store<f32>(p+4,f32(load<f64>(out+8)));store<f32>(p+8,f32(load<f64>(out+16)));
 }
 return count;
}
