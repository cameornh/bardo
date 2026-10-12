import { Terrain, terrainCSG, fieldNormal } from './terrain.js';
import { beachBed, BEACH_ROCKS } from './beach-model.js';
import { sampleRegion } from './sampling.js';
const REEF=[-18,-1.4,-17.5,4.5,1.3,2.2],ARCH=[-8,2.3,2.5];
export function ellipsoidDistance(p,c,r){const q=p.map((v,i)=>v-c[i]),a=Math.hypot(...q.map((v,i)=>v/r[i])),b=Math.hypot(...q.map((v,i)=>v/(r[i]*r[i])));return b>1e-8?a*(a-1)/b:-Math.min(...r);}
function boxDistance(p,c,r){const q=p.map((v,i)=>Math.abs(v-c[i])-r[i]);return Math.hypot(...q.map(v=>Math.max(v,0)))+Math.min(0,Math.max(...q));}
export function beachFeatures(p){let d=ellipsoidDistance(p,REEF.slice(0,3),REEF.slice(3));for(const r of BEACH_ROCKS)d=Math.min(d,Math.hypot(...p.map((v,i)=>v-r[i]))-r[3]);const arch=boxDistance(p,ARCH,[3.5,2.3,1.5])-.12,hole=Math.hypot(p[0]+8,p[1]-1.4)-1.65;return Math.min(d,Math.max(arch,-hole));}
export class BeachTerrain extends Terrain{
 constructor(soil=(x,z)=>beachBed(x,z)){super();this.soil=soil;this.samples=null;this.sampleRevision=-1;}
 distance(p){return terrainCSG(Math.min((p[1]-this.soil(p[0],p[2]))*.35,beachFeatures(p)),...p,this.edits);}
 normal(p){return fieldNormal(q=>this.distance(q),p);}
 projectSphere(p,r){let contact=false,normal=[0,1,0];for(let k=0;k<4;k++){const d=this.distance(p);normal=this.normal(p);const e=.006,g=Math.max(.15,(this.distance(p.map((v,i)=>v+normal[i]*e))-d)/e);if(d/g>=r)break;const push=Math.min(2,r-d/g);for(let i=0;i<3;i++)p[i]+=normal[i]*push;contact=true;}return {contact,normal};}
 trace(o,d,maxT=250){let t=.02;for(let i=0;i<300&&t<maxT;i++){const p=o.map((v,k)=>v+d[k]*t),f=this.distance(p);if(f<.0015)return p;t+=Math.max(.003,f*.85);}return null;}
 top(x,z){const hit=this.trace([x,20,z],[0,-1,0],40);return hit?.[1]??-20;}
 rebuildSamples(){if(this.sampleRevision===this.revision)return this.samples;const bounds=[[-23,-3,-21,-13,1,-14],[-13,-3,-1,-3,5,5],...this.edits.map(e=>[e[0]-e[3]-.6,e[1]-e[3]-.6,e[2]-e[3]-.6,e[0]+e[3]+.6,e[1]+e[3]+.6,e[2]+e[3]+.6])];const centers=[],normals=[],radii=[];
  for(const b of bounds){const s=sampleRegion((x,y,z)=>this.distance([x,y,z]),p=>this.normal(p),b.slice(0,3),b.slice(3),.4);centers.push(...s.centers);normals.push(...s.normals);radii.push(...s.radii);}
  this.samples={centers:new Float32Array(centers),normals:new Float32Array(normals),radii:new Float32Array(radii),count:radii.length};this.sampleRevision=this.revision;return this.samples;
 }
}
export const BEACH_TERRAIN_GLSL=`
uniform int uBeachEditCount;uniform vec4 uBeachEdits[64];uniform float uBeachEditModes[64];
float ellipsoidSDF(vec3 p,vec3 c,vec3 r){vec3 q=p-c;float a=length(q/r),b=length(q/(r*r));return b>.00001?a*(a-1.)/b:-min(r.x,min(r.y,r.z));}
float beachFeatures(vec3 p){float d=min(rockSDF(p),ellipsoidSDF(p,vec3(-18,-1.4,-17.5),vec3(4.5,1.3,2.2)));vec3 q=abs(p-vec3(-8,2.3,2.5))-vec3(3.5,2.3,1.5);float arch=length(max(q,0.))+min(0.,max(q.x,max(q.y,q.z)))-.12;float hole=length(p.xy-vec2(-8,1.4))-1.65;return min(d,max(arch,-hole));}
float beachCSG(float base,vec3 p){float d=min(base,beachFeatures(p));for(int i=0;i<64;i++){if(i>=uBeachEditCount)break;float s=length(p-uBeachEdits[i].xyz)-uBeachEdits[i].w;d=uBeachEditModes[i]>0.?min(d,s):max(d,-s);}return d;}
`;
