import {wetlandGLSL,waterSurfaceHeight} from './wetland.js';
import {reflectedSurfaceClip} from './wave-surface.js';
import * as THREE from 'three';
import {SAND_CAP,SAND_SIDE,SAND_METRES} from './wind-sand.js';

export class SandDriftView{
 constructor(scene,uniforms,lighting,finite=false,eyeScene=null,capacity=SAND_CAP){
  this.finite=finite;
  this.capacity=capacity;
  const geometry=new THREE.InstancedBufferGeometry();
  this.centers=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4);
  this.velocities=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3);
  this.seeds=new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2);
  geometry.setAttribute('flight',this.velocities);geometry.setAttribute('grain',this.centers);geometry.setAttribute('grainSeed',this.seeds);
  const positions=[],offsets=[];
  for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)for(const q of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]){
   if(finite&&(x||z))continue;positions.push(...q,0);offsets.push(x,z);
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('tileOffset',new THREE.Float32BufferAttribute(offsets,2));
  const matUniforms={
   ...uniforms,
   sunDirection:uniforms.sunDirection??{value:new THREE.Vector3(-.6,1,.5).normalize()},
   sunColor:uniforms.sunColor??{value:new THREE.Color(1.1,1.02,.88)},
   hazeColor:uniforms.hazeColor??{value:new THREE.Color(.38,.45,.48)},
   color:{value:new THREE.Color()},
   coverage:{value:1}
  };
  const hasLightingSun=lighting.includes('sunDirection');
  const material=new THREE.ShaderMaterial({uniforms:matUniforms,
   transparent:true,depthWrite:false,
   vertexShader:reflectedSurfaceClip+`attribute vec4 grain;attribute vec3 flight;attribute vec2 tileOffset,grainSeed;uniform vec2 viewport;varying vec2 g;varying vec3 vWorldPos;varying float fade,tint,vDust,vSeed,vAlpha;
   const float tile=${SAND_METRES.toFixed(1)};
   void main(){
    float isDust=grain.w<0.?1.:0.;
    float rad=max(.001,abs(grain.w));
    vec3 p=grain.xyz;${finite?'':'p.xz+=tile*(floor((cameraPosition.xz-p.xz)/tile+.5)+tileOffset);'}
    vec3 v=(viewMatrix*vec4(p,1.)).xyz;float z=max(.03,-v.z);
    vec4 clip=projectionMatrix*vec4(v,1.);g=position.xy*2.5;
    // Project an isotropic 3D covariance through the perspective Jacobian.
    vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*viewport*.5*rad/z;
    vec2 d=f*v.xy/z;
    vec3 velocity=mat3(viewMatrix)*flight;
    vec2 streak=f/rad*(velocity.xy+v.xy/z*velocity.z)*.011;
    mat2 cov=mat2(f.x*f.x+d.x*d.x+.12,d.x*d.y,d.x*d.y,f.y*f.y+d.y*d.y+.12)+outerProduct(streak,streak);
    tint=smoothstep(.005,.018,rad);
    vDust=isDust;
    vWorldPos=p;
    vSeed=grainSeed.x;
    vAlpha=grainSeed.y;
    float a=sqrt(cov[0][0]),b=cov[0][1]/a;
    vec2 offset=vec2(a*g.x,b*g.x+sqrt(max(.01,cov[1][1]-b*b))*g.y);
    float eye=1.-smoothstep(.045,.14,length(v));
    // Limit the support of a grain crossing the near plane, including its motion blur.
    offset*=min(1.,min(viewport.x,viewport.y)*.065/max(1.,2.5*sqrt(cov[0][0]+cov[1][1])));
    clip.xy+=offset*2./viewport*clip.w;
    fade=1.-smoothstep(${capacity>SAND_CAP?'45.,120.':'6.,17.'},length(p.xz-cameraPosition.xz));
    #ifdef EYE_GRAIN
    fade*=eye;clip.z=0.;
    gl_Position=v.z<-.005&&eye>.001?clip:vec4(2.,2.,2.,1.);
    #else
    fade*=1.-eye;
    gl_Position=v.z<-.03&&!belowReflector(p)?clip:vec4(2.,2.,2.,1.);
    #endif
   }`,
   fragmentShader:lighting+`${hasLightingSun?'':'uniform vec3 sunDirection,sunColor;'}uniform vec3 hazeColor;varying vec2 g;varying vec3 vWorldPos;varying float fade,tint,vDust,vSeed,vAlpha;uniform vec3 color;uniform float coverage;
   void main(){
    float r2=dot(g,g);
    vec3 sunD=normalize(sunDirection);
    vec3 viewDir=normalize(cameraPosition-vWorldPos);
    float daySun=smoothstep(-.04,.09,sunD.y);
    float fog=1.-exp(-length(cameraPosition-vWorldPos)*.00028);
    if(vDust>.5||coverage<.98){
     float a=coverage*fade*vAlpha*exp(-.44*r2)*(vDust>.5?.10:.72);
     if(a<.012)discard;
     float fwd=pow(max(1e-4,dot(viewDir,-sunD)),2.2);
     float sunVis=sampleSunShadow(vWorldPos,vec3(0.,1.,0.))*daySun;
     vec3 dustCol=color*(env(vec3(0.,1.,0.),1.)*.90+sunColor*daySun*(.26+fwd*.28)*(.25+.75*sunVis));
     gl_FragColor=vec4(mix(dustCol,hazeColor,fog),a);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
     return;
    }
    vec2 uvG=g/1.45;
    float u2=dot(uvG,uvG);
    if(u2>1.)discard;
    float a=coverage*fade*vAlpha*smoothstep(1.,.28,u2);
    if(a<.02)discard;
    float nz=sqrt(max(0.,1.-u2));
    vec3 nGrain=normalize(vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0])*uvG.x
     +vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1])*uvG.y
     +vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])*nz);
    vec3 nSoft=normalize(mix(vec3(0.,1.,0.),nGrain,.22));
    float sunVis=sampleSunShadow(vWorldPos,nSoft)*daySun;
    vec3 lit=color*(env(nSoft,1.)+sunColor*max(0.,dot(nSoft,sunD))*sunVis);
    gl_FragColor=vec4(mix(lit,hazeColor,fog),a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.visible=false;scene.add(this.mesh);
  if(eyeScene){
   const eyeMaterial=new THREE.ShaderMaterial({vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,uniforms:material.uniforms,transparent:true,depthWrite:false});
   eyeMaterial.defines={EYE_GRAIN:1};eyeMaterial.depthTest=false;
   this.eye=new THREE.Mesh(geometry,eyeMaterial);this.eye.frustumCulled=false;this.eye.visible=false;eyeScene.add(this.eye);
  }
  this.bytes=new Uint8Array(4*SAND_SIDE*SAND_SIDE);
  this.texture=new THREE.DataTexture(this.bytes,SAND_SIDE,SAND_SIDE,THREE.RGBAFormat);
  this.texture.wrapS=this.texture.wrapT=THREE.RepeatWrapping;this.texture.magFilter=this.texture.minFilter=THREE.LinearFilter;this.texture.needsUpdate=true;
 }
 setLandscape(land){
  if(this.landscape===land)return;
  this.landscape=land;
  for(const mesh of [this.mesh,this.eye]){
   if(!mesh)continue;
   const mat=mesh.material;mat.userData.flatVertex??=mat.vertexShader;
   mat.uniforms.survey??={value:new THREE.Vector2()};
   mat.uniforms.seaLevel??={value:0};
   mat.uniforms.lensHeight??={value:.31};
   mat.uniforms.swashPad??={value:.14};
   if(land){
    mat.uniforms.survey.value.set(land.x,land.z);
    mat.uniforms.seaLevel.value=land.climate?.seaLevelOffset??0;
    mat.uniforms.lensHeight.value=land.hydrology?.lensHeight??.31;
   }
   mat.vertexShader=land?wetlandGLSL+'uniform float lensHeight,swashPad;\n'+mat.userData.flatVertex.replace('vec3 v=(viewMatrix',`
    float bed=landHeight(p.xz);
    float dShore=landShoreDist(p.xz);
    float tideF=max(.74+.26*exp(-max(0.,dShore)/24.),smoothstep(225.,270.,dShore));
    float datum=seaLevel*tideF;
    float wt=datum+lensHeight*(1.-exp(-max(0.,dShore)/42.));
    float waterSurf=max(datum+swashPad*exp(-max(0.,dShore)/6.5),wt);
    ${this.finite
     ?'if(p.y<=waterSurf+.01||(bed<waterSurf&&p.y<=waterSurf+.04)){gl_Position=vec4(2.,2.,2.,1.);return;}'
     :'if(bed<waterSurf+.06){gl_Position=vec4(2.,2.,2.,1.);return;}p.y+=bed;if(p.y<=waterSurf+.01){gl_Position=vec4(2.,2.,2.,1.);return;}'}
    vec3 v=(viewMatrix`):mat.userData.flatVertex;
   mat.needsUpdate=true;
  }
 }
 updateEye(camera){
  const state=this.state;
  if(this.eye){
   const wSpd=state?.lastWindSpeed||0;
   this.eye.visible=!!state&&!!camera&&state.grains.some(g=>{
    let dx=g.x-camera.x,dz=g.z-camera.z;
    if(!this.finite){dx-=Math.round(dx/SAND_METRES)*SAND_METRES;dz-=Math.round(dz/SAND_METRES)*SAND_METRES;}
    if(dx*dx+dz*dz>=.14**2)return false;
    const wx=camera.x+dx,wz=camera.z+dz;
    const bed=this.landscape?.height(wx,wz)??0;
    if(this.landscape){
     const waterSurf=waterSurfaceHeight(this.landscape,wx,wz,wSpd);
     if(!this.finite){
      if(bed<waterSurf+.06||bed+g.y<=waterSurf+.01)return false;
     }else if(g.y<=waterSurf+.01)return false;
    }
    const worldY=this.finite?g.y:g.y+bed;
    return dx*dx+dz*dz+(worldY-camera.y)**2<.14**2;
   });
  }
 }
 update(state,mat,camera){
  const changed=this.state!==state;this.state=state;this.updateEye(camera);
  const count=state?Math.min(state.grains.length,this.capacity):0;
  this.mesh.visible=count>0;if(!state)return;
  this.mesh.geometry.instanceCount=count;this.mesh.material.uniforms.color.value.set(mat.color);
  for(let i=0;i<count;i++){const g=state.grains[i];this.centers.setXYZW(i,g.x,g.y,g.z,g.r);this.velocities.setXYZ(i,g.vx,g.vy,g.vz);this.seeds.setXY(i,g.seed??((i*0.6180339887)%1),g.alpha??1);}
  if(count)this.centers.needsUpdate=this.velocities.needsUpdate=this.seeds.needsUpdate=true;
  if(this.landscape){
   const sl=this.landscape.climate?.seaLevelOffset??0;
   const lh=this.landscape.hydrology?.lensHeight??.31;
   const sp=.14+.014*Math.max(0,(state.lastWindSpeed||0)-5);
   for(const m of [this.mesh,this.eye]){
    if(!m)continue;
    if(m.material.uniforms.seaLevel)m.material.uniforms.seaLevel.value=sl;
    if(m.material.uniforms.lensHeight)m.material.uniforms.lensHeight.value=lh;
    if(m.material.uniforms.swashPad)m.material.uniforms.swashPad.value=sp;
   }
  }
  if(!this.finite&&(this.version!==state.version||changed)){
   for(let i=0;i<state.bed.length;i++){
    const h=state.driftHeight(i%SAND_SIDE*SAND_METRES/SAND_SIDE,Math.floor(i/SAND_SIDE)*SAND_METRES/SAND_SIDE);
    const encoded=Math.round(Math.max(0,Math.min(1,.5+h/4))*65535);
    this.bytes[4*i]=encoded>>8;this.bytes[4*i+1]=encoded&255;
   }
   this.texture.needsUpdate=true;this.version=state.version;this.state=state;
  }
 }
 dispose(){this.eye?.removeFromParent();this.eye?.material.dispose();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();}
}
