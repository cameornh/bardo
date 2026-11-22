import * as T from 'three';
import {wetlandGLSL} from './wetland.js';
import {reedFamily,instancedReed} from './reed-stand.js';
import {WetlandReeds} from './wetland-reeds.js';
import {reflectedSurfaceClip} from './wave-surface.js';

// Each axis is a nested world-space lattice. Adjacent strips share their
// actual vertices, including at changes of spacing and across the origin.
function groundGrid(){
 const axis=[{offset:0,step:.375}];
 let offset=0;
 for(let level=0;level<10;level++){
  const step=.375*2**level;
  for(let i=0;i<12;i++){offset+=step;axis.push({offset,step});}
 }
 axis.push({offset:12000,step:192});
 axis.unshift(...axis.slice(1).reverse().map(v=>({...v,offset:-v.offset})));
 const positions=[],steps=[],indices=[],n=axis.length;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  positions.push(axis[i].offset,0,axis[j].offset);steps.push(axis[i].step,axis[j].step);
  const k=j*n+i;
  if(i+1<n&&j+1<n)indices.push(k,k+n,k+1,k+1,k+n,k+n+1);
 }
 const g=new T.BufferGeometry();g.setIndex(indices);
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('gridStep',new T.Float32BufferAttribute(steps,2));return g;
}
const habitat=`
 varying float standCover;
 float colony(vec2 p,float h){
  float moist=smoothstep(-.68,-.10,h)*(1.-smoothstep(.18,.85,h));
  return moist*(.08+.92*smoothstep(.20,.75,landNoise((p+survey)/9.)));
 }`;
const lattice=`attribute vec2 gridStep;
 uniform vec2 landEye;vec2 landPoint(){vec2 cell=landEye/gridStep;return (floor(cell)+smoothstep(vec2(0.),vec2(1.),fract(cell)))*gridStep+position.xz;}`;
export class WetlandView{
 constructor(view,lighting){
  this.view=view;this.geometry=groundGrid();
  this.uniforms={...view.groundMaterial.uniforms,...Object.fromEntries(
   ['height0','height1','height2','bandMix','rings','ringCount','ringAttenuation','clipWaves','clipHeights','clipFloor'].map(k=>[k,view.uniforms[k]])),
   survey:{value:new T.Vector2()},landEye:{value:new T.Vector2()}};
  const bed=view.groundMaterial;
  this.terrain=new T.ShaderMaterial({uniforms:this.uniforms,
   vertexShader:wetlandGLSL+habitat+lattice+'varying vec2 duneSlope;\n'+bed.vertexShader
    .replace('worldPosition=(modelMatrix*vec4(position,1.)).xyz;', 'vec2 p0=landPoint();float h=landHeight(p0);float flatten=smoothstep(10.,60.,abs(cameraPosition.y))*smoothstep(38.,120.,length(p0-landEye));worldPosition=vec3(p0.x,h*(1.-flatten),p0.y);duneSlope=vec2(h-landHeight(p0+vec2(.3,0)),h-landHeight(p0+vec2(0,.3)))/.3;standCover=colony(p0,h);'),
   fragmentShader:wetlandGLSL+reflectedSurfaceClip+habitat+'varying vec2 duneSlope;\n'+bed.fragmentShader
    .replace('length(cameraPosition-p)*.003','length(cameraPosition-p)*.00013')
    .replace('vec3 prior=n;', `if(clipWaves&&belowReflector(p))discard;
     float span=max(length(dFdx(p.xz)),length(dFdy(p.xz)));
     float farMix=smoothstep(32.,110.,length(p.xz-cameraPosition.xz));
     float h=p.y;vec2 slope=duneSlope;float cover=standCover;
     if(farMix>0.){
      float exact=landHeight(p.xz),dx=clamp(span,.35,5.);
      slope=mix(slope,vec2(exact-landHeight(p.xz+vec2(dx,0)),exact-landHeight(p.xz+vec2(0,dx)))/dx,farMix);
      h=mix(h,exact,farMix);cover=mix(cover,colony(p.xz,h),farMix);
     }
     vec3 prior=n;`)
    .replace('vec3 prior=n;',`
    n=normalize(vec3(slope.x+n.x/n.y,1.,slope.y+n.z/n.y));
    float damp=1.-smoothstep(-.12,.84,h);
    base*=mix(vec3(1.),vec3(.51,.53,.44),damp);
    float remote=smoothstep(24.,66.,length(cameraPosition-p));
    base=mix(base,vec3(.11,.145,.055),cover*(.17+.62*remote));
    vec3 prior=n;`)
    .replace('vec2 finish=groundFinish(p.xz);',`if(farMix>0.){
      // Depth belongs to the ray through this pixel. A vertical correction
      // projects to another pixel and exposes whole coarse triangles at a bank.
      vec3 ray=p-cameraPosition;float delta=0.;
      if(abs(ray.y)>.001)delta=clamp((h-p.y)/ray.y,-.35,.35);
      vec3 at=mix(vec3(p.x,h,p.z),p+delta*ray,smoothstep(10.,60.,abs(cameraPosition.y)));
      vec4 d=projectionMatrix*viewMatrix*vec4(at,1.);
      gl_FragDepth=clamp(.5+.5*d.z/d.w,0.,1.);
     }vec2 finish=groundFinish(p.xz);`)});
  this.reeds=new WetlandReeds(view,lighting);
 }
 configure(land,library){
  this.land=land;this.uniforms.survey.value.set(land.x,land.z);
  const assets=reedFamily(library);
  const placed=library.world.instances.filter(i=>assets.some(a=>instancedReed(a)&&a.id===i.assetId));
  this.reeds.configure(assets,library.materials,placed);
  for(const i of placed)this.view.groups.get(i.id).visible=false;
 }
 update(view,wind,time){
  // Preserve enough depth precision to resolve a centimetre of water over a bank
  // when the orbit is kilometres above the terrain. Keep the close-up near plane.
  const near=Math.max(.03,(Math.abs(view.camera.position.y)-9)*.012);
  if(view.camera.near!==near){view.camera.near=near;view.camera.updateProjectionMatrix();}
  this.uniforms.landEye.value.set(view.camera.position.x,view.camera.position.z);
  this.reeds.update(this.land,view.camera,wind,time,view);
 }
 dispose(){this.geometry.dispose();this.terrain.dispose();this.reeds.dispose();}
}
