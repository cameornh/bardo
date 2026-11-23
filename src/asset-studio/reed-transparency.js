// Integrate reed optical density in camera-depth order at each pixel. The bounds
// come from the actual overlapping lobes, including their tilt and current pose.
// A centimetre between two crossing leaves can therefore span the full range.
import * as T from 'three';

const reedCoverage = `
 varying vec2 gaussian;
 #if !defined(REED_RANGE_ONLY) && !defined(REED_LIGHT_VERT)
 varying vec3 dye,normalW;
 varying float haze;
 #endif
 varying vec3 worldPoint;
 varying float coverageScale,reedDepth,vSoft;
 uniform mat4 projectionMatrix;
 uniform int reedWaterSide;
 uniform vec2 clipHeights;
 uniform sampler2D reedSolidDepth;
 uniform bool hasReedSolidDepth;
 float visibleDensity(){
  if(reedDepth<=0.)discard;
  float r2=dot(gaussian,gaussian);
  #ifdef CRISP_FOLIAGE
   float soft=clamp(vSoft,0.,1.);
   float kurt=mix(.75,.04,soft);
   float cut=mix(.045,.018,soft);
   float hi=mix(.28,.72,soft);
   float gain=mix(4.2,1.85,soft);
   float w=exp(-.5*r2*(1.+kurt*r2));
   if(w<cut)discard;
   float density=gain*coverageScale*smoothstep(cut,hi,w);
  #else
   float density=2.55*coverageScale*exp(-.5*r2);
   if(density<.003005)discard;
  #endif
  if(hasReedSolidDepth){
   float depth=.5+.5*(-projectionMatrix[2][2]+projectionMatrix[3][2]/reedDepth);
   if(depth>texelFetch(reedSolidDepth,ivec2(gl_FragCoord.xy),0).r)discard;
  }
  if(reedWaterSide!=0 && (reedWaterSide<0)!=(worldPoint.y<clipHeights.x||
    (worldPoint.y<=clipHeights.y && worldPoint.y<elevation(worldPoint.xz))))discard;
  return density;
 }
`;

// Keep the two extreme surfaces separate, even with a third surface far behind
// them. Split the intervening range logarithmically to favour nearby detail.
// Smooth weights avoid a colour jump when adjacent leaf segments cross.
const depthBands = `
 uniform sampler2D reedRange;
 #ifdef BYTE_LAYERS
 uniform sampler2D reedFar;
 uniform bool lowDigit;
 #endif
 vec4 bandWeights(float z){
  vec2 r=texelFetch(reedRange,ivec2(gl_FragCoord.xy),0).rg;
  #ifdef BYTE_LAYERS
   float nearZ=projectionMatrix[3][2]/(2.*r.x-1.+projectionMatrix[2][2]);
   float reversed=texelFetch(reedFar,ivec2(gl_FragCoord.xy),0).r;
   float farZ=projectionMatrix[3][2]/(1.-2.*reversed+projectionMatrix[2][2]);
   float precisionZ=max(.00065*z,z*z*1.2e-7/abs(projectionMatrix[3][2]));
  #else
   float nearZ=256.*r.x/(1.-r.x),farZ=-256.*r.y/(1.+r.y);
   float precisionZ=max(.00004,z*.00065);
  #endif
  float span=max(0.,farZ-nearZ);
  if(span<=2.*precisionZ)return vec4(1.,0.,0.,0.);
  float gap=clamp(z-nearZ,0.,span);
  float rim=min(.20*span,max(2.*precisionZ,max(.001,.012*span)));
  float begin=min(.18*span,precisionZ),end=min(.42*span,precisionZ+rim);
  float first=1.-smoothstep(begin,end,gap);
  float last=1.-smoothstep(begin,end,span-gap);
  float inner=max(0.,1.-first-last);
  float middle=clamp(log(1.+gap/max(rim,.02))/log(1.+span/max(rim,.02)),0.,1.);
  float back=smoothstep(.42,.68,middle);
  return vec4(first,inner*(1.-back),inner*back,last);
 }
 void storeLayer(out vec4 layer,vec4 dyeDensity,float fraction){
  #ifdef BYTE_LAYERS
   // Split fixed-point optical depth into additive digits. Each write is
   // an exact byte, so different submission orders produce the same sum.
   vec4 ticks=floor(fraction*dyeDensity*512.+.5);
   layer=(lowDigit?mod(ticks,32.):floor(ticks/32.))/255.;
  #else
   layer=fraction*dyeDensity;
  #endif
 }
`;

