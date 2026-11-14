export const SURFACE_INPUT_WGSL=`
@group(0) @binding(0) var<uniform> c:array<vec4f,3>;
@group(0) @binding(1) var<storage,read> water:array<f32>;
@group(0) @binding(2) var<storage,read> columns:array<i32>;
@group(0) @binding(3) var<storage,read> bed:array<f32>;
@group(0) @binding(4) var<storage,read> bodies:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> raw:array<vec4f>;
@group(0) @binding(6) var surface:texture_storage_2d<rgba32float,write>;
@group(0) @binding(7) var flow:texture_storage_2d<rgba32float,write>;
fn position(i:u32)->vec4f {let o=i*4u;return vec4f(water[o],water[o+1u],water[o+2u],water[o+3u]);}
fn velocity(i:u32)->vec3f {let o=u32(c[0].x)*4u+i*4u;return vec3f(water[o],water[o+2u],water[o+1u]);}
fn candidate(i:u32,rain:bool)->bool {return position(i).w==0.&&(rain||water[u32(c[0].x)*16u+i]>=5.||c[0].w==0.);}
fn cell(p:vec2f)->vec2i {return clamp(vec2i(floor((p+vec2f(5.5,4.9))/c[1].z)),vec2i(0),vec2i(c[1].xy)-1);}
fn head(b:vec2i)->i32 {if(any(b<vec2i(0))||any(b>=vec2i(c[1].xy))){return -1;}return columns[b.x+b.y*i32(c[1].x)];}
fn next(i:i32)->i32 {return columns[u32(c[1].x*c[1].y)+u32(i)];}
fn gather(uv:vec2u,rain:bool) {
 let size=u32(c[1].w);if(any(uv>=vec2u(size))){return;}
 let point=(vec2f(uv)+.5)*vec2f(11,9.8)/f32(size)-vec2f(5.5,4.9);let base=cell(point);
 var radius=c[0].y*.85;if(!rain){radius=max(radius,length(vec2f(11,9.8)/f32(size))*.55);}let r2=radius*radius;
 var top=-100.;var sum=vec3f(0);var organic=0.;var activity=0.;var weight=0.;let n=u32(c[0].x);
 for(var z=-1;z<=1;z++){for(var x=-1;x<=1;x++){var i=head(base+vec2i(x,z));
  for(var seen=0u;seen<64u&&i>=0;seen++){let id=u32(i);let p=position(id);if(candidate(id,rain)&&dot(point-p.xz,point-p.xz)<=r2){top=max(top,p.y+c[0].y*.32);}i=next(i);}
 }}
 if(rain){textureStore(surface,vec2i(uv),vec4f(top,0,0,0));return;}
 for(var z=-1;z<=1;z++){for(var x=-1;x<=1;x++){var i=head(base+vec2i(x,z));
  for(var seen=0u;seen<64u&&i>=0;seen++){let id=u32(i);let p=position(id);let d2=dot(point-p.xz,point-p.xz);
   if(candidate(id,false)&&d2<=r2&&p.y+c[0].y*.32>=top-c[0].y*.65){let w=max(.001,1.-d2/r2);weight+=w;sum+=velocity(id)*w;organic+=max(0.,c[2].x+water[n*8u+id*4u+1u])*w;activity+=clamp(water[n*12u+id*4u+3u]*.35+max(water[n*17u+id*2u],water[n*17u+id*2u+1u])*.25-.035,0.,1.)*w;}
   i=next(i);
  }
 }}
 let k=uv.x+uv.y*size;var wet=select(0.,1.,weight>0.&&top>bed[k]+.025/c[0].z);
 if(weight>0.){sum/=weight;organic=1.-exp(-organic/weight);activity/=weight;}
 let world=vec3f(point.x,top,point.y);
 for(var j=0u;j<u32(c[2].y);j++){let b=bodies[j];if(distance(world,b.xyz)<b.w){wet=0.;activity=0.;}}
 raw[k*2u]=vec4f(top,bed[k],organic,activity);raw[k*2u+1u]=vec4f(sum,wet);
}
@compute @workgroup_size(8,8) fn sea(@builtin(global_invocation_id) gid:vec3u){gather(gid.xy,false);}
@compute @workgroup_size(8,8) fn rain(@builtin(global_invocation_id) gid:vec3u){gather(gid.xy,true);}
fn velocityAt(q:vec2i)->vec4f {let size=i32(c[1].w);let p=clamp(q,vec2i(0),vec2i(size-1));return raw[u32(p.x+p.y*size)*2u+1u];}
@compute @workgroup_size(8,8) fn focus(@builtin(global_invocation_id) gid:vec3u){
 let size=u32(c[1].w);if(any(gid.xy>=vec2u(size))){return;}let uv=vec2i(gid.xy);let k=gid.x+gid.y*size;var s=raw[k*2u];let f=raw[k*2u+1u];
 if(f.w<.5){s.w=0.;}else{let a=velocityAt(uv-vec2i(1,0));let b=velocityAt(uv+vec2i(1,0));let d=velocityAt(uv-vec2i(0,1));let e=velocityAt(uv+vec2i(0,1));
 let convergence=max(0.,-(select(0.,b.x,b.w>.5)-select(0.,a.x,a.w>.5))/(22./f32(size))-(select(0.,e.y,e.w>.5)-select(0.,d.y,d.w>.5))/(19.6/f32(size)));
 let shoal=exp(-max(0.,(s.x-s.y)*c[0].z)/max(2.,c[0].y*c[0].z*2.5));s.w=clamp(smoothstep(.06,.6,s.w)*(.12+1.8*shoal)*(.4+.6*smoothstep(.015,.18,convergence)),0.,1.);}
 textureStore(surface,uv,s);textureStore(flow,uv,f);
}
`;

export const FLOW_INPUT_WGSL=`
@group(0) @binding(0) var<uniform> c:array<vec4f,3>;
@group(0) @binding(1) var<storage,read> water:array<f32>;
@group(0) @binding(2) var centers:texture_storage_2d<rgba32float,write>;
@group(0) @binding(3) var channels:texture_storage_2d<rgba32float,write>;
@group(0) @binding(4) var shapes:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;let n=u32(c[0].x);if(i>=n){return;}let o=i*4u;let s=c[0].y;let sigma=max(.018,s*(.65+.2*clamp((select(0.,water[n*16u+i],i<u32(c[2].z))-5.)/20.,0.,1.))*.95);let at=vec2i(i32(i%64u),i32(i/64u));
 textureStore(centers,at,vec4f(water[o],water[o+1u],water[o+2u],sigma));
 textureStore(channels,at,vec4f(water[n*4u+o],water[n*4u+o+1u],water[n*4u+o+2u],s*s*s/(15.7496099457*sigma*sigma*sigma)));
 textureStore(shapes,at,vec4f(0,1,0,1));
}`;
