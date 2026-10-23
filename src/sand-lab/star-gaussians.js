import * as THREE from 'three';
import catalogue from './bright-stars.json' with {type:'json'};
import {starIrradiance,starColor} from './night-sky-model.js';
export const STAR_SIGMA=.00016;
export const STAR_TWINKLE_GAIN=3;
export function starDirection(ra,dec){const a=ra*Math.PI/180,d=dec*Math.PI/180;return [Math.sin(a-Math.PI)*Math.cos(d),Math.sin(d),Math.cos(a-Math.PI)*Math.cos(d)];}
// CPU reference of J C J^T, C = sigma² (I - direction direction^T).
// J*direction=0, so projection reduces to sigma² J J^T. No polar UVs.
export function projectStar(d,fx,fy,sigma=STAR_SIGMA){const z=-d[2],s=sigma*sigma,z2=z*z;const xx=s*fx*fx/z2*(1+d[0]*d[0]/z2)+.25,yy=s*fy*fy/z2*(1+d[1]*d[1]/z2)+.25,xy=s*fx*fy*d[0]*d[1]/(z2*z2);return {xx,yy,xy,det:xx*yy-xy*xy,solidAngle:z*z*z/(fx*fy)};}
// Faint, compact points show the most seeing; broader projected footprints
// average it out. Weight the unmodified covariance so breathing cannot feed back.
export function starTwinkleStrength(magnitude,cov){const t=Math.max(0,Math.min(1,(magnitude-1.5)/4)),compact=cov?Math.min(1,.65/Math.sqrt((cov.xx+cov.yy)*.5)):1;return STAR_TWINKLE_GAIN*t*t*(3-2*t)*compact;}
export function scintillation(magnitude,elevation,time,seed,cov){const amplitude=(.008+.012*(1-Math.max(0,elevation))**2)*starTwinkleStrength(magnitude,cov);return 1+amplitude*(.65*Math.sin(time*5.1+seed)+.35*Math.sin(time*8.7+seed*2.7));}
// Atmospheric seeing changes a centered Gaussian's footprint, not its sky
// direction. T C T^T stays positive definite; flux is normalized after shaping.
export function starSeeingCovariance(cov,magnitude,elevation,time,seed){
 const amount=starTwinkleStrength(magnitude,cov)*(.055+.045*(1-Math.max(0,elevation))**2);
 const breathe=amount*.5*Math.sin(time*1.7+seed*1.3),stretch=amount*.65*Math.sin(time*3.7+seed),shear=amount*.5*Math.sin(time*2.9+seed*1.7),a=1+breathe+stretch,b=1+breathe-stretch;
 const xx=a*a*cov.xx+2*a*shear*cov.xy+shear*shear*cov.yy,xy=a*shear*cov.xx+(a*b+shear*shear)*cov.xy+b*shear*cov.yy,yy=shear*shear*cov.xx+2*b*shear*cov.xy+b*b*cov.yy;
 return {...cov,xx,xy,yy,det:xx*yy-xy*xy};
}
export const STAR_COVARIANCE_GLSL=`vec3 starCovariance(vec3 d,vec2 focal){float z=-d.z,s=${STAR_SIGMA**2};return vec3(s*focal.x*focal.x/(z*z)*(1.+d.x*d.x/(z*z))+.25,s*focal.x*focal.y*d.x*d.y/pow(z,4.),s*focal.y*focal.y/(z*z)*(1.+d.y*d.y/(z*z))+.25);}`;
export const STAR_SEEING_GLSL=`float starTwinkleStrength(float magnitude,vec3 cov){return ${STAR_TWINKLE_GAIN.toFixed(1)}*smoothstep(1.5,5.5,magnitude)*min(1.,.65/sqrt((cov.x+cov.z)*.5));}
vec3 starSeeingCovariance(vec3 cov,float magnitude,float elevation,float time,float seed){
 float amount=starTwinkleStrength(magnitude,cov)*(.055+.045*pow(1.-max(0.,elevation),2.));
 float breathe=amount*.5*sin(time*1.7+seed*1.3),stretch=amount*.65*sin(time*3.7+seed),shear=amount*.5*sin(time*2.9+seed*1.7),a=1.+breathe+stretch,b=1.+breathe-stretch;
 return vec3(a*a*cov.x+2.*a*shear*cov.y+shear*shear*cov.z,a*shear*cov.x+(a*b+shear*shear)*cov.y+b*shear*cov.z,shear*shear*cov.x+2.*b*shear*cov.y+b*b*cov.z);
}`;
export const STAR_VERTEX=`precision highp float;in vec3 aDirection,aColor;in vec2 aPhotometry;
uniform mat3 uCelestialRotation;uniform mat4 uViewMatrix,uProjection;uniform vec2 uResolution;uniform float uStarTime;
out vec2 vQ;out vec3 vRadiance;out vec3 vWorld;out float vMagnitude;
${STAR_COVARIANCE_GLSL}${STAR_SEEING_GLSL}
void main(){vec3 world=transpose(uCelestialRotation)*aDirection,d=mat3(uViewMatrix)*world;vWorld=world;vMagnitude=aPhotometry.y;
 if(d.z>=-.02||world.y<-.01){gl_Position=vec4(2,2,2,1);vQ=vec2(10);vRadiance=vec3(0);return;}
 float seed=dot(aDirection,vec3(173.7,87.2,139.4));
 float z=-d.z,fx=uProjection[0][0]*uResolution.x*.5,fy=uProjection[1][1]*uResolution.y*.5;vec3 baseCov=starCovariance(d,vec2(fx,fy)),cov=starSeeingCovariance(baseCov,aPhotometry.y,world.y,uStarTime,seed);float xx=cov.x,xy=cov.y,yy=cov.z;
 // Cholesky maps the quad's unit covariance to the projected ellipse.
 float a=sqrt(xx),b=xy/a,c=sqrt(max(.000001,yy-b*b));vQ=position.xy*4.;vec2 offset=vec2(a*vQ.x,b*vQ.x+c*vQ.y);
 float amplitude=(.008+.012*pow(1.-max(0.,world.y),2.))*starTwinkleStrength(aPhotometry.y,baseCov);
 float flicker=1.+amplitude*(.65*sin(uStarTime*5.1+seed)+.35*sin(uStarTime*8.7+seed*2.7));
 // Opposite edges change symmetrically about the fixed catalogue position.
 vec4 clip=uProjection*vec4(d,0);clip.xy+=offset*2./uResolution*clip.w;clip.z=clip.w*.9999;gl_Position=clip;
 float solidAngle=z*z*z/(fx*fy);vRadiance=aColor*aPhotometry.x/(6.283185307*a*c*solidAngle)*flicker;
}`;
export const STAR_FRAGMENT=`precision highp float;in vec2 vQ;in vec3 vRadiance,vWorld;in float vMagnitude;out vec4 outColor;
uniform sampler2D uOpaqueRead,uWaterSurface,uAtmosphere,uExposure;uniform vec2 uResolution;uniform vec3 uMoonDirection;uniform float uMoonSize;
void main(){float r2=dot(vQ,vQ);if(r2>16.)discard;vec2 uv=gl_FragCoord.xy/uResolution;
 if(texture(uOpaqueRead,uv).a<9999.||texture(uWaterSurface,uv).a<9999.)discard;
 if(dot(vWorld,uMoonDirection)>cos(.00452*uMoonSize))discard;
 float el=asin(clamp(vWorld.y,0.,1.))/1.570796327;vec3 transmission=textureLod(uAtmosphere,vec2((.5+sqrt(el)*127.)/256.,112.5/128.),0.).rgb*smoothstep(-.003,.001,vWorld.y);
 // Faint points emerge as the eye adapts, and wash out in bright surroundings.
 // This is a perceptual stellar response, not an added night light source.
 vec4 exposure=texelFetch(uExposure,ivec2(0),0);float adapted=smoothstep(2.,6.,log(max(1.,exposure.r))/log(10.));float visibility=mix(1.,adapted,smoothstep(1.,5.,vMagnitude));
 outColor=vec4(vRadiance*transmission*exp(-.5*r2)*visibility*.035,0);
}`;
export class StarGaussians{
 constructor(uniforms){
  const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,-1,1,0,1,1,0],3));g.setIndex([0,1,2,2,1,3]);
  const directions=[],colors=[],photometry=[];for(const [ra,dec,mag,bv] of catalogue){directions.push(...starDirection(ra,dec));colors.push(...starColor(bv));photometry.push(starIrradiance(mag),mag);}
  g.setAttribute('aDirection',new THREE.InstancedBufferAttribute(new Float32Array(directions),3));g.setAttribute('aColor',new THREE.InstancedBufferAttribute(new Float32Array(colors),3));g.setAttribute('aPhotometry',new THREE.InstancedBufferAttribute(new Float32Array(photometry),2));g.instanceCount=catalogue.length;
  this.uniforms={...uniforms,uStarTime:{value:0},uExposure:{value:null}};this.geometry=g;this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:STAR_VERTEX,fragmentShader:STAR_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(g,this.material);mesh.frustumCulled=false;this.scene.add(mesh);this.time=0;
 }
 render(renderer,camera,exposure,dt){this.time+=Math.max(0,dt);this.uniforms.uStarTime.value=this.time;this.uniforms.uExposure.value=exposure.output.uniforms.uExposure.value;renderer.render(this.scene,camera);}
 dispose(){this.geometry.dispose();this.material.dispose();}
}
