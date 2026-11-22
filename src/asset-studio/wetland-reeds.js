import * as T from 'three';
import {REED_TILE} from './wetland.js';
import {markProfile,ribbonWidth} from './gaussian-marks.js';
import {MAX_ACTIVE_CROWNS,instancedReed,plantedCrown,reedPartMatrix} from './reed-stand.js';

const nearEnd=23,farEnd=115;
function crownGeometry(asset,materials,coarse){
 const positions=[],axes=[],sides=[],quads=[],colors=[],parts=[],roots=[],hingeAxes=[],indices=[];
 const color=id=>new T.Color(materials.find(m=>m.id===id)?.color??'#778349');
 for(const [index,p] of asset.parts.entries()){
  const m=reedPartMatrix(p),stem=p.stamps[0],length=2*stem.size[1];
  function lobe(start,end,width,side,tint,hinge=null){
   const from=start.clone().applyMatrix4(m),to=end.clone().applyMatrix4(m);
   const axis=to.clone().sub(from).multiplyScalar(.43);
   if(axis.lengthSq()<1e-9)return;
   const across=side.clone().transformDirection(m).multiplyScalar(width);
   const center=from.lerp(to,.5),first=positions.length/3;
   for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
    positions.push(...center.toArray());axes.push(...axis.toArray());sides.push(...across.toArray());
    roots.push(...(hinge?.root??[0,0,0]),hinge?.index??-1);hingeAxes.push(...(hinge?.side??[0,0,0]));
    quads.push(x,y);colors.push(...tint.toArray());parts.push(index);
   }
   indices.push(first,first+1,first+2,first,first+2,first+3);
  }
  const right=new T.Vector3(1,0,0),up=new T.Vector3(0,1,0);
  lobe(new T.Vector3(),up.clone().multiplyScalar(length),stem.size[0]*.65,right,color(stem.materialId));
  const plume=p.marks.filter(m=>m.id.startsWith('spikelet'));
  if(plume.length){
   const bottom=Math.min(...plume.map(m=>m.root[1]));
   lobe(up.clone().multiplyScalar(bottom),up.clone().multiplyScalar(length+.04),(length-bottom)*.13,right,color(plume[0].materialId));
  }
  for(const [j,mark] of p.marks.entries()){
   if(mark.id.startsWith('spikelet')&&(coarse||j%3!==0))continue;
   if(coarse&&j%2!==0)continue;
   const root=new T.Vector3(...mark.root),axis=new T.Vector3(...mark.axis),normal=new T.Vector3(...mark.up);
   const side=axis.clone().cross(normal).normalize(),profile=markProfile(mark),tint=color(mark.materialId);
   const hinge={index:j,root:root.clone().applyMatrix4(m).toArray(),side:side.clone().transformDirection(m).toArray()};
   const curve=t=>root.clone().addScaledVector(axis,mark.length*t).addScaledVector(normal,mark.length*mark.curl*.48*t*t);
   const divisions=coarse?2:5;
   for(let k=0;k<divisions;k++){
    const t=(k+.5)/divisions,width=mark.length*mark.width*(.07+.93*ribbonWidth(t,...profile));
    lobe(curve(k/divisions),curve((k+1)/divisions),width*(coarse?1.03:.66),side,tint,hinge);
   }
  }
 }
 const g=new T.InstancedBufferGeometry();g.setIndex(indices);
 for(const [key,data,n] of [['position',positions,3],['along',axes,3],['sideways',sides,3],['corner',quads,2],['tint',colors,3],['section',parts,1],['leafRoot',roots,4],['leafAxis',hingeAxes,3]])
  g.setAttribute(key,new T.Float32BufferAttribute(data,n));
 g.instanceCount=0;return g;
}

