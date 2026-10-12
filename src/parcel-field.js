// Sparse bricks retain small kernels even when the spray spans a large region.
// The normalized Gaussian integral is exactly the parcel's physical volume;
// its isosurface is visual reconstruction, not an extra source of material.
export const PARCEL_BRICK=1.6, PARCEL_CELLS=24, PARCEL_PAD=26, PARCEL_DX=PARCEL_BRICK/PARCEL_CELLS, PARCEL_ISO=.18;
export function parcelKernel(p){const sigma=Math.max(.018,p.radius*.95);return {sigma,amplitude:p.volume/((2*Math.PI)**1.5*sigma**3)};}
export function parcelDensity(items,point,kind){let density=0,wet=0;const gradient=[0,0,0];for(const p of items){if(p.kind!==kind)continue;const {sigma,amplitude}=parcelKernel(p),q=point.map((v,k)=>(v-p.position[k])/sigma);if(q.some(v=>Math.abs(v)>3))continue;const w=amplitude*Math.exp(-.5*q.reduce((v,x)=>v+x*x,0));density+=w;wet+=w*p.wet;for(let k=0;k<3;k++)gradient[k]-=w*q[k]/sigma;}return {density,wet:density?wet/density:0,gradient};}
export function brickHash(x,y,z,mask){return ((Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))>>>0)&mask;}
export function parcelBricks(items){const bricks=[],map=new Map();for(const p of items){const {sigma}=parcelKernel(p),radius=3*sigma+PARCEL_DX,lo=p.position.map(v=>Math.floor((v-radius)/PARCEL_BRICK)),hi=p.position.map(v=>Math.floor((v+radius)/PARCEL_BRICK));for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){const key=`${x},${y},${z}`;if(!map.has(key)){map.set(key,bricks.length);bricks.push({cell:[x,y,z],items:[]});}bricks[map.get(key)].items.push(p);}}
 const capacity=2**Math.ceil(Math.log2(Math.max(4,bricks.length*4))),table=new Float32Array(capacity*4);bricks.forEach((b,id)=>{let slot=brickHash(...b.cell,capacity-1);while(table[slot*4+3])slot=(slot+1)&(capacity-1);table.set([...b.cell,id+1],slot*4);});return {bricks,table,capacity};}
export const PARCEL_FIELD_GLSL=`
uniform highp sampler2D uParcelField,uParcelPages;
uniform int uParcelPageMask,uParcelAtlasColumns;
const float PARCEL_DX=${PARCEL_DX},PARCEL_BRICK=${PARCEL_BRICK},PARCEL_ISO=${PARCEL_ISO};
int parcelBrick(ivec3 c){uint h=(uint(c.x)*73856093u)^(uint(c.y)*19349663u)^(uint(c.z)*83492791u);int slot=int(h&uint(uParcelPageMask));for(int i=0;i<64;i++){vec4 page=texelFetch(uParcelPages,ivec2(slot%256,slot/256),0);if(page.w==0.)return -1;if(all(equal(ivec3(page.xyz),c)))return int(page.w)-1;slot=(slot+1)&uParcelPageMask;}return -1;}
vec3 parcelVoxel(int id,ivec3 c){ivec2 tile=ivec2(id%uParcelAtlasColumns,id/uParcelAtlasColumns)*ivec2(156,130);ivec2 slice=ivec2(c.y%6,c.y/6)*26;return texelFetch(uParcelField,tile+slice+c.xz,0).rgb;}
vec3 parcelSample(vec3 p){ivec3 brick=ivec3(floor(p/PARCEL_BRICK));int id=parcelBrick(brick);if(id<0)return vec3(0);vec3 q=(p-vec3(brick)*PARCEL_BRICK)/PARCEL_DX+vec3(.5);ivec3 c=ivec3(floor(q));vec3 f=fract(q);return mix(mix(mix(parcelVoxel(id,c),parcelVoxel(id,c+ivec3(1,0,0)),f.x),mix(parcelVoxel(id,c+ivec3(0,0,1)),parcelVoxel(id,c+ivec3(1,0,1)),f.x),f.z),mix(mix(parcelVoxel(id,c+ivec3(0,1,0)),parcelVoxel(id,c+ivec3(1,1,0)),f.x),mix(parcelVoxel(id,c+ivec3(0,1,1)),parcelVoxel(id,c+ivec3(1,1,1)),f.x),f.z),f.y);}
`;
