import * as THREE from 'three';
import {QUAD_VERTEX} from '../../shaders.js';
import {reachableShader} from '../shader-reachability.js';

// The surface search is independent of the four projected quad corners.
// Evaluate it once on the GPU, retaining the Gaussian covariance and the same
// SH/underwater response. Optionally reuse lighting too. No readback or physics
// modification. These experiments are not installed in the normal live app.
export function splitFoamGeometry(vertex,{lighting=false}={}){
 const start=vertex.indexOf('void main(){'),tangent=vertex.indexOf('vec3 tangent=',start),organicStart=vertex.indexOf('float organic=',tangent),organicEnd=vertex.indexOf(';vec3 tint=',organicStart);
 if(start<0||tangent<0||organicStart<0||organicEnd<0)throw Error('Sea foam geometry contract changed');
 const library=vertex.slice(0,start).replace(/flat out[^;]+;|out vec2 vQ;/g,'');
 let geometry=vertex.slice(start,tangent).replace('int index=gl_InstanceID/2;bool land=gl_InstanceID%2==1;', 'int id=int(gl_FragCoord.y)*uSeaSize*2+int(gl_FragCoord.x);int index=id/2;bool land=id%2==1;').replaceAll('vAmount','amount').replace('gl_Position=vec4(2,2,2,1);return;','return;');
 geometry=geometry.replace('void main(){','void main(){outPoint=vec4(0);outNormal=vec4(0);float amount;');
 const tail=lighting?'vec3 light;'+vertex.slice(organicStart,vertex.lastIndexOf('}')).replaceAll('vLight','light')+'outPoint=vec4(point,amount);outNormal=vec4(light,0);}':vertex.slice(organicStart,organicEnd)+';outPoint=vec4(point,amount);outNormal=vec4(normal,organic);}';
 const fragment=reachableShader(library+'\nlayout(location=0)out vec4 outPoint;layout(location=1)out vec4 outNormal;\n'+geometry+tail,[]);
 let draw=vertex.slice(0,start)+`uniform sampler2D uFoamPoint,uFoamNormal;
void main(){int id=gl_InstanceID;int index=id/2;bool land=id%2==1;ivec2 cell=ivec2(index%uSeaSize,index/uSeaSize),address=ivec2(id%(uSeaSize*2),id/(uSeaSize*2));
 vec4 record=texelFetch(uFoamPoint,address,0),surfaceRecord=texelFetch(uFoamNormal,address,0);vAmount=record.w;if(vAmount<.002){gl_Position=vec4(2,2,2,1);return;}
 vec2 stepSize=vec2(11.,9.8)/float(uSeaSize);vec3 point=record.xyz,normal=surfaceRecord.xyz;
`+vertex.slice(tangent);
 draw=draw.replace(vertex.slice(organicStart,organicEnd),'float organic=surfaceRecord.w');
 if(lighting){
  // Keep the inexpensive exact terrain normal in the drawing program. This
  // frees the second RGBA32F record for shared SH and medium lighting without
  // a third attachment, quantization, or a wider render-target split.
  draw=draw.replace('normal=surfaceRecord.xyz;',`normal=vec3(0);
   float gx=(elevation(cell+ivec2(1,0),land)-elevation(cell-ivec2(1,0),land))/(2.*stepSize.x),gz=(elevation(cell+ivec2(0,1),land)-elevation(cell-ivec2(0,1),land))/(2.*stepSize.y);
   normal=normalize(vec3(-clamp(gx,-1.,1.),1.,-clamp(gz,-1.,1.)));`);
  draw=draw.slice(0,draw.indexOf('float organic=surfaceRecord.w'))+'vLight=surfaceRecord.xyz;}';
 }
 return {fragment,vertex:draw};
}

export class FoamGeometryCache {
 constructor(draw,{lighting=false}={}){
  this.draw=draw;this.sea=draw.seaFoamRenderer;this.reference=draw.particleVisibility.seaMaterial;
  const {vertex,fragment}=splitFoamGeometry(this.reference.vertexShader,{lighting}),n=this.sea.foam.size;
  this.target=new THREE.WebGLRenderTarget(n*2,n,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.u={...this.reference.uniforms,uFoamPoint:{value:this.target.textures[0]},uFoamNormal:{value:this.target.textures[1]}};
  this.prepare=new THREE.ShaderMaterial({name:lighting?'sea-foam-lighting-cache':'sea-foam-surface-cache',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});
  this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.prepare));this.camera=new THREE.Camera();
  const uniforms=this.reference.uniforms;try{this.reference.uniforms={};this.material=this.reference.clone();}finally{this.reference.uniforms=uniforms;}
  this.material.uniforms=this.u;this.material.vertexShader=vertex;this.material.name='cached-sea-foam-Gaussians';delete this.material.userData.liveReachability;delete this.material.userData.liveLoopBounds;
  this.stats={preparations:0,texels:0};
 }
 install(){
  const sea=this.sea,render=sea.render.bind(sea);
  sea.render=(r,camera,lab)=>{
   if(!lab.optimizations.foamGeometryCache||lab.optimizations.particleOcclusion||this.draw.particleVisibility.enabled===false)return render(r,camera,lab);
   // Let the existing visibility wrapper update sky and policy first.
   const submit=r.render;r.render=(scene,view,...args)=>{
    if(scene!==sea.scene)return submit.call(r,scene,view,...args);
    const old=r.getRenderTarget(),auto=r.autoClear,mesh=sea.scene.children[0],previous=mesh.material;r.autoClear=false;
    try{r.setRenderTarget(this.target);submit.call(r,this.scene,this.camera);this.stats.preparations++;this.stats.texels=this.target.width*this.target.height;
     r.setRenderTarget(old);mesh.material=this.material;return submit.call(r,scene,view,...args);
    }finally{mesh.material=previous;r.setRenderTarget(old);r.autoClear=auto;}
   };
   try{return render(r,camera,lab);}finally{r.render=submit;}
  };return this;
 }
 jobs(){const scene=new THREE.Scene();scene.add(new THREE.Mesh(this.sea.geometry,this.material));return [{name:this.prepare.name,scene:this.scene,camera:this.camera,target:this.target},{name:this.material.name,scene,camera:this.draw.field.camera,target:this.draw.composite}];}
 dispose(){this.target.dispose();this.geometry.dispose();this.prepare.dispose();this.material.dispose();}
}
