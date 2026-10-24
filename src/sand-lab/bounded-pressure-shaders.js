// Deliberately no LAB_GEOMETRY_GLSL, object loops, SDF calls, lighting,
// specialization, noise, or nested neighbor loops in either compute pass.
const common=`precision highp float;precision highp int;
uniform sampler2D uPositions,uNeighbors,uWall,uLambda;
uniform int uCount;uniform float uSpacing;
out vec4 result;
vec4 point(int i){return texelFetch(uPositions,ivec2(i%64,i/64),0);}
int neighbor(int i,int a){return int(texelFetch(uNeighbors,ivec2(i%64+(a/32)*64,(i/64)*8+(a%32)/4),0)[a%4]);}
`;
export const PRESSURE_DENSITY_SHADER=common+`
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int i=uv.y*64+uv.x;
 if(i>=uCount){result=vec4(0);return;}
 vec4 p=point(i),wall=texelFetch(uWall,uv,0);
 float h=uSpacing*2.,h2=h*h,volume=uSpacing*uSpacing*uSpacing,
  w=315./(64.*3.141592653589793*h*h2),g=-45./(3.141592653589793*h2*h2*h2),rho=volume*w+wall.w,sum=0.;
 vec3 grad=wall.xyz;
 for(int a=0;a<128;a++){
  int j=neighbor(i,a);if(j<0)break;vec3 d=p.xyz-point(j).xyz;float r2=dot(d,d);
  if(r2>=h2)continue;float r=sqrt(r2),q=1.-r2/h2;rho+=volume*w*q*q*q;
  if(r<.000001)continue;vec3 v=d*(volume*g*(h-r)*(h-r)/r);sum+=dot(v,v);grad+=v;
 }
 result=vec4(p.xyz,-max(0.,rho-1.)/(sum+dot(grad,grad)+.04/h2));
}`;
export const PRESSURE_CORRECTION_SHADER=common+`
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int i=uv.y*64+uv.x;
 if(i>=uCount){result=vec4(0);return;}vec4 p=point(i);
 if(p.w>.5){result=p;return;}
 vec4 own=texelFetch(uLambda,uv,0);float h=uSpacing*2.,h2=h*h,volume=uSpacing*uSpacing*uSpacing,
  w=315./(64.*3.141592653589793*h*h2),g=-45./(3.141592653589793*h2*h2*h2),ref=w*.91*.91*.91;
 vec3 delta=own.w*texelFetch(uWall,uv,0).xyz;
 for(int a=0;a<128;a++){
  int j=neighbor(i,a);if(j<0)break;vec4 other=texelFetch(uLambda,ivec2(j%64,j/64),0);
  vec3 d=p.xyz-other.xyz;float r2=dot(d,d);if(r2<1e-12||r2>=h2)continue;
  float r=sqrt(r2),q=1.-r2/h2,ratio=w*q*q*q/ref,ratio2=ratio*ratio,
   f=(own.w+other.w-.00015*ratio2*ratio2)*volume*g*(h-r)*(h-r)/r;
  delta+=d*f;
 }
 p.xyz+=delta*min(1.,uSpacing*.2/max(length(delta),1e-30));
 result=p;
}`;
