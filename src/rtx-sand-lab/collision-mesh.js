// CPU-only collision geometry. The render surface and stock are never changed.
import {operand,buildSandBricks} from './sand-bricks.js';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function exactShape(shape,p){let d=operand(shape,p,0);for(let i=1;i<=shape.cuts.length;i++)d=Math.max(d,operand(shape,p,i));return d;}
export function activeOperand(shape,p,bricks=null){
 let mask=-1;if(bricks){const {n,extent,masks}=bricks,c=p.map((v,k)=>Math.floor((v+extent[k])/(2*extent[k])*n));if(c.every(v=>v>=0&&v<n))mask=masks[c[0]+n*(c[1]+n*c[2])];}
 let best=-Infinity,id=0;for(let i=0;i<=shape.cuts.length;i++)if(mask&(1<<i)){const d=operand(shape,p,i);if(d>best){best=d;id=i;}}return id;
}
const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const tets=[[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6],[0,5,1,6]];
const edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

export function buildCollisionMesh(shape,n=32){
 n=Math.max(8,Math.min(48,n|0));
 const r=shape.radius,a=shape.aspect||1,pad=r*.08,extent=[r+pad,r*a+pad,r+pad],step=extent.map(v=>2*v/n),width=n+1;
 const values=new Float32Array(width**3),index=(x,y,z)=>x+width*(y+width*z),point=(x,y,z)=>[x*step[0]-extent[0],y*step[1]-extent[1],z*step[2]-extent[2]];
 for(let z=0;z<=n;z++)for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)values[index(x,y,z)]=exactShape(shape,point(x,y,z));
 const triangles=[];
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const v=corners.map(c=>values[index(x+c[0],y+c[1],z+c[2])]);if(v.every(d=>d>=0)||v.every(d=>d<0))continue;
  const p=corners.map(c=>point(x+c[0],y+c[1],z+c[2]));
  for(const t of tets){
   const poly=[];for(const [i,j] of edges){const u=t[i],w=t[j];if((v[u]<0)===(v[w]<0))continue;const f=v[u]/(v[u]-v[w]);poly.push(p[u].map((c,k)=>c+(p[w][k]-c)*f));}
   if(poly.length<3)continue;
   const center=[0,1,2].map(k=>poly.reduce((s,q)=>s+q[k],0)/poly.length),e=r*.0001;
   let normal=[0,1,2].map(k=>{const q=center.slice(),b=center.slice();q[k]+=e;b[k]-=e;return exactShape(shape,q)-exactShape(shape,b);});
   const len=Math.hypot(...normal);if(len<1e-14)continue;normal=normal.map(v=>v/len);
   const u=sub(poly[0],center),w=cross(normal,u);poly.sort((q,b)=>Math.atan2(dot(sub(q,center),w),dot(sub(q,center),u))-Math.atan2(dot(sub(b,center),w),dot(sub(b,center),u)));
   for(let i=1;i<poly.length-1;i++){
    let b=poly[i],c=poly[i+1];let fn=cross(sub(b,poly[0]),sub(c,poly[0]));const length=Math.hypot(...fn);if(length<1e-14)continue;
    const q=poly[0].map((v,k)=>(v+b[k]+c[k])/3),gradient=[0,1,2].map(k=>{const u=q.slice(),v=q.slice();u[k]+=e;v[k]-=e;return exactShape(shape,u)-exactShape(shape,v);}),g=Math.hypot(...gradient);
    if(g<1e-14)continue;
    if(dot(fn,gradient)<0)[b,c]=[c,b];
    triangles.push({a:poly[0],b,c,normal:gradient.map(v=>v/g),operand:activeOperand(shape,q),reliable:Math.abs(exactShape(shape,q))<r*.003&&Math.abs(dot(fn,gradient)/length/g)>.9});
   }
  }
 }
 function tree(ids){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const i of ids)for(const p of [triangles[i].a,triangles[i].b,triangles[i].c])for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  if(ids.length<=8)return {min,max,ids};const axis=max.map((v,k)=>v-min[k]).indexOf(Math.max(...max.map((v,k)=>v-min[k])));
  ids.sort((i,j)=>(triangles[i].a[axis]+triangles[i].b[axis]+triangles[i].c[axis])-(triangles[j].a[axis]+triangles[j].b[axis]+triangles[j].c[axis]));
  const mid=ids.length>>1;return {min,max,left:tree(ids.slice(0,mid)),right:tree(ids.slice(mid))};
 }
 return {n,extent,step,values,triangles,tree:triangles.length?tree(triangles.map((_,i)=>i)):null,error:Math.hypot(...step),bricks:buildSandBricks(shape)};
}

// Conservative interval for the 1-Lipschitz input field. It also protects
// unresolved thin features: interpolation is NEVER used as a final contact.
export function meshField(mesh,p){
 const [sx,sy,sz]=mesh.step,x=(p[0]+mesh.extent[0])/sx,y=(p[1]+mesh.extent[1])/sy,z=(p[2]+mesh.extent[2])/sz;
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),n=mesh.n,w=n+1;
 if(ix<0||iy<0||iz<0||ix>=n||iy>=n||iz>=n)return null;
 const a=x-ix,b=y-iy,c=z-iz,i=ix+w*(iy+w*iz),v=mesh.values,ww=w*w;
 const low=(v[i]*(1-a)+v[i+1]*a)*(1-b)+(v[i+w]*(1-a)+v[i+w+1]*a)*b;
 const high=(v[i+ww]*(1-a)+v[i+ww+1]*a)*(1-b)+(v[i+ww+w]*(1-a)+v[i+ww+w+1]*a)*b;
 return {value:low*(1-c)+high*c,error:Math.sqrt(a*(1-a)*sx*sx+b*(1-b)*sy*sy+c*(1-c)*sz*sz)+1e-6};
}
function closest(p,{a,b,c}){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return a.map((v,k)=>v+ab[k]*d1/(d1-d3));
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return a.map((v,k)=>v+ac[k]*d2/(d2-d6));
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return b.map((v,k)=>v+(c[k]-v)*(d4-d3)/(d4-d3+d5-d6));
 const denom=1/(va+vb+vc);return a.map((v,k)=>v+ab[k]*vb*denom+ac[k]*vc*denom);
}
export function meshNearest(mesh,p,maxDistance=Infinity){
 if(!mesh.tree)return null;let best=maxDistance**2,result=null,visited=0;
 const bound=n=>n.min.reduce((s,v,k)=>s+Math.max(v-p[k],0,p[k]-n.max[k])**2,0);
 function visit(node){if(bound(node)>best)return;
  if(node.ids){for(const id of node.ids){visited++;const t=mesh.triangles[id],q=closest(p,t),delta=sub(p,q),d=dot(delta,delta);if(d<=best){best=d;result={point:q,normal:t.normal,operand:t.operand,reliable:t.reliable,distance:Math.sqrt(d)*Math.sign(dot(delta,t.normal)||1),triangle:id};}}}
  else{const first=bound(node.left)<bound(node.right)?node.left:node.right;visit(first);visit(first===node.left?node.right:node.left);}
 }visit(mesh.tree);return result?{...result,visited}:null;
}
