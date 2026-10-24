@inline function value(g:usize,i:i32):f64{return load<f64>(g+usize(i)*8);}
@inline function limit(v:f64,lo:f64,hi:f64):f64{return Math.max(lo,Math.min(hi,v));}
function height(x:f64,z:f64,g:usize):f64{
 const n=i32(value(g,0)),a=limit((x+5.5)/value(g,1),0,n-1),b=limit((z+4.9)/value(g,2),0,n-1),i=i32(Math.floor(a)),j=i32(Math.floor(b)),u=a-i,v=b-j;
 const w0=(1-u)*(1-u)*(1-u)/6,w1=(3*u*u*u-6*u*u+4)/6,w2=(-3*u*u*u+3*u*u+3*u+1)/6,w3=u*u*u/6;
 const z0=(1-v)*(1-v)*(1-v)/6,z1=(3*v*v*v-6*v*v+4)/6,z2=(-3*v*v*v+3*v*v+3*v+1)/6,z3=v*v*v/6;
 const x0=i32(Math.max(0,i-1)),x2=i32(Math.min(n-1,i+1)),x3=i32(Math.min(n-1,i+2)),offset=i32(value(g,9));let h:f64=0;
 for(let row=0;row<4;row++){const k=i32(limit(j+row-1,0,n-1))*n+offset,w=row==0?z0:row==1?z1:row==2?z2:z3;
  h+=value(g,k+x0)*w0*w;h+=value(g,k+i)*w1*w;h+=value(g,k+x2)*w2*w;h+=value(g,k+x3)*w3*w;
 }return h;
}
function solid(x:f64,y:f64,z:f64,g:usize):f64{
 let d=(y-height(x,z,g))*.65;
 const count=i32(value(g,3)),offset=i32(value(g,10));
 for(let i=0;i<count;i++){
  const o=offset+i*16,px=x-value(g,o),py=y-value(g,o+1),pz=z-value(g,o+2),r=value(g,o+3),bound=d+r*1.5;
  if(bound<=0||px*px+py*py+pz*pz>=bound*bound)continue;
  let q:f64;
  if(value(g,o+4)<.5)q=Math.sqrt(px*px+py*py+pz*pz)-r;
  else{
   const a=value(g,o+5)*px+value(g,o+6)*py+value(g,o+7)*pz,b=value(g,o+8)*px+value(g,o+9)*py+value(g,o+10)*pz,c=value(g,o+11)*px+value(g,o+12)*py+value(g,o+13)*pz,rad=Math.sqrt(a*a+c*c),wall=r*.16;
   q=Math.min(Math.max(Math.abs(rad-r*.84)-wall,Math.abs(b)-r),Math.max(rad-r,Math.abs(b+r)-wall));
  }d=Math.min(d,q);
 }
 if(value(g,7)>0){const px=x-value(g,4),py=y-value(g,5),pz=z-value(g,6),dy=py-limit(py,0,value(g,8));d=Math.min(d,Math.sqrt(px*px+dy*dy+pz*pz)-value(g,7));}
 return Math.min(d,Math.min(5.5-Math.abs(x),Math.min(4.9-Math.abs(z),9-y)));
}
function sandAt(x:f64,y:f64,z:f64,g:usize):bool{
 if(x<value(g,12)||y<value(g,13)||z<value(g,14)||x>value(g,15)||y>value(g,16)||z>value(g,17))return false;
 const i=i32(limit(Math.floor((x+5.5)/11*32),0,31)),j=i32(limit(Math.floor((z+4.9)/9.8*32),0,31));
 return value(g,i32(value(g,18))+i+j*32)>0;
}
function needsReference(x:f64,y:f64,z:f64,g:usize):bool{
 if(value(g,11)<=0)return false;
 // Exactly the same local bins as SandLab.solid, including every sample
 // of its finite-difference normal. Distant parcels must not turn the
 // empty space between them into a slow JavaScript geometry query.
 const e=.003;
 return sandAt(x,y,z,g)||sandAt(x+e,y,z,g)||sandAt(x-e,y,z,g)||sandAt(x,y+e,z,g)||sandAt(x,y-e,z,g)||sandAt(x,y,z+e,g)||sandAt(x,y,z-e,g);
}
export function metric(x:f64,y:f64,z:f64,reach:f64,g:usize,out:usize):i32{
 if(needsReference(x,y,z,g))return 1;
 const d=solid(x,y,z,g);let gx:f64=0,gy:f64=0,gz:f64=0,m:f64=1;
 if(d<reach){const e=.003;gx=(solid(x+e,y,z,g)-solid(x-e,y,z,g))/(2*e);gy=(solid(x,y+e,z,g)-solid(x,y-e,z,g))/(2*e);gz=(solid(x,y,z+e,g)-solid(x,y,z-e,g))/(2*e);m=Math.max(.05,Math.sqrt(gx*gx+gy*gy+gz*gz));}
 store<f64>(out,gx/m);store<f64>(out+8,gy/m);store<f64>(out+16,gz/m);store<f64>(out+24,d/m);return 0;
}
export function contact(x:f64,y:f64,z:f64,radius:f64,g:usize,out:usize):i32{
 for(let i=0;i<3;i++){
  if(metric(x,y,z,radius,g,out))return 1;const distance=load<f64>(out+24);if(distance>=radius)break;
  x+=load<f64>(out)*(radius-distance);y+=load<f64>(out+8)*(radius-distance);z+=load<f64>(out+16)*(radius-distance);
 }
 store<f64>(out,x);store<f64>(out+8,y);store<f64>(out+16,z);return 0;
}
