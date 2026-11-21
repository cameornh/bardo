import * as THREE from 'three';
import {OCEAN_SIZE as N,TILE_METRES} from './ocean.js';

const wave=/* glsl */`
 uniform sampler2D heights;
 uniform float frameMix;
 uniform vec4 rings[12];
 uniform int ringCount;
 float elevation(vec2 pos){
  vec4 h=texture2D(heights,pos/${TILE_METRES.toFixed(1)}+vec2(.5/${N.toFixed(1)}));
  vec2 pair=vec2(dot(h.rg,vec2(65280.,255.)),dot(h.ba,vec2(65280.,255.)));
  float y=(mix(pair.x,pair.y,frameMix)/65535.-.5)*12.;
  for(int i=0;i<12;i++){if(i>=ringCount)break;
   vec4 r=rings[i];float q=length(pos-r.xy)-2.*r.z;
   y+=r.w*cos(6.*q)*exp(-3.*q*q-1.3*r.z);
  }
  return y;
 }`;
export class OceanView{
 constructor(scene,environment,lighting) {
  this.scene=scene;this.bytes=new Uint8Array(4*N*N);
  this.texture=new THREE.DataTexture(this.bytes,N,N);
  this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;
  this.texture.wrapS=this.texture.wrapT=THREE.RepeatWrapping;
  // Encode both keyframes' slopes once per transform so shading costs one filtered lookup.
  this.slopes=new Uint8Array(4*N*N);this.normalTexture=new THREE.DataTexture(this.slopes,N,N);
  this.normalTexture.minFilter=this.normalTexture.magFilter=THREE.LinearFilter;
  this.normalTexture.wrapS=this.normalTexture.wrapT=THREE.RepeatWrapping;
  this.uniforms={environment,slopes:{value:this.normalTexture},heights:{value:this.texture},frameMix:{value:0},ringCount:{value:0},
   rings:{value:Array.from({length:12},()=>new THREE.Vector4())},color:{value:new THREE.Color()},properties:{value:new THREE.Vector4()}};
  const geometry=new THREE.PlaneGeometry(2,2,100,100);geometry.rotateX(-Math.PI/2);
  const p=geometry.attributes.position;
  const axis=u=>{const a=Math.abs(u);return Math.sign(u)*(18*a+55*a**3+9950*a**12);};
  for(let i=0;i<p.count;i++)p.setXYZ(i,axis(p.getX(i)),0,axis(p.getZ(i)));
  const material=new THREE.ShaderMaterial({uniforms:this.uniforms,side:THREE.DoubleSide,
   vertexShader:wave+`varying vec3 surface;
   void main(){surface=(modelMatrix*vec4(position,1.)).xyz;float dist=length(cameraPosition.xz-surface.xz);
    surface.y=elevation(surface.xz)*(1.-smoothstep(45.,180.,dist));
    gl_Position=projectionMatrix*viewMatrix*vec4(surface,1.);}`,
   fragmentShader:wave+lighting+`varying vec3 surface;uniform sampler2D slopes;uniform vec3 color;uniform vec4 properties;
   void main(){vec2 x=surface.xz;
    vec4 derivatives=texture2D(slopes,x/${TILE_METRES.toFixed(1)}+vec2(.5/${N.toFixed(1)}));
    vec2 slope=(mix(derivatives.xy,derivatives.zw,frameMix)*255.-128.)/120.;
    for(int i=0;i<12;i++){if(i>=ringCount)break;
     vec4 r=rings[i];vec2 delta=x-r.xy;float dist=length(delta),q=dist-2.*r.z;
     slope+=delta/max(.001,dist)*r.w*exp(-3.*q*q-1.3*r.z)*(-6.*sin(6.*q)-6.*q*cos(6.*q));
    }
    float footprint=max(length(dFdx(x)),length(dFdy(x)));
    slope*=1.-smoothstep(.4,3.,footprint);vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
    vec3 viewDir=normalize(cameraPosition-surface);
    float fresnel=.025+.92*pow(1.-abs(dot(n,viewDir)),5.);
    vec3 light=shade(color*.52,n,surface,properties);
    gl_FragColor=vec4(mix(light,env(reflect(-viewDir,n),0.),fresnel),1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
  this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;scene.add(this.mesh);
  const beadMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:`
   varying vec3 n;varying vec3 p;
   void main(){vec4 world=modelMatrix*instanceMatrix*vec4(position,1.);p=world.xyz;n=normal;
   gl_Position=projectionMatrix*viewMatrix*world;}`,fragmentShader:lighting+`
   varying vec3 n;varying vec3 p;uniform vec3 color;uniform vec4 properties;
   void main(){gl_FragColor=vec4(shade(color,normalize(n),p,properties),1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
  this.beads=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),beadMat,96);
  this.beads.count=0;this.beads.frustumCulled=false;scene.add(this.beads);
  this.matrix=new THREE.Matrix4();this.show(false);
 }
 show(on){this.mesh.visible=this.beads.visible=on;}
 update(sea,camera,m){
  this.show(true);this.mesh.position.set(camera.position.x,0,camera.position.z);
  if(this.lastSea!==sea||this.version!==sea.version){
   for(let i=0;i<N*N;i++)for(let f=0;f<2;f++){
    const grid=sea.frames[f],x=i%N,z=i-x,scale=120*N/(2*TILE_METRES);
    const dx=grid[z+(x+1)%N]-grid[z+(x+N-1)%N];
    const dz=grid[(i+N)%(N*N)]-grid[(i+N*N-N)%(N*N)];
    this.slopes[i*4+2*f]=Math.max(0,Math.min(255,Math.round(128+scale*dx)));
    this.slopes[i*4+2*f+1]=Math.max(0,Math.min(255,Math.round(128+scale*dz)));
    const value=Math.round(Math.min(1,Math.max(0,.5+sea.frames[f][i]/12))*65535);
    this.bytes[i*4+2*f]=value>>8;this.bytes[i*4+2*f+1]=value&255;
   }
   this.normalTexture.needsUpdate=this.texture.needsUpdate=true;this.version=sea.version;this.lastSea=sea;
  }
  const u=this.uniforms;u.color.value.set(m.color);u.properties.value.set(m.roughness,m.metallic,m.opacity,m.emission);
  u.frameMix.value=sea.mix;u.ringCount.value=sea.ripples.length;
  sea.ripples.forEach((r,i)=>u.rings.value[i].set(r.x,r.z,sea.time-r.t,r.a));
  this.beads.count=sea.drops.length;sea.drops.forEach((d,i)=>this.beads.setMatrixAt(i,this.matrix.makeScale(d.r,d.r,d.r).setPosition(d.x,d.y,d.z)));
  if(this.beads.count)this.beads.instanceMatrix.needsUpdate=true;
 }
 dispose(){for(const m of [this.mesh,this.beads]){m.removeFromParent();m.geometry.dispose();m.material.dispose();}this.beads.dispose();this.texture.dispose();this.normalTexture.dispose();}
}
