import * as THREE from 'three';
import {BLOB_FAMILIES, BLOB_KERNELS, LabBlobFamilies, blobFamily, sampleBlob} from './water-lab-blobs.js';
import {QUAD_VERTEX} from '../shaders.js';

export const BLOB_DENSITY_GLSL = `
vec4 blobSample(vec3 p){
  vec4 sum=vec4(0);
  for(int i=0;i<5;i++){
    vec3 q=p-vK[i].xyz;float variance=vK[i].w*vK[i].w;
    float d=vA[i/4][i%4]*exp(-.5*dot(q,q)/variance);
    sum+=vec4(d,-q*d/variance);
  }
  return sum;
}`;

const vertex = `precision highp float;precision highp int;
in vec4 aParcel;uniform highp sampler2D uBlobKernels;
flat out vec4 vK[5],vA[2],vBound;flat out vec3 vChem;
void main(){
  for(int i=0;i<5;i++)vK[i]=texelFetch(uBlobKernels,ivec2(i,gl_InstanceID),0);
  vA[0]=texelFetch(uBlobKernels,ivec2(5,gl_InstanceID),0);vA[1]=texelFetch(uBlobKernels,ivec2(6,gl_InstanceID),0);
  vChem=texelFetch(uBlobKernels,ivec2(7,gl_InstanceID),0).xyz;vBound=aParcel;
  vec4 p=viewMatrix*vec4(aParcel.xyz,1);float z=-p.z,r=aParcel.w;
  if(z+r<0.){gl_Position=vec4(2,2,2,1);return;}
  if(z<=r+.01){gl_Position=vec4(position.xy,0,1);return;}
  // Conservative perspective bounds of the family. The queried primitives
  // remain normalized 3D Gaussians, not the quad or a collection of spheres.
  vec2 lo=vec2(1e4),hi=vec2(-1e4);
  for(int i=0;i<8;i++){
    vec3 q=p.xyz+r*vec3((i&1)==0?-1.:1.,(i&2)==0?-1.:1.,(i&4)==0?-1.:1.);
    vec4 clip=projectionMatrix*vec4(q,1);vec2 uv=clip.xy/clip.w;lo=min(lo,uv);hi=max(hi,uv);
  }
  gl_Position=vec4(mix(max(lo,vec2(-1)),min(hi,vec2(1)),position.xy*.5+.5),0,1);
}`;

const fragment = common => `precision highp float;precision highp int;
flat in vec4 vK[5],vA[2],vBound;flat in vec3 vChem;out vec4 outColor;
${common}
${BLOB_DENSITY_GLSL}
float joinedDensity(vec3 p){return blobSample(p).x+rho(p);}
void main(){
  vec2 uv=gl_FragCoord.xy/uResolution;vec3 ray=rayAt(uv),offset=uEye-vBound.xyz;
  float b=dot(offset,ray),h=b*b-dot(offset,offset)+vBound.w*vBound.w;if(h<0.)discard;
  float begin=max(.001,-b-sqrt(h)),end=min(-b+sqrt(h),texture(uImage,uv).a);
  if(end<begin)discard;
  float t=begin,last=t,stepSize=max(uSpacing*.028,(end-begin)/191.);bool hit=false;
  for(int i=0;i<192;i++){
    if(joinedDensity(uEye+ray*t)>=PARCEL_ISO){hit=true;break;}
    last=t;t+=stepSize;if(t>end)break;
  }
  if(!hit)discard;
  for(int i=0;i<6;i++){float middle=(last+t)*.5;if(joinedDensity(uEye+ray*middle)<PARCEL_ISO)last=middle;else t=middle;}
  vec3 p=uEye+ray*t;vec4 densityGradient=blobSample(p);float e=uSpacing*.12;
  vec3 gradient=densityGradient.yzw+vec3(rho(p+vec3(e,0,0))-rho(p-vec3(e,0,0)),rho(p+vec3(0,e,0))-rho(p-vec3(0,e,0)),rho(p+vec3(0,0,e))-rho(p-vec3(0,0,e)))/(2.*e);
  vec3 n=length(gradient)>1e-7?-normalize(gradient):-ray;if(dot(n,-ray)<0.)n=-n;
  vec3 refracted=refract(ray,n,1./WATER_IOR);float path=0.;vec4 chemicals=vec4(0);
  for(int i=0;i<100;i++){
    vec3 q=p+refracted*(path+uSpacing*.012);float d=blobSample(q).x;vec4 bulk=parcelSample(q);
    if(d+bulk.x<PARCEL_ISO)break;
    chemicals+=vec4((d*vChem+bulk.yzw)/max(d+bulk.x,.0001),1);path+=uSpacing*.045;
  }
  outColor=vec4(shadeWater(p,n,ray,path,chemicals.xyz/max(1.,chemicals.w)),t);
  vec4 clip=uProjection*uViewMatrix*vec4(p,1);gl_FragDepth=clip.z/clip.w*.5+.5;
}`;

