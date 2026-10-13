import {riverHeight,riverDistance,riverSeed,RIVER_GLSL} from './water-lab-river.js';
// Bounded fixtures for one water material. Coordinates are normalized by scale;
// particle volumes and gravity are converted back to SI at the solver boundary.
export const LAB_PRESETS={
 pipe:{name:'Pipe / impinging jet',scale:1,spacing:.25,eye:[9,6,11],target:[0,1.5,0]},
 waterfall:{name:'Waterfall',scale:3,spacing:.32,eye:[10,8,13],target:[0,2.7,0]},
 pool:{name:'Pool / submerged jets',scale:1.5,spacing:.29,eye:[9,7,11],target:[0,1,0]},
 tank:{name:'Moving glass tank',scale:1,spacing:.23,eye:[7,5,9],target:[0,1.7,0]},
 river:{name:'River / sediment / solutes',scale:2,spacing:.32,minSpacing:.18,eye:[22,25,32],target:[0,1.7,0]},
 glass:{name:'Spinning drinking glass',scale:.05,spacing:.19,eye:[5,4,7],target:[0,1.6,0]},
 ocean:{name:'Wind-driven ocean basin',scale:4,spacing:.36,eye:[11,8,13],target:[0,1.1,0]},
};
export const LAB_IDS=Object.keys(LAB_PRESETS),NEIGHBORS=128;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const dot=(a,b)=>a.reduce((v,x,k)=>v+x*b[k],0);
export const length=a=>Math.hypot(...a);
export const hash=i=>{const q=Math.sin(i*91.173+18.17)*43758.54;return q-Math.floor(q);};
export function rotate(p,tilt=0,spin=0,inverse=false){const c=Math.cos(tilt),s=Math.sin(tilt),a=Math.cos(spin),b=Math.sin(spin);if(inverse){const q=[c*p[0]+s*p[1],-s*p[0]+c*p[1],p[2]];return [a*q[0]-b*q[2],q[1],b*q[0]+a*q[2]];}const q=[a*p[0]+b*p[2],p[1],-b*p[0]+a*p[2]];return [c*q[0]-s*q[1],s*q[0]+c*q[1],q[2]];}
export function box(p,b){const q=p.map((v,k)=>Math.abs(v)-b[k]);return length(q.map(v=>Math.max(v,0)))+Math.min(Math.max(...q),0);}
export function floorHeight(p,kind,slope=.1){if(kind==='river')return riverHeight(p,slope);if(kind==='ocean')return Math.max(-.3,(p[2]-1)*.48);return 0;}
export function vesselLocal(p,motion){return rotate(p.map((v,k)=>v-motion.position[k]),motion.tilt,motion.spin,true);}
export function vesselDistance(p,kind,motion){if(kind!=='tank'&&kind!=='glass')return 100;const q=vesselLocal(p,motion);if(kind==='glass'){const r=Math.hypot(q[0],q[2]);return Math.min(Math.max(Math.abs(r-1.1)-.095,Math.abs(q[1]) -1.5),Math.max(r-1.2,Math.abs(q[1]+1.5)-.095));}let d=box([q[0],q[1]+1.7,q[2]],[2.2,.12,1.6]);for(const a of [0,2])for(const side of [-1,1]){const v=q.slice(),b=[2.2,1.7,1.6];v[a]-=side*(a===0?2.1:1.5);b[a]=.12;d=Math.min(d,box(v,b));}return d;}
export function fixtureDistance(p,kind,motion,bedDelta=0,slope=.1){let d=kind==='river'?riverDistance(p,slope,bedDelta):p[1]-floorHeight(p,kind)-bedDelta;if(kind==='waterfall')d=Math.min(d,box([p[0],p[1]-2.4,p[2]+3],[3.2,2.4,1.8]));if(kind==='pool')for(const a of [0,2])for(const side of [-1,1]){const q=[p[0],p[1]-1,p[2]],b=[4,1,3.1];q[a]-=side*(a===0?3.9:3);b[a]=.12;d=Math.min(d,box(q,b));}d=Math.min(d,vesselDistance(p,kind,motion));return Math.min(d,5.5-Math.abs(p[0]),(kind==='river'?19.5:4.9)-Math.abs(p[2]),(kind==='river'?12:9)-p[1]);}
export function normalAt(p,field){const e=.003,n=[0,1,2].map(k=>{const a=p.slice(),b=p.slice();a[k]+=e;b[k]-=e;return field(a)-field(b);}),l=length(n)||1;return n.map(v=>v/l);}
export function wallVelocity(p,m){const r=p.map((v,k)=>v-m.position[k]),axis=rotate([0,1,0],m.tilt,0),omega=[0,0,m.tiltVelocity].map((v,k)=>v+axis[k]*m.spinVelocity);return [m.velocity[0]+omega[1]*r[2]-omega[2]*r[1],m.velocity[1]+omega[2]*r[0]-omega[0]*r[2],m.velocity[2]+omega[0]*r[1]-omega[1]*r[0]];}
export function createMotion(){return {position:[0,2,0],velocity:[0,0,0],target:[0,2,0],tilt:0,targetTilt:0,tiltVelocity:0,spin:0,spinVelocity:0,targetSpin:0};}
export function stepMotion(m,dt){for(let k=0;k<3;k++){m.velocity[k]+=(25*(m.target[k]-m.position[k])-9*m.velocity[k])*dt;m.position[k]+=m.velocity[k]*dt;}m.tiltVelocity+=(25*(m.targetTilt-m.tilt)-9*m.tiltVelocity)*dt;m.tilt+=m.tiltVelocity*dt;m.spinVelocity+=(m.targetSpin-m.spinVelocity)*(1-Math.exp(-dt*3));m.spin+=m.spinVelocity*dt;}
export function seedWater(kind,spec=LAB_PRESETS[kind]){const s=spec.spacing,result=[];const add=(p,v=[0,0,0])=>result.push({p,v,held:false,chem:[0,0,0,0]});
 if(kind==='river')return riverSeed(spec,spec.riverSlope??.1,spec.sourceSpeed??1.5);
 if(kind==='pipe'){for(let i=0;i<1200;i++)add([-4.875+(i%40)*s,s*.45+Math.floor(i/800)*s,(Math.floor(i/40)%20-9.5)*s]);return result;}
 if(kind==='waterfall'){
  for(let i=0;i<1600;i++)add([(i%28-13.5)*s,s*.48+Math.floor(i/448)*s,(Math.floor(i/28)%16)*s-.5]);
  for(let i=0;i<220;i++)add([(i%14-6.5)*s,4.8+s*.5+Math.floor(i/140)*s,-4.35+(Math.floor(i/14)%10)*s],[0,0,6/spec.scale]);
  for(let y=0;y<Math.floor(4.7/s);y++)for(let x=0;x<14;x++){const drop=y*s,age=Math.sqrt(2*drop/(9.81/spec.scale)),speed=6/spec.scale;add([(x-6.5)*s,4.95-drop,-1.1+speed*age],[0,-9.81/spec.scale*age,speed]);}
  return result;
 }
 for(let z=-4.4;z<4.5;z+=s)for(let y=.24;y<3;y+=s)for(let x=-4.7;x<4.8;x+=s){let yes=false;if(kind==='pool')yes=Math.abs(x)<3.5&&Math.abs(z)<2.6&&y<1.4;if(kind==='tank')yes=Math.abs(x)<1.87&&Math.abs(z)<1.26&&y>.55&&y<2.1;if(kind==='glass')yes=Math.hypot(x,z)<.87&&y>.66&&y<2.35;if(kind==='ocean')yes=y>floorHeight([x,y,z],kind)+.16&&y<1.35;if(yes)add([x,y,z]);}return result;
}
// Symmetric lists: both particles accept a pair or neither does. Diffusion
// therefore exchanges equal solute mass; no directional nearest-N truncation.
export function buildNeighbors(positions,spacing){
 const n=positions.length/4,reach=spacing*2.65,r2max=reach*reach,bins=new Map(),cells=new Int32Array(n*3),lists=Array.from({length:n},()=>[]);
 const key=(x,y,z)=>Math.max(Math.abs(x),Math.abs(y),Math.abs(z))<512?(x+512)+(y+512)*1024+(z+512)*1048576:`${x},${y},${z}`;
 for(let i=0;i<n;i++){const o=i*4,x=Math.floor(positions[o]/reach),y=Math.floor(positions[o+1]/reach),z=Math.floor(positions[o+2]/reach);cells.set([x,y,z],i*3);const id=key(x,y,z),bin=bins.get(id);if(bin)bin.push(i);else bins.set(id,[i]);}
 let overflow=0;
 for(let i=0;i<n;i++){const o=i*4,c=i*3,xi=positions[o],yi=positions[o+1],zi=positions[o+2];for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const bin=bins.get(key(cells[c]+x,cells[c+1]+y,cells[c+2]+z));if(!bin)continue;for(const j of bin){if(j<=i)continue;const q=j*4,dx=xi-positions[q],dy=yi-positions[q+1],dz=zi-positions[q+2];if(dx*dx+dy*dy+dz*dz>=r2max)continue;if(lists[i].length===NEIGHBORS||lists[j].length===NEIGHBORS){overflow++;continue;}lists[i].push(j);lists[j].push(i);}}}
 const data=new Float32Array(n*NEIGHBORS);data.fill(-1);lists.forEach((l,i)=>data.set(l,i*NEIGHBORS));return {data,overflow};
}
export function kernel(r,h){const q=Math.max(0,1-r*r/(h*h));return 315/(64*Math.PI*h**3)*q**3;}
export function kernelGradient(d,h){const r=length(d);if(r<1e-6||r>=h)return [0,0,0];const c=-45/(Math.PI*h**6)*(h-r)**2/r;return d.map(x=>x*c);}
export function densityAt(positions,p,spacing){const h=spacing*2,volume=spacing**3;let d=0;for(let i=0;i<positions.length;i+=4)d+=volume*kernel(Math.hypot(...p.map((v,k)=>v-positions[i+k])),h);return d;}
export function buoyancyAcceleration(ratio,submerged,scale=1){return 9.81/scale*(submerged/ratio-1);}
export function solveDensity(positions,neighbors,spacing,iterations=3,collide=p=>p){const n=positions.length/4,h=spacing*2,volume=spacing**3;let pos=positions.slice();const lambdas=new Float32Array(n),density=new Float32Array(n);for(let iteration=0;iteration<iterations;iteration++){
 for(let i=0;i<n;i++){let rho=volume*kernel(0,h),sum=0,gradient=[0,0,0];for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const d=[0,1,2].map(k=>pos[i*4+k]-pos[j*4+k]),g=kernelGradient(d,h).map(x=>x*volume);rho+=volume*kernel(length(d),h);sum+=dot(g,g);gradient=gradient.map((v,k)=>v+g[k]);}density[i]=rho;lambdas[i]=-Math.max(0,rho-1)/(sum+dot(gradient,gradient)+.04/(h*h));}
 const next=pos.slice();for(let i=0;i<n;i++){if(pos[i*4+3]>.5)continue;let delta=[0,0,0];for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const d=[0,1,2].map(k=>pos[i*4+k]-pos[j*4+k]),g=kernelGradient(d,h),r=length(d),scorr=-.00015*Math.pow(kernel(r,h)/kernel(.3*h,h),4);for(let k=0;k<3;k++)delta[k]+=(lambdas[i]+lambdas[j]+scorr)*volume*g[k];}const limit=Math.min(1,spacing*.2/(length(delta)||1)),p=collide([0,1,2].map(k=>pos[i*4+k]+delta[k]*limit));next.set(p,i*4);}pos=next;}return {positions:pos,density};}
