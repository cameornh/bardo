// Landscape crowns reuse the authored geometry of the five growth stages.
// Each curved blade is sampled with a few elongated 3D Gaussian lobes.
// Instance records contain only a root, a heading and a growth scale.
import * as T from 'three';
import {REED_TILE} from './wetland.js';

function crownGeometry(asset,materials){
 const positions=[],axes=[],sides=[],quads=[],colors=[],indices=[];
 function lobe(from,to,width,color){
  const along=to.clone().sub(from),length=along.length();if(length<.001)return;
  const center=from.clone().lerp(to,.5),side=new T.Vector3(along.z,0,-along.x);
  if(side.lengthSq()<1e-7)side.set(1,0,0);
  side.setLength(width);along.multiplyScalar(.27);
  const index=positions.length/3;
  for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
   positions.push(...center.toArray());axes.push(...along.toArray());sides.push(...side.toArray());
   quads.push(x,y);colors.push(color.r,color.g,color.b);
  }
  indices.push(index,index+1,index+2,index,index+2,index+3);
 }
 const color=id=>new T.Color(materials.find(m=>m.id===id)?.color??'#778349');
 for(const part of asset.parts){
  const stem=part.stamps[0],length=2*stem.size[1];
  const origin=new T.Vector3(...part.transform.position);
  const rotation=new T.Quaternion().setFromEuler(new T.Euler(...part.transform.rotation.map(T.MathUtils.degToRad)));
  const world=p=>p.applyQuaternion(rotation).add(origin);
  const start=new T.Vector3(),tip=new T.Vector3(0,length,0);
  for(let i=0;i<3;i++)lobe(world(start.clone().lerp(tip,i/3)),world(start.clone().lerp(tip,(i+1)/3)),stem.size[0]*.56,color(stem.materialId));
  const plume=part.marks.filter(m=>m.id.startsWith('spikelet'));
  if(plume.length){
   const bottom=Math.min(...plume.map(m=>m.root[1]));
   lobe(world(new T.Vector3(0,bottom,0)),world(new T.Vector3(0,length+.04,0)),(length-bottom)*.14,color('reed-husk'));
  }
  for(const m of part.marks){
   if(m.id.startsWith('spikelet'))continue;
   const curve=t=>world(new T.Vector3(...m.root).addScaledVector(new T.Vector3(...m.axis),m.length*t)
    .addScaledVector(new T.Vector3(...m.up),m.length*m.curl*.48*t*t));
   for(let i=0;i<3;i++)lobe(curve(i/3),curve((i+1)/3),m.width*m.length*(i===2?.28:.47),color(m.materialId));
  }
 }
 const g=new T.InstancedBufferGeometry();g.setIndex(indices);
 for(const [key,data,n] of [['position',positions,3],['along',axes,3],['sideways',sides,3],['corner',quads,2],['tint',colors,3]])
  g.setAttribute(key,new T.Float32BufferAttribute(data,n));
 g.instanceCount=0;return g;
}
const reedVertex=`
 attribute vec3 along,sideways,tint;attribute vec2 corner;attribute vec4 site;attribute float growth;
 uniform vec2 viewport,breeze;uniform float windClock,turbulence;
 varying vec2 gaussian;varying vec3 dye,normalW;varying float opacity,haze;
 vec3 turn(vec3 v,float c,float s){return vec3(c*v.x-s*v.z,v.y,s*v.x+c*v.z);}
 void main(){
  float c=cos(site.w),s=sin(site.w),h=position.y*growth;
  float phase=windClock*1.31-dot(site.xz,vec2(.09,-.06));
  float load=(1.+turbulence*(.31*sin(phase)+.13*sin(2.13*phase+site.w)))*.0078;
  vec3 bend=vec3(breeze.x,0.,breeze.y)*load;
  vec3 world=site.xyz+turn(position,c,s)*growth+bend*h*h;
  vec3 axis=(turn(along,c,s)+2.*bend*h*along.y)*growth;
  vec3 width=turn(sideways,c,s)*growth;
  vec3 third=normalize(cross(axis,width))*length(width)*.48;
  normalW=normalize(cross(width,axis));dye=tint;
  vec4 v=viewMatrix*vec4(world,1.);float z=-v.z;
  // The perspective Jacobian is only local. Reject volumes outside the
  // view cone before dividing by depth, especially beside the camera plane.
  float reach=3.*(length(axis)+length(width));
  if(z<.035||any(greaterThan(abs(v.xy),(z+reach)/vec2(projectionMatrix[0][0],projectionMatrix[1][1])+reach))){
   gl_Position=vec4(2.,2.,2.,1.);return;
  }
  mat3 basis=mat3(viewMatrix)*mat3(axis,width,third);
  vec3 px=vec3(1.,0.,v.x/z)*basis*(.5*projectionMatrix[0][0]*viewport.x/z);
  vec3 py=vec3(0.,1.,v.y/z)*basis*(.5*projectionMatrix[1][1]*viewport.y/z);
  float xx=dot(px,px),yy=dot(py,py),xy=dot(px,py);
  float a=sqrt(xx+.18),b=xy/a;
  gaussian=corner*2.6;
  vec2 off=vec2(a*gaussian.x,b*gaussian.x+sqrt(max(.005,yy+.18-b*b))*gaussian.y);
  vec4 clip=projectionMatrix*v;clip.xy+=off*2./viewport*clip.w;
  gl_Position=v.z<-.035?clip:vec4(2.,2.,2.,1.);
  float distanceToRoot=length(cameraPosition-site.xyz);
  opacity=smoothstep(.035,.08+reach,z)*(1.-smoothstep(45.,65.,distanceToRoot))*clamp(sqrt(max(0.,xx*yy-xy*xy)/max(.0001,(xx+.18)*(yy+.18)-xy*xy)),.14,1.);
  haze=1.-exp(-distanceToRoot*.005);
 }`;