const reedVertex=`
 attribute vec3 along,sideways,tint;attribute vec2 corner;attribute vec4 site;
 attribute vec4 leafRoot;attribute vec3 leafAxis;attribute float section;attribute vec2 growthPose;
 uniform vec2 viewport,breeze;uniform float windClock,turbulence;uniform sampler2D poses,angles;
 varying vec2 gaussian;varying vec3 dye,normalW;varying float opacity,haze,elevation;
 vec3 turn(vec3 v,float c,float s){return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
 vec3 rotateLeaf(vec3 v,float c,float s){return c*v+cross(leafAxis,v)*s+leafAxis*dot(leafAxis,v)*(1.-c);}
 void main(){
  vec3 axis,width,world;float size=growthPose.x;
  float c=cos(site.w),s=sin(site.w),h=position.y*size;
  float phase=windClock*1.31-dot(site.xz,vec2(.09,-.06));
  vec3 bend=vec3(breeze.x,0.,breeze.y)*(.0078*(1.+turbulence*(.31*sin(phase)+.13*sin(2.13*phase+site.w))));
  world=site.xyz+turn(position,c,s)*size+bend*h*h;
  axis=(turn(along,c,s)+2.*bend*h*along.y)*size;width=turn(sideways,c,s)*size;
  if(growthPose.y>=0.){
   int row=int(growthPose.y+section);
   mat3 frame=mat3(texelFetch(poses,ivec2(0,row),0).xyz,texelFetch(poses,ivec2(1,row),0).xyz,texelFetch(poses,ivec2(2,row),0).xyz);
   vec4 shift=texelFetch(poses,ivec2(3,row),0);
   vec3 pos=position,d=along;
   if(leafRoot.w>=0.){
    float angle=texelFetch(angles,ivec2(int(leafRoot.w),row),0).r,co=cos(angle),si=sin(angle);
    pos=leafRoot.xyz+rotateLeaf(position-leafRoot.xyz,co,si);d=rotateLeaf(along,co,si);
   }
   world=mix(world,frame*pos+shift.xyz,shift.w);
   axis=mix(axis,frame*d,shift.w);width=mix(width,frame*sideways,shift.w);
  }
  float distanceToRoot=length(cameraPosition-site.xyz);
  float coarse=smoothstep(13.,${nearEnd.toFixed(1)},distanceToRoot);
  #ifdef COARSE_STAND
  float blend=coarse*(1.-smoothstep(65.,${farEnd.toFixed(1)},distanceToRoot));
  #else
  float blend=1.-coarse;
  #endif
  vec4 v=viewMatrix*vec4(world,1.);float z=-v.z;
  float reach=3.*(length(axis)+length(width));
  if(blend<=.001||z<.035||any(greaterThan(abs(v.xy),(z+reach)/vec2(projectionMatrix[0][0],projectionMatrix[1][1])+reach))){
   gl_Position=vec4(2.,2.,2.,1.);return;
  }
  vec3 third=normalize(cross(axis,width))*length(width)*.56;
  normalW=normalize(cross(width,axis));dye=tint;elevation=world.y;
  mat3 basis=mat3(viewMatrix)*mat3(axis,width,third);
  vec3 px=vec3(1.,0.,v.x/z)*basis*(.5*projectionMatrix[0][0]*viewport.x/z);
  vec3 py=vec3(0.,1.,v.y/z)*basis*(.5*projectionMatrix[1][1]*viewport.y/z);
  float xx=dot(px,px),yy=dot(py,py),xy=dot(px,py);
  float a=sqrt(xx+.24),b=xy/a;
  gaussian=corner*2.8;
  vec2 off=vec2(a*gaussian.x,b*gaussian.x+sqrt(max(.005,yy+.24-b*b))*gaussian.y);
  vec4 clip=projectionMatrix*v;clip.xy+=off*2./viewport*clip.w;gl_Position=clip;
  opacity=blend*smoothstep(.035,.08+reach,z)*clamp(sqrt(max(0.,xx*yy-xy*xy)/max(.0001,(xx+.24)*(yy+.24)-xy*xy)),.16,1.);
  haze=1.-exp(-distanceToRoot*.0014);
 }`;