export function diffuseChemistry(chem,neighbors,positions,spacing,dt){const out=chem.slice(),n=positions.length/4,h=spacing*2;for(let i=0;i<n;i++)for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;if(j<=i)continue;const a0=i*4,b0=j*4,r=Math.hypot(positions[a0]-positions[b0],positions[a0+1]-positions[b0+1],positions[a0+2]-positions[b0+2]),w=Math.max(0,1-r/h)*Math.min(.006,dt*.12);for(let k=0;k<3;k++){const exchange=(chem[j*4+k]-chem[i*4+k])*w;out[i*4+k]+=exchange;out[j*4+k]-=exchange;}}return out;}
export const LAB_GEOMETRY_GLSL=`
${RIVER_GLSL}
uniform highp sampler2D uLabBed;uniform int uStation;uniform vec3 uContainer;uniform float uTilt,uSpin;uniform int uBodyCount;uniform highp sampler2D uBodies;
vec3 rotateLab(vec3 p,bool inverse){float c=cos(uTilt),s=sin(uTilt),a=cos(uSpin),b=sin(uSpin);if(inverse){vec3 q=vec3(c*p.x+s*p.y,-s*p.x+c*p.y,p.z);return vec3(a*q.x-b*q.z,q.y,b*q.x+a*q.z);}vec3 q=vec3(a*p.x+b*p.z,p.y,-b*p.x+a*p.z);return vec3(c*q.x-s*q.y,s*q.x+c*q.y,q.z);}
float labBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float labFloor(vec3 p){if(uStation==4)return riverBase(p)+texture(uLabBed,p.xz/vec2(12,40)+.5).r;if(uStation==6)return max(-.3,(p.z-1.)*.48);return 0.;}
float vessel(vec3 p){if(uStation!=3&&uStation!=5)return 100.;vec3 q=rotateLab(p-uContainer,true);if(uStation==5){float r=length(q.xz);return min(max(abs(r-1.1)-.095,abs(q.y)-1.5),max(r-1.2,abs(q.y+1.5)-.095));}float d=labBox(q+vec3(0,1.7,0),vec3(2.2,.12,1.6));for(int a=0;a<2;a++)for(int j=0;j<2;j++){vec3 v=q,b=vec3(2.2,1.7,1.6);int axis=a==0?0:2;v[axis]-=(j==0?-1.:1.)*(a==0?2.1:1.5);b[axis]=.12;d=min(d,labBox(v,b));}return d;}
float fixture(vec3 p){float d=uStation==4?riverDistance(p,texture(uLabBed,p.xz/vec2(12,40)+.5).r):p.y-labFloor(p);if(uStation==1)d=min(d,labBox(p+vec3(0,-2.4,3),vec3(3.2,2.4,1.8)));if(uStation==2)for(int a=0;a<2;a++)for(int s=0;s<2;s++){vec3 q=p-vec3(0,1.,0),b=vec3(4.,1.,3.1);int axis=a==0?0:2;q[axis]-=(s==0?-1.:1.)*(a==0?3.9:3.);b[axis]=.12;d=min(d,labBox(q,b));}return min(d,vessel(p));}
vec4 labBody(int i){return texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);}
float labSolid(vec3 p){float d=min(fixture(p),min(5.5-abs(p.x),min((uStation==4?19.5:4.9)-abs(p.z),(uStation==4?12.:9.)-p.y)));for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i);d=min(d,length(p-b.xyz)-b.w);}return d;}
vec3 labNormal(vec3 p){float e=.003;return normalize(vec3(labSolid(p+vec3(e,0,0))-labSolid(p-vec3(e,0,0)),labSolid(p+vec3(0,e,0))-labSolid(p-vec3(0,e,0)),labSolid(p+vec3(0,0,e))-labSolid(p-vec3(0,0,e))));}
vec3 labCollide(vec3 p,float radius){for(int i=0;i<3;i++){float d=labSolid(p);if(d>=radius)break;p+=labNormal(p)*(radius-d);}return p;}
`;
