import { materialSH } from './sh.js';

export const TEXELS_PER_SPLAT=21;
export const FLOATS_PER_SPLAT=TEXELS_PER_SPLAT*4;
export function surfaceCovariance(n,r,thickness=.08) {
  const a=r*r,b=a*(thickness*thickness-1);
  return [a+b*n[0]*n[0],b*n[0]*n[1],b*n[0]*n[2],a+b*n[1]*n[1],b*n[1]*n[2],a+b*n[2]*n[2]];
}
export function tangentArea(c,n){
  let tx=Math.abs(n[1])<.9?-n[2]:0,ty=Math.abs(n[1])<.9?0:n[2],tz=Math.abs(n[1])<.9?n[0]:-n[1];
  const len=Math.hypot(tx,ty,tz)||1;tx/=len;ty/=len;tz/=len;
  const bx=n[1]*tz-n[2]*ty,by=n[2]*tx-n[0]*tz,bz=n[0]*ty-n[1]*tx;
  const ctx=c[0]*tx+c[1]*ty+c[2]*tz,cty=c[1]*tx+c[3]*ty+c[4]*tz,ctz=c[2]*tx+c[4]*ty+c[5]*tz;
  const cbx=c[0]*bx+c[1]*by+c[2]*bz,cby=c[1]*bx+c[3]*by+c[4]*bz,cbz=c[2]*bx+c[4]*by+c[5]*bz;
  const tt=tx*ctx+ty*cty+tz*ctz,bb=bx*cbx+by*cby+bz*cbz,tb=tx*cbx+ty*cby+tz*cbz;
  return Math.sqrt(Math.max(1e-12,tt*bb-tb*tb));
}

export function mergeGaussians(nodes) {
  let mass=0;const center=[0,0,0],normal=[0,0,0],cov=[0,0,0,0,0,0];
  for(const g of nodes){mass+=g.mass;for(let i=0;i<3;i++){center[i]+=g.center[i]*g.mass;normal[i]+=g.normal[i]*g.mass;}}
  for(let i=0;i<3;i++)center[i]/=mass;
  const length=Math.hypot(...normal)||1;for(let i=0;i<3;i++)normal[i]/=length;
  for(const g of nodes){
    const d=g.center.map((v,i)=>v-center[i]),between=[d[0]*d[0],d[0]*d[1],d[0]*d[2],d[1]*d[1],d[1]*d[2],d[2]*d[2]];
    for(let i=0;i<6;i++)cov[i]+=(g.cov[i]+between[i])*g.mass/mass;
  }
  return {center,normal,cov,mass,tau:mass/tangentArea(cov,normal)};
}
function normalBin(n){
  let axis=0;for(let i=1;i<3;i++)if(Math.abs(n[i])>Math.abs(n[axis]))axis=i;
  return axis*2+(n[axis]<0?1:0);
}
export function buildGaussianHierarchy(samples,material) {
  let nodes=Array.from({length:samples.count},(_,i)=>{
    const center=Array.from(samples.centers.subarray(i*3,i*3+3)),normal=Array.from(samples.normals.subarray(i*3,i*3+3));
    const r=samples.radii[i]*1.12, tau=2.4;
    return {center,normal,cov:surfaceCovariance(normal,r),mass:tau*r*r,tau};
  });
  const baseSigma=nodes.reduce((s,g)=>s+Math.sqrt((g.cov[0]+g.cov[3]+g.cov[5])/2),0)/Math.max(1,nodes.length);
  const all=[],levels=[];
  for(let level=0;level<8;level++){
    levels.push({offset:all.length,count:nodes.length,sigma:nodes.reduce((s,g)=>s+Math.sqrt((g.cov[0]+g.cov[3]+g.cov[5])/2),0)/Math.max(1,nodes.length)});
    all.push(...nodes);
    const cells=new Map(),size=baseSigma*3*2**level;
    for(const node of nodes){
      const key=node.center.map(v=>Math.floor(v/size)).join(',')+':'+normalBin(node.normal);
      if(!cells.has(key))cells.set(key,[]);cells.get(key).push(node);
    }
    const next=[...cells.values()].map(mergeGaussians);
    if(next.length===nodes.length||next.length<1)break;
    nodes=next;
  }
  const packed=new Float32Array(all.length*FLOATS_PER_SPLAT);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  all.forEach((g,i)=>{
    const o=i*FLOATS_PER_SPLAT;
    packed.set(g.center,o);packed.set(g.normal,o+4);packed[o+7]=g.tau;
    packed.set(g.cov.slice(0,3),o+8);packed.set(g.cov.slice(3),o+12);
    const tailSigma=Math.min(8,Math.sqrt(2*Math.log(Math.max(g.tau/.0001,1.01))));packed[o+15]=tailSigma;
    const sh=materialSH(g.normal,material);
    for(let k=0;k<16;k++)packed.set(sh.subarray(k*3,k*3+3),o+20+k*4);
    for(let j=0;j<3;j++){const support=tailSigma*Math.sqrt(g.cov[[0,3,5][j]]);min[j]=Math.min(min[j],g.center[j]-support);max[j]=Math.max(max[j],g.center[j]+support);}
  });
  return {packed,levels,min,max,count:samples.count,materialKey:JSON.stringify(material)};
}
