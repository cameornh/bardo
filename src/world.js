import { Terrain, TERRAIN_GLSL } from './terrain.js';
// The field is the authoritative shape. Rendering samples and physics query it.
export const MATERIALS = [
  { name: 'Terracotta', color: [0.57, 0.20, 0.115], roughness: 0.64, metal: 0, transmission: 0, scatter: 0.08, friction: 0.65 },
  { name: 'Brushed copper', color: [0.72, 0.37, 0.16], roughness: 0.23, metal: 0.94, transmission: 0, scatter: 0, friction: 0.4 },
  { name: 'Jade wax', color: [0.24, 0.51, 0.38], roughness: 0.32, metal: 0, transmission: 0, scatter: 0.8, friction: 0.5 },
  { name: 'Sea glass', color: [0.57, 0.81, 0.72], roughness: 0.09, metal: 0, transmission: 0.95, scatter: 0, friction: 0.22 },
  { name: 'Wool', color: [0.69, 0.54, 0.31], roughness: 0.95, metal: 0, transmission: 0, scatter: 0.25, friction: 0.8 },
  { name: 'Copper probe', color: [0.73, 0.33, 0.10], roughness: 0.22, metal: 0.8, transmission: 0, scatter: 0, friction: 0.55 },
  { name: 'Limestone', color: [0.60, 0.59, 0.51], roughness: 0.9, metal: 0, transmission: 0, scatter: 0, friction: 0.6 },
];

export const OBJECTS = [
  { id: 0, name: 'Clay', center: [-3, 1.03, 0], bound: 1.6 },
  { id: 1, name: 'Copper', center: [0, 1.2, -0.35], bound: 1.3 },
  { id: 2, name: 'Wax', center: [3, 0.98, 0], bound: 1.04 },
  { id: 3, name: 'Glass', center: [-1.55, 0.76, 2.95], bound: 0.82 },
  { id: 4, name: 'Wool', center: [1.55, 0.80, 3.0], bound: 0.86 },
  { id: 5, name: 'Probe', center: [0, 3.8, 1.7], bound: 0.45 },
];

