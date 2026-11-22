import * as T from 'three';
import {ReedTransparency} from './reed-transparency.js';
import {waveHeight} from './wave-surface.js';
import {medium} from './water-optics.js';
import {REED_TILE} from './wetland.js';
import {markProfile,ribbonWidth} from './gaussian-marks.js';
import {MAX_ACTIVE_CROWNS,instancedReed,crownTransform,plantedCrown,reedPartMatrix} from './reed-stand.js';

const fineEnd=10,nearEnd=23,farEnd=115;
function crownGeometry(asset,materials,lod){
 const coarse=lod===2;
 const positions=[],axes=[],sides=[],quads=[],colors=[],parts=[],roots=[],hingeAxes=[],skins=[],indices=[];
 const color=id=>new T.Color(materials.find(m=>m.id===id)?.color??'#778349');
 for(const [index,p] of asset.parts.entries()){
  const m=reedPartMatrix(p),stem=p.stamps[0],length=2*stem.size[1];
  const child=asset.parts.findIndex(part=>part.joint?.parentId===p.id);
  const parent=asset.parts.findIndex(part=>part.id===p.joint?.parentId);
  function lobe(start,end,width,side,tint,hinge=null){
   const y=hinge?.mount??(start.y+end.y)*.5;
   const atBase=parent>=0&&(child<0||y<length*.5),neighbor=atBase?parent:child;
   const distance=atBase?y:length-y;
   const blend=neighbor<0?0:.5*(1-Math.min(1,Math.max(0,distance/(.36*length))))**2;
   const from=start.clone().applyMatrix4(m),to=end.clone().applyMatrix4(m);
   const axis=to.clone().sub(from).multiplyScalar(.64);
   if(axis.lengthSq()<1e-9)return;
   const across=side.clone().transformDirection(m).multiplyScalar(width);
   const center=from.lerp(to,.5),first=positions.length/3;
   for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
    positions.push(...center.toArray());axes.push(...axis.toArray());sides.push(...across.toArray());
    roots.push(...(hinge?.root??[0,0,0]),hinge?.index??-1);hingeAxes.push(...(hinge?.side??[0,0,0]));
    skins.push(Math.max(0,neighbor),blend,atBase?index:Math.max(0,child));
    quads.push(x,y);colors.push(...tint.toArray());parts.push(index);
   }
   indices.push(first,first+1,first+2,first,first+2,first+3);
  }
  const right=new T.Vector3(1,0,0),up=new T.Vector3(0,1,0);
  const cane=color(stem.materialId),husk=color('reed-husk');
  const sections=coarse?2:lod===1?4:10;
  for(let k=0;k<sections;k++){
   const t=(k+.5)/sections;
   lobe(up.clone().multiplyScalar(length*k/sections),up.clone().multiplyScalar(length*(k+1)/sections),
    stem.size[0]*(.57-.13*t),right,cane.clone().lerp(husk,(1-t)*.13));
  }
  if(!lod)for(const mark of p.marks){
   if(!mark.id.startsWith('leaf-'))continue;
   const y=mark.root[1],r=stem.size[0];
   lobe(up.clone().multiplyScalar(Math.max(0,y-.42*r)),up.clone().multiplyScalar(y+.42*r),
    r*.72,right,cane.clone().lerp(husk,.32));
  }
  for(const [j,mark] of p.marks.entries()){
   const spike=mark.id.startsWith('spikelet');
   if(coarse&&(spike?j%4!==0:j%2!==0)||lod===1&&spike&&j%2!==0)continue;
   const root=new T.Vector3(...mark.root),axis=new T.Vector3(...mark.axis),normal=new T.Vector3(...mark.up);
   const side=axis.clone().cross(normal).normalize(),profile=markProfile(mark),tint=color(mark.materialId);
   const hinge={index:j,mount:root.y,root:root.clone().applyMatrix4(m).toArray(),side:side.clone().transformDirection(m).toArray()};
   const curve=t=>root.clone().addScaledVector(axis,mark.length*t).addScaledVector(normal,mark.length*mark.curl*.48*t*t);
   const divisions=coarse?2:spike?(lod?1:3):lod?5:9;
   // A folded blade has two faces meeting at a pale midrib. Build them
   // along the same continuous ribbon as the painted asset in the editor.
   const lanes=lod||spike?[0]:[-1,0,1];
   const ribbon=(t,lane)=>{
    const w=mark.length*mark.width*(.045+.955*ribbonWidth(t,...profile));
    return curve(t).addScaledVector(side,lane*.56*w).addScaledVector(normal,Math.abs(lane)*.14*w);
   };
   if(spike&&!lod){
    // A narrow awn emerges from the grain at the end of each plume branch.
    const grain=curve(.77),tip=curve(1);
    lobe(grain,tip,mark.length*mark.width*.83,side,tint.clone().multiplyScalar(.68+.14*Math.cos(j*2.4)),hinge);
    lobe(tip,curve(1.16),mark.length*.008,side,tint.clone().lerp(cane,.24),hinge);
   }
   for(let k=0;k<divisions;k++)for(const lane of lanes){
    const t=(k+.5)/divisions,width=mark.length*mark.width*(.045+.955*ribbonWidth(t,...profile));
    const shade=tint.clone().multiplyScalar((.80+.20*t)*(lane<0?.84:lane>0?1.01:1.19));
    if(spike)shade.lerp(cane,.19*(1-t));
    const across=side.clone().addScaledVector(normal,lane*.22).normalize();
    lobe(ribbon(k/divisions,lane),ribbon((k+1)/divisions,lane),width*(lanes.length===1?.53:.31),across,shade,hinge);
   }
  }
 }
 const g=new T.InstancedBufferGeometry();g.setIndex(indices);
 for(const [key,data,n] of [['position',positions,3],['along',axes,3],['sideways',sides,3],['corner',quads,2],['tint',colors,3],['section',parts,1],['skin',skins,3],['leafRoot',roots,4],['leafAxis',hingeAxes,3]])
  g.setAttribute(key,new T.Float32BufferAttribute(data,n));
 g.instanceCount=0;return g;
}

