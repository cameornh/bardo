import { surfaceCovariance, tangentArea, mergeGaussians } from './gaussians.js';

// Artistic homogeneous coefficients in m^-1, not measured material fits.
// Display objects are enlarged 40x: one scene unit represents 25 mm here.
export const OPTICAL_METRES = .025;
export const OPTICAL_PRESETS = [
 {name:'Marble',radii:[.78,.79,.52],absorption:[7,12,20],scattering:[350,430,520],g:.25,ior:1.49,roughness:.23,diffusion:true},
 {name:'Leaf',radii:[.48,.88,.023],absorption:[1900,75,2800],scattering:[1200,1900,950],g:.55,ior:1.42,roughness:.48,diffusion:true},
 {name:'Skin',radii:[.76,.72,.18],absorption:[24,95,170],scattering:[850,1100,1450],g:.72,ior:1.4,roughness:.42,diffusion:true},
 {name:'Water',radii:[.72,.67,.58],absorption:[.28,.065,.035],scattering:[.06,.08,.12],g:.35,ior:1.333,roughness:.055,diffusion:false},
 {name:'Clear glass',radii:[.65,.67,.50],absorption:[.10,.065,.045],scattering:[.01,.01,.01],g:0,ior:1.5,roughness:.055,diffusion:false},
 {name:'Amber glass',radii:[.65,.67,.50],absorption:[3,30,115],scattering:[.04,.04,.04],g:0,ior:1.52,roughness:.09,diffusion:false},
 {name:'Emerald glass',radii:[.65,.67,.50],absorption:[115,8,70],scattering:[.04,.04,.04],g:0,ior:1.52,roughness:.09,diffusion:false},
 {name:'Cobalt glass',radii:[.65,.67,.50],absorption:[130,50,3],scattering:[.04,.04,.04],g:0,ior:1.52,roughness:.09,diffusion:false},
 {name:'Ruby glass',radii:[.65,.67,.50],absorption:[4,135,90],scattering:[.04,.04,.04],g:0,ior:1.52,roughness:.09,diffusion:false},
];
export function createOpticalSamples(){
 return OPTICAL_PRESETS.map((p,i)=>({...p,id:i,center:[(i%3-1)*2.35,4.65-Math.floor(i/3)*2.12,0],radii:[...p.radii],thickness:1,absorptionScale:1,scatterScale:1,turbidity:0}));
}
export function sampleRadii(sample){return [sample.radii[0],sample.radii[1],sample.radii[2]*sample.thickness];}
export function opticalCoefficients(sample){
 return {absorption:sample.absorption.map(x=>x*OPTICAL_METRES*sample.absorptionScale),scattering:sample.scattering.map(x=>(x*sample.scatterScale+sample.turbidity*100)*OPTICAL_METRES)};
}
export function rayEllipsoid(origin,direction,radii){
 const o=origin.map((v,i)=>v/radii[i]),d=direction.map((v,i)=>v/radii[i]);
 const a=d.reduce((s,v)=>s+v*v,0),b=o.reduce((s,v,i)=>s+v*d[i],0),c=o.reduce((s,v)=>s+v*v,0)-1,disc=b*b-a*c;
 if(disc<0||a===0)return null;const root=Math.sqrt(disc);return [(-b-root)/a,(-b+root)/a];
}
export function beerLambert(extinction,length){return extinction.map(s=>Math.exp(-s*Math.max(0,length)));}
export function fresnelDielectric(cosine,etaI=1,etaT=1.5){
 const c=Math.min(1,Math.max(0,cosine)),s2=(etaI/etaT)**2*(1-c*c);if(s2>=1)return 1;
 const t=Math.sqrt(1-s2),rs=(etaI*c-etaT*t)/(etaI*c+etaT*t),rp=(etaT*c-etaI*t)/(etaT*c+etaI*t);return .5*(rs*rs+rp*rp);
}
export function phaseHG(cosine,g){return (1-g*g)/(4*Math.PI*Math.max(1e-6,1+g*g-2*g*cosine)**1.5);}
export function illuminationMask(entry,radii,split){return !split||entry[0]/radii[0]>.02?1:0;}

// Deterministic sphere sampling, affinely transformed to each ellipsoid.
// Covariance transforms with the surface; a thin leaf stays thin at grazing angles.
export function opticalHierarchy(radii,count=1536){
 let nodes=[];const sigma=Math.sqrt(4*Math.PI/count)*.64,angle=Math.PI*(3-Math.sqrt(5));
 for(let i=0;i<count;i++){
  const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),n=[r*Math.cos(i*angle),y,r*Math.sin(i*angle)],center=n.map((x,k)=>x*radii[k]);
  const normal=n.map((x,k)=>x/radii[k]),len=Math.hypot(...normal);for(let k=0;k<3;k++)normal[k]/=len;
  const c=surfaceCovariance(n,sigma,.05),cov=[c[0]*radii[0]**2,c[1]*radii[0]*radii[1],c[2]*radii[0]*radii[2],c[3]*radii[1]**2,c[4]*radii[1]*radii[2],c[5]*radii[2]**2];
  nodes.push({center,normal,cov,tau:1.65,mass:1.65*tangentArea(cov,normal)});
 }
 const levels=[];
 for(let level=0;level<6;level++){
  levels.push({nodes,count:nodes.length,sigma:nodes.reduce((s,n)=>s+Math.sqrt((n.cov[0]+n.cov[3]+n.cov[5])/2),0)/nodes.length});
  const cells=new Map(),size=sigma*3*2**level;
  for(const n of nodes){let axis=0;for(let j=1;j<3;j++)if(Math.abs(n.normal[j])>Math.abs(n.normal[axis]))axis=j;
   const key=n.center.map((v,j)=>Math.floor(v/radii[j]/size)).join(',')+':'+axis+':'+(n.normal[axis]>0);
   if(!cells.has(key))cells.set(key,[]);cells.get(key).push(n);
  }
  const next=[...cells.values()].map(mergeGaussians);if(next.length>=nodes.length)break;nodes=next;
 }
 return levels;
}
