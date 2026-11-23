// Cross sections of coaxial ellipsoids are circles. Between profile crossings,
// an exposed arc belongs to exactly one primitive, including inside a carved cup.
import {BufferGeometry,Float32BufferAttribute} from 'three';

const axes=['x','y','z'];
const eps=1e-8;

function sections(shape,axis){
 const a=axes[axis],b=axes[(axis+1)%3],c=axes[(axis+2)%3],base=shape.primitives[0];
 if(base.box)return null;
 const arcs=[],slabs=[];
 for(const s of shape.primitives){
  if(s.box){
   // Only cuts spanning the complete radial section are planes of revolution.
   if(Math.abs(s.center[b]-base.center[b])+base.size[b]>s.size[b]||
      Math.abs(s.center[c]-base.center[c])+base.size[c]>s.size[c])return null;
   slabs.push([s.center[a]-s.size[a],s.center[a]+s.size[a]]);
  }else{
   if(Math.abs(s.size[b]-s.size[c])>eps||Math.abs(s.center[b]-base.center[b])>eps||Math.abs(s.center[c]-base.center[c])>eps)return null;
   const radius=s.size[b],mid=s.center[a],half=s.size[a];
   arcs.push({mid,half,radius,curvature:(radius/half)**2});
  }
 }
 return {arcs,slabs};
}
const squared=(s,h)=>s.radius**2-s.curvature*(h-s.mid)**2;

function crossings(s,t){
 // Local coordinates keep the subtraction well-conditioned far from the origin.
 const d=s.mid-t.mid,A=t.curvature-s.curvature,B=2*t.curvature*d,C=s.radius**2-squared(t,s.mid);
 if(Math.abs(A)<eps)return Math.abs(B)>eps?[s.mid-C/B]:[];
 const disc=B*B-4*A*C;
 if(disc<0)return [];
 const root=Math.sqrt(disc);
 return [s.mid+(-B-root)/(2*A),s.mid+(-B+root)/(2*A)];
}

export function revolvedOptic(shape,shadow){
 let profile,axis=0;
 for(;axis<3;axis++){profile=sections(shape,axis);if(profile)break;}
 if(!profile)return null;
 const {arcs,slabs}=profile,outer=arcs[0],lo=outer.mid-outer.half,hi=outer.mid+outer.half;
 const events=[lo,hi,...slabs.flat(),...arcs.flatMap(s=>[s.mid-s.half,s.mid+s.half])];
 for(let i=1;i<arcs.length;i++)for(let j=0;j<i;j++)events.push(...crossings(arcs[i],arcs[j]));
 const bounds=events.filter(h=>h>=lo&&h<=hi).sort((a,b)=>a-b).filter((h,i,all)=>!i||h-all[i-1]>eps);
 const ranges=bounds.slice(1).map((end,i)=>{
  const mid=(bounds[i]+end)*.5;
  if(slabs.some(([a,b])=>mid>a&&mid<b))return null;
  let inner=null,max=0;
  for(const s of arcs.slice(1)){const r=squared(s,mid);if(r>max){max=r;inner=s;}}
  return squared(outer,mid)>max?{inner}:null;
 });
 const pos=[],norm=[],indices=[],around=shadow?16:48;
 const base=shape.center.toArray(),b=(axis+1)%3,c=(axis+2)%3;
 const ring=(height,radius,axial,radial)=>{
  const id=pos.length/3,inv=1/Math.hypot(axial,radial);
  for(let i=0;i<around;i++){
   const angle=i*2*Math.PI/around,x=Math.cos(angle),y=Math.sin(angle);
   const p=[...base],n=[0,0,0];
   p[axis]=height;p[b]+=radius*x;p[c]+=radius*y;n[axis]=axial*inv;n[b]=radial*x*inv;n[c]=radial*y*inv;
   pos.push(...p);norm.push(...n);
  }
  return id;
 };
 const strip=(lower,upper,reverse)=>{
  for(let i=0;i<around;i++){
   const j=(i+1)%around,a=lower+i,b=lower+j,c=upper+i,d=upper+j;
   if(reverse)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
  }
 };
 const radiusAt=(s,h)=>s?Math.sqrt(Math.max(0,squared(s,h))):0;
 const angleAt=(s,h)=>Math.asin(Math.max(-1,Math.min(1,(h-s.mid)/s.half)));
 function arc(s,h0,h1,inner){
  const a=angleAt(s,h0),b=angleAt(s,h1),steps=Math.max(1,Math.ceil((b-a)/(Math.PI/(shadow?9:22))));
  let previous;
  for(let i=0;i<=steps;i++){
   const theta=a+(b-a)*i/steps,sign=inner?-1:1;
   const r=ring(s.mid+s.half*Math.sin(theta),s.radius*Math.cos(theta),sign*Math.sin(theta)/s.half,sign*Math.cos(theta)/s.radius);
   if(i)strip(previous,r,inner);
   previous=r;
  }
 }
 for(let i=0;i<ranges.length;i++){
  if(!ranges[i])continue;
  const h0=bounds[i],h1=bounds[i+1],inner=ranges[i].inner;
  arc(outer,h0,h1,false);if(inner)arc(inner,h0,h1,true);
  for(const [h,sign,neighbor] of [[h0,-1,ranges[i-1]],[h1,1,ranges[i+1]]]){
   if(neighbor)continue;
   const r=radiusAt(outer,h),hole=radiusAt(inner,h);
   if(r-hole>eps)strip(ring(h,hole,sign,0),ring(h,r,sign,0),sign>0);
  }
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('normal',new Float32BufferAttribute(norm,3));
 g.setIndex(indices);g.computeBoundingBox();return g;
}