export class WetlandReeds{
 constructor(view,lighting){
  this.material=new T.ShaderMaterial({uniforms:{...view.uniforms,breeze:{value:new T.Vector2()},windClock:{value:0},turbulence:{value:0}},
   vertexShader:reedVertex,fragmentShader:lighting+`
    varying vec2 gaussian;varying vec3 dye,normalW;varying float opacity,haze;
    void main(){
     float weight=exp(-.5*dot(gaussian,gaussian));
     float cover=1.-exp(-2.65*opacity*smoothstep(.06,.64,weight));if(cover<.035)discard;
     vec3 n=normalize(normalW);vec3 lit=dye*(.5*(env(n,1.)+env(-n,1.))+.42+.32*abs(dot(n,normalize(vec3(-.6,1.,.5)))));
     gl_FragColor=vec4(mix(lit,vec3(.38,.45,.48),haze),cover);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`,transparent:true,side:T.DoubleSide,forceSinglePass:true});
  this.frustum=new T.Frustum();this.vp=new T.Matrix4();this.bounds=new T.Box3();this.tiles=new Map();this.group=new T.Group();view.scene.add(this.group);
 }
 configure(assets,materials,placements){
  this.clear();this.placements=placements;
  for(const a of assets){
   const mesh=new T.Mesh(crownGeometry(a,materials),this.material);mesh.frustumCulled=false;this.group.add(mesh);
  }
 }
 update(land,eye,wind,time){
  const camera=eye.position;
  const u=this.material.uniforms,angle=wind.heading*Math.PI/180;
  u.breeze.value.set(Math.cos(angle),Math.sin(angle)).multiplyScalar(28*Math.tanh(wind.speed/28)*(1-Math.exp(-2.4*time)));
  u.windClock.value=time;u.turbulence.value=wind.turbulence??0;
  const cx=Math.floor(camera.x/REED_TILE),cz=Math.floor(camera.z/REED_TILE);
  eye.updateMatrixWorld();
  this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse));
  const sites=this.group.children.map(()=>[]),keep=new Set(),radius=4;
  for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){
   const x=cx+i,z=cz+j;
   this.bounds.min.set(x*REED_TILE-4,-6,z*REED_TILE-4);this.bounds.max.set((x+1)*REED_TILE+4,11,(z+1)*REED_TILE+4);
   if(this.bounds.distanceToPoint(camera)>66||!this.frustum.intersectsBox(this.bounds))continue;
   const key=x+','+z;keep.add(key);
   let tile=this.tiles.get(key);
   if(!tile){tile=land.crowns(x,z).filter(crown=>this.placements.every(p=>Math.hypot(p[0]-crown.x,p[2]-crown.z)>1.1));this.tiles.set(key,tile);}
  }
  const signature=[...keep].join('|');if(signature===this.signature)return;this.signature=signature;
  for(const [key,tile] of this.tiles){
   if(keep.has(key)){for(const crown of tile)sites[crown.variant%sites.length]?.push(crown);}
   else{const [x,z]=key.split(',').map(Number);if(Math.abs(cx-x)>radius||Math.abs(cz-z)>radius)this.tiles.delete(key);}
  }
  for(let i=0;i<sites.length;i++){
   const g=this.group.children[i].geometry,rows=sites[i];
   if((g.attributes.site?.count??0)<rows.length||!g.attributes.site){
    // Reallocate rarely. Release the old GPU buffers before replacing attributes.
    g.dispose();const capacity=2**Math.ceil(Math.log2(Math.max(16,rows.length)));
    g.setAttribute('site',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    g.setAttribute('growth',new T.InstancedBufferAttribute(new Float32Array(capacity),1));
   }
   rows.forEach((r,j)=>{g.attributes.site.setXYZW(j,r.x,r.y-.025,r.z,r.yaw);g.attributes.growth.setX(j,r.size);});
   g.attributes.site.needsUpdate=g.attributes.growth.needsUpdate=true;g.instanceCount=rows.length;
  }
 }
 clear(){for(const mesh of this.group.children)mesh.geometry.dispose();this.group.clear();this.tiles.clear();this.signature=undefined;}
 dispose(){this.clear();this.material.dispose();this.group.removeFromParent();}
}
