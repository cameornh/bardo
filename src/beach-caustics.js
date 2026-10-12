import * as THREE from 'three';
import { waterTransmittance } from './water-material.js';
import { QUAD_VERTEX } from './shaders.js';
import { BEACH_RENDER_WORLD } from './beach-shaders.js';
// Forward light transport. Irradiance patterns are produced by refraction of
// photon bundles through the current water normals and hollow glass shells.
const photon=`precision highp float;precision highp int;in vec2 vUv;layout(location=0)out vec4 hit;layout(location=1)out vec4 flux;
${BEACH_RENDER_WORLD}
float intersectLayer(vec3 o,vec3 d,int layer){float t=.012;for(int k=0;k<24;k++){vec3 p=o+d*t;float h=surfaceHeight(p.xz,layer),f=p.y-h;if(f<.007)return t;t+=max(.015,f/max(.2,-d.y)*.75);if(t>100.)break;}return 1e5;}
void main(){vec3 light=uSun.y>.02?uSun:uMoon,power=uSun.y>.02?uSunColor:uMoonColor;vec2 xz=uPhotonOrigin+vUv*uPhotonSize;vec3 o=vec3(xz.x,10.,xz.y)+vec3(light.x,0,light.z)*10./max(.1,light.y),d=-light,energy=power*max(0.,light.y);float medium=1.;hit=vec4(0);flux=vec4(0);if(light.y<=.02)return;
 for(int event=0;event<9;event++){float land=intersectLayer(o,d,0),water=medium==1.?intersectLayer(o,d,1):1e5,nearest=min(land,water);int id=-1;bool inner=false;
  for(int i=0;i<uBallCount;i++){vec4 b=body(i);for(int shell=0;shell<2;shell++){float r=b.w-(shell==1?.012:0.);vec2 t=sphere(o,d,b.xyz,r);float q=t.x>.006?t.x:t.y;if(q>.006&&q<nearest){nearest=q;id=i;inner=shell==1;}}}
  if(nearest>9999.)return;vec3 p=o+d*nearest;if(medium==WATER_IOR)energy*=waterTransmission(nearest,uTurbidity);
  if(id<0&&land<=water+.008){if(event==0)return;hit=vec4(p,1);flux=vec4(energy,1);return;}
  vec3 normal;float nextIOR;
  if(id>=0){vec4 b=body(id);normal=normalize(p-b.xyz);bool entering=dot(d,normal)<0.;if(inner)normal=-normal;nextIOR=inner?(entering?1.:1.5):(entering?1.5:(p.y<surfaceHeight(p.xz,1)?WATER_IOR:1.));}
  else{if(waterState(p.xz).x<.005)return;normal=surfaceNormal(p.xz,1,.16);nextIOR=WATER_IOR;}
  if(dot(normal,d)>0.)normal=-normal;float cosine=max(0.,-dot(normal,d)),f0=pow((medium-nextIOR)/(medium+nextIOR),2.),F=f0+(1.-f0)*pow(1.-cosine,5.);vec3 refracted=refract(d,normal,medium/nextIOR);if(dot(refracted,refracted)<.01){d=reflect(d,normal);}else{energy*=1.-F;d=refracted;medium=nextIOR;}o=p+d*.009;
 }
}`;
const gatherVertex=`precision highp float;precision highp int;uniform sampler2D uPhotonHits,uPhotonFlux;uniform vec2 uOrigin;uniform float uN,uDx,uPhotonSize;out vec2 vKernel;out vec3 vEnergy;void main(){ivec2 id=ivec2(gl_InstanceID%128,gl_InstanceID/128);vec4 hit=texelFetch(uPhotonHits,id,0);vEnergy=texelFetch(uPhotonFlux,id,0).rgb;float sigma=uPhotonSize/128.*.7;vec2 p=hit.xz+position.xy*3.*sigma,uv=(p-uOrigin)/(uN*uDx);gl_Position=vec4(uv*2.-1.,0,1);if(hit.w<.5)gl_Position=vec4(2,2,0,1);vKernel=position.xy*3.;vEnergy*=pow(uPhotonSize/128.,2.)/(6.283185*sigma*sigma);}`;
const gatherFragment=`precision highp float;precision highp int;in vec2 vKernel;in vec3 vEnergy;out vec4 outColor;void main(){outColor=vec4(vEnergy*exp(-.5*dot(vKernel,vKernel)),0);}`;
export class BeachCaustics{
 constructor(renderer,uniforms){this.renderer=renderer;this.u={...uniforms};this.photons=new THREE.WebGLRenderTarget(128,128,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});this.target=new THREE.WebGLRenderTarget(384,384,{type:THREE.HalfFloatType,depthBuffer:false});this.u.uPhotonHits={value:this.photons.textures[0]};this.u.uPhotonFlux={value:this.photons.textures[1]};this.camera=new THREE.Camera();this.trace=new THREE.Scene();this.trace.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:photon,uniforms:this.u,depthTest:false,depthWrite:false})));const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);g.instanceCount=128*128;this.gather=new THREE.Scene();const mesh=new THREE.Mesh(g,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:gatherVertex,fragmentShader:gatherFragment,uniforms:this.u,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor}));mesh.frustumCulled=false;this.gather.add(mesh);this.last=-1;this.enabled=true;}
 render(time,camera,revision=0){const p=camera.position,forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),key=[Math.round(p.x),Math.round(p.z),Math.round(forward.x*10),Math.round(forward.z*10),...this.u.uSun.value.toArray().map(v=>v.toFixed(3)),...this.u.uOrigin.value.toArray(),revision].join(':');if(!this.enabled||key===this.lastKey&&time-this.last<.12&&this.last>=0)return;this.last=time;this.lastKey=key;this.u.uPhotonOrigin.value.set(p.x+forward.x*12-18,p.z+forward.z*12-18);const r=this.renderer,old=r.getRenderTarget();r.setRenderTarget(this.photons);r.render(this.trace,this.camera);r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.render(this.gather,this.camera);r.setRenderTarget(old);}
 dispose(){for(const scene of [this.trace,this.gather])for(const mesh of scene.children){mesh.geometry.dispose();mesh.material.dispose();}this.photons.dispose();this.target.dispose();}
 static async verifyFlat(renderer){
  const tex=new THREE.DataTexture(new Float32Array([8,0,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);tex.needsUpdate=true;const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
  const light=new THREE.Vector3(.3,1,.2).normalize(),energy=new THREE.Vector3(1,.9,.8),uniforms={uSun:{value:light},uMoon:{value:light},uSunColor:{value:energy},uMoonColor:{value:energy},uOrigin:{value:new THREE.Vector2(0,0)},uN:{value:128},uDx:{value:.65},uOcean:{value:tex},uSurfaceCache:{value:zero},uBodies:{value:zero},uBallCount:{value:0},uPhotonOrigin:{value:new THREE.Vector2()},uPhotonSize:{value:36},uTurbidity:{value:.012}};
  const test=new BeachCaustics(renderer,uniforms),camera=new THREE.PerspectiveCamera();camera.position.set(-200,10,-200);test.render(0,camera);
  try{const [hits,flux]=await Promise.all([0,1].map(k=>renderer.readRenderTargetPixelsAsync(test.photons,0,0,128,128,new Float32Array(128*128*4),undefined,k))),direction=[-light.x/1.333,-Math.sqrt(1-(light.x**2+light.z**2)/1.333**2),-light.z/1.333],path=8/-direction[1],F=((1-1.333)/(1+1.333))**2+(1-((1-1.333)/(1+1.333))**2)*(1-light.y)**5,trans=waterTransmittance(path,.012),power=energy.toArray().map((e,i)=>e*light.y*(1-F)*trans[i]);let positionError=0,fluxError=0,count=0;
   for(let i=0;i<128*128;i++){if(hits[i*4+3]>.5)count++;const expected=[uniforms.uPhotonOrigin.value.x+(i%128+.5)/128*36+direction[0]*path,-8,uniforms.uPhotonOrigin.value.y+(Math.floor(i/128)+.5)/128*36+direction[2]*path];for(let j=0;j<3;j++){positionError=Math.max(positionError,Math.abs(hits[i*4+j]-expected[j]));fluxError=Math.max(fluxError,Math.abs(flux[i*4+j]-power[j]));}}
   return {count,positionError,fluxError,pass:count===128*128&&positionError<.02&&fluxError<.005};
  }finally{test.dispose();tex.dispose();zero.dispose();}
 }

}