export function smoothUnion(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function baseDistance(id, x, y, z) {
  if (id === 0) return smoothUnion(Math.hypot(x, y + 0.03, z) - 1.0, Math.hypot(x - 0.23, y - 0.65, z + 0.06) - 0.60, 0.45);
  if (id === 1) return Math.hypot(Math.hypot(x, y) - 0.85, z) - 0.32;
  return Math.hypot(x, y, z) - [1, 1, 0.98, 0.76, 0.80, 0.43][id];
}

export class World {
  constructor() {
    this.objects = OBJECTS.map(o => ({ ...o, center: [...o.center] }));
    this.edits = [];
    this.revision = 0;
    this.terrain = new Terrain();
    this.terrainEnabled = false;
    this.showcaseEnabled = true;
    this.fluidEnabled = false;
  }
  localDistance(id, x, y, z) {
    let d = baseDistance(id, x, y, z);
    if (id === 0) for (const e of this.edits) d = Math.max(d, -(Math.hypot(x-e[0], y-e[1], z-e[2]) - e[3]));
    return d;
  }
  distanceTo(id, p) {
    if (id === 6) return this.terrainEnabled ? this.terrain.distance(p) : p[1];
    const c = this.objects[id].center;
    return this.localDistance(id, p[0]-c[0], p[1]-c[1], p[2]-c[2]);
  }
  sample(p, omit = -1) {
    let distance = this.distanceTo(6,p), id = 6;
    for (let i = 0; i < this.objects.length; i++) {
      if(i<5&&!this.showcaseEnabled)continue;
      if (i === omit) continue;
      const d = this.distanceTo(i, p);
      if (d < distance) { distance = d; id = i; }
    }
    return { distance, id };
  }
  collisionSample(p, omit = -1) {
    const result=this.sample(p,omit);
    if(result.id===6&&this.terrainEnabled){
      const n=this.terrain.normal(p),e=.004;
      const gradient=(this.terrain.distance(p.map((v,i)=>v+n[i]*e))-result.distance)/e;
      result.distance/=Math.max(.2,Math.abs(gradient));
      // Recompare solid distances after correcting the terrain's distance bound.
      for(let id=0;id<this.objects.length;id++)if(id!==omit&&(id===5||this.showcaseEnabled)){const d=this.distanceTo(id,p);if(d<result.distance){result.distance=d;result.id=id;}}
    }
    return result;
  }
  normal(id, p, local = false) {
    if (id === 6) return this.terrainEnabled ? this.terrain.normal(p) : [0,1,0];
    const e = 0.001;
    const f = (x,y,z) => local ? this.localDistance(id,x,y,z) : this.distanceTo(id,[x,y,z]);
    const [x,y,z] = p;
    const n = [f(x+e,y,z)-f(x-e,y,z), f(x,y+e,z)-f(x,y-e,z), f(x,y,z+e)-f(x,y,z-e)];
    const length = Math.hypot(...n) || 1;
    return n.map(v => v/length);
  }
  raycast(origin, direction, only = -1, maxDistance = 180) {
    let t = 0;
    for (let step = 0; step < 360 && t < maxDistance; step++) {
      const point = origin.map((v,i) => v + direction[i]*t);
      const s = only >= 0 ? { distance: this.distanceTo(only,point), id: only } : this.sample(point);
      if (s.distance < 0.003) return { point, id:s.id, normal:this.normal(s.id,point), distance:t };
      t += Math.max(s.distance * 0.75, 0.002);
    }
    return null;
  }
  carve(point, radius = 0.36) {
    if (this.edits.length >= 12) return false;
    const c = this.objects[0].center;
    this.edits.push([point[0]-c[0], point[1]-c[1], point[2]-c[2],radius]);
    this.revision++;
    return true;
  }
  undo() { if (this.edits.length) { this.edits.pop(); this.revision++; return true; } return false; }
}

// Same primitive definitions as baseDistance; tested against CPU landmarks.
// Edits and object centers are uniforms, so secondary rays see the edited world.
export const FIELD_GLSL = `
${TERRAIN_GLSL}
uniform vec3 uCenters[6];
uniform bool uShowcase;
uniform vec4 uEdits[12];
uniform int uEditCount;
float smoothUnion(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float objectDistance(int id, vec3 worldP){
 vec3 p=worldP-uCenters[id]; float d;
 if(id==0){
  d=smoothUnion(length(p+vec3(0,.03,0))-1.,length(p-vec3(.23,.65,-.06))-.60,.45);
  for(int i=0;i<12;i++){if(i>=uEditCount)break;d=max(d,-(length(p-uEdits[i].xyz)-uEdits[i].w));}
 }else if(id==1){d=length(vec2(length(p.xy)-.85,p.z))-.32;}
 else if(id==2)d=length(p)-.98;
 else if(id==3)d=length(p)-.76;
 else if(id==4)d=length(p)-.80;
 else d=length(p)-.43;
 return d;
}
vec2 mapScene(vec3 p,int omit){
 vec2 result=vec2(terrainField(p),6.);
 // The five static test objects fit in this conservative sphere. Distant
 // terrain rays skip their individual primitives and clay edit evaluations.
 if(uShowcase&&length(p-vec3(0,1,1))-5.5<result.x){
  for(int i=0;i<5;i++){if(i==omit)continue;float d=objectDistance(i,p);if(d<result.x)result=vec2(d,float(i));}
 }
 // The dynamic probe is outside that static group and must always be queried.
 if(omit!=5){float d=objectDistance(5,p);if(d<result.x)result=vec2(d,5.);}
 return result;
}
vec3 fieldNormal(vec3 p,int id){
 vec2 e=vec2(.002,0);
 if(id==6)return normalize(vec3(terrainField(p+e.xyy)-terrainField(p-e.xyy),terrainField(p+e.yxy)-terrainField(p-e.yxy),terrainField(p+e.yyx)-terrainField(p-e.yyx)));
 return normalize(vec3(objectDistance(id,p+e.xyy)-objectDistance(id,p-e.xyy),objectDistance(id,p+e.yxy)-objectDistance(id,p-e.yxy),objectDistance(id,p+e.yyx)-objectDistance(id,p-e.yyx)));
}
`;
