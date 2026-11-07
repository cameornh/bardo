import {GEOMETRY_WGSL} from './geometry.js';
export const PARTICLE_WGSL=`
struct Work {p:vec4f,wall:vec4f,shift:vec4f,lambda:f32,inBand:u32,pad:vec2f};
struct Output {p:vec4f,v:vec4f,chem:vec4f,metric:vec4f,extra:vec4f};
@group(0) @binding(0) var<uniform> cfg:array<vec4f,8>;
@group(0) @binding(1) var<storage,read> input:array<f32>;
@group(0) @binding(2) var<storage,read> field:array<f32>;
@group(0) @binding(3) var<storage,read_write> work:array<Work>;
@group(0) @binding(4) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> buckets:array<u32>;
@group(0) @binding(6) var<storage,read_write> neighbors:array<u32>;
@group(0) @binding(7) var<storage,read_write> output:array<Output>;
fn item(i:u32,o:u32)->vec4f{let a=i*68u+o;return vec4f(input[a],input[a+1u],input[a+2u],input[a+3u]);}
fn hash(c:vec3i)->u32{let u=bitcast<vec3u>(c);return ((u.x*73856093u)^(u.y*19349663u)^(u.z*83492791u))&8191u;}
fn cell(p:vec3f)->vec3i{return vec3i(floor(p/(cfg[0].y*2.3)));}
fn bad()->bool{return atomicLoad(&counts[8192])>0u;}
${GEOMETRY_WGSL}
@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(cfg[0].x)){return;}let old=item(i,0u);let pred=item(i,4u);var p=pred.xyz;
 if(old.w==0.&&input[i*68u+64u]>.5){var displacement=vec3f(0);for(var axis=0u;axis<3u;axis++){
  var delta=0.;var vel=0.;var w=0.;for(var k=0u;k<8u;k++){let at=i*68u+16u+axis*8u+k;let j=i32(input[at]);if(j<0){continue;}let f=u32(j)*4u;if(field[f+2u]<.5){continue;}let weight=input[at+24u];w+=weight;delta+=(field[f]-field[f+1u])*weight;vel+=field[f]*weight;}
  let inv=select(0.,1./max(w,1e-12),w>1e-12);let flip=pred[axis]-old[axis]+delta*inv*cfg[0].w/cfg[0].z;displacement[axis]=mix(flip,vel*inv*cfg[0].w/cfg[0].z,cfg[1].x);
 }p=old.xyz+displacement*min(1.,cfg[0].y*.45/max(1e-12,length(displacement)));}
 work[i].p=vec4f(p,old.w);work[i].shift=vec4f(0);work[i].lambda=0.;
 let b=hash(cell(p));let slot=atomicAdd(&counts[b],1u);if(slot<64u){buckets[b*64u+slot]=i;}else{atomicStore(&counts[8192],1u);}
}
@compute @workgroup_size(64) fn findNeighbors(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(cfg[0].x)||bad()){return;}let p=work[i].p.xyz;let c=cell(p);var count=0u;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=c+vec3i(x,y,z);let b=hash(q);let n=min(64u,atomicLoad(&counts[b]));for(var at=0u;at<n;at++){
   let j=buckets[b*64u+at];if(j==i||any(cell(work[j].p.xyz)!=q)){continue;}let d=p-work[j].p.xyz;
   if(dot(d,d)<pow(cfg[0].y*2.3,2.)){if(count<128u){neighbors[i*129u+count]=j;count++;}else{atomicStore(&counts[8192],2u);}}
  }
 }}}
 neighbors[i*129u+128u]=count;
}
@compute @workgroup_size(64) fn density(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(cfg[0].x)||bad()){return;}let p=work[i].p;work[i].inBand=0u;work[i].wall=vec4f(0);if(p.w>0.){return;}
 let s=cfg[0].y;let h=2.*s;let m=metric(p.xyz,h);let q=clamp(m.w/h,0.,1.);let q2=q*q;
 let rhoWall=.5-315./256.*q*(1.-q2*(4./3.-q2*(6./5.-q2*(4./7.-q2/9.))));
 let gradWall=select(vec3f(0),m.xyz*(-315./(256.*h)*pow(1.-q2,4.)),rhoWall>1e-6);work[i].wall=vec4f(gradWall,rhoWall);
 let gc=vec3i(floor((p.xyz*cfg[0].z-cfg[2].xyz)/cfg[3].xyz));let dims=vec3i(cfg[5].xyz);var inBand=true;
 if(all(gc>=vec3i(0))&&all(gc<dims)){let at=u32(gc.x+dims.x*(gc.y+dims.y*gc.z));inBand=field[u32(cfg[4].y)+at]>.5;}
 if(!inBand&&solid(p.xyz)>=h){return;}work[i].inBand=1u;
 let W=315./(512.*3.14159265359);let G=-45./(64.*3.14159265359*s*s*s);var rho=W+rhoWall;var sum=0.;var grad=gradWall;
 for(var k=0u;k<neighbors[i*129u+128u];k++){let j=neighbors[i*129u+k];let d=p.xyz-work[j].p.xyz;let r2=dot(d,d);if(r2>=h*h){continue;}let q=1.-r2/(h*h);rho+=W*q*q*q;let r=sqrt(r2);if(r<1e-6){continue;}let v=d*(G*(h-r)*(h-r)/r);sum+=dot(v,v);grad+=v;}
 work[i].lambda=-max(0.,rho-1.)/(sum+dot(grad,grad)+.04/(h*h));
}
@compute @workgroup_size(64) fn collide(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(cfg[0].x)||bad()){return;}let p=work[i].p;if(p.w>0.){output[i].p=p;return;}
 let s=cfg[0].y;let h=2.*s;let G=-45./(64.*3.14159265359*s*s*s);var shift=work[i].lambda*work[i].wall.xyz;
 for(var k=0u;k<neighbors[i*129u+128u];k++){let j=neighbors[i*129u+k];let d=p.xyz-work[j].p.xyz;let r2=dot(d,d);if(r2<1e-12||r2>=h*h){continue;}let r=sqrt(r2);shift+=d*((work[i].lambda+work[j].lambda)*G*(h-r)*(h-r)/r);}
 shift*=min(1.,s*.12/max(1e-12,length(shift)));work[i].shift=vec4f(shift,0);output[i].p=vec4f(contact(p.xyz+shift),p.w);
}
fn raw(i:u32)->vec3f{return select((output[i].p.xyz-item(i,0u).xyz-work[i].shift.xyz)/cfg[0].w,vec3f(0),item(i,0u).w>0.);}
@compute @workgroup_size(64) fn transport(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(cfg[0].x)||bad()){return;}let old=item(i,0u);let p=output[i].p;let v=raw(i);let chem=item(i,12u);let s=cfg[0].y;let scale=cfg[0].z;let dt=cfg[0].w;let h=2.*s;
 var weight=0.;var acc=vec3f(0);var normal=vec3f(0);var strain=0.;var count=0.;var dc=vec3f(0);
 for(var k=0u;k<neighbors[i*129u+128u];k++){let j=neighbors[i*129u+k];let d=p.xyz-output[j].p.xyz;let r2=dot(d,d);if(r2>=h*h){continue;}let q=1.-r2/(h*h);let w=315./(512.*3.14159265359)*q*q*q;let r=sqrt(r2);let dv=raw(j)-v;weight+=w;acc+=dv*w;normal+=d*w;strain+=pow(dot(dv,d)/max(r,1e-8),2.)*w;if(r<s*1.9){count+=1.;}dc+=(item(j,12u).xyz-chem.xyz)*(1.-r/h)*min(.006,dt*.12);}
 let incoming=(item(i,4u).xyz-old.xyz)/dt;let impactSpeed=max(sqrt(max(0.,dot(incoming,incoming)-dot(v,v))),length(incoming-v))*scale;
 let len=length(normal);let n=normal/max(len,1e-8);let surface=min(1.,len/s*12.);let deformation=sqrt(strain/max(.2,weight))*scale;let threshold=max(.08,.3*sqrt(9.81*s*scale));
 let breaking=max(0.,deformation-threshold*.9)/(threshold+.35);let impact=max(0.,impactSpeed-threshold*1.2)/(threshold+.35);let energy=surface*min(1.,weight/.18)*min(5.,breaking*.8+impact*.7);
 output[i].v=vec4f(select(v+acc*(.012+cfg[1].y/max(.1,weight))-n*cfg[1].z*dt*surface,vec3f(0),old.w>0.),0);
 let outward=-dot(acc,n)/max(.02,weight)*scale;let capillarySpeed=sqrt(cfg[1].w/(s*scale));let breakup=surface*min(1.,weight/.12)*min(3.,max(0.,outward-max(4.*capillarySpeed,threshold*.5))/max(.15,threshold));
 output[i].chem=vec4f(chem.xyz+dc,min(1.,chem.w*exp(-dt*.65)+energy*dt*.3));output[i].metric=vec4f(n,select(energy,0.,old.w>0.));output[i].extra=vec4f(count,max(deformation,max(0.,outward)),impactSpeed,select(breakup,0.,old.w>0.));
}
`;