const reedVertex=`
 attribute vec3 along,sideways,tint;attribute vec2 corner;attribute vec4 site;
 attribute vec4 leafRoot;attribute vec3 leafAxis,skin;attribute float section;attribute vec3 growthPose;
 uniform vec2 viewport;uniform sampler2D poses,angles;
 varying vec2 gaussian;varying vec3 dye,normalW,worldPoint;varying float coverageScale,haze,reedDepth;
 vec3 turn(vec3 v,float c,float s){return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
 vec3 rotateLeaf(vec3 v,float c,float s){return c*v+cross(leafAxis,v)*s+leafAxis*dot(leafAxis,v)*(1.-c);}
 mat3 basisAt(int row){return mat3(texelFetch(poses,ivec2(0,row),0).xyz,texelFetch(poses,ivec2(1,row),0).xyz,texelFetch(poses,ivec2(2,row),0).xyz);}
 void main(){
  float distanceToRoot=length(cameraPosition-site.xyz);
  float mid=smoothstep(6.,${fineEnd.toFixed(1)},distanceToRoot);
  float far=smoothstep(15.,${nearEnd.toFixed(1)},distanceToRoot);
  #if REED_LOD == 0
   float blend=1.-mid;
  #elif REED_LOD == 1
   float blend=mid*(1.-far);
  #else
   float blend=far*(1.-smoothstep(65.,${farEnd.toFixed(1)},distanceToRoot));
  #endif
  if(blend<=.001){gl_Position=vec4(2.,2.,2.,1.);return;}
  vec3 world=position,axis=along,width=sideways;float size=growthPose.x;
  float c=cos(site.w),s=sin(site.w);
  if(growthPose.y>=0.){
   int base=int(growthPose.y),row=base+int(section);
   mat3 frame=basisAt(row);vec3 shift=texelFetch(poses,ivec2(3,row),0).xyz;
   if(skin.y>0.&&texelFetch(poses,ivec2(3,base+int(skin.z)),0).w>.5){
    int next=base+int(skin.x);
    frame=frame*(1.-skin.y)+basisAt(next)*skin.y;
    shift=mix(shift,texelFetch(poses,ivec2(3,next),0).xyz,skin.y);
   }
   if(leafRoot.w>=0.){
    float angle=texelFetch(angles,ivec2(int(leafRoot.w),row),0).r,co=cos(angle),si=sin(angle);
    world=leafRoot.xyz+rotateLeaf(position-leafRoot.xyz,co,si);axis=rotateLeaf(along,co,si);width=rotateLeaf(sideways,co,si);
   }
   world=frame*world+shift;axis=frame*axis;width=frame*width;
  }
  if(growthPose.z<.5){
   world=site.xyz+turn(world,c,s)*size;axis=turn(axis,c,s)*size;width=turn(width,c,s)*size;
  }
  vec4 v=viewMatrix*vec4(world,1.);float z=-v.z;
  float reach=3.*(length(axis)+length(width));
  if(z<.035||any(greaterThan(abs(v.xy),(z+reach)/vec2(projectionMatrix[0][0],projectionMatrix[1][1])+reach))){
   gl_Position=vec4(2.,2.,2.,1.);return;
  }
  vec3 third=normalize(cross(axis,width))*length(width)*.56;
  normalW=normalize(cross(width,axis));dye=tint;
  mat3 basis=mat3(viewMatrix)*mat3(axis,width,third);
  vec3 px=vec3(1.,0.,v.x/z)*basis*(.5*projectionMatrix[0][0]*viewport.x/z);
  vec3 py=vec3(0.,1.,v.y/z)*basis*(.5*projectionMatrix[1][1]*viewport.y/z);
  float xx=dot(px,px),yy=dot(py,py),xy=dot(px,py);
  float a=sqrt(xx+.24),b=xy/a;
  gaussian=corner*2.8;
  float minor=sqrt(max(.005,yy+.24-b*b));
  vec2 off=vec2(a*gaussian.x,b*gaussian.x+minor*gaussian.y);
  // Conditional mean of the ellipsoid along the pixel ray. Its far end can
  // pass behind a solid even when the centre of a long blade is in front.
  worldPoint=world+mat3(axis,width,third)*(px*(gaussian.x/a)+(py-px*(b/a))*(gaussian.y/minor));
  vec4 clip=projectionMatrix*v;clip.xy+=off*2./viewport*clip.w;vec4 pointClip=projectionMatrix*viewMatrix*vec4(worldPoint,1.);
  reedDepth=pointClip.w;clip.z=pointClip.z/max(.03,reedDepth)*clip.w;gl_Position=clip;
  coverageScale=blend*smoothstep(.035,.08+reach,z)*clamp(sqrt(max(0.,xx*yy-xy*xy)/max(.0001,(xx+.24)*(yy+.24)-xy*xy)),.16,1.);
  haze=1.-exp(-distanceToRoot*.0014);
 }`;

