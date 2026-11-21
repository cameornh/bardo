import {BreakingGrid,breakerVertex} from './breaking-grid.js';
import {scoopProfile} from './ocean.js';
import * as THREE from 'three';
import {WhitewaterView} from './whitewater-view.js';
import {WaterCapture} from './water-capture.js';
import {medium,interfaceOptics} from './water-optics.js';
import {LiquidParcels} from './liquid-parcels.js';
import {OCEAN_SIZE as N,WAVE_BANDS} from './ocean.js';

import {wave} from './wave-surface.js';

function waveTexture(){
 const t=new THREE.DataTexture(new Uint8Array(4*N*N),N,N);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;
 t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=4;
 return t;
}
export class OceanView{
 constructor(scene,environment,lighting) {
  this.scene=scene;this.bands=WAVE_BANDS.map(()=>({height:waveTexture(),slope:waveTexture()}));
  this.uniforms={environment,bandMix:{value:new THREE.Vector3()},ringCount:{value:0},clipWaves:{value:false},clipHeights:{value:new THREE.Vector2()},
   rings:{value:Array.from({length:12},()=>new THREE.Vector4())},color:{value:new THREE.Color()},properties:{value:new THREE.Vector4()}};
  this.bands.forEach((b,i)=>{
   this.uniforms['height'+i]={value:b.height};this.uniforms['slope'+i]={value:b.slope};
  });
  this.capture=new WaterCapture(this.uniforms,lighting);
  const geometry=new THREE.PlaneGeometry(2,2,100,100);geometry.rotateX(-Math.PI/2);
  const p=geometry.attributes.position;
  // The outermost ring reaches grazing rays even from the maximum orbit height.
  const axis=u=>{const a=Math.abs(u);return Math.sign(u)*(18*a+55*a**3+9950*a**12+2e6*a**100);};
  const spacing=new Float32Array(p.count);
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),z=p.getZ(i),a=Math.max(Math.abs(x),Math.abs(z));
   spacing[i]=axis(a+.01)-axis(Math.max(0,a-.01));
   p.setXYZ(i,axis(x),0,axis(z));
  }
  geometry.setAttribute('spacing',new THREE.BufferAttribute(spacing,1));
  const material=new THREE.ShaderMaterial({uniforms:this.uniforms,side:THREE.DoubleSide,
   vertexShader:wave+`
   varying vec3 surface;
   #ifdef BREAKING_GRID
   ${breakerVertex}
   #else
   attribute float spacing;
   #endif
   void main(){
    #ifdef BREAKING_GRID
    refineOcean(surface);
    #else
    surface=(modelMatrix*vec4(position,1.)).xyz;
    surface.y=surfaceHeight(surface.xz,spacing);
    #endif
    vec4 clip=projectionMatrix*viewMatrix*vec4(surface,1.);
    gl_Position=vec4(clip.xy,min(clip.z,clip.w*.9999997),clip.w);}`,
   fragmentShader:wave+lighting+medium+interfaceOptics+`varying vec3 surface;
   #ifdef BREAKING_GRID
   varying vec3 dxOffset,dzOffset;
   varying vec2 referenceXZ;
   #endif
   void main(){
    #ifdef BREAKING_GRID
    vec2 slope=waterSlope(referenceXZ);
    vec3 area=cross(vec3(0.,slope.y,1.)+dzOffset,vec3(1.,slope.x,0.)+dxOffset);
    vec3 n=area*inversesqrt(max(1.e-10,dot(area,area)));
    float air=.49*smoothstep(.35,1.18,1.-area.y);
    #else
    vec2 slope=waterSlope(surface.xz);
    vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
    float air=0.;
    #endif
    vec3 radiance=opticalSurface(surface,n,-1.,air);
    // Blend only the very long atmospheric sight paths into the sky at the horizon.
    float path=length(surface-cameraPosition);
    float haze=1.-exp(-path*.000085);
    gl_FragColor=vec4(mix(radiance,skyColor,haze),1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;scene.add(this.mesh);
  this.breakingGrid=new BreakingGrid(this.mesh);
  this.effectsScene=new THREE.Scene();this.effects=new WhitewaterView(this.effectsScene,this.uniforms,wave,lighting);
  this.parcels=new LiquidParcels(scene,this.uniforms,wave,lighting);this.show(false);
 }
 show(on){this.mesh.visible=this.parcels.mesh.visible=on;}
 update(sea,camera,m){
  this.show(true);this.mesh.position.set(camera.position.x,0,camera.position.z);
  for(let b=0;b<sea.bands.length;b++){
   const field=sea.bands[b],cache=this.bands[b];this.uniforms.bandMix.value.setComponent(b,field.mix);
   if(this.lastSea===sea&&cache.version===field.version)continue;
   const bytes=cache.height.image.data,slopes=cache.slope.image.data,scale=120*N/(2*field.metres);
   let low=Infinity,high=-Infinity;
   for(let i=0;i<N*N;i++)for(let f=0;f<2;f++){
    const grid=field.frames[f],x=i%N,z=i-x;
    const dx=grid[z+(x+1)%N]-grid[z+(x+N-1)%N],dz=grid[(i+N)%(N*N)]-grid[(i+N*N-N)%(N*N)];
    slopes[i*4+2*f]=Math.max(0,Math.min(255,Math.round(128+scale*dx)));
    slopes[i*4+2*f+1]=Math.max(0,Math.min(255,Math.round(128+scale*dz)));
    const value=Math.round(Math.min(1,Math.max(0,.5+grid[i]/12))*65535);
    low=Math.min(low,grid[i]);high=Math.max(high,grid[i]);
    bytes[i*4+2*f]=value>>8;bytes[i*4+2*f+1]=value&255;
   }
   cache.low=low;cache.high=high;
   cache.height.needsUpdate=cache.slope.needsUpdate=true;cache.version=field.version;
  }
  this.lastSea=sea;
  const u=this.uniforms;u.color.value.set(m.color);u.properties.value.set(m.roughness,m.metallic,m.opacity,m.emission);
  u.opacity.value=m.opacity;u.ior.value=m.ior;u.absorption.value=m.absorption;u.scattering.value=m.scattering;
  // The interpolated wave cannot leave the sum of its individual band ranges.
  // Include the signed ripple envelope and the packed texture interpolation error.
  const margin=sea.ripples.reduce((a,r)=>a+(r.scoop?scoopProfile(r,sea.time).depth:Math.abs(r.a)*Math.exp(-1.3*(sea.time-r.t))),.01);
  u.clipHeights.value.set(-margin,margin);
  for(const b of this.bands){u.clipHeights.value.x+=b.low;u.clipHeights.value.y+=b.high;}
  u.ringCount.value=sea.ripples.length;
  sea.ripples.forEach((r,i)=>{
   if(r.scoop){const {width2,depth}=scoopProfile(r,sea.time);u.rings.value[i].set(r.x,r.z,-width2,depth);}
   else u.rings.value[i].set(r.x,r.z,sea.time-r.t,r.a);
  });
  this.breakingGrid.update(sea,camera.position);this.parcels.update(sea,camera);this.effects.update(sea,camera);
 }
 dispose(){this.breakingGrid.dispose();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.parcels.dispose();this.capture.dispose();this.effects.dispose();for(const b of this.bands){b.height.dispose();b.slope.dispose();}}
}
