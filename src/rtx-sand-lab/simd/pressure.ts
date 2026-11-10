// Live SIMD experiment. f64x2 vector operations; CSR traversal stays scalar.
// Dot products retain scalar summation order, including the odd-element tail.
@inline function field(m:usize,l:i32,k:i32):usize{return usize(load<u32>(m+usize(l*10+k)*4));}
@inline function count(m:usize,l:i32):i32{return i32(field(m,l,0));}
@inline function value(p:usize,i:i32):f64{return load<f64>(p+usize(i)*8);}
@inline function put(p:usize,i:i32,v:f64):void{store<f64>(p+usize(i)*8,v);}
@inline function index(p:usize,i:i32):i32{return load<i32>(p+usize(i)*4);}
function dot(a:usize,b:usize,n:i32):f64{let s:f64=0,i=0;for(;i+1<n;i+=2){const v=f64x2.mul(v128.load(a+usize(i)*8),v128.load(b+usize(i)*8));s+=f64x2.extract_lane(v,0);s+=f64x2.extract_lane(v,1);}if(i<n)s+=value(a,i)*value(b,i);return s;}
function subtract(n:i32,b:usize,ax:usize,r:usize):void{let i=0;for(;i+1<n;i+=2){const o=usize(i)*8;v128.store(r+o,f64x2.sub(v128.load(b+o),v128.load(ax+o)));}if(i<n)put(r,i,value(b,i)-value(ax,i));}
function update(n:i32,x:usize,r:usize,d:usize,ax:usize,alpha:f64):void{let i=0;const a=f64x2.splat(alpha);for(;i+1<n;i+=2){const o=usize(i)*8;v128.store(x+o,f64x2.add(v128.load(x+o),f64x2.mul(a,v128.load(d+o))));v128.store(r+o,f64x2.sub(v128.load(r+o),f64x2.mul(a,v128.load(ax+o))));}if(i<n){put(x,i,value(x,i)+alpha*value(d,i));put(r,i,value(r,i)-alpha*value(ax,i));}}
function direction(n:i32,d:usize,z:usize,beta:f64):void{let i=0;const b=f64x2.splat(beta);for(;i+1<n;i+=2){const o=usize(i)*8;v128.store(d+o,f64x2.add(v128.load(z+o),f64x2.mul(b,v128.load(d+o))));}if(i<n)put(d,i,value(z,i)+beta*value(d,i));}
function multiply(m:usize,l:i32,x:usize,out:usize):void{
 const n=count(m,l),off=field(m,l,1),diag=field(m,l,2),col=field(m,l,3),weight=field(m,l,4);
 for(let i=0;i<n;i++){let v=value(diag,i)*value(x,i);for(let k=index(off,i);k<index(off,i+1);k++)v-=value(weight,k)*value(x,index(col,k));put(out,i,v);}
}
function smooth(m:usize,l:i32,passes:i32):void{
 const n=count(m,l),off=field(m,l,1),diag=field(m,l,2),col=field(m,l,3),weight=field(m,l,4),x=field(m,l,6),b=field(m,l,7),next=field(m,l,8);
 for(let s=0;s<passes;s++){
  for(let i=0;i<n;i++){let sum=value(b,i);for(let k=index(off,i);k<index(off,i+1);k++)sum+=value(weight,k)*value(x,index(col,k));const d=value(diag,i),old=value(x,i);put(next,i,d>0?old+.7*(sum/d-old):0);}
  memory.copy(x,next,usize(n)*8);
 }
}
function cycle(m:usize,l:i32,levels:i32):void{
 const n=count(m,l),x=field(m,l,6);memory.fill(x,0,usize(n)*8);
 if(l==levels-1){smooth(m,l,32);return;}
 smooth(m,l,3);const ax=field(m,l,9),b=field(m,l,7),parent=field(m,l,5),coarse=field(m,l+1,7);multiply(m,l,x,ax);memory.fill(coarse,0,usize(count(m,l+1))*8);
 for(let i=0;i<n;i++){const j=index(parent,i);put(coarse,j,value(coarse,j)+value(b,i)-value(ax,i));}
 cycle(m,l+1,levels);const correction=field(m,l+1,6);
 for(let i=0;i<n;i++)put(x,i,value(x,i)+value(correction,index(parent,i)));
 smooth(m,l,3);
}
function precondition(m:usize,levels:i32,r:usize,z:usize):void{const n=count(m,0);memory.copy(field(m,0,7),r,usize(n)*8);cycle(m,0,levels);memory.copy(z,field(m,0,6),usize(n)*8);}
export function pressure(m:usize,levels:i32,b:usize,x:usize,r:usize,d:usize,ax:usize,z:usize,tolerance:f64,iterations:i32):i32{
 const n=count(m,0),base=Math.max(Math.sqrt(dot(b,b,n)/f64(n)),1e-12),limit=Math.max(1e-10,base*tolerance);
 multiply(m,0,x,ax);subtract(n,b,ax,r);precondition(m,levels,r,z);memory.copy(d,z,usize(n)*8);let rz=dot(r,z,n),k=0;
 for(;k<iterations&&Math.sqrt(dot(r,r,n)/f64(n))>limit;k++){
  multiply(m,0,d,ax);const denominator=dot(d,ax,n);if(!(denominator>1e-30))break;const alpha=rz/denominator;
  update(n,x,r,d,ax,alpha);
  precondition(m,levels,r,z);const next=dot(r,z,n),beta=next/Math.max(1e-30,rz);direction(n,d,z,beta);rz=next;
 }
 return k;
}