export class WetlandReeds{
 constructor(view,lighting){
  this.poses=new T.DataTexture(new Float32Array(16),4,1,T.RGBAFormat,T.FloatType);
  this.angles=new T.DataTexture(new Float32Array(1),1,1,T.RedFormat,T.FloatType);
  this.uniforms={...view.uniforms,angles:{value:this.angles},poses:{value:this.poses},breeze:{value:new T.Vector2()},windClock:{value:0},turbulence:{value:0}};
  this.materials=[false,true].map(coarse=>new T.ShaderMaterial({uniforms:this.uniforms,defines:coarse?{COARSE_STAND:1}:{},
   vertexShader:reedVertex,fragmentShader:lighting+`
    varying vec2 gaussian;varying vec3 dye,normalW;varying float opacity,haze,elevation;uniform float clipFloor;
    void main(){
     if(elevation<clipFloor)discard;
     float weight=exp(-.5*dot(gaussian,gaussian));
     float cover=opacity*(1.-exp(-4.*weight));if(cover<.045)discard;
     vec3 n=normalize(normalW);vec3 lit=dye*(.5*(env(n,1.)+env(-n,1.))+.42+.32*abs(dot(n,normalize(vec3(-.6,1.,.5)))));
     gl_FragColor=vec4(mix(lit,vec3(.38,.45,.48),haze),cover);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`,transparent:true,side:T.DoubleSide,forceSinglePass:true}));
  this.frustum=new T.Frustum();this.vp=new T.Matrix4();this.bounds=new T.Box3();this.tiles=new Map();this.group=new T.Group();view.scene.add(this.group);
 }
 configure(assets,materials,placements){
  this.clear();this.instances=placements;this.assets=assets;this.placed=placements.map(p=>plantedCrown(p,assets.findIndex(a=>a?.id===p.assetId)));
  this.markIndices=assets.map(a=>a?.parts.map(p=>new Map(p.marks.map((mark,i)=>[mark.id,i]))));
  const columns=Math.max(1,...assets.flatMap(a=>a?.parts.map(p=>p.marks.length)??[]));
  const rows=Math.max(1,this.placed.reduce((sum,site)=>sum+assets[site.variant].parts.length,0)+MAX_ACTIVE_CROWNS*Math.max(0,...assets.map(a=>a?.parts.length??0)));
  this.poses.dispose();this.poses.image={data:new Float32Array(rows*16),width:4,height:rows};this.poses.needsUpdate=true;
  this.angles.dispose();this.angles.image={data:new Float32Array(columns*rows),width:columns,height:rows};this.angles.needsUpdate=true;
  this.inverseParts=assets.map(a=>instancedReed(a)?a.parts.map(p=>reedPartMatrix(p).invert()):[]);
  for(const [variant,a] of assets.entries())if(instancedReed(a))for(const [lod,material] of this.materials.entries()){
   const mesh=new T.Mesh(crownGeometry(a,materials,!!lod),material);mesh.userData={variant,lod};mesh.frustumCulled=false;this.group.add(mesh);
  }
 }
 uploadPoses(sim,view){
  const slots=new Map(),mat=new T.Matrix4(),liveKeys=new Set();let count=0;
  if(this.lastPhysics!==sim){this.filtered=new Map();this.lastPhysics=sim;this.lastTime=undefined;}
  this.filtered??=new Map();
  const dt=sim?Math.max(0,sim.time-(this.lastTime??sim.time)):0;
  this.lastTime=sim?.time;
  const alpha=-Math.expm1(-dt/.055);
  for(const site of [...this.placed,...Array.from(sim?.stand?.active.values()??[],s=>s.site)]){
   const parts=this.assets[site.variant]?.parts;
   const group=view.groups.get(site.id);
   if(!parts||!group&&!sim?.get(site.id,parts[0].id)||count+parts.length>this.poses.image.height)continue;
   group?.updateWorldMatrix(true,true);
   slots.set(site.id,count);
   const born=sim?.stand?.active.get(site.id)?.born??0;
   const blend=sim?1-Math.exp(-Math.max(0,sim.time-born)*8):1;
   for(const [j,p] of parts.entries()){
    const matrix=sim?.get(site.id,p.id)?.matrix??group.children[j].matrixWorld;
    mat.multiplyMatrices(matrix,this.inverseParts[site.variant][j]);
    // Averaging affine transforms with a common weight keeps neighbouring
    // section endpoints together while removing contact-frequency vibration.
    const key=site.id+':'+p.id,prior=this.filtered.get(key);
    if(sim&&prior)for(let i=0;i<16;i++)prior[i]+=(mat.elements[i]-prior[i])*alpha;
    const pose=prior??mat.elements;
    if(sim){liveKeys.add(key);if(!prior)this.filtered.set(key,pose.slice());}
    this.poses.image.data.set(pose,16*count);
    this.poses.image.data[16*count+15]=blend;
    const image=this.angles.image,offset=image.width*count;
    image.data.fill(0,offset,offset+p.marks.length);
    for(const h of sim?.paintedHinges.parts.get(site.id+':'+p.id)??[]){
     image.data[offset+this.markIndices[site.variant][j].get(h.mark.id)]=h.angle;
    }
    count++;
   }
  }
  for(const key of this.filtered.keys())if(!liveKeys.has(key))this.filtered.delete(key);
  if(count){this.poses.needsUpdate=true;this.angles.needsUpdate=true;}
  return slots;
 }
 update(land,eye,wind,time,view){
  const camera=eye.position,u=this.uniforms,angle=wind.heading*Math.PI/180;
  u.breeze.value.set(Math.cos(angle),Math.sin(angle)).multiplyScalar(28*Math.tanh(wind.speed/28)*(1-Math.exp(-2.4*time)));
  u.windClock.value=time;u.turbulence.value=wind.turbulence??0;
  const cx=Math.floor(camera.x/REED_TILE),cz=Math.floor(camera.z/REED_TILE);
  let moved=false;
  for(const [i,site] of this.placed.entries()){
   const pos=this.instances[i].transform.position;
   if(site.x!==pos[0]||site.y!==pos[1]||site.z!==pos[2]){
    [site.x,site.y,site.z]=pos;moved=true;
   }
  }
  if(moved){this.tiles.clear();this.signature=undefined;}
  const slots=this.uploadPoses(view.activePhysics,view);
  eye.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse));
  const keep=[],radius=Math.ceil((farEnd+4)/REED_TILE);
  if(camera.y<farEnd+10&&camera.y>-farEnd)for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){
   const x=cx+i,z=cz+j;
   this.bounds.min.set(x*REED_TILE-4,-6,z*REED_TILE-4);this.bounds.max.set((x+1)*REED_TILE+4,11,(z+1)*REED_TILE+4);
   const dist=this.bounds.distanceToPoint(camera);
   if(dist>farEnd||!this.frustum.intersectsBox(this.bounds))continue;
   const key=x+','+z;
   let tile=this.tiles.get(key);
   if(!tile){tile=land.crowns(x,z).filter(c=>this.placed.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>1.1));this.tiles.set(key,tile);}
   keep.push({key,tile,near:dist<nearEnd});
  }
  const signature=keep.map(t=>t.key+Number(t.near)).join('|')+'/'+[...slots.keys()].join('|');
  if(signature===this.signature)return;this.signature=signature;
  for(const key of this.tiles.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(cx-x)>radius||Math.abs(cz-z)>radius)this.tiles.delete(key);}
  const visible=this.placed.concat(keep.flatMap(t=>t.tile));
  this.visible=visible;
  for(const mesh of this.group.children){
   const {lod,variant}=mesh.userData,g=mesh.geometry;
   const rows=(lod?visible:this.placed.concat(keep.filter(t=>t.near).flatMap(t=>t.tile))).filter(s=>s.variant===variant);
   if(!g.attributes.site||g.attributes.site.count<rows.length){
    g.dispose();const capacity=2**Math.ceil(Math.log2(Math.max(16,rows.length)));
    g.setAttribute('site',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    g.setAttribute('growthPose',new T.InstancedBufferAttribute(new Float32Array(capacity*2),2));
   }
   rows.forEach((r,j)=>{g.attributes.site.setXYZW(j,r.x,r.y,r.z,r.yaw);g.attributes.growthPose.setXY(j,r.size,slots.get(r.id)??-1);});
   g.attributes.site.needsUpdate=g.attributes.growthPose.needsUpdate=true;g.instanceCount=rows.length;
  }
 }
 pick(ray,nearest,sim,includeMarks){
  const p=new T.Vector3(),q=new T.Vector3(),end=new T.Vector3(),start=new T.Vector3(),hit=new T.Vector3(),matrix=new T.Matrix4();
  for(const site of this.visible??[]){
   if(!this.inverseParts[site.variant]?.length)continue;
   p.set(site.x,site.y+site.size,site.z);
   if(ray.distanceSqToPoint(p)>9*site.size*site.size)continue;
   const cos=Math.cos(site.yaw),sin=Math.sin(site.yaw);
   const sitePoint=v=>{const x=v.x,z=v.z;v.set(site.x+site.size*(cos*x+sin*z),site.y+site.size*v.y,site.z+site.size*(-sin*x+cos*z));
    const h=v.y-site.y,phase=this.uniforms.windClock.value*1.31-site.x*.09+site.z*.06;
    const load=.0078*h*h*(1+this.uniforms.turbulence.value*(.31*Math.sin(phase)+.13*Math.sin(2.13*phase+site.yaw)));
    v.x+=load*this.uniforms.breeze.value.x;v.z+=load*this.uniforms.breeze.value.y;return v;};
   const asset=this.assets[site.variant];
   for(const [j,part] of asset.parts.entries()){
    const r=sim?.get(site.id,part.id),s=part.stamps[0];
    if(r)matrix.copy(r.matrix);else matrix.copy(this.inverseParts[site.variant][j]).invert();
    start.set(0,0,0).applyMatrix4(matrix);end.set(0,2*s.size[1],0).applyMatrix4(matrix);
    if(!r){sitePoint(start);sitePoint(end);}
    const d2=ray.distanceSqToSegment(start,end,hit,q);
    const accept=(d2,radius,mark=null)=>{
     if(d2>radius*radius)return;
     const distance=hit.distanceTo(ray.origin);if(nearest&&nearest.distance<=distance)return;
     nearest={point:hit.clone(),normal:hit.clone().sub(q).normalize(),distance,partId:part.id,mark,materialId:mark?.materialId??s.materialId,
      instanceId:site.id,reedSite:site,assetId:this.placed.some(s=>s.id===site.id)?asset.id:undefined};
    };
    accept(d2,s.size[0]*site.size+.025);
    if(!includeMarks)continue;
    const hinges=sim?.paintedHinges.parts.get(site.id+':'+part.id);
    const transform=v=>{v.applyMatrix4(matrix);return r?v:sitePoint(v);};
    for(const mark of part.marks){
     const root=new T.Vector3(...mark.root);
     if(ray.distanceSqToPoint(transform(start.copy(root)))>(1.8*mark.length*site.size)**2)continue;
     const angle=hinges?.find(h=>h.mark.id===mark.id)?.angle??0;
     const along=new T.Vector3(...mark.axis),up=new T.Vector3(...mark.up),side=along.clone().cross(up).normalize();
     along.applyAxisAngle(side,angle);up.applyAxisAngle(side,angle);
     const profile=markProfile(mark);
     for(let k=1;k<=4;k++){
      const t=k/4;
      transform(end.copy(root).addScaledVector(along,mark.length*t).addScaledVector(up,mark.length*mark.curl*.48*t*t));
      const width=site.size*mark.length*mark.width*ribbonWidth(t-.125,...profile);
      accept(ray.distanceSqToSegment(start,end,hit,q),Math.max(.012,width),mark);start.copy(end);
     }
    }
   }
  }
  return nearest;
 }
 clear(){for(const mesh of this.group.children)mesh.geometry.dispose();this.group.clear();this.tiles.clear();this.visible=[];this.filtered?.clear();this.signature=undefined;}
 dispose(){this.clear();this.poses.dispose();this.angles.dispose();for(const m of this.materials)m.dispose();this.group.removeFromParent();}
}
