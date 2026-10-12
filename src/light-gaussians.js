import { SHAPE, worldPoint, rotateX, shapeDistance, waveHeight, norm } from './light-transport.js';
import { surfaceCovariance, mergeGaussians } from './gaussians.js';

function surfaceNormal(v,p){const e=.0001;return norm([0,1,2].map(k=>{const a=[...p],b=[...p];a[k]+=e;b[k]-=e;return shapeDistance(v,a)-shapeDistance(v,b);}));}
function hierarchy(nodes,id){
 const levels=[];let cell=.27;
 for(let level=0;level<7;level++){
  levels.push({nodes,count:nodes.length,sigma:nodes.reduce((s,g)=>s+Math.sqrt((g.cov[0]+g.cov[3]+g.cov[5])/2),0)/nodes.length});
  const groups=new Map();for(const g of nodes){let axis=0;for(let i=1;i<3;i++)if(Math.abs(g.normal[i])>Math.abs(g.normal[axis]))axis=i;
   const key=g.center.map(x=>Math.floor(x/cell)).join(',')+':'+(axis*2+(g.normal[axis]<0?1:0));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);
  }
  const next=[...groups.values()].map(mergeGaussians);cell*=2;if(next.length===nodes.length)continue;nodes=next;if(nodes.length<2)break;
 }
 const center=levels[0].nodes.reduce((s,g)=>s.map((x,i)=>x+g.center[i]/levels[0].count),[0,0,0]);return {id,levels,center};
}
export function lightSurfaceGaussians(scene){
 const groups=[];
 for(const v of scene.volumes){
  const nodes=[],step=.13,s=v.size;
  function add(p,n,spacing=step){n=rotateX(n||surfaceNormal(v,p),v.rotation);const sigma=spacing*.78,tau=2.8;nodes.push({center:worldPoint(v,p),normal:n,cov:surfaceCovariance(n,sigma,.12),tau,mass:tau*sigma*sigma});}
  if(v.type===SHAPE.SPHERE){const count=Math.max(300,Math.ceil(4*Math.PI*s[0]*s[0]/(step*step*.65))),spacing=Math.sqrt(4*Math.PI*s[0]*s[0]/count);for(let i=0;i<count;i++){const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),a=i*2.399963229728653,n=[r*Math.cos(a),y,r*Math.sin(a)];add(n.map(x=>x*s[0]),n,spacing);}}
  else if(v.type===SHAPE.BOX||v.type===SHAPE.WATER){
   for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
    const a=(axis+1)%3,b=(axis+2)%3,na=Math.ceil(s[a]*2/step),nb=Math.ceil(s[b]*2/step);
    for(let ia=0;ia<na;ia++)for(let ib=0;ib<nb;ib++){
     const p=[0,0,0],n=[0,0,0];p[axis]=s[axis]*sign;p[a]=(2*(ia+.5)/na-1)*s[a];p[b]=(2*(ib+.5)/nb-1)*s[b];n[axis]=sign;
     if(v.type===SHAPE.WATER){const wave=waveHeight(p[0],p[2],v.params[0],v.params[1]);if(axis===1&&sign===1){p[1]+=wave;add(p,null);continue;}if(axis!==1)p[1]+=wave*(p[1]+s[1])/(2*s[1]);}
     add(p,n);
    }
   }
  }else if(v.type===SHAPE.PRISM){
   const nx=Math.ceil(2*s[0]/step),ny=Math.ceil(2*s[1]/step),nz=Math.ceil(2*s[2]/step);
   for(let iy=0;iy<ny;iy++){const y=(2*(iy+.5)/ny-1)*s[1],edge=(s[1]-y)*v.params[0]/v.params[1],row=Math.max(1,Math.ceil(2*edge/step));
    for(const sign of [-1,1]){for(let iz=0;iz<row;iz++)add([sign*s[0],y,(2*(iz+.5)/row-1)*edge],[sign,0,0]);
     for(let ix=0;ix<nx;ix++)add([(2*(ix+.5)/nx-1)*s[0],y,sign*edge],[0,v.params[0],sign*v.params[1]],step/v.params[1]);}
   }
   for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++)add([(2*(ix+.5)/nx-1)*s[0],-s[1],(2*(iz+.5)/nz-1)*s[2]],[0,-1,0]);
  }else{
   const count=Math.ceil(2*s[0]/step),R=v.params[0],offset=v.params[1];
   for(let ix=0;ix<count;ix++)for(let iy=0;iy<count;iy++){
    const x=(2*(ix+.5)/count-1)*s[0],y=(2*(iy+.5)/count-1)*s[0],r2=x*x+y*y;if(r2>s[0]*s[0])continue;
    if(v.type===SHAPE.MIRROR){add([x,y,R*r2],norm([-2*R*x,-2*R*y,1]));continue;}
    const z=v.type===SHAPE.CONVEX?Math.sqrt(R*R-r2)-Math.sqrt(R*R-s[0]*s[0])+offset:R+offset-Math.sqrt(R*R-r2);
    for(const sign of [-1,1])add([x,y,z*sign]);
   }
   if(v.type!==SHAPE.MIRROR){const edge=v.type===SHAPE.CONVEX?offset:s[2],nz=Math.max(1,Math.ceil(2*edge/step)),na=Math.ceil(2*Math.PI*s[0]/step);
    for(let i=0;i<na;i++)for(let j=0;j<nz;j++){const a=i/na*2*Math.PI;add([s[0]*Math.cos(a),s[0]*Math.sin(a),edge*(2*(j+.5)/nz-1)],[Math.cos(a),Math.sin(a),0]);}
   }
  }
  groups.push(hierarchy(nodes,v.id));
 }
 for(let wall=0;wall<2;wall++){
  const nodes=[],nx=60,ny=wall?30:60,step=.2,normal=wall?[0,0,1]:[0,1,0],sigma=.156,tau=2.8;
  for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){const a=-6+(x+.5)*step,b=(wall?0:-6)+(y+.5)*step;nodes.push({center:wall?[a,b,-5.8]:[a,0,b],normal,cov:surfaceCovariance(normal,sigma),tau,mass:tau*sigma*sigma});}
  groups.push(hierarchy(nodes,100+wall));
 }
 return groups;
}
export function pathGaussians(segments){
 return segments.map(({a,b,channel,power})=>{
  const d=b.map((x,i)=>x-a[i]),length=Math.hypot(...d),n=norm(d),long=length*length/12,short=.006**2,delta=long-short;
  return {id:channel,center:a.map((x,i)=>(x+b[i])/2),normal:n,cov:[short+delta*n[0]*n[0],delta*n[0]*n[1],delta*n[0]*n[2],short+delta*n[1]*n[1],delta*n[1]*n[2],short+delta*n[2]*n[2]],tau:Math.min(1,power)};
 });
}
