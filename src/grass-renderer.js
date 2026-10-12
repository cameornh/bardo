import * as THREE from 'three';
import { GRASS_GRID, GRASS_STRIDE, GrassDynamics } from './grass.js';
import { CHUNK_SIZE } from './terrain.js';
import { allocateBudget, sameViewMatrix } from './lod.js';
import { materialSH } from './sh.js';
import { SH_GLSL } from './shaders.js';

const CAPACITY=24000,MAX_CHUNKS=49;
const vertex=`
precision highp float;
in vec4 aRootHeight,aNormalWidth,aParams;
uniform sampler2D uBendAtlas;
uniform vec2 uResolution;
uniform vec3 uEye,uLight,uGrassSH[16];
uniform int uSHDegree;
${SH_GLSL}
out vec2 vGaussian;
out vec3 vWorld,vColor,vRoot,vUp;
out float vTau,vBend;
vec3 bendAt(vec2 local,int slot){
 vec2 p=clamp(local*2.,vec2(0),vec2(31.999));ivec2 cell=ivec2(floor(p));vec2 t=fract(p);
 cell.y+=slot*33;
 return mix(mix(texelFetch(uBendAtlas,cell,0).xyz,texelFetch(uBendAtlas,cell+ivec2(1,0),0).xyz,t.x),mix(texelFetch(uBendAtlas,cell+ivec2(0,1),0).xyz,texelFetch(uBendAtlas,cell+ivec2(1,1),0).xyz,t.x),t.y);
}
void main(){
 vec3 root=aRootHeight.xyz,n=aNormalWidth.xyz;float height=aRootHeight.w,width=aNormalWidth.w,seed=aParams.x,level=aParams.y;
 int slot=int(aParams.z)/3,segment=int(aParams.z)%3;
 vec3 bend=bendAt(root.xz-floor(root.xz/16.)*16.,slot);bend.z=clamp(bend.z,0.,1.);
 float s=level<2.?(float(segment)+.5)/3.:.48;
 // Root stays attached. Quadratic centerline and its tangent share the same
 // deformation, so the elongated Gaussian covariance follows the bent blade.
 vec3 lean=vec3(cos(seed*6.283),0,sin(seed*6.283))*.13;
 vec3 displacement=vec3(bend.x,0,bend.y)*.9+lean;
 vec3 p=root+n*height*(s-.85*bend.z*s*s)+displacement*height*s*s;
 vec3 tangent=normalize(n*(1.-1.7*bend.z*s)+displacement*(2.*s));
 float lengthSigma=height*(level<2.?.19:.24),widthSigma=width*(level<2.?1.-.7*s:1.);
 // Axially elongated 3D covariance, not a billboard cutout texture.
 mat3 covariance=mat3(widthSigma*widthSigma)+outerProduct(tangent,tangent)*(lengthSigma*lengthSigma-widthSigma*widthSigma);
 vec4 viewP=viewMatrix*vec4(p,1.);float z=max(-viewP.z,.1);
 mat3 r=mat3(viewMatrix),c=r*covariance*transpose(r);
 vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));
 vec3 jx=vec3(f.x/z,0,f.x*slope.x/z),jy=vec3(0,f.y/z,f.y*slope.y/z);
 float A=dot(jx,c*jx),B=dot(jx,c*jy),C=dot(jy,c*jy),det=max(A*C-B*B,1e-9);A+=.3;C+=.3;
 float compensation=sqrt(det/max(A*C-B*B,1e-9));
 float mid=(A+C)*.5,d=sqrt(max((A-C)*(A-C)*.25+B*B,0.)),e1=mid+d,e2=max(mid-d,.001);
 vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));
 vec2 offset=4.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=offset*2./uResolution*clip.w;if(viewP.z>-.1)clip=vec4(2,2,2,1);gl_Position=clip;
 vec3 viewDirection=normalize(uEye-p),light=normalize(uLight);float basis[16];basisSH(viewDirection,basis);vec3 ambient=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;ambient+=uGrassSH[i]*basis[i];}
 vec3 green=mix(vec3(.13,.24,.028),vec3(.36,.43,.09),seed);
 float direct=.35+.65*max(dot(n,light),0.);
 float back=pow(max(dot(-viewDirection,light),0.),3.);
 vColor=green*(direct*1.55+max(ambient,vec3(0))*.7)+green*.55*back;
 vColor*=mix(.65,1.12,s);vColor*=1.-.18*bend.z;
 vGaussian=position.xy*4.;vTau=(level<2.?1.9:2.8)*aParams.w*compensation;
 vWorld=p;vRoot=root;vUp=n;vBend=bend.z;
}
`;
const fragment=`
precision highp float;
uniform vec2 uResolution;
uniform vec3 uEye,uBall;
uniform float uBallRadius;
uniform mat4 uInverseProjection,uCameraMatrix;
uniform int uView;
uniform bool uBendView;
in vec2 vGaussian;in vec3 vWorld,vColor,vRoot,vUp;in float vTau,vBend;
out vec4 outColor;
void main(){
 float density=exp(-.5*dot(vGaussian,vGaussian)),alpha=1.-exp(-vTau*density);if(alpha<.001)discard;
 vec4 farP=uInverseProjection*vec4(gl_FragCoord.xy/uResolution*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 // Grass never writes hard ellipse depth. The real ball analytically occludes
 // grass behind it; blades in front can still overlap the ball's lower edge.
 float depth=dot(vWorld-uEye,ray);vec3 relative=uEye-uBall;
 float b=dot(relative,ray),disc=b*b-dot(relative,relative)+uBallRadius*uBallRadius;
 if(disc>0.&&b<0.&&-b-sqrt(disc)<depth)discard;
 vec3 p=uEye+ray*depth;if(dot(p-vRoot,vUp)<-.02)discard;
 vec3 color=vColor;
 if(uView==1)color=vUp*.5+.5;
 if(uView==2)color=vec3(.18,.6,.24)*density;
 if(uBendView)color=mix(vec3(.13,.36,.13),vec3(.95,.17,.025),vBend);
 float fog=1.-exp(-max(length(vWorld-uEye)-25.,0.)*.027);color=mix(color,vec3(.48,.51,.49),fog);
 outColor=vec4(color*alpha,alpha);
}
`;