const resolveFragment=`
 uniform sampler2D layer0,layer1,layer2,layer3,baseColor,baseDepth;
 uniform bool presentBase;
 #ifdef BYTE_LAYERS
 uniform sampler2D fine0,fine1,fine2,fine3;
 #define DENSITY(coarse,fine) ((32.*texelFetch(coarse,p,0)+texelFetch(fine,p,0))*(255./512.))
 #else
 #define DENSITY(coarse,fine) texelFetch(coarse,p,0)
 #endif
 vec4 overLayer(vec4 behind,vec4 density){
  float transmission=exp(-density.a);
  vec3 tint=density.rgb/max(.00001,density.a);
  return vec4(tint*(1.-transmission),1.-transmission)+behind*transmission;
 }
 void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec4 accum=presentBase?vec4(texelFetch(baseColor,p,0).rgb,1.):vec4(0.);
  accum=overLayer(accum,DENSITY(layer3,fine3));
  accum=overLayer(accum,DENSITY(layer2,fine2));
  accum=overLayer(accum,DENSITY(layer1,fine1));
  accum=overLayer(accum,DENSITY(layer0,fine0));
  if(accum.a==0.)discard;
  gl_FragDepth=presentBase?texelFetch(baseDepth,p,0).r:0.;
  gl_FragColor=vec4(accum.rgb/accum.a,accum.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

export class ReedTransparency{
 constructor(group,uniforms,vertex,waves,shading,crisp=false,vertexLighting=''){
  this.group=group;this.uniforms=uniforms;this.vertex=vertex;this.waves=waves;this.shading=shading;this.crisp=crisp;this.vertexLighting=vertexLighting;
  this.targets=new Map();this.size=new T.Vector2();this.clearColor=new T.Color();
  Object.assign(uniforms,{reedRange:{value:null},reedFar:{value:null},reverseReedDepth:{value:false},lowDigit:{value:false},reedSolidDepth:{value:null},hasReedSolidDepth:{value:false}});
 }
 init(renderer){
  const bytes=!renderer.extensions.has('EXT_color_buffer_float');
  this.bytes=bytes;
  const defines={...(bytes?{BYTE_LAYERS:1}:{}),...(this.crisp?{CRISP_FOLIAGE:1}:{})};
  const hasVertLight=this.crisp&&!!this.vertexLighting;
  const materials=(fragment,extraDefines,vertexShader,options)=>[0,1,2,3].map(lod=>new T.ShaderMaterial({
   uniforms:this.uniforms,defines:{...defines,...extraDefines,REED_LOD:lod},vertexShader,
   fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,side:T.DoubleSide,
   forceSinglePass:true,toneMapped:false,blending:T.CustomBlending,...options}));
  this.rangeMaterials=materials(this.waves+reedCoverage+`
   uniform bool reverseReedDepth;
   void main(){
    visibleDensity();
    float z=reedDepth;
    #ifdef BYTE_LAYERS
     float d=.5+.5*(-projectionMatrix[2][2]+projectionMatrix[3][2]/z);
     gl_FragDepth=reverseReedDepth?1.-d:d;gl_FragColor=vec4(0.);
    #else
     float d=z/(256.+z);gl_FragColor=vec4(d,-d,0.,0.);
    #endif
   }`,{REED_RANGE_ONLY:1},this.vertex,bytes?{blending:T.NoBlending,colorWrite:false,depthWrite:true,depthTest:true}
    :{blendEquation:T.MinEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor});
  const layerVert=hasVertLight?this.vertexLighting+'\nuniform vec3 hazeColor;\n'+this.vertex:this.vertex;
  this.layerMaterials=materials(this.waves+reedCoverage+this.shading+depthBands+`
   layout(location=1) out vec4 band1;
   layout(location=2) out vec4 band2;
   layout(location=3) out vec4 band3;
   void main(){
    float density=visibleDensity();
    vec4 weights=bandWeights(reedDepth);
    vec4 value=density*vec4(reedLight(),1.);
    storeLayer(gl_FragColor,value,weights.x);storeLayer(band1,value,weights.y);
    storeLayer(band2,value,weights.z);storeLayer(band3,value,weights.w);
   }`,hasVertLight?{REED_LIGHT_VERT:1}:{},layerVert,{blendSrc:T.OneFactor,blendDst:T.OneFactor});
  const uniforms=Object.fromEntries(['baseColor','baseDepth','layer0','layer1','layer2','layer3','fine0','fine1','fine2','fine3','presentBase'].map(k=>[k,{value:null}]));
  this.resolve=new T.ShaderMaterial({uniforms,defines,transparent:true,depthTest:true,depthFunc:T.AlwaysDepth,depthWrite:false,
   vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:resolveFragment});
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  this.quad=new T.Mesh(g,this.resolve);this.quad.frustumCulled=false;
  this.screen=new T.Scene();this.screen.add(this.quad);
 }
 draw(renderer,camera,side,underwater,base){
  if(!this.resolve)this.init(renderer);
  const out=renderer.getRenderTarget(),u=this.uniforms,clear=renderer.autoClear;
  const w=out?.width??renderer.getDrawingBufferSize(this.size).x,h=out?.height??this.size.y;
  // Full-size transmission and presentation share storage. The reflection
  // keeps its own half-size pair, avoiding reallocations between passes.
  let targets=this.targets.get(camera);
  if(!targets){
   const opts={depthBuffer:false,type:this.bytes?T.UnsignedByteType:T.HalfFloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter};
   const depthTarget=()=>new T.WebGLRenderTarget(w,h,{depthTexture:new T.DepthTexture(w,h,T.UnsignedIntType)});
   targets={range:this.bytes?depthTarget():new T.WebGLRenderTarget(w,h,{...opts,format:T.RGFormat}),
    far:this.bytes?depthTarget():null,fine:this.bytes?new T.WebGLRenderTarget(w,h,{...opts,count:4}):null,layers:new T.WebGLRenderTarget(w,h,{...opts,count:4})};
   this.targets.set(camera,targets);
  }
  const {range,far,layers,fine}=targets;range.setSize(w,h);far?.setSize(w,h);layers.setSize(w,h);fine?.setSize(w,h);
  u.reedWaterSide.value=side;u.reedUnderwater.value=underwater;
  u.reedSolidDepth.value=(base??out)?.depthTexture??null;u.hasReedSolidDepth.value=!!u.reedSolidDepth.value;
  const alpha=renderer.getClearAlpha();renderer.getClearColor(this.clearColor);
  const clearTarget=(target,color,opacity)=>{
   renderer.setRenderTarget(target);renderer.setClearColor(color,opacity);renderer.clear(true,target.depthBuffer,false);
  };
  if(clear&&!base)renderer.clear();
  renderer.autoClear=false;
  const hasVisible=this.group.children.some(m=>m.visible);
  if(!hasVisible&&!base){
   renderer.setRenderTarget(out);renderer.setClearColor(this.clearColor,alpha);renderer.autoClear=clear;return;
  }
  // The half-float range uses MIN(z,-z). A positive high value in both
  // channels is the identity, including negative far-depth values.
  if(hasVisible){
   u.reverseReedDepth.value=false;
   clearTarget(range,0xffff00,1);
   for(const mesh of this.group.children)if(mesh.visible)mesh.material=this.rangeMaterials[mesh.userData.lod];
   renderer.render(this.group,camera);
   if(far){
    // A 24-bit depth attachment keeps nearby blades distinct even when float
    // blending is unavailable. Reverse projected depth for the farthest pass.
    clearTarget(far,0,0);u.reverseReedDepth.value=true;
    renderer.render(this.group,camera);u.reedFar.value=far.depthTexture;
   }
   u.lowDigit.value=false;clearTarget(layers,0,0);
   u.reedRange.value=far?range.depthTexture:range.texture;
   for(const mesh of this.group.children)if(mesh.visible)mesh.material=this.layerMaterials[mesh.userData.lod];
   renderer.render(this.group,camera);
   if(fine){
    clearTarget(fine,0,0);u.lowDigit.value=true;renderer.render(this.group,camera);
   }
  }else{
   clearTarget(layers,0,0);
   if(fine)clearTarget(fine,0,0);
  }
  renderer.setRenderTarget(out);renderer.setClearColor(this.clearColor,alpha);
  const ru=this.resolve.uniforms;
  for(let i=0;i<4;i++){ru['layer'+i].value=layers.textures[i];if(fine)ru['fine'+i].value=fine.textures[i];}
  ru.presentBase.value=!!base;ru.baseColor.value=base?.texture??null;ru.baseDepth.value=base?.depthTexture??null;
  this.resolve.depthWrite=!!base;
  renderer.render(this.screen,camera);renderer.autoClear=clear;
 }
 dispose(){
  for(const {range,far,layers,fine} of this.targets.values()){range.dispose();far?.dispose();layers.dispose();fine?.dispose();}
  for(const m of [...this.rangeMaterials??[],...this.layerMaterials??[]])m.dispose();
  this.resolve?.dispose();this.quad?.geometry.dispose();
 }
}
