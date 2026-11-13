import * as THREE from 'three';
import {QUAD_VERTEX} from '../../shaders.js';

// Cache the actual cubic polynomial, not a sampled approximation of the
// surface. Each cell owns four RGBA32F coefficient texels. No camera state,
// moisture or parcel geometry is baked into this ground-only representation.
export const polynomial = (a,b,c,d) => [(a+4*b+c)/6,(c-a)/2,(a-2*b+c)/2,(-a+3*b-3*c+d)/6];
export function terrainCoefficients(data,n,x,z,stride=4){
 const rows=[];
 for(let j=0;j<4;j++)rows.push(polynomial(...Array.from({length:4},(_,i)=>data[(Math.max(0,Math.min(n-1,z+j-1))*n+Math.max(0,Math.min(n-1,x+i-1)))*stride])));
 return Array.from({length:4},(_,i)=>polynomial(...rows.map(r=>r[i])));
}
export function evaluateTerrain(c,x,z){
 const f=v=>((v[3]*z+v[2])*z+v[1])*z+v[0],g=v=>(3*v[3]*z+2*v[2])*z+v[1],a=c.map(f),b=c.map(g);
 return [((a[3]*x+a[2])*x+a[1])*x+a[0],(3*a[3]*x+2*a[2])*x+a[1],((b[3]*x+b[2])*x+b[1])*x+b[0]];
}

// A modified control point affects four adjacent cubic cells. Tile halos
// account for that support exactly, including clamped beach boundaries.
export class TerrainTileJournal {
 constructor(tileSize=8){this.tileSize=tileSize;this.totalRebuilds=0;}
 update(data,n,revision,identity=data){
  const reset=this.identity!==identity||this.n!==n,dirty=new Set(),tiles=Math.ceil(n/this.tileSize);
  if(!reset&&this.revision===revision)return [];
  if(reset){this.n=n;this.identity=identity;this.heights=new Float32Array(n*n).fill(NaN);}
  for(let k=0;k<n*n;k++)if(this.heights[k]!==data[k*4]){
   this.heights[k]=data[k*4];const x=k%n,z=Math.floor(k/n);
   for(let j=Math.max(0,z-2);j<=Math.min(n-1,z+1);j++)for(let i=Math.max(0,x-2);i<=Math.min(n-1,x+1);i++)dirty.add(Math.floor(j/this.tileSize)*tiles+Math.floor(i/this.tileSize));
  }
  this.revision=revision;this.totalRebuilds+=dirty.size;
  return [...dirty].sort((a,b)=>a-b).map(k=>{const x=k%tiles*this.tileSize,z=Math.floor(k/tiles)*this.tileSize;return [x,z,Math.min(this.tileSize,n-x),Math.min(this.tileSize,n-z)];});
 }
}

export const TERRAIN_COEFFICIENT_FRAGMENT=`precision highp float;precision highp int;
uniform sampler2D uSand;out vec4 outColor;
vec4 poly(vec4 v){return vec4((v.x+4.*v.y+v.z)/6.,(v.z-v.x)*.5,(v.x-2.*v.y+v.z)*.5,(-v.x+3.*v.y-3.*v.z+v.w)/6.);}
void main(){ivec2 pixel=ivec2(gl_FragCoord.xy),cell=ivec2(pixel.x/4,pixel.y);int column=pixel.x%4,n=textureSize(uSand,0).x;vec4 v;
 for(int j=0;j<4;j++){vec4 row;for(int i=0;i<4;i++)row[i]=texelFetch(uSand,clamp(cell+ivec2(i-1,j-1),ivec2(0),ivec2(n-1)),0).r;v[j]=poly(row)[column];}
 outColor=poly(v);
}`;

export const TERRAIN_CACHE_GLSL=`
uniform bool uTerrainPolynomial;uniform sampler2D uTerrainCoefficients;
vec3 cachedTerrain(vec2 p){
 float n=float(textureSize(uSand,0).x);vec2 raw=(p+vec2(5.5,4.9))/vec2(11.,9.8)*(n-1.),q=clamp(raw,0.,n-1.),f=fract(q);ivec2 c=ivec2(floor(q));
 vec4 a=texelFetch(uTerrainCoefficients,ivec2(c.x*4,c.y),0),b=texelFetch(uTerrainCoefficients,ivec2(c.x*4+1,c.y),0),v=texelFetch(uTerrainCoefficients,ivec2(c.x*4+2,c.y),0),d=texelFetch(uTerrainCoefficients,ivec2(c.x*4+3,c.y),0);
 vec4 row=((d*f.x+v)*f.x+b)*f.x+a,dx=(3.*d*f.x+2.*v)*f.x+b;
 float h=((row.w*f.y+row.z)*f.y+row.y)*f.y+row.x;
 vec2 g=vec2(((dx.w*f.y+dx.z)*f.y+dx.y)*f.y+dx.x,(3.*row.w*f.y+2.*row.z)*f.y+row.y)*(n-1.)/vec2(11.,9.8);
 if(raw.x<0.||raw.x>n-1.)g.x=0.;if(raw.y<0.||raw.y>n-1.)g.y=0.;return vec3(h,g);
}
`;