export class GrassRenderer {
  constructor(uniforms){
    this.enabled=true;this.budget=12000;this.count=0;this.residentBlades=0;this.dynamics=new GrassDynamics();this.free=Array.from({length:MAX_CHUNKS},(_,i)=>MAX_CHUNKS-1-i);
    this.atlasData=new Float32Array(GRASS_GRID*GRASS_GRID*MAX_CHUNKS*4);
    this.atlas=new THREE.DataTexture(this.atlasData,GRASS_GRID,GRASS_GRID*MAX_CHUNKS,THREE.RGBAFormat,THREE.FloatType);this.atlas.needsUpdate=true;this.initialUpload=true;
    this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
    this.roots=new Float32Array(CAPACITY*4);this.normals=new Float32Array(CAPACITY*4);this.params=new Float32Array(CAPACITY*4);
    for(const [name,data] of [['aRootHeight',this.roots],['aNormalWidth',this.normals],['aParams',this.params]])this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(data,4).setUsage(THREE.DynamicDrawUsage));
    const coeffs=materialSH([0,1,0],{color:[.26,.4,.075],roughness:.65,metal:0,scatter:.4});
    this.uniforms={...uniforms,uBendAtlas:{value:this.atlas},uGrassSH:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...coeffs.subarray(i*3,i*3+3)))},uBall:{value:new THREE.Vector3()},uBallRadius:{value:.43},uBendView:{value:false}};
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,depthTest:true,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
    this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
    this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.point=new THREE.Vector3();this.sphere=new THREE.Sphere();this.target=6;
    this.draws=[];
    this.revision=0;this.cachedRevision=-1;this.cachedCamera=new THREE.Matrix4();this.cachedProjection=new THREE.Matrix4();this.cachedMotion=0;this.cachedBudget=0;this.cachedResolution='';this.targetGoal=0;
  }
  addChunk(key,data){if(!data)return;this.removeChunk(key);if(!this.free.length)throw new Error('Grass residency exceeded terrain cache');this.dynamics.add(key,data,this.free.pop());this.revision++;}
  removeChunk(key){const c=this.dynamics.chunks.get(key);if(c){this.free.push(c.slot);this.dynamics.remove(key);this.revision++;}}
  prepare(camera,probe,motion,dt){
    this.residentBlades=0;
    for(const c of this.dynamics.chunks.values())this.residentBlades+=c.levels[0].count;
    if(!this.enabled){this.count=0;this.geometry.instanceCount=0;this.cachedRevision=-1;return;}
    this.uniforms.uBall.value.copy(probe.position);this.uniforms.uBallRadius.value=probe.radius;
    this.flushBends();
    const resolution=this.uniforms.uResolution.value.toArray().join(',');
    if(this.cachedRevision===this.revision&&sameViewMatrix(this.cachedCamera,camera.matrixWorld)&&sameViewMatrix(this.cachedProjection,camera.projectionMatrix)&&this.cachedResolution===resolution&&this.cachedBudget===this.budget&&Math.abs(this.cachedMotion-motion)<.0001&&Math.abs(this.target-this.targetGoal)<.01)return;
    this.count=0;this.cachedRevision=this.revision;this.cachedCamera.copy(camera.matrixWorld);this.cachedProjection.copy(camera.projectionMatrix);this.cachedResolution=resolution;this.cachedBudget=this.budget;this.cachedMotion=motion;
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const focal=this.uniforms.uResolution.value.y*camera.projectionMatrix.elements[5]*.5,items=[];
    for(const c of this.dynamics.chunks.values())for(const patch of c.patches){
      if(!Number.isFinite(patch.minY))continue;
      this.sphere.center.set(patch.x,(patch.minY+patch.maxY)*.5,patch.z);this.sphere.radius=Math.hypot(3,3,(patch.maxY-patch.minY)*.5);
      if(!this.frustum.intersectsSphere(this.sphere))continue;
      this.point.copy(this.sphere.center).applyMatrix4(camera.matrixWorldInverse);
      const levels=patch.levels.map(l=>({...l,count:l.indices.length*l.segments}));
      // Parents can move into an adjacent 4 m patch; preserve a monotone budget
      // bound when one level has fewer representatives in this particular patch.
      for(let i=levels.length-2;i>=0;i--)levels[i].count=Math.max(levels[i].count,levels[i+1].count);
      items.push({chunk:c,patch,scale:focal/Math.max(3,-this.point.z-2),levels});
    }
    const requested=6*motion,needed=allocateBudget(items,requested,this.budget).target;
    this.targetGoal=needed;
    this.target+=(needed-this.target)*(1-Math.exp(-Math.min(dt,.1)/(needed>this.target?.08:.5)));
    const allocation=allocateBudget(items,this.target,this.budget),draws=this.draws;draws.length=0;
    const view=camera.matrixWorldInverse.elements;
    for(let j=0;j<items.length;j++){
      const c=items[j].chunk,choice=allocation.choices[j];
      for(const [li,weight] of choice.a===choice.b?[[choice.a,1]]:[[choice.a,1-choice.t],[choice.b,choice.t]]){
        if(weight<.001)continue;const level=items[j].patch.levels[li];
        for(const i of level.indices){
          const o=i*GRASS_STRIDE,r=c.records,depth=-(view[2]*r[o]+view[6]*r[o+1]+view[10]*r[o+2]+view[14]);if(depth<.1)continue;
          draws.push({c,o,depth,weight,segments:level.segments});
        }
      }
    }
    draws.sort((a,b)=>b.depth-a.depth);
    for(const draw of draws){const {c,o,weight,segments}=draw,r=c.records;for(let s=0;s<segments;s++){
      const index=this.count++*4;if(index>=this.roots.length)throw new Error('Grass draw budget exceeded');
      this.roots.set(r.subarray(o,o+4),index);this.normals.set(r.subarray(o+4,o+8),index);this.params.set([r[o+8],r[o+9],c.slot*3+s,weight],index);
    }}
    this.geometry.instanceCount=this.count;
    for(const attribute of Object.values(this.geometry.attributes))if(attribute.isInstancedBufferAttribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*4);attribute.needsUpdate=true;}
  }
  flushBends(){
    this.atlas.clearUpdateRanges();let dirty=false;
    for(const c of this.dynamics.chunks.values())for(const row of c.dirty){
      const start=row*GRASS_GRID*4,offset=(c.slot*GRASS_GRID+row)*GRASS_GRID*4;
      this.atlasData.set(c.field.subarray(start,start+GRASS_GRID*4),offset);
      if(!this.initialUpload)this.atlas.addUpdateRange(offset,GRASS_GRID*4);dirty=true;
    }
    for(const c of this.dynamics.chunks.values())c.dirty.clear();
    if(dirty)this.atlas.needsUpdate=true;this.initialUpload=false;
  }
  render(renderer,camera){if(this.enabled&&this.count)renderer.render(this.scene,camera);}
  dispose(){this.atlas.dispose();this.geometry.dispose();this.material.dispose();}
}