export class LabBlobRenderer {
  constructor(uniforms, common) {
    this.families = new LabBlobFamilies();
    this.texture = new THREE.DataTexture(new Float32Array(8 * BLOB_FAMILIES * 4), 8, BLOB_FAMILIES, THREE.RGBAFormat, THREE.FloatType);
    this.u = {...uniforms, uBlobKernels: {value: this.texture}};
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0], 3));
    this.geometry.setIndex([0,1,2,0,2,3]);
    this.geometry.setAttribute('aParcel', new THREE.InstancedBufferAttribute(new Float32Array(BLOB_FAMILIES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment(common), uniforms: this.u});
    this.mesh = new THREE.Mesh(this.geometry, this.material);this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();this.scene.add(this.mesh);
  }
  update(lab) {
    const families = this.families.update(lab), a = this.geometry.getAttribute('aParcel'), data = this.texture.image.data;
    families.forEach((f, i) => {
      const o = i * 32;data.fill(0, o, o + 32);
      f.kernels.forEach((k, j) => {data.set([...k.position, k.sigma], o + j * 4);data[o + 20 + j] = k.amplitude;});
      data.set(lab.chem.subarray(f.id * 4, f.id * 4 + 3), o + 28);
      a.array.set([...f.position, f.radius], i * 4);
    });
    a.needsUpdate = this.texture.needsUpdate = true;this.geometry.instanceCount = families.length;
    return this.families.active;
  }
  static async verify(renderer) {
    const family = blobFamily(51, [.2, .3, .1], .25, .85);
    const uniforms = {vK: {value: family.kernels.map(k => new THREE.Vector4(...k.position, k.sigma))},
      vA: {value: [new THREE.Vector4(...family.kernels.slice(0,4).map(k => k.amplitude)), new THREE.Vector4(family.kernels[4].amplitude,0,0,0)]}};
    const material = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: QUAD_VERTEX,
      fragmentShader: `precision highp float;precision highp int;uniform vec4 vK[5],vA[2];out vec4 outColor;${BLOB_DENSITY_GLSL}
      void main(){int i=int(gl_FragCoord.x);vec3 p=vec3(float(i%16),float((i/16)%16),float(i/256))*.025+vec3(0,.1,-.1);outColor=blobSample(p);}`, uniforms, depthTest: false, depthWrite: false});
    const geometry = new THREE.PlaneGeometry(2,2), scene = new THREE.Scene();scene.add(new THREE.Mesh(geometry, material));
    const target = new THREE.WebGLRenderTarget(4096,1,{type:THREE.FloatType,depthBuffer:false}), old = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
      const data = new Float32Array(4096*4);renderer.readRenderTargetPixels(target,0,0,4096,1,data);
      let error = 0;
      for(let i=0;i<4096;i++){
        const p=[i%16,Math.floor(i/16)%16,Math.floor(i/256)].map((v,k)=>v*.025+[0,.1,-.1][k]);
        const ref=sampleBlob(family,p), expected=[ref.density,...ref.gradient];
        expected.forEach((v,k)=>{error=Math.max(error,Math.abs(v-data[i*4+k]));});
      }
      return {error,pass:error<1e-4,samples:4096,kernels:BLOB_KERNELS};
    } finally {renderer.setRenderTarget(old);target.dispose();geometry.dispose();material.dispose();}
  }
}