function appendToFunction(source,signature,wrapper){
 const start=source.indexOf(signature),brace=source.indexOf('{',start);let end=brace+1,depth=1;
 if(start<0||brace<0)throw Error('Terrain shader contract changed');
 for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;if(end>=source.length)throw Error('Unclosed terrain shader');}
 return source.slice(0,end)+'\n'+wrapper+'\n'+source.slice(end);
}

export function cacheTerrainShader(source){
 if(!source.includes('float sandHeight(vec2 p)'))return source;
 source=source.replace('float sandHeight(vec2 p)','float referenceSandHeight(vec2 p)');
 const at=source.indexOf('float referenceSandHeight');source=source.slice(0,at)+TERRAIN_CACHE_GLSL+source.slice(at);
 // Insert after the reference function, before its callers.
 source=appendToFunction(source,'float referenceSandHeight','float sandHeight(vec2 p){return uTerrainPolynomial?cachedTerrain(p).x:referenceSandHeight(p);}');
 if(source.includes('vec2 sandHeightGradient(vec2 p)')){
  source=source.replace('vec2 sandHeightGradient(vec2 p)','vec2 referenceSandGradient(vec2 p)');
  source=appendToFunction(source,'vec2 referenceSandGradient','vec2 sandHeightGradient(vec2 p){return uTerrainPolynomial?cachedTerrain(p).yz:referenceSandGradient(p);}');
 }
 return source;
}

export class TerrainSurfaceCache {
 constructor(draw){
  this.draw=draw;this.journal=new TerrainTileJournal();this.target=new THREE.WebGLRenderTarget(4,1,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.u={uTerrainPolynomial:{value:false},uTerrainCoefficients:{value:this.target.texture}};
  this.material=new THREE.ShaderMaterial({name:'terrain-polynomial-cache',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TERRAIN_COEFFICIENT_FRAGMENT,uniforms:{uSand:draw.lab.u.uSand},depthTest:false,depthWrite:false});
  this.scene=new THREE.Scene();this.geometry=new THREE.PlaneGeometry(2,2);this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.stats={tiles:0,texels:0,updates:0};
 }
 install(){
  // Only rendering passes; physics, shadows' geometry, snapshots and tools
  // retain their existing exact data. Apply to each split pass explicitly.
  this.materials=[];
  for(const split of this.draw.splitSurfaces.values())for(const job of split.jobs(null))job.scene.traverse(o=>{
   const m=o.material;if(!m||this.materials.includes(m))return;const next=cacheTerrainShader(m.fragmentShader);if(next===m.fragmentShader)return;
   this.materials.push(m);m.fragmentShader=next;Object.assign(m.uniforms,this.u);m.needsUpdate=true;
  });
  const render=this.draw.render.bind(this.draw);this.draw.render=options=>{this.update();return render(options);};return this;
 }
 update(){
  const {lab,renderer:r}=this.draw,enabled=lab.optimizations.terrainPolynomial===true;this.u.uTerrainPolynomial.value=enabled;
  this.stats.tiles=this.stats.texels=0;if(!enabled)return;
  lab.syncUniforms();const bed=lab.sand,n=bed.n;
  // Budget remains bounded. Unexpected larger grids use the reference.
  if(n>256){this.u.uTerrainPolynomial.value=false;return;}
  const dirty=this.journal.update(bed.data,n,bed.bedGeometryRevision,bed);if(!dirty.length)return;
  if(this.target.width!==n*4||this.target.height!==n)this.target.setSize(n*4,n);
  const old=r.getRenderTarget(),viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),test=r.getScissorTest(),auto=r.autoClear;r.autoClear=false;
  try{r.setRenderTarget(this.target);r.setScissorTest(true);
   // For a broad reset a single draw costs less than dozens of rectangles.
   const rectangles=dirty.length>16?[[0,0,n,n]]:dirty;
   for(const [x,z,w,h] of rectangles){r.setScissor(x*4,z,w*4,h);r.render(this.scene,this.camera);this.stats.texels+=w*h*4;}
   this.stats.tiles=dirty.length;this.stats.updates++;
  }finally{r.setRenderTarget(old);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(test);r.autoClear=auto;}
 }
 jobs(){return [{name:this.material.name,scene:this.scene,camera:this.camera,target:this.target}];}
 dispose(){this.target.dispose();this.material.dispose();this.geometry.dispose();}
}
