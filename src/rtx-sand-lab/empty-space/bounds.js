// Conservative cubic terrain ceilings. Positive B-spline weights cannot
// exceed the largest control height in their support. Boundary tiles extend
// outward because the existing terrain sampler clamps outside the beach.
export const TILE_COUNT=8, MAX_TERRAIN_SIZE=256, BOUND_MARGIN=.002;
export function terrainCeilings(data,n){
 if(!Number.isInteger(n)||n<2||n>MAX_TERRAIN_SIZE||data.length<n*n*4)throw Error('Terrain bounds capacity exceeded');
 const out=new Float32Array(64);
 for(let z=0;z<8;z++)for(let x=0;x<8;x++){
  const lowX=Math.max(0,Math.floor(x*(n-1)/8)-1),highX=Math.min(n-1,Math.floor((x+1)*(n-1)/8)+2),lowZ=Math.max(0,Math.floor(z*(n-1)/8)-1),highZ=Math.min(n-1,Math.floor((z+1)*(n-1)/8)+2);
  let h=-Infinity;for(let j=lowZ;j<=highZ;j++)for(let i=lowX;i<=highX;i++)h=Math.max(h,data[(j*n+i)*4]);
  if(!Number.isFinite(h))throw Error('Nonfinite terrain height');out[z*8+x]=Math.fround(h+BOUND_MARGIN);
 }return out;
}
export function firstTerrainEntry(o,d,bounds,limit=75){
 const low=[-5.5,-4.9],size=[11/8,9.8/8],p=[o[0],o[2]],v=[d[0],d[2]],cell=p.map((x,k)=>Math.max(0,Math.min(7,Math.floor((x-low[k])/size[k]))));let t=0;
 for(let i=0;i<18;i++){
  const exits=cell.map((c,k)=>Math.abs(v[k])<1e-9||v[k]<0&&c===0||v[k]>0&&c===7?limit:Math.max(t,(low[k]+(c+Number(v[k]>0))*size[k]-p[k])/v[k]));
  const end=Math.min(limit,...exits),h=bounds[cell[1]*8+cell[0]];
  if(Math.min(o[1]+d[1]*t,o[1]+d[1]*end)<=h)return d[1]<0?Math.max(t,(h-o[1])/d[1]):t;
  if(end>=limit)return limit;
  for(let k=0;k<2;k++)if(exits[k]<=end)cell[k]+=v[k]>0?1:-1;
  t=end;
 }return t; // Exhaustion is conservative, never a claimed miss.
}
export const BOUNDS_WGSL=`
@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var bounds:texture_storage_2d<r32float,write>;
var<workgroup> heights:array<f32,64>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let n=i32(textureDimensions(terrain).x);let lo=max(vec2i(0),vec2i(group.xy)* (n-1)/8-vec2i(1));
 let hi=min(vec2i(n-1),(vec2i(group.xy)+vec2i(1))*(n-1)/8+vec2i(2));let size=hi-lo+vec2i(1);let count=u32(size.x*size.y);
 var h=-3.4e38;for(var i=lane;i<count;i+=64u){h=max(h,textureLoad(terrain,lo+vec2i(i32(i)%size.x,i32(i)/size.x),0).r);}heights[lane]=h;
 for(var stride=32u;stride>0u;stride/=2u){workgroupBarrier();if(lane<stride){heights[lane]=max(heights[lane],heights[lane+stride]);}}
 workgroupBarrier();if(lane==0u){textureStore(bounds,vec2i(group.xy),vec4f(heights[0]+0.002));}
}`;
export const EMPTY_SPACE_GLSL=`
uniform bool uEmptySpaceBounds;uniform bool uEmptySpaceAdvance;uniform sampler2D uEmptyBounds;
float firstTerrainEntry(vec3 o,vec3 d,float limit){
 ivec2 cell=ivec2(clamp(floor((o.xz+vec2(5.5,4.9))/vec2(11.,9.8)*8.),0.,7.));float t=0.;
 for(int i=0;i<18;i++){
  vec2 edge=vec2(-5.5,-4.9)+(vec2(cell)+vec2(greaterThan(d.xz,vec2(0))))*vec2(11.,9.8)/8.;vec2 exitAt=vec2(limit);
  if(abs(d.x)>1e-9&&!((d.x<0.&&cell.x==0)||(d.x>0.&&cell.x==7)))exitAt.x=max(t,(edge.x-o.x)/d.x);
  if(abs(d.z)>1e-9&&!((d.z<0.&&cell.y==0)||(d.z>0.&&cell.y==7)))exitAt.y=max(t,(edge.y-o.z)/d.z);
  float end=min(limit,min(exitAt.x,exitAt.y)),h=texelFetch(uEmptyBounds,cell,0).r;
  if(min(o.y+d.y*t,o.y+d.y*end)<=h)return d.y<0.?max(t,(h-o.y)/d.y):t;
  if(end>=limit)return limit;
  if(exitAt.x<=end)cell.x+=d.x>0.?1:-1;if(exitAt.y<=end)cell.y+=d.z>0.?1:-1;t=end;
 }return t;
}
float firstSandEntry(vec3 o,vec3 d,float limit){
 float t=firstTerrainEntry(o,d,limit);
 // Parcel bounds already include smooth-union support. Never skip into them.
 if(uSandCount>0){vec2 span=sandRayInterval(o,d);if(span.y>=span.x)t=min(t,max(0.,span.x-.002));}
 return t;
}
bool rayMayHitBody(vec3 o,vec3 d,float limit){
 for(int j=0;j<uBodyCount;j++){
  if(texelFetch(uBodies,ivec2((j*2+1)%256,(j*2+1)/256),0).w<=.5)continue;
  vec4 b=labBody(j);vec3 q=o-b.xyz;float r=b.w*1.55+.002,a=dot(q,d),disc=a*a-dot(q,q)+r*r;
  if(disc>=0.&&-a+sqrt(disc)>=0.&&-a-sqrt(disc)<=limit)return true;
 }return false;
}
`;
