// Exact CSG acceleration. Every operand is 1-Lipschitz: an operand whose
// upper bound is below another's lower bound cannot win max() in this brick.
// The retained operands are still evaluated analytically, including at contacts.
export function operand(p, q, i) {
 const c=i?p.cuts[i-1]:null,a=c?(c.aspect||1):(p.aspect||1);
 const x=q[0]-(c?.offset[0]||0),y=(q[1]-(c?.offset[1]||0))/a,z=q[2]-(c?.offset[2]||0);
 const d=(Math.hypot(x,y,z)-(c?Math.abs(c.radius):p.radius))*Math.min(1,a);
 return c?.radius>0?-d:d;
}
export function buildSandBricks(shape,n=12) {
 const extent=[shape.radius,shape.radius*(shape.aspect||1),shape.radius];
 const step=extent.map(v=>2*v/n),error=Math.hypot(...step)*.5+1e-6;
 const masks=new Uint32Array(n**3),q=[0,0,0],values=new Float64Array(shape.cuts.length+1);
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  q[0]=-extent[0]+(x+.5)*step[0];q[1]=-extent[1]+(y+.5)*step[1];q[2]=-extent[2]+(z+.5)*step[2];
  let lower=-Infinity;for(let i=0;i<values.length;i++){values[i]=operand(shape,q,i);lower=Math.max(lower,values[i]-error);}
  let mask=0;for(let i=0;i<values.length;i++)if(values[i]+error>=lower)mask|=1<<i;
  masks[x+n*(y+n*z)]=mask;
 }
 return {n,extent,masks};
}
export function brickDistance(shape,bricks,q) {
 const {n,extent,masks}=bricks,c=q.map((v,k)=>Math.floor((v+extent[k])/(2*extent[k])*n));
 if(c.some(v=>v<0||v>=n))return undefined;
 let mask=masks[c[0]+n*(c[1]+n*c[2])],d=-Infinity;
 while(mask){const bit=31-Math.clz32(mask&-mask);d=Math.max(d,operand(shape,q,bit));mask&=mask-1;}
 return d;
}
