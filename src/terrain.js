export const CHUNK_SIZE = 16;
export const STREAM_RADIUS = 3;
export const MAX_TERRAIN_EDITS = 64;
export const TERRAIN_MIN_Y = -12;
export const TERRAIN_MAX_Y = 12;

export function terrainHeight(x, z) {
  const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - 10) / 18));
  if(t===0)return 0;
  const envelope = t * t * (3 - 2 * t);
  return envelope * (2.6 * Math.sin(x * .055) * Math.cos(z * .045)
    + 1.4 * Math.sin(x * .11 + z * .07)
    + .6 * Math.sin(x * .23) * Math.cos(z * .18));
}

// Conservative distance bound, not an exact Euclidean distance to the height
// surface. Division by two bounds the gradient, including the central plateau.
export function terrainDistance(x, y, z, edits = []) {
  let d = (y - terrainHeight(x, z)) / 2;
  return terrainCSG(d,x,y,z,edits);
}

// Shared CSG semantics for streamed terrain and the volumetric beach.
export function terrainCSG(d,x,y,z,edits){
  for(const e of edits){const sphere=Math.hypot(x-e[0],y-e[1],z-e[2])-e[3];d=e[4]>0?Math.min(d,sphere):Math.max(d,-sphere);}
  return d;
}

export function fieldNormal(distance,p,e=.003){
 const n=[0,1,2].map(i=>{const a=p.slice(),b=p.slice();a[i]+=e;b[i]-=e;return distance(a)-distance(b);}),length=Math.hypot(...n)||1;return n.map(v=>v/length);
}
export function terrainNormal(p,edits=[]){return fieldNormal(q=>terrainDistance(...q,edits),p);}

export const chunkKey = (x, z) => `${x},${z}`;
export function editsForChunk(edits, cx, cz, margin = 3) {
  const x = cx * CHUNK_SIZE, z = cz * CHUNK_SIZE;
  return edits.filter(e => e[0]+e[3]>=x-margin && e[0]-e[3]<=x+CHUNK_SIZE+margin
    && e[2]+e[3]>=z-margin && e[2]-e[3]<=z+CHUNK_SIZE+margin);
}

export function desiredChunks(x, z, radius = STREAM_RADIUS) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  const chunks = [];
  for (let dz=-radius; dz<=radius; dz++) for (let dx=-radius; dx<=radius; dx++) {
    const distance = Math.max(Math.abs(dx), Math.abs(dz));
    chunks.push({ key:chunkKey(cx+dx,cz+dz), cx:cx+dx, cz:cz+dz,
      spacing:distance<=1 ? .5 : distance===2 ? 1 : 2, priority:dx*dx+dz*dz });
  }
  return chunks.sort((a,b) => a.priority-b.priority);
}

export class Terrain {
  constructor() { this.edits=[]; this.revision=0; this.lastEdit=null; }
  distance(p) { return terrainDistance(...p,this.edits); }
  normal(p) { return terrainNormal(p,this.edits); }
  edit(point, radius, mode = 'subtract') {
    if(this.edits.length>=MAX_TERRAIN_EDITS || point.length!==3 || !point.every(Number.isFinite)
      || !Number.isFinite(radius) || radius<.25 || radius>3
      || point[1]-radius<TERRAIN_MIN_Y+1 || point[1]+radius>TERRAIN_MAX_Y-1) return false;
    this.edits.push([...point,radius,mode==='add'?1:-1]);
    this.lastEdit=[...point]; this.revision++; return true;
  }
  undo() { if(!this.edits.length)return false; this.lastEdit=this.edits.pop().slice(0,3); this.revision++; return true; }
  serialize() { return JSON.stringify({version:1,edits:this.edits}); }
  restore(text) {
    try {
      const data=JSON.parse(text);
      if(data.version!==1 || !Array.isArray(data.edits) || data.edits.length>MAX_TERRAIN_EDITS) return false;
      const valid=data.edits.every(e=>Array.isArray(e)&&e.length===5&&e.every(Number.isFinite)
        && e[3]>=.25&&e[3]<=3&&Math.abs(e[4])===1
        && e[1]-e[3]>=TERRAIN_MIN_Y+1&&e[1]+e[3]<=TERRAIN_MAX_Y-1);
      if(!valid)return false;
      this.edits=data.edits; this.lastEdit=this.edits.at(-1)?.slice(0,3)||null; this.revision++; return true;
    } catch { return false; }
  }
}

export const TERRAIN_GLSL = `
uniform bool uTerrainMode;
uniform int uTerrainEditCount;
uniform vec4 uTerrainEdits[64];
uniform float uTerrainEditModes[64];
float terrainHeight(vec2 p){
 float t=clamp((length(p)-10.)/18.,0.,1.);
 if(t==0.)return 0.;
 return t*t*(3.-2.*t)*(2.6*sin(p.x*.055)*cos(p.y*.045)+1.4*sin(p.x*.11+p.y*.07)+.6*sin(p.x*.23)*cos(p.y*.18));
}
float terrainField(vec3 p){
 if(!uTerrainMode)return p.y;
 float d=(p.y-terrainHeight(p.xz))*.5;
 for(int i=0;i<64;i++){
  if(i>=uTerrainEditCount)break;
  float sphere=length(p-uTerrainEdits[i].xyz)-uTerrainEdits[i].w;
  d=uTerrainEditModes[i]>0.?min(d,sphere):max(d,-sphere);
 }
 return d;
}
`;
