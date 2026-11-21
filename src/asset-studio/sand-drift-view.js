import * as THREE from 'three';
import {SAND_CAP,SAND_SIDE,SAND_METRES} from './wind-sand.js';

export class SandDriftView{
 constructor(scene,uniforms,lighting){
  const geometry=new THREE.InstancedBufferGeometry();
  this.centers=new THREE.InstancedBufferAttribute(new Float32Array(SAND_CAP*4),4);
  this.velocities=new THREE.InstancedBufferAttribute(new Float32Array(SAND_CAP*3),3);
  geometry.setAttribute('flight',this.velocities);geometry.setAttribute('grain',this.centers);
  const positions=[],offsets=[];
  for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)for(const q of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]){
   positions.push(...q,0);offsets.push(x,z);
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('tileOffset',new THREE.Float32BufferAttribute(offsets,2));
  const material=new THREE.ShaderMaterial({uniforms:{...uniforms,color:{value:new THREE.Color()}},
   transparent:true,depthWrite:false,
   vertexShader:`attribute vec4 grain;attribute vec3 flight;attribute vec2 tileOffset;uniform vec2 viewport;varying vec2 g;varying float fade,tint;
   const float tile=${SAND_METRES.toFixed(1)};
   void main(){
    vec3 p=grain.xyz;p.xz+=tile*(floor((cameraPosition.xz-p.xz)/tile+.5)+tileOffset);
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
    clip.xy+=offset*2./viewport*clip.w;
    fade=1.-smoothstep(6.,17.,length(p.xz-cameraPosition.xz));gl_Position=v.z<-.03?clip:vec4(2.,2.,2.,1.);
   }`,
   fragmentShader:lighting+`varying vec2 g;varying float fade,tint;uniform vec3 color;
   void main(){float a=fade*exp(-.5*dot(g,g))*.72;if(a<.015)discard;
    gl_FragColor=vec4(color*(env(vec3(0.,1.,0.),1.)+.68)*mix(.52,1.32,tint),a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.visible=false;scene.add(this.mesh);
  this.bytes=new Uint8Array(SAND_SIDE*SAND_SIDE).fill(128);
  this.texture=new THREE.DataTexture(this.bytes,SAND_SIDE,SAND_SIDE,THREE.RedFormat);
  this.texture.wrapS=this.texture.wrapT=THREE.RepeatWrapping;this.texture.magFilter=this.texture.minFilter=THREE.LinearFilter;this.texture.needsUpdate=true;
 }
 update(state,mat){
  this.mesh.visible=!!state&&state.grains.length>0;
  if(!state)return;
  this.mesh.geometry.instanceCount=state.grains.length;this.mesh.material.uniforms.color.value.set(mat.color);
  state.grains.forEach((g,i)=>{this.centers.setXYZW(i,g.x,g.y,g.z,g.r);this.velocities.setXYZ(i,g.vx,g.vy,g.vz);});
  if(state.grains.length)this.centers.needsUpdate=this.velocities.needsUpdate=true;
  if(this.version!==state.version||this.state!==state){
   for(let i=0;i<this.bytes.length;i++)this.bytes[i]=Math.max(0,Math.min(255,Math.round(128+(state.bed[i]-.012)*8000)));
   this.texture.needsUpdate=true;this.version=state.version;this.state=state;
  }
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.texture.dispose();}
}
