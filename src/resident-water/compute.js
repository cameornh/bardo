import {GEOMETRY_WGSL} from '../rtx-sand-lab/fields/particles/geometry.js';
// Dynamic occupancy, MAC deposition/projection and marker prediction stay on
// the device. Free surface uses p=0; solid faces have zero normal flux. This
// bounded Jacobi projection is deliberately independent of CPU MG topology.
export const RESIDENT_WGSL=`
struct State {p:vec4f,v:vec4f,chem:vec4f,metric:vec4f,extra:vec4f};
@group(0) @binding(0) var<uniform> cfg:array<vec4f,8>;
@group(0) @binding(1) var<storage,read_write> input:array<f32>;
@group(0) @binding(2) var<storage,read_write> field:array<f32>;
@group(0) @binding(3) var<storage,read_write> state:array<State>;
@group(0) @binding(4) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> slots:array<u32>;
@group(0) @binding(6) var<storage,read_write> grid:array<f32>;
${GEOMETRY_WGSL}
fn D()->vec3i{return vec3i(cfg[5].xyz);} fn N()->u32{return u32(cfg[7].y);}
fn H()->vec3f{return cfg[3].xyz/cfg[0].z;} fn O()->vec3f{return cfg[2].xyz/cfg[0].z;}
fn ix(p:vec3i,d:vec3i)->u32{return u32(p.x+d.x*(p.y+d.y*p.z));}
fn coord(i:u32,d:vec3i)->vec3i{return vec3i(i32(i)%d.x,(i32(i)/d.x)%d.y,i32(i)/(d.x*d.y));}
fn inside(q:vec3i)->bool{return all(q>=vec3i(0))&&all(q<D());}
fn phase(q:vec3i)->f32{if(!inside(q)){return 0.;}return grid[ix(q,D())];}
fn fd(a:u32)->vec3i{var d=D();d[a]++;return d;}
fn fi(q:vec3i,a:u32)->u32{return u32(cfg[6][a])+ix(q,fd(a));}
fn face(j:u32)->vec4i{var a=0u;if(j>=u32(cfg[6].y)){a=1u;}if(j>=u32(cfg[6].z)){a=2u;}return vec4i(coord(j-u32(cfg[6][a]),fd(a)),i32(a));}
fn openFace(q:vec3i,a:u32)->bool{var lo=q;lo[a]--;let p=phase(lo);let r=phase(q);return p>0.&&r>0.&&(p==1.||r==1.);}
fn read4(o:u32)->vec4f{return vec4f(input[o],input[o+1u],input[o+2u],input[o+3u]);}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(cfg[0].x)){return;}let s=state[i];let o=i*68u;var v=s.v.xyz;v.y-=9.81/cfg[0].z*cfg[0].w;
 // Existing particle surface activity gates wind; no camera-dependent force.
 if(s.extra.x<22.){let air=vec3f(cfg[7].z/cfg[0].z,0,0);let relative=air-v;v+=cfg[0].w*.0015*relative*abs(relative);}
 v*=min(1.,cfg[0].y*.45/cfg[0].w/max(1e-8,length(v)));let pred=select(s.p.xyz+v*cfg[0].w,s.p.xyz,s.p.w>0.);
 for(var k=0u;k<4u;k++){input[o+k]=s.p[k];input[o+4u+k]=s.p[k];input[o+8u+k]=s.v[k];input[o+12u+k]=s.chem[k];}for(var k=0u;k<3u;k++){input[o+4u+k]=pred[k];}
 let q=vec3i(floor((s.p.xyz-O())/H()));if(inside(q)&&s.p.w==0.){let at=ix(q,D());let slot=atomicAdd(&counts[at],1u);if(slot<u32(cfg[4].z)){slots[at*u32(cfg[4].z)+slot]=i;}else{atomicStore(&counts[N()],1u);}}
}
@compute @workgroup_size(64) fn classify(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=N()){return;}let p=O()+(vec3f(coord(i,D()))+vec3f(.5))*H();let occupancy=f32(atomicLoad(&counts[i]))*cfg[0].y*cfg[0].y*cfg[0].y/(H().x*H().y*H().z);grid[i]=select(select(2.,0.,solid(p)<0.),1.,occupancy>.25);grid[N()+i]=0.;grid[N()*2u+i]=0.;
}
@compute @workgroup_size(64) fn stencils(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(cfg[0].x)){return;}let o=i*68u;let p=read4(o).xyz;let cell=vec3i(floor((p-O())/H()));input[o+64u]=select(0.,1.,phase(cell)==1.);
 for(var a=0u;a<3u;a++){var off=vec3f(.5);off[a]=0.;let q=(p-O())/H()-off;let base=vec3i(floor(q));let f=fract(q);let d=fd(a);
 for(var k=0u;k<8u;k++){let at=o+16u+a*8u+k;input[at]=-1.;input[at+24u]=0.;let delta=vec3i(i32(k&1u),i32((k>>1u)&1u),i32(k>>2u));let c=base+delta;if(any(c<vec3i(0))||any(c>=d)){continue;}let w=mix(vec3f(1)-f,f,vec3f(delta));input[at]=f32(fi(c,a));input[at+24u]=w.x*w.y*w.z;}}
}
@compute @workgroup_size(64) fn deposit(@builtin(global_invocation_id) id:vec3u){
 let j=id.x;if(j>=u32(cfg[7].x)){return;}let f=face(j);let a=u32(f.w);var off=vec3f(.5);off[a]=0.;let q=vec3f(f.xyz)+off;var sum=0.;var weight=0.;
 var lo=f.xyz;lo[a]--;let wet=phase(lo)==1.||phase(f.xyz)==1.;if(wet){for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let cell=vec3i(floor(q))+vec3i(x,y,z);if(!inside(cell)||phase(cell)!=1.){continue;}let at=ix(cell,D());let count=min(u32(cfg[4].z),atomicLoad(&counts[at]));
 for(var k=0u;k<count;k++){let i=slots[at*u32(cfg[4].z)+k];let o=i*68u;let p=(read4(o).xyz-O())/H();let w3=max(vec3f(0),vec3f(1)-abs(p-q));let w=w3.x*w3.y*w3.z;weight+=w;sum+=w*(input[o+4u+a]-input[o+a])/cfg[0].w;}
 }}}}
 let v=sum/max(1e-12,weight)*cfg[0].z;field[j*4u]=select(0.,v,openFace(f.xyz,a));field[j*4u+1u]=v;field[j*4u+2u]=select(0.,1.,wet);field[j*4u+3u]=0.;
}
@compute @workgroup_size(64) fn rhs(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=N()){return;}let q=coord(i,D());var div=0.;var band=grid[i]!=1.;
 for(var a=0u;a<3u;a++){var hi=q;hi[a]++;div+=(field[fi(hi,a)*4u]-field[fi(q,a)*4u])/H()[a];for(var sign=-1;sign<=1;sign+=2){var next=q;next[a]+=sign;band=band||phase(next)!=1.;}}
 grid[N()*3u+i]=select(0.,-div,grid[i]==1.);field[u32(cfg[4].y)+i]=select(0.,1.,band);
}
fn relax(i:u32,sourceLayer:u32,destinationLayer:u32){
 let q=coord(i,D());if(grid[i]!=1.){grid[destinationLayer*N()+i]=0.;return;}var sum=0.;var diagonal=0.;
 for(var a=0u;a<3u;a++){for(var sign=-1;sign<=1;sign+=2){var next=q;next[a]+=sign;let phaseNext=phase(next);if(phaseNext==0.){continue;}let w=1./(H()[a]*H()[a]);diagonal+=w;if(phaseNext==1.){sum+=w*grid[sourceLayer*N()+ix(next,D())];}}}
 grid[destinationLayer*N()+i]=(grid[3u*N()+i]+sum)/max(1e-12,diagonal);
}
@compute @workgroup_size(64) fn pressureA(@builtin(global_invocation_id) id:vec3u){if(id.x<N()){relax(id.x,1u,2u);}}
@compute @workgroup_size(64) fn pressureB(@builtin(global_invocation_id) id:vec3u){if(id.x<N()){relax(id.x,2u,1u);}}
@compute @workgroup_size(64) fn project(@builtin(global_invocation_id) id:vec3u){
 let j=id.x;if(j>=u32(cfg[7].x)){return;}let f=face(j);let a=u32(f.w);var lo=f.xyz;lo[a]--;if(openFace(f.xyz,a)){field[j*4u]-=(grid[N()+ix(f.xyz,D())]-grid[N()+ix(lo,D())])/H()[a];}
}
`;
