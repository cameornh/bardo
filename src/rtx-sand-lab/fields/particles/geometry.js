// Same cubic terrain, ordered sand CSG, oriented cups and capsule as the CPU
// contact oracle. Host validation bounds every variable-size loop beforehand.
export const GEOMETRY_WGSL=`
fn g(i:u32)->f32{return field[u32(cfg[4].x)+i];}
fn cubic(t:f32)->vec4f{return vec4f(pow(1.-t,3.)/6.,(3.*t*t*t-6.*t*t+4.)/6.,(-3.*t*t*t+3.*t*t+3.*t+1.)/6.,t*t*t/6.);}
fn height(p:vec3f)->f32{
 let n=i32(g(0));let q=clamp((p.xz+vec2f(5.5,4.9))/vec2f(g(1),g(2)),vec2f(0),vec2f(f32(n-1)));
 let c=vec2i(floor(q));let a=cubic(fract(q.x));let b=cubic(fract(q.y));var h=0.;
 for(var z=0;z<4;z++){for(var x=0;x<4;x++){h+=g(u32(g(9))+u32(clamp(c.x+x-1,0,n-1)+n*clamp(c.y+z-1,0,n-1)))*a[x]*b[z];}}
 return h;
}
fn solid(p:vec3f)->f32{
 var d=(p.y-height(p))*.65;
 if(g(19)>0.&&all(p>=vec3f(g(12),g(13),g(14)))&&all(p<=vec3f(g(15),g(16),g(17)))){
  let c=vec2u(clamp(floor((p.xz+vec2f(5.5,4.9))/vec2f(11,9.8)*32.),vec2f(0),vec2f(31)));
  let bins=u32(g(20));let cell=bins+(c.x+c.y*32u)*4u;let start=u32(g(cell));let count=min(32u,u32(g(cell+1u)));
  for(var j=0u;j<count;j++){
   let o=u32(g(19))+u32(g(bins+4096u+start+j))*8u;let v=p-vec3f(g(o),g(o+1u),g(o+2u));let aspect=g(o+4u);
   var q=(length(vec3f(v.x,v.y/aspect,v.z))-g(o+3u))*min(1.,aspect);
   for(var k=0u;k<min(16u,u32(g(o+7u)));k++){let c=u32(g(o+6u))+k*5u;let a=g(c+4u);let t=v-vec3f(g(c),g(c+1u),g(c+2u));let r=g(c+3u);let cut=(length(vec3f(t.x,t.y/a,t.z))-abs(r))*min(1.,a);q=max(q,select(cut,-cut,r>0.));}
   let blend=g(o+5u);let h=max(blend-abs(d-q),0.)/max(blend,.00001);d=min(d,q)-h*h*blend*.25;
  }
 }
 for(var i=0u;i<min(32u,u32(g(3)));i++){
  let o=u32(g(10))+i*16u;let v=p-vec3f(g(o),g(o+1u),g(o+2u));let r=g(o+3u);// Cup distance is a max/min field, not a Euclidean distance. A sphere
  // bound cannot safely prune it (especially near the tilted rim).
  if(g(o+4u)<.5){let bound=d+r;if(bound<=0.||dot(v,v)>=bound*bound){continue;}}
  var q=length(v)-r;
  if(g(o+4u)>.5){let a=dot(v,vec3f(g(o+5u),g(o+6u),g(o+7u)));let b=dot(v,vec3f(g(o+8u),g(o+9u),g(o+10u)));let c=dot(v,vec3f(g(o+11u),g(o+12u),g(o+13u)));let rad=length(vec2f(a,c));let wall=r*.16;q=min(max(abs(rad-r*.84)-wall,abs(b)-r),max(rad-r,abs(b+r)-wall));}d=min(d,q);
 }
 if(g(7)>0.){let v=p-vec3f(g(4),g(5),g(6));d=min(d,length(vec3f(v.x,v.y-clamp(v.y,0.,g(8)),v.z))-g(7));}
 return min(d,min(5.5-abs(p.x),min(4.9-abs(p.z),9.-p.y)));
}
fn metric(p:vec3f,reach:f32)->vec4f{
 let d=solid(p);if(d>=reach){return vec4f(0,0,0,d);}
 let e=.003;let grad=vec3f(solid(p+vec3f(e,0,0))-solid(p-vec3f(e,0,0)),solid(p+vec3f(0,e,0))-solid(p-vec3f(0,e,0)),solid(p+vec3f(0,0,e))-solid(p-vec3f(0,0,e)))/(2.*e);
 let m=max(.05,length(grad));return vec4f(grad/m,d/m);
}
fn contact(point:vec3f)->vec3f{var p=point;let skin=cfg[0].y*.12;for(var j=0;j<3;j++){let m=metric(p,skin);if(m.w>=skin){break;}p+=m.xyz*(skin-m.w);}return p;}
`;
