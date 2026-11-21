import {LIMITS} from './model.js';
import {field} from './sculpt.js';

// For sharp box CSG the stamp planes partition the solid into rectangular cells.
// A Gaussian on an exposed rectangle can cover all the way to its true edge.
// Smooth or complicated sculpts continue to use their sampled tangent patches.
export function planarSurface(stamps, spacing) {
 if (!stamps?.length || !spacing || stamps.length>12 || stamps.some((s,i)=>s.shape!=='box'||(i>0&&s.mode!=='paint'&&s.blend>0))) return null;
 const planes=[0,1,2].map(k=>[...new Set(stamps.flatMap(s=>[s.position[k]-s.size[k],s.position[k]+s.size[k]]))].sort((a,b)=>a-b));
 const dims=planes.map(p=>p.length-1), count=dims.reduce((a,b)=>a*b);
 if(count>4096)return null;
 const cells=new Int16Array(count).fill(-1),index=([x,y,z])=>x+dims[0]*(y+dims[1]*z);
 const coords=i=>[i%dims[0],Math.floor(i/dims[0])%dims[1],Math.floor(i/(dims[0]*dims[1]))];
 for(let i=0;i<count;i++){
  const p=coords(i).map((c,k)=>(planes[k][c]+planes[k][c+1])*.5),[d,m]=field(p,stamps);
  if(d<0)cells[i]=m;
 }
 const out={positions:[],normals:[],materials:[],supportMin:[],supportMax:[],spacing,truncated:false};
 for(let i=0;i<count;i++){
  if(cells[i]<0)continue;
  const c=coords(i),lo=c.map((j,k)=>planes[k][j]),hi=c.map((j,k)=>planes[k][j+1]);
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
   const neighbor=c.slice();neighbor[axis]+=sign;
   if(neighbor[axis]>=0&&neighbor[axis]<dims[axis]&&cells[index(neighbor)]>=0)continue;
   const u=(axis+1)%3,v=(axis+2)%3,nu=Math.ceil((hi[u]-lo[u])/spacing),nv=Math.ceil((hi[v]-lo[v])/spacing);
   if(out.materials.length+nu*nv>LIMITS.splats)return null;
   const n=[0,0,0],p=lo.slice();n[axis]=sign;p[axis]=sign>0?hi[axis]:lo[axis];
   for(let a=0;a<nu;a++)for(let b=0;b<nv;b++){
    p[u]=lo[u]+(a+.5)*(hi[u]-lo[u])/nu;p[v]=lo[v]+(b+.5)*(hi[v]-lo[v])/nv;
    out.positions.push(...p);out.normals.push(...n);out.materials.push(stamps[field(p,stamps)[1]].materialId);
    out.supportMin.push(...lo);out.supportMax.push(...hi);
   }
  }
 }
 return out;
}

// Build hard surface color and depth from the same intersection. A splat whose
// tangent plane misses the ray cannot stand in for a surface at grazing angles.
export function surfaceFragment(depth, lighting, relief, reflectionClip) {
 return `${lighting}\n${relief}\n${reflectionClip}
 uniform vec2 viewport;uniform mat4 projectionMatrix,cameraWorld;uniform float matterPlaying;
 varying vec2 footprint,phase;varying vec3 vNormal,vColor,vWorld,grain,localCoord,localN;
 varying float vRadius;varying vec4 vProps;flat varying mat3 worldToLocal;
 flat varying vec4 boundsLo,seam;flat varying vec3 boundsHi;
 void main(){
  if(phase.x>1.5||(matterPlaying>.5&&phase.x>.5))discard;
  bool hard=boundsLo.w>.5;float q=dot(footprint,footprint);
  if(q>${depth?'5.':'5.62'})discard;
  vec3 ray=normalize(vec3((gl_FragCoord.xy/viewport*2.-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.));
  vec3 nv=mat3(viewMatrix)*vNormal,centerView=(viewMatrix*vec4(vWorld,1.)).xyz;
  float facing=-dot(nv,ray);if(facing<.001)discard;
  float t=-dot(nv,centerView)/facing;
  if(!hard)t=clamp(t,length(centerView)-vRadius,length(centerView)+vRadius);
  if(t<.03)discard;
  vec3 delta=worldToLocal*(mat3(cameraWorld)*(ray*t-centerView)),coord=localCoord+delta;
  if(hard&&(dot(coord,seam.xyz)>seam.w+.000002||dot(delta,delta)>6.76*vRadius*vRadius||any(lessThan(coord,boundsLo.xyz))||any(greaterThan(coord,boundsHi))))discard;
  vec3 surface=(cameraWorld*vec4(ray*t,1.)).xyz;if(belowReflector(surface))discard;
  vec3 n=normalize(vNormal),base=vColor;
  float h=grainSurface(coord,localN,grain,n,base,cameraPosition-surface);
  vec4 clip=projectionMatrix*vec4(ray*t,1.);float z=reliefDepth(clip.z/clip.w*.5+.5,surface,normalize(vNormal),h,projectionMatrix);
  gl_FragDepth=z;
  ${depth?'gl_FragColor=vec4(0.);':`if(!hard){vec4 front=projectionMatrix*vec4(ray*(t-4.*vRadius),1.);gl_FragDepth=.5+.5*front.z/front.w;}
   if(hard)gl_FragDepth=max(0.,z-.00000018);
   float coverage=hard?1.:smoothstep(.06,.3,exp(-.5*q));gl_FragColor=vec4(shade(base,n,surface,vProps),coverage*vProps.z);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>`}
 }`;
}
