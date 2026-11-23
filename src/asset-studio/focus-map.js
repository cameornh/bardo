// Render each fitted distribution only over its support. The ground samples the
// resulting irradiance once. Sub-texel foci keep their analytic representation
// when widely separated optics would otherwise erase them from the shared map.
import * as T from 'three';
const SIZE=256;
export class FocusMap{
 constructor(capacity){
  this.bounds=new T.Vector4();
  this.geometry=new T.InstancedBufferGeometry().copy(new T.PlaneGeometry(2,2));
  const attribute=(name,n)=>{
   const a=new T.InstancedBufferAttribute(new Float32Array(capacity*n),n).setUsage(T.DynamicDrawUsage);
   this.geometry.setAttribute(name,a);return a;
  };
  this.region=attribute('region',4);this.precisionXZ=attribute('precisionXZ',3);this.flux=attribute('flux',3);
  this.material=new T.ShaderMaterial({uniforms:{bounds:{value:this.bounds}},depthTest:false,depthWrite:false,toneMapped:false,transparent:true,
   blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,
   vertexShader:`attribute vec4 region;attribute vec3 precisionXZ,flux;uniform vec4 bounds;
   varying vec2 offset;flat varying vec3 quadratic,power;
   void main(){quadratic=precisionXZ;power=flux;offset=position.xy*region.zw;
   gl_Position=vec4(((region.xy+offset-bounds.xy)*bounds.zw)*2.-1.,0.,1.);}`,
   fragmentShader:`varying vec2 offset;flat varying vec3 quadratic,power;
   void main(){float q=dot(offset*offset,quadratic.xy)+quadratic.z*offset.x*offset.y;
   gl_FragColor=vec4(q<12.?power*exp(-.5*max(0.,q)):vec3(0.),0.);}`});
  this.mesh=new T.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;
  this.scene=new T.Scene();this.scene.add(this.mesh);this.camera=new T.Camera();this.savedColor=new T.Color();
 }
 update(view,spots){
  const r=view.renderer,u=view.groundMaterial.uniforms;
  if(spots.length===this.last?.length&&spots.every((s,i)=>s===this.last[i]))return;
  this.last=spots;
  if(!spots.length){u.focusMapScale.value=0;u.focusCount.value=0;return;}
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  const radii=spots.map(({shape:s,light:l})=>{
   const det=s.z*s.w-.25*l.w*l.w;
   const x=Math.sqrt(12*s.w/det),z=Math.sqrt(12*s.z/det);
   x0=Math.min(x0,s.x-x);z0=Math.min(z0,s.y-z);x1=Math.max(x1,s.x+x);z1=Math.max(z1,s.y+z);
   return [x,z];
  });
  const w=x1-x0,h=z1-z0,bounds=u.focusBounds.value.set(x0,z0,1/w,1/h);
  this.bounds.copy(bounds);
  const hdr=r.extensions.has('EXT_color_buffer_float');
  this.target??=new T.WebGLRenderTarget(SIZE,SIZE,{depthBuffer:false,type:hdr?T.HalfFloatType:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  const scale=hdr?1:Math.max(1,spots.reduce((sum,s)=>sum+Math.max(s.light.x,s.light.y,s.light.z),0));
  const prior=r.getRenderTarget(),clear=r.autoClear,alpha=r.getClearAlpha();r.getClearColor(this.savedColor);
  r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.autoClear=false;
  let exact=0,mapped=0;
  try{for(const [i,{shape:s,light:l}] of spots.entries()){
   // Evaluate a thin feature exactly if the atlas cannot resolve its narrow axis.
   const trace=s.z+s.w,major=.5*(trace+Math.hypot(s.z-s.w,l.w));
   if(Math.max(w,h)*Math.sqrt(major)>SIZE*.65){
    u.focusShape.value[exact].copy(s);u.focusLight.value[exact++].copy(l);continue;
   }
   this.region.setXYZW(mapped,s.x,s.y,...radii[i]);this.precisionXZ.setXYZ(mapped,s.z,s.w,l.w);
   this.flux.setXYZ(mapped,l.x/scale,l.y/scale,l.z/scale);mapped++;
  }
  if(mapped){
   this.region.needsUpdate=this.precisionXZ.needsUpdate=this.flux.needsUpdate=true;
   this.geometry.instanceCount=mapped;r.render(this.scene,this.camera);
  }}finally{r.setRenderTarget(prior);r.setClearColor(this.savedColor,alpha);r.autoClear=clear;}
  u.focusMap.value=this.target.texture;u.focusMapScale.value=mapped?scale:0;u.focusCount.value=exact;
 }
 dispose(){this.target?.dispose();this.geometry.dispose();this.material.dispose();}
}
