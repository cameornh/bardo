import {MG_WGSL} from './multigrid.js';
// One bounded grid solve; no host readbacks between deposition, projection and
// the existing particle kernels. Pressure is FP32 multigrid-PCG, CPU multigrid
// remains the independently checked fallback. Grid limits are enforced on host.
export const CONNECTED_WGSL=`
@group(0) @binding(0) var<uniform> c:array<vec4f,8>;
@group(0) @binding(1) var<storage,read_write> input:array<f32>;
@group(0) @binding(2) var<storage,read_write> field:array<f32>;
@group(0) @binding(3) var<storage,read> faceData:array<f32>;
@group(0) @binding(4) var<storage,read> bins:array<u32>;
@group(0) @binding(5) var<storage,read> topo:array<f32>;
@group(0) @binding(6) var<storage,read_write> tmp:array<f32>;
fn N()->u32{return u32(c[0].y);} fn F()->u32{return u32(c[0].z);}
fn dims(a:u32)->vec3i{var d=vec3i(c[1].xyz);d[a]++;return d;}
fn index(p:vec3i,d:vec3i)->u32{return u32(p.x+d.x*(p.y+d.y*p.z));}
fn offset(a:u32)->u32{return u32(c[4][a]);}
fn phase(i:i32)->f32{if(i<0){return 2.;}return topo[u32(i)*4u+3u];}
fn samplePrior(p:vec3f,a:u32)->f32{
 var off=vec3f(.5);off[a]=0.;let q=(p-c[2].xyz)/c[3].xyz-off;let b=vec3i(floor(q));let f=fract(q);let d=dims(a);var s=0.;var w=0.;
 for(var k=0u;k<8u;k++){let dc=vec3i(i32(k&1u),i32((k>>1u)&1u),i32(k>>2u));let at=b+dc;if(any(at<vec3i(0))||any(at>=d)){continue;}let v=mix(vec3f(1)-f,f,vec3f(dc));let ww=v.x*v.y*v.z;s+=ww*faceData[(offset(a)+index(at,d))*16u+12u];w+=ww;}
 return s/max(w,1e-12);
}
@compute @workgroup_size(64) fn stencils(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(c[0].x)){return;}let o=i*68u;for(var k=0u;k<16u;k++){input[o+k]=faceData[F()*16u+i*17u+k];}input[o+64u]=faceData[F()*16u+i*17u+16u];let p=vec3f(input[o],input[o+1u],input[o+2u])*c[2].w;
 for(var a=0u;a<3u;a++){var off=vec3f(.5);off[a]=0.;let q=(p-c[2].xyz)/c[3].xyz-off;let b=vec3i(floor(q));let f=fract(q);let d=dims(a);
 for(var k=0u;k<8u;k++){let at=o+16u+a*8u+k;input[at]=-1.;input[at+24u]=0.;let dc=vec3i(i32(k&1u),i32((k>>1u)&1u),i32(k>>2u));let cell=b+dc;if(any(cell<vec3i(0))||any(cell>=d)){continue;}let w=mix(vec3f(1)-f,f,vec3f(dc));input[at]=f32(offset(a)+index(cell,d));input[at+24u]=w.x*w.y*w.z;}}
}
@compute @workgroup_size(64) fn deposit(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=F()){return;}let m=j*16u;let a=u32(faceData[m+2u]);var off=vec3f(.5);off[a]=0.;let q=vec3f(faceData[m+4u],faceData[m+5u],faceData[m+6u])+off;let base=vec3i(floor(q));let d=vec3i(c[1].xyz);var sum=0.;var weight=0.;
 // Exact trilinear support: at most 27 grid bins, without float atomics,
 // contention, fixed-point overflow or nondeterministic scatter summation.
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let cell=base+vec3i(x,y,z);if(any(cell<vec3i(0))||any(cell>=d)){continue;}let at=index(cell,d);if(phase(i32(at))!=1.){continue;}
 for(var k=bins[at];k<bins[at+1u];k++){let i=bins[N()+1u+k];let o=i*68u;let p=(vec3f(input[o],input[o+1u],input[o+2u])*c[2].w-c[2].xyz)/c[3].xyz;let v=max(vec3f(0),vec3f(1)-abs(p-q));let w=v.x*v.y*v.z;weight+=w;sum+=w*(input[o+4u+a]-input[o+a])*c[2].w/c[0].w;}
 }}}
 field[j*4u]=select(0.,sum/max(weight,1e-12),weight>1e-9);field[j*4u+3u]=select(0.,1.,weight>1e-9);
}
@compute @workgroup_size(64) fn extend(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=F()){return;}let m=j*16u;var value=field[j*4u];var valid=field[j*4u+3u];
 if(valid==0.&&faceData[m+9u]>.5){let d=dims(u32(faceData[m+2u]));let q=vec3i(vec3f(faceData[m+4u],faceData[m+5u],faceData[m+6u]));var sum=0.;var count=0.;for(var a=0u;a<3u;a++){for(var sign=-1;sign<=1;sign+=2){var p=q;p[a]+=sign;if(any(p<vec3i(0))||any(p>=d)){continue;}let k=offset(u32(faceData[m+2u]))+index(p,d);if(field[k*4u+3u]>0.){sum+=field[k*4u];count+=1.;}}}if(count>0.){value=sum/count;valid=1.;}}
 tmp[j*4u]=value;tmp[j*4u+1u]=valid;
}
@compute @workgroup_size(64) fn extended(@builtin(global_invocation_id) gid:vec3u){let j=gid.x;if(j>=F()){return;}field[j*4u]=tmp[j*4u];field[j*4u+3u]=tmp[j*4u+1u];}
@compute @workgroup_size(64) fn advect(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=F()){return;}let m=j*16u;let a=u32(faceData[m+2u]);let limit=c[1].w*.42/c[0].w;field[j*4u+1u]=field[j*4u];var velocity=field[j*4u];
 if(faceData[m+7u]==0.){velocity=faceData[m+11u];}else if(faceData[m+9u]<.5){var off=vec3f(.5);off[a]=0.;let p=c[2].xyz+(vec3f(faceData[m+4u],faceData[m+5u],faceData[m+6u])+off)*c[3].xyz;let v=vec3f(samplePrior(p,0u),samplePrior(p,1u),samplePrior(p,2u));let q=p-clamp(v*c[0].w,vec3f(-c[1].w*.45),vec3f(c[1].w*.45));let cell=vec3i(floor((q-c[2].xyz)/c[3].xyz));var prior=faceData[m+12u];if(all(cell>=vec3i(0))&&all(cell<vec3i(c[1].xyz))){if(phase(i32(index(cell,vec3i(c[1].xyz))))==2.){prior=samplePrior(q,a);}}velocity=clamp(mix(prior,faceData[m+10u],c[3].w),-limit,limit);field[j*4u+1u]=velocity;}
 tmp[j*4u+2u]=velocity;
}
@compute @workgroup_size(64) fn viscosity(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=F()){return;}let m=j*16u;let v=tmp[j*4u+2u];var delta=0.;if(faceData[m+7u]!=0.){let a=u32(faceData[m+2u]);let d=dims(a);let q=vec3i(vec3f(faceData[m+4u],faceData[m+5u],faceData[m+6u]));for(var axis=0u;axis<3u;axis++){for(var sign=-1;sign<=1;sign+=2){var p=q;p[axis]+=sign;if(any(p<vec3i(0))||any(p>=d)){continue;}let k=offset(a)+index(p,d);if(faceData[k*16u+7u]!=0.&&faceData[k*16u+8u]==faceData[m+8u]){delta+=c[0].w*faceData[m+13u]/(c[3][axis]*c[3][axis])*(tmp[k*4u+2u]-v);}}}}
 field[j*4u]=v+delta;
}
fn at(i:u32,k:u32)->u32{return F()*4u+k*N()+i;}
@compute @workgroup_size(64) fn rhs(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=N()){return;}let d=vec3i(c[1].xyz);let q=vec3i(i32(i)%d.x,(i32(i)/d.x)%d.y,i32(i)/(d.x*d.y));var div=0.;if(phase(i32(i))>0.){for(var a=0u;a<3u;a++){let fd=dims(a);var hi=q;hi[a]++;div+=(field[(offset(a)+index(hi,fd))*4u]-field[(offset(a)+index(q,fd))*4u])/c[3][a];}}
 tmp[at(i,7u)]=-div*c[1].w*c[1].w;
}
@compute @workgroup_size(64) fn compatible(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=N()){return;}let off=u32(c[5].y)+i*2u;let start=u32(topo[off]);let count=u32(topo[off+1u]);var sum=0.;for(var k=0u;k<count;k++){sum+=tmp[at(u32(topo[u32(c[5].y)+start+k]),7u)];}tmp[at(i,5u)]=tmp[at(i,7u)]-sum/max(1.,f32(count));if(c[5].z>.5){tmp[at(i,0u)]=0.;}
}
var<workgroup> sums:array<f32,256>;
var<workgroup> alpha:f32;var<workgroup> beta:f32;var<workgroup> rz:f32;var<workgroup> base:f32;var<workgroup> iteration:f32;
fn reduce(lid:u32,value:f32)->f32{sums[lid]=value;workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(lid<stride){sums[lid]+=sums[lid+stride];}workgroupBarrier();}let total=sums[0];workgroupBarrier();return total;}
fn product(i:u32,slot:u32)->f32{var v=topo[i*4u]*tmp[at(i,slot)];for(var k=u32(topo[i*4u+1u]);k<u32(topo[i*4u+2u]);k++){let o=u32(c[5].x)+k*2u;v-=topo[o+1u]*tmp[at(u32(topo[o]),slot)];}return v;}
${MG_WGSL}
@compute @workgroup_size(256) fn pressure(@builtin(local_invocation_index) lid:u32){
 var rr=0.;for(var i=lid;i<N();i+=256u){let b=tmp[at(i,5u)];tmp[at(i,1u)]=b-product(i,0u);rr+=b*b;}
 let bnorm=reduce(lid,rr);if(lid==0u){base=bnorm;iteration=0.;}workgroupBarrier();storageBarrier();precondition(lid);
 var zz=0.;for(var i=lid;i<N();i+=256u){let z=tmp[at(i,4u)];tmp[at(i,2u)]=z;zz+=tmp[at(i,1u)]*z;}
 let initial=reduce(lid,zz);if(lid==0u){rz=initial;}workgroupBarrier();storageBarrier();
 // Uniform convergence exit and strict 32-cycle work bound. The CPU checks
 // true residual before accepting any pressure or particle output.
 for(var iter=0u;iter<32u;iter++){
  if(workgroupUniformLoad(&rz)<=0.){break;}
  var pap=0.;for(var i=lid;i<N();i+=256u){let a=product(i,2u);tmp[at(i,3u)]=a;pap+=a*tmp[at(i,2u)];}
  let denom=reduce(lid,pap);if(lid==0u){alpha=select(0.,rz/max(denom,1e-30),denom>1e-30);}workgroupBarrier();storageBarrier();
  rr=0.;for(var i=lid;i<N();i+=256u){tmp[at(i,0u)]+=alpha*tmp[at(i,2u)];let r=tmp[at(i,1u)]-alpha*tmp[at(i,3u)];tmp[at(i,1u)]=r;rr+=r*r;}
  let rnorm=reduce(lid,rr);if(lid==0u){iteration=f32(iter+1u);beta=select(0.,1.,rnorm>max(1e-20,base*4e-10));}workgroupBarrier();storageBarrier();
  if(workgroupUniformLoad(&beta)==0.){break;}
  precondition(lid);zz=0.;for(var i=lid;i<N();i+=256u){zz+=tmp[at(i,1u)]*tmp[at(i,4u)];}
  let next=reduce(lid,zz);if(lid==0u){beta=next/max(rz,1e-30);rz=next;}workgroupBarrier();
  for(var i=lid;i<N();i+=256u){tmp[at(i,2u)]=tmp[at(i,4u)]+beta*tmp[at(i,2u)];}storageBarrier();
 }
 if(lid==0u){tmp[at(0u,8u)]=iteration;}
}
@compute @workgroup_size(64) fn project(@builtin(global_invocation_id) gid:vec3u){
 let j=gid.x;if(j>=F()){return;}let m=j*16u;let a=i32(faceData[m]);let b=i32(faceData[m+1u]);var lo=0.;var hi=0.;if(a>=0){lo=tmp[at(u32(a),0u)];}if(b>=0){hi=tmp[at(u32(b),0u)];}field[j*4u]-=faceData[m+7u]*(hi-lo)*c[3][u32(faceData[m+2u])]/(c[1].w*c[1].w);
}
`;
