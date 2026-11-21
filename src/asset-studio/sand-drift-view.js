import {reflectedSurfaceClip} from './wave-surface.js';
import * as THREE from 'three';
import {SAND_CAP,SAND_SIDE,SAND_METRES} from './wind-sand.js';

export class SandDriftView{
 constructor(scene,uniforms,lighting,finite=false,eyeScene=null,capacity=SAND_CAP){
  this.finite=finite;
  const geometry=new THREE.InstancedBufferGeometry();
  this.centers=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4);
  this.velocities=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3);
  geometry.setAttribute('flight',this.velocities);geometry.setAttribute('grain',this.centers);
  const positions=[],offsets=[];
  for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)for(const q of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]){
   if(finite&&(x||z))continue;positions.push(...q,0);offsets.push(x,z);
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('tileOffset',new THREE.Float32BufferAttribute(offsets,2));
  const material=new THREE.ShaderMaterial({uniforms:{...uniforms,color:{value:new THREE.Color()},coverage:{value:1}},
   transparent:true,depthWrite:false,
   vertexShader:reflectedSurfaceClip+`attribute vec4 grain;attribute vec3 flight;attribute vec2 tileOffset;uniform vec2 viewport;varying vec2 g;varying float fade,tint;
   const float tile=${SAND_METRES.toFixed(1)};
   void main(){
    vec3 p=grain.xyz;${finite?'':'p.xz+=tile*(floor((cameraPosition.xz-p.xz)/tile+.5)+tileOffset);'}
    vec3 v=(viewMatrix*vec4(p,1.)).xyz;float z=max(.03,-v.z);
    vec4 clip=projectionMatrix*vec4(v,1.);g=position.xy*2.5;
    // Project an isotropic 3D covariance through the perspective Jacobian.
    vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*viewport*.5*grain.w/z;
    vec2 d=f*v.xy/z;
    vec3 velocity=mat3(viewMatrix)*flight;
    vec2 streak=f/grain.w*(velocity.xy+v.xy/z*velocity.z)*.008;
    mat2 cov=mat2(f.x*f.x+d.x*d.x+.12,d.x*d.y,d.x*d.y,f.y*f.y+d.y*d.y+.12)+outerProduct(streak,streak);
    tint=smoothstep(.009,.02,grain.w);
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
   fragmentShader:lighting+`varying vec2 g;varying float fade,tint;uniform vec3 color;uniform float coverage;
   void main(){float a=coverage*fade*exp(-.5*dot(g,g))*.72;if(a<.015)discard;
    gl_FragColor=vec4(color*(env(vec3(0.,1.,0.),1.)+.68)*mix(.52,1.32,tint),a);
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
 updateEye(camera){
  const state=this.state;
  if(this.eye){
   this.eye.visible=!!state&&!!camera&&state.grains.some(g=>{
    let dx=g.x-camera.x,dz=g.z-camera.z;
    if(!this.finite){dx-=Math.round(dx/SAND_METRES)*SAND_METRES;dz-=Math.round(dz/SAND_METRES)*SAND_METRES;}
    return dx*dx+dz*dz+(g.y-camera.y)**2<.14**2;
   });
  }
 }
 update(state,mat,camera){
  const changed=this.state!==state;this.state=state;this.updateEye(camera);
  this.mesh.visible=!!state&&state.grains.length>0;if(!state)return;
  this.mesh.geometry.instanceCount=state.grains.length;this.mesh.material.uniforms.color.value.set(mat.color);
  state.grains.forEach((g,i)=>{this.centers.setXYZW(i,g.x,g.y,g.z,g.r);this.velocities.setXYZ(i,g.vx,g.vy,g.vz);});
  if(state.grains.length)this.centers.needsUpdate=this.velocities.needsUpdate=true;
  if(!this.finite&&(this.version!==state.version||changed)){
   for(let i=0;i<state.bed.length;i++){
    const h=state.height(i%SAND_SIDE*SAND_METRES/SAND_SIDE,Math.floor(i/SAND_SIDE)*SAND_METRES/SAND_SIDE);
    const encoded=Math.round(Math.max(0,Math.min(1,.5+h/4))*65535);
    this.bytes[4*i]=encoded>>8;this.bytes[4*i+1]=encoded&255;
   }
   this.texture.needsUpdate=true;this.version=state.version;this.state=state;
  }
 }
 dispose(){this.eye?.removeFromParent();this.eye?.material.dispose();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();}
}
