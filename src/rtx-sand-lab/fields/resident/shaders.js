// Small kernels around the unchanged connected pressure/contact solver.
// No camera inputs, extra physics iterations or unbounded dispatch loops.
export const RESIDENT_WATER_WGSL=`
struct Output {p:vec4f,v:vec4f,chem:vec4f,metric:vec4f,extra:vec4f};
@group(0) @binding(0) var<uniform> c:array<vec4f,8>;
@group(0) @binding(1) var<storage,read_write> input:array<f32>;
@group(0) @binding(2) var<storage,read_write> state:array<Output>;
@group(0) @binding(3) var<storage,read> patches:array<f32>;
@group(0) @binding(4) var<storage,read> prediction:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> air:array<vec4f>;
@group(0) @binding(6) var<storage,read> field:array<vec4f>;
@group(0) @binding(7) var<storage,read> topo:array<f32>;
@group(0) @binding(8) var<storage,read_write> published:array<f32>;
fn idx(p:vec3i,d:vec3i)->u32{return u32(p.x+d.x*(p.y+d.y*p.z));}
fn windHash(p:vec2f)->f32{let q=vec2u(p-floor(p/64.)*64.);var n=q.x*374761393u+q.y*668265263u;n=(n^(n>>13u))*1274126177u;return f32((n^(n>>16u))&65535u)/65535.;}
fn noise(p:vec2f)->f32{let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);return mix(mix(windHash(i),windHash(i+vec2f(1,0)),u.x),mix(windHash(i+vec2f(0,1)),windHash(i+vec2f(1)),u.x),u.y);}
fn pressure(p:vec2f,t:f32)->f32{let q=p*.125-vec2f(0,t*c[2].x*.085);return .006*c[2].x*c[2].x*c[2].y*((noise(q)-.5)+.38*(noise(q*2.)-.5)+.16*(noise(q*4.)-.5));}
fn sampleAir(p:vec3f)->vec3f{
 let d=vec3i(c[3].xyz);let q=(p-c[4].xyz)/c[5].xyz-.5;let b=vec3i(floor(q));let f=fract(q);var v=vec3f(0);var w=0.;
 for(var k=0u;k<8u;k++){let delta=vec3i(i32(k&1u),i32((k>>1u)&1u),i32((k>>2u)&1u));let cell=b+delta;if(any(cell<vec3i(0))||any(cell>=d)){continue;}let a=air[2u*u32(c[3].w)+idx(cell,d)];if(a.w==0.){continue;}let weights=select(vec3f(1)-f,f,delta>vec3i(0));let t=weights.x*weights.y*weights.z;v+=a.xyz*t;w+=t;}
 return v/max(w,1e-12)/c[1].z;
}
@compute @workgroup_size(64) fn applyEdits(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=u32(c[0].y)){return;}let o=j*16u;let i=u32(patches[o]);
 state[i].p=vec4f(patches[o+1u],patches[o+2u],patches[o+3u],patches[o+4u]);
 state[i].v=vec4f(patches[o+5u],patches[o+6u],patches[o+7u],patches[o+8u]);
 state[i].chem=vec4f(patches[o+9u],patches[o+10u],patches[o+11u],patches[o+12u]);state[i].extra.x=patches[o+13u];
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(c[0].x)){return;}let o=i*68u;let p=state[i].p;var pred=p;
 if(c[0].z<.5){pred=prediction[i];}
 else if(p.w==0.){
  let dt=c[1].x;let scale=c[1].z;var v=state[i].v.xyz-vec3f(0,9.81/scale*dt,0);
  if((state[i].chem.w>.01||state[i].extra.x<25.)&&c[5].w>.5){
   let a=sampleAir(p.xyz*scale);let rel=a-v;v+=dt*c[2].z*rel*abs(rel);
   var stress=2.6*pressure(p.xz*scale,c[1].w);
   if(c[2].w>.5){let gain=1.6+2.2/(1.+pow(c[2].x/18.,2.));stress=2.6*gain*(pressure(p.xz*scale,c[1].w)*.45+pressure(p.xz*scale*.38,c[1].w*.38)*.85);}
   v.y-=dt*stress*min(1.,pow(length(a)*scale/max(c[2].x,1e-6),2.))/(scale*max(.2,c[1].y*scale));
  }
  let limit=c[1].y*.45/dt;v*=min(1.,limit/max(length(v),1e-12));pred=vec4f(p.xyz+v*dt,p.w);
 }
 for(var k=0u;k<4u;k++){input[o+k]=p[k];input[o+4u+k]=pred[k];input[o+8u+k]=state[i].v[k];input[o+12u+k]=state[i].chem[k];}
}
fn airLayer(i:u32,layer:u32){
 let n=u32(c[3].w);if(i>=n){return;}let d=vec3i(c[3].xyz);let q=vec3i(i32(i)%d.x,(i32(i)/d.x)%d.y,i32(i)/(d.x*d.y));
 let phase=topo[i*4u+3u];var out=vec4f(0);
 if(layer==0u){if(phase==2.){out.w=1.;for(var a=0u;a<3u;a++){var fd=d;fd[a]++;var hi=q;hi[a]++;out[a]=.5*(field[u32(c[6][a])+idx(q,fd)].x+field[u32(c[6][a])+idx(hi,fd)].x);}}}
 else{out=air[(layer-1u)*n+i];if(out.w==0.&&phase==1.){var count=0.;for(var a=0u;a<3u;a++){for(var sign=-1;sign<=1;sign+=2){var at=q;at[a]+=sign;if(any(at<vec3i(0))||any(at>=d)){continue;}let neighbor=air[(layer-1u)*n+idx(at,d)];if(neighbor.w>0.){out=vec4f(out.xyz+neighbor.xyz,0);count+=1.;}}}if(count>0.){out=vec4f(out.xyz/count,f32(layer+1u));}}}
 air[layer*n+i]=out;
}
@compute @workgroup_size(64) fn airBase(@builtin(global_invocation_id) gid:vec3u){airLayer(gid.x,0u);}
@compute @workgroup_size(64) fn airFirst(@builtin(global_invocation_id) gid:vec3u){airLayer(gid.x,1u);}
@compute @workgroup_size(64) fn airSecond(@builtin(global_invocation_id) gid:vec3u){airLayer(gid.x,2u);}
@compute @workgroup_size(64) fn publish(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;let n=u32(c[0].x);if(i>=n){return;}
 for(var k=0u;k<4u;k++){published[i*4u+k]=state[i].p[k];published[n*4u+i*4u+k]=state[i].v[k];published[n*8u+i*4u+k]=state[i].chem[k];published[n*12u+i*4u+k]=state[i].metric[k];}
 published[n*16u+i]=state[i].extra.x;published[n*17u+i*2u]=state[i].extra.y;published[n*17u+i*2u+1u]=state[i].extra.z;published[n*19u+i]=state[i].extra.w;
}
`;