export class WetlandReeds{
 constructor(view,lighting){
  this.poses=new T.DataTexture(new Float32Array(16),4,1,T.RGBAFormat,T.FloatType);
  this.angles=new T.DataTexture(new Float32Array(1),1,1,T.RedFormat,T.FloatType);
  this.uniforms={...view.oceanView.uniforms,...view.uniforms,angles:{value:this.angles},poses:{value:this.poses},reedWaterSide:{value:0},reedUnderwater:{value:false}};
  this.frustum=new T.Frustum();this.vp=new T.Matrix4();this.bounds=new T.Box3();this.tiles=new Map();this.group=new T.Scene();
  this.transparency=new ReedTransparency(this.group,this.uniforms,reedVertex,waveHeight,lighting+medium+`
   uniform bool reedUnderwater;
   vec3 reedLight(){
    vec3 n=normalize(normalW);
    vec3 lit=dye*(.5*(env(n,1.)+env(-n,1.))+.42+.32*abs(dot(n,normalize(vec3(-.6,1.,.5)))));
    lit=mix(lit,vec3(.38,.45,.48),haze);
    return reedUnderwater?inWater(lit,length(worldPoint-cameraPosition)):lit;
   }`);
 }
 draw(renderer,camera,side,underwater=false,base=null){
  this.transparency.draw(renderer,camera,side,underwater,base);
 }
 configure(assets,materials,placements){
  this.clear();this.instances=placements;this.assets=assets;this.placed=placements.map(p=>plantedCrown(p,assets.findIndex(a=>a?.id===p.assetId)));
  this.markIndices=assets.map(a=>a?.parts.map(p=>new Map(p.marks.map((mark,i)=>[mark.id,i]))));
  const columns=Math.max(1,...assets.flatMap(a=>a?.parts.map(p=>p.marks.length)??[]));
  const rows=Math.max(1,this.placed.reduce((sum,site)=>sum+assets[site.variant].parts.length,0)+(MAX_ACTIVE_CROWNS+Math.max(3,assets.length))*Math.max(0,...assets.map(a=>a?.parts.length??0)));
  this.poses.dispose();this.poses.image={data:new Float32Array(rows*16),width:4,height:rows};this.poses.needsUpdate=true;
  this.angles.dispose();this.angles.image={data:new Float32Array(columns*rows),width:columns,height:rows};this.angles.needsUpdate=true;
  this.inverseParts=assets.map(a=>instancedReed(a)?a.parts.map(p=>reedPartMatrix(p).invert()):[]);
  for(const [variant,a] of assets.entries())if(instancedReed(a))for(let lod=0;lod<3;lod++){
   const mesh=new T.Mesh(crownGeometry(a,materials,lod),null);mesh.userData={variant,lod};mesh.frustumCulled=false;this.group.add(mesh);
  }
 }
 uploadPoses(sim,camera){
  const slots=new Map(),mat=new T.Matrix4(),liveKeys=new Set();let count=0;
  if(this.lastPhysics!==sim){this.filtered=new Map();this.lastPhysics=sim;this.lastTime=undefined;}
  this.filtered??=new Map();
  const dt=sim?Math.max(0,sim.time-(this.lastTime??sim.time)):0;
  this.lastTime=sim?.time;
  const alpha=-Math.expm1(-dt/.055);
  const stand=sim?.stand;
  const samples=stand?.samples??[],local=[...(stand?.active.values()??[])];
  const parked=[...(stand?.parked.values()??[])].filter(({site})=>Math.hypot(site.x-camera.x,site.z-camera.z)<farEnd+5);
  const states=[...samples,...local,...parked],rows=states.reduce((sum,state)=>sum+this.assets[state.site.variant].parts.length,0);
  if(rows>this.poses.image.height)for(const tex of [this.poses,this.angles]){
   const channels=tex===this.poses?16:tex.image.width;
   tex.dispose();tex.image={width:tex.image.width,height:rows,data:new Float32Array(channels*rows)};
  }
  for(const state of states){
   const site=state.site,parts=this.assets[site.variant].parts,owner=state.inverse?stand.windWorld:sim;
   const sample=state.saved?stand.sample(site):null;
   slots.set(site.id,count);
   for(const [j,p] of parts.entries()){
    const saved=state.saved?.get(p.id);
    const record=saved??(sample?stand.windWorld.get(sample.site.id,p.id):owner.get(site.id,p.id));
    const matrix=record?.matrix??reedPartMatrix(p);
    mat.multiplyMatrices(matrix,this.inverseParts[site.variant][j]);
    if(state.inverse)mat.premultiply(state.inverse);
    if(sample&&!saved)mat.premultiply(sample.inverse).premultiply(crownTransform(site));
    // Averaging affine transforms with a common weight keeps neighbouring
    // section endpoints together while removing contact-frequency vibration.
    const key=site.id+':'+p.id,prior=this.filtered.get(key);
    if(sim&&prior)for(let i=0;i<16;i++)prior[i]+=(mat.elements[i]-prior[i])*alpha;
    const pose=prior??mat.elements;
    if(sim){liveKeys.add(key);if(!prior)this.filtered.set(key,pose.slice());}
    this.poses.image.data.set(pose,16*count);
    this.poses.image.data[16*count+15]=Number(!record?.jointBroken);
    const image=this.angles.image,offset=image.width*count;
    image.data.fill(0,offset,offset+p.marks.length);
    for(const h of saved?.hinges??(sample?stand.windWorld:owner).paintedHinges.parts.get(record?.key)??[]){
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
  const camera=eye.position,stand=view.activePhysics?.stand;
  const cx=Math.floor(camera.x/REED_TILE),cz=Math.floor(camera.z/REED_TILE);
  let moved=false;
  for(const [i,site] of this.placed.entries()){
   const t=this.instances[i].transform,pos=t.position,yaw=t.rotation[1]*Math.PI/180;
   if(site.x!==pos[0]||site.y!==pos[1]||site.z!==pos[2]||site.yaw!==yaw||site.size!==t.scale[1]){
    [site.x,site.y,site.z]=pos;site.yaw=yaw;site.size=t.scale[1];moved=true;
   }
  }
  if(moved){this.tiles.clear();this.signature=undefined;}
  const slots=this.uploadPoses(view.activePhysics,camera);
  eye.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse));
  const keep=[],radius=Math.ceil((farEnd+4)/REED_TILE);
  if(camera.y<farEnd+10&&camera.y>-farEnd)for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){
   const x=cx+i,z=cz+j;
   this.bounds.min.set(x*REED_TILE-4,-6,z*REED_TILE-4);this.bounds.max.set((x+1)*REED_TILE+4,11,(z+1)*REED_TILE+4);
   const dist=this.bounds.distanceToPoint(camera);
   if(dist>farEnd||!this.frustum.intersectsBox(this.bounds))continue;
   const key=x+','+z;
   let tile=this.tiles.get(key);
   if(!tile){tile=land.crowns(x,z,this.assets.length).filter(c=>this.placed.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>1.1));this.tiles.set(key,tile);}
   keep.push({key,tile});
  }
  const signature=[camera.x,camera.y,camera.z].map(Math.floor).join(',')+'/'+keep.map(t=>t.key).join('|')+'/'+[...slots.keys()].join('|');
  if(signature===this.signature)return;this.signature=signature;
  for(const key of this.tiles.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(cx-x)>radius||Math.abs(cz-z)>radius)this.tiles.delete(key);}
  const visible=this.placed.concat(keep.flatMap(t=>t.tile));
  this.visible=visible;
  for(const mesh of this.group.children){
   const {lod,variant}=mesh.userData,g=mesh.geometry;
   // The one-metre camera cell can shift by up to its diagonal before the
   // batches rebuild. Overlap that margin; the shader does the exact fade.
   const rows=visible.filter(s=>{
    if(s.variant!==variant)return false;
    const d=Math.hypot(s.x-camera.x,s.y-camera.y,s.z-camera.z);
    return lod===0?d<fineEnd+2:lod===1?d>4&&d<nearEnd+2:d>13&&d<farEnd+2;
   });
   if(!g.attributes.site||g.attributes.site.count<rows.length){
    g.dispose();const capacity=2**Math.ceil(Math.log2(Math.max(16,rows.length)));
    g.setAttribute('site',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    g.setAttribute('growthPose',new T.InstancedBufferAttribute(new Float32Array(capacity*3),3));
   }
   rows.forEach((r,j)=>{g.attributes.site.setXYZW(j,r.x,r.y,r.z,r.yaw);const active=slots.has(r.id),sample=active?null:stand?.sample(r);
    g.attributes.growthPose.setXYZ(j,r.size,slots.get(active?r.id:sample?.site.id)??-1,Number(active));});
   g.attributes.site.needsUpdate=g.attributes.growthPose.needsUpdate=true;g.instanceCount=rows.length;
  }
 }
 pick(ray,nearest,sim,includeMarks){
  const p=new T.Vector3(),q=new T.Vector3(),end=new T.Vector3(),start=new T.Vector3(),hit=new T.Vector3(),matrix=new T.Matrix4();
  for(const site of this.visible??[]){
   if(!this.inverseParts[site.variant]?.length)continue;
   p.set(site.x,site.y+site.size,site.z);
   if(ray.distanceSqToPoint(p)>9*site.size*site.size&&!sim?.stand?.active.has(site.id)&&!sim?.stand?.parked.has(site.id))continue;
   const asset=this.assets[site.variant];
   for(const [j,part] of asset.parts.entries()){
    const r=sim?.get(site.id,part.id),s=part.stamps[0];
    if(sim?.stand)sim.stand.pose(site,part,matrix);
    else matrix.multiplyMatrices(crownTransform(site),reedPartMatrix(part));
    start.set(0,0,0).applyMatrix4(matrix);end.set(0,2*s.size[1],0).applyMatrix4(matrix);
    const d2=ray.distanceSqToSegment(start,end,hit,q);
    const accept=(d2,radius,mark=null)=>{
     if(d2>radius*radius)return;
     const distance=hit.distanceTo(ray.origin);if(nearest&&nearest.distance<=distance)return;
     nearest={point:hit.clone(),normal:hit.clone().sub(q).normalize(),distance,partId:part.id,mark,materialId:mark?.materialId??s.materialId,
      instanceId:site.id,reedSite:site,assetId:this.placed.some(s=>s.id===site.id)?asset.id:undefined};
    };
    accept(d2,s.size[0]*site.size+.025);
    if(!includeMarks)continue;
    const sample=r?null:sim?.stand?.sample(site);
    const hinges=r?sim.paintedHinges.parts.get(r.key):sim?.stand?.parked.get(site.id)?.saved.get(part.id)?.hinges??sim?.stand?.windWorld?.paintedHinges.parts.get(sample?.site.id+':'+part.id);
    const transform=v=>v.applyMatrix4(matrix);
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
 dispose(){this.clear();this.poses.dispose();this.angles.dispose();this.transparency.dispose();this.group.removeFromParent();}
}
