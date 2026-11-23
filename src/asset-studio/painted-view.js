import * as T from 'three';
import {markProfile,ribbonWidth,supportedMark} from './gaussian-marks.js';
import {reflectedSurfaceClip} from './wave-surface.js';

const sections=10, lanes=[-1,0,1];
const vertex=`
attribute vec2 lobe,profile;attribute vec3 root,axis,markUp,tint;attribute vec4 style,props;attribute float swing,highlight;
uniform vec2 viewport;
varying vec2 uvG;varying vec3 world,norm,base;varying vec4 finish;varying float extent,softDab;
void main(){
 float t=lobe.x, lane=lobe.y, len=style.x, kind=style.w;
 vec3 side=normalize(cross(axis,markUp));
 vec3 dir=axis*cos(swing)+markUp*sin(swing),up=normalize(cross(side,dir));
 float form=mix(sin(3.14159*pow(t,profile.x)),1.-t,profile.y);
 float width=len*style.y*(.07+.93*max(0.,form));
 float rise=style.z*t*t*.48;
 vec3 center=root+len*(dir*t+up*rise)+width*(lane*.49*side+abs(lane)*.055*up);
 vec3 tangent=normalize(dir+up*(style.z*t*.96)),across=normalize(side+up*(lane*.11));
 vec3 n=normalize(cross(across,tangent));
 // The three axes are the square root of this lobe's 3D covariance.
 mat3 mv=mat3(modelViewMatrix);
 vec3 A=mv*tangent*(len*.086),B=mv*across*(width*.39),C=mv*n*(len*.012);
 softDab=step(.5,kind);
 if(softDab>.5){
  // A dab is one oriented volume. Its curvature bends the rest axis at the root.
  tangent=normalize(dir+up*(style.z*.48));n=normalize(cross(side,tangent));
  center=root+tangent*len*.5;
  A=mv*tangent*(len*.23);B=mv*side*(len*style.y*.46);C=mv*n*(len*style.y*.30);
 }
 vec4 c=modelViewMatrix*vec4(center,1.);float z=max(.03,-c.z);
 vec3 jx=vec3(1.,0.,c.x/z)*(projectionMatrix[0][0]*viewport.x*.5/z);
 vec3 jy=vec3(0.,1.,c.y/z)*(projectionMatrix[1][1]*viewport.y*.5/z);
 vec3 px=vec3(dot(jx,A),dot(jx,B),dot(jx,C)),py=vec3(dot(jy,A),dot(jy,B),dot(jy,C));
 float a=dot(px,px)+.18,b=dot(px,py),d=dot(py,py)+.18;
 float mid=(a+d)*.5,delta=length(vec2((a-d)*.5,b)),theta=.5*atan(2.*b,a-d);
 vec2 u=vec2(cos(theta),sin(theta)),v=vec2(-u.y,u.x);
 uvG=position.xy*2.7;vec2 offset=u*sqrt(max(.1,mid+delta))*uvG.x+v*sqrt(max(.1,mid-delta))*uvG.y;
 vec4 clip=projectionMatrix*c;clip.xy+=offset*2./viewport*clip.w;
 gl_Position=c.z<-.03?clip:vec4(2.,2.,2.,1.);
 extent=max(length(mv*tangent)*len*.18,length(mv*across)*width*.9);
 norm=normalize(transpose(inverse(mat3(modelMatrix)))*n);world=(modelMatrix*vec4(center,1.)).xyz;
 base=tint*(.72+.28*t+.08*(1.-abs(lane)));
 base=mix(base,vec3(.15,.72,.84),.45*highlight);finish=props;
}`;
function geometry(records,materials){
 const g=new T.InstancedBufferGeometry(),positions=[],lobes=[],indices=[];
 const dab=records[0].mark.kind==='dab',count=dab?1:sections;
 for(let i=0;i<count;i++)for(const lane of dab?[0]:lanes){
   const first=positions.length/3;
   for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){positions.push(x,y,0);lobes.push((i+.5)/count,lane);}
   indices.push(first,first+1,first+2,first,first+2,first+3);
 }
 g.setIndex(indices);g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('lobe',new T.Float32BufferAttribute(lobes,2));
 const add=(name,size,values)=>g.setAttribute(name,new T.InstancedBufferAttribute(new Float32Array(values),size));
 const marks=records.map(r=>r.mark);
 for(const [name,key] of [['axis','axis'],['markUp','up'],['root','root']])add(name,3,marks.flatMap(m=>m[key]));
 add('profile',2,marks.flatMap(markProfile));
 add('style',4,marks.flatMap(m=>[m.length,m.width,m.curl,Number(m.kind==='dab')]));
 add('tint',3,marks.flatMap(m=>new T.Color(materials.get(m.materialId).color).toArray()));
 add('props',4,marks.flatMap(m=>{const p=materials.get(m.materialId);return [p.roughness,p.metallic,p.opacity,p.emission];}));
 add('highlight',1,records.map(()=>0));
 add('swing',1,records.map(r=>r.angle||0));g.attributes.swing.setUsage(T.DynamicDrawUsage);
 g.instanceCount=marks.length;g.boundingBox=new T.Box3();
 for(const m of marks){
   const root=new T.Vector3(...m.root),radius=1.8*m.length;
   g.boundingBox.union(new T.Box3(root.clone().addScalar(-radius),root.addScalar(radius)));
 }
 g.boundingSphere=g.boundingBox.getBoundingSphere(new T.Sphere());
 return g;
}

  export class PaintedView{
   constructor(uniforms,lighting){
    this.scene=new T.Scene();this.batches=[];
    this.shadowMaterial=new T.ShaderMaterial({colorWrite:false,depthWrite:true,depthTest:true,side:T.DoubleSide,
     vertexShader:`
      attribute vec2 lobe,profile;attribute vec3 root,axis,markUp;attribute vec4 style;attribute float swing;
      varying vec2 vG;
      void main(){
       float t=lobe.x, lane=lobe.y, len=style.x, kind=style.w;
       vec3 side=normalize(cross(axis,markUp));
       vec3 dir=axis*cos(swing)+markUp*sin(swing),up=normalize(cross(side,dir));
       float form=mix(sin(3.14159*pow(t,profile.x)),1.-t,profile.y);
       float width=len*style.y*(.07+.93*max(0.,form));
       float rise=style.z*t*t*.48;
       vec3 center=root+len*(dir*t+up*rise)+width*(lane*.49*side+abs(lane)*.055*up);
       vec3 tangent=normalize(dir+up*(style.z*t*.96)),across=normalize(side+up*(lane*.11));
       vec3 A=tangent*(len*.086),B=across*(width*.39);
       if(step(.5,kind)>.5){
        tangent=normalize(dir+up*(style.z*.48));
        center=root+tangent*len*.5;
        A=tangent*(len*.23);B=side*(len*style.y*.46);
       }
       vG=position.xy*1.4;
       vec3 localP=center+A*vG.x+B*vG.y;
       gl_Position=projectionMatrix*modelViewMatrix*vec4(localP,1.);
      }`,
     fragmentShader:'varying vec2 vG;void main(){if(dot(vG,vG)>1.5)discard;gl_FragColor=vec4(0.);}'
    });
    this.material=new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:lighting+reflectedSurfaceClip+`
   varying vec2 uvG;varying vec3 world,norm,base;varying vec4 finish;varying float extent,softDab;
   uniform vec2 viewport;uniform mat4 projectionMatrix;
   void main(){float w=exp(-.5*dot(uvG,uvG));float aa=clamp(fwidth(w),.002,.022);
    if(w<.09-aa||belowReflector(world))discard;
    vec3 vc=(viewMatrix*vec4(world,1.)).xyz,nv=mat3(viewMatrix)*norm;
    vec3 ray=vec3((2.*gl_FragCoord.xy/viewport-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.);
    float den=dot(ray,nv),depth=-vc.z;
    if(abs(den)>.0001)depth=clamp(dot(vc,nv)/den,depth-extent,depth+extent);
    vec4 clip=projectionMatrix*vec4(ray*max(.03,depth),1.);gl_FragDepth=.5+.5*clip.z/clip.w;
    vec3 n=normalize(norm);
    vec3 lit=shade(base,n,world,finish);
    // Diffuse light passes through thin blades. At grazing angles both faces
    // contribute, so neighboring lobes do not flip between light and dark.
    float grazing=1.-smoothstep(.02,.42,abs(dot(n,normalize(cameraPosition-world))));
    vec3 through=base*(.5*(env(n,1.)+env(-n,1.))+vec3(.49,.46,.4));
    lit=mix(lit,through,grazing*(1.-finish.y)*finish.x*.84);
    gl_FragColor=vec4(lit,finish.z*smoothstep(.09-aa,.09+aa,w)*mix(1.,w,softDab));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,transparent:true,depthWrite:true,side:T.DoubleSide,forceSinglePass:true});
  this.material.name='Studio painted Gaussian attachments';
 }
 clear(){this.clearPreview();for(const b of this.batches)b.mesh.geometry.dispose();this.batches=[];this.scene.clear();}
 rebuild(view,sim=null){
  this.clear();this.sim=sim;this.revision=sim?.paintedHinges?.revision;
  const materials=new Map(view.library.materials.map(m=>[m.id,m]));
  for(const [id,group] of view.groups){
   const asset=view.library.assets.find(a=>a.id===group.userData.assetId);
   for(const obj of group.children){
    const p=asset.parts.find(x=>x.id===obj.userData.partId);
    if(!p?.marks?.length)continue;
    const records=sim?sim.paintedHinges.parts.get(id+':'+p.id)||[]:
      p.marks.filter(m=>supportedMark(p,m,materials)).map(mark=>({mark}));
    const owners=new Map();
    for(const r of records){const key=r.owner||obj;if(!owners.has(key))owners.set(key,[]);owners.get(key).push(r);}
    for(const [owner,owned] of owners)for(const dab of [false,true]){
     const rows=owned.filter(r=>(r.mark.kind==='dab')===dab);if(!rows.length)continue;
     const mesh=new T.Mesh(geometry(rows,materials),this.material);mesh.matrixAutoUpdate=false;
     this.batches.push({mesh,owner,rows,id,part:p,assetId:asset.id});this.scene.add(mesh);
    }
   }
  }
  this.update(view,sim);this.highlightSelection();
 }
 update(view,sim){
  if(this.sim!==sim||this.revision!==sim?.paintedHinges?.revision)return this.rebuild(view,sim);
  for(const {mesh,owner,rows,id} of this.batches){
   mesh.visible=view.groups.get(id)?.visible!==false;
   if(!mesh.visible)continue;
   if(!sim)owner.updateWorldMatrix(true,false);
   mesh.matrix.copy(sim?owner.matrix:owner.matrixWorld);mesh.matrixWorldNeedsUpdate=true;
   const attr=mesh.geometry.attributes.swing;let dirty=false;
   for(let i=0;i<rows.length;i++){const v=Math.fround(rows[i].angle||0);if(attr.array[i]!==v){attr.array[i]=v;dirty=true;}}
   if(dirty)attr.needsUpdate=true;
  }
 }
 setMarkSwings(instanceId,swings){
  if(!swings)return;
  for(const b of this.batches){
   if(b.id!==instanceId)continue;
   for(let i=0;i<b.rows.length;i++){
    const angle=swings[b.rows[i].mark.id];
    if(angle!==undefined)b.rows[i].angle=angle;
   }
  }
 }
 select(partId,markId){
  if(this.selectedPart===partId&&this.selectedMark===markId)return;
  this.selectedPart=partId;this.selectedMark=markId;this.highlightSelection();
 }
 highlightSelection(){
  for(const b of this.batches){
   const a=b.mesh.geometry.attributes.highlight;
   for(let i=0;i<b.rows.length;i++){
    const selected=Number(!this.sim&&b.id==='editor'&&b.part.id===this.selectedPart&&b.rows[i].mark.id===this.selectedMark);
    if(a.array[i]!==selected){a.array[i]=selected;a.needsUpdate=true;}
   }
  }
 }
 // Test against the curled ribbon in root space. Picking uses the same length,
 // width profile and current hinge angle as the GPU-drawn footprint.
 pick(ray,nearest=null){
  const inverse=new T.Matrix4(),local=new T.Ray();
  for(const b of this.batches){
   if(!b.mesh.visible)continue;
   const matrix=b.mesh.matrix;local.copy(ray).applyMatrix4(inverse.copy(matrix).invert());
   if(!local.intersectsBox(b.mesh.geometry.boundingBox))continue;
   for(const {mark:m,angle=0,owner} of b.rows){
    const root=new T.Vector3(...m.root);
    if(local.distanceSqToPoint(root)>(1.8*m.length)**2)continue;
    const dir=new T.Vector3(...m.axis),up=new T.Vector3(...m.up),side=dir.clone().cross(up);
    dir.applyAxisAngle(side,angle);up.applyAxisAngle(side,angle);
    if(m.kind==='dab'){
     const tangent=dir.clone().addScaledVector(up,.48*m.curl).normalize(),n=side.clone().cross(tangent);
     const center=root.clone().addScaledVector(tangent,m.length*.5);
     const ellipsoid=new T.Matrix4().makeBasis(tangent.clone().multiplyScalar(.50*m.length),
      side.clone().multiplyScalar(m.length*m.width),n.clone().multiplyScalar(.66*m.length*m.width)).setPosition(center);
     const sphereRay=local.clone().applyMatrix4(ellipsoid.clone().invert());
     const surface=sphereRay.intersectSphere(new T.Sphere(new T.Vector3(),1),new T.Vector3());
     if(surface){
      const world=matrix.clone().multiply(ellipsoid),point=surface.clone().applyMatrix4(world),distance=point.distanceTo(ray.origin);
      if(!nearest||distance<nearest.distance)nearest={point,distance,mark:m,materialId:m.materialId,normal:surface.applyNormalMatrix(new T.Matrix3().getNormalMatrix(world)),partId:b.part.id,assetId:b.assetId,instanceId:b.id,bodyKey:owner?.key};
     }
     continue;
    }
    const [bias,taper]=markProfile(m);
    for(let i=0;i<sections;i++){
     const t=(i+.5)/sections, tangent=dir.clone().addScaledVector(up,m.curl*t*.96).normalize(),n=side.clone().cross(tangent);
     const center=root.clone().addScaledVector(dir,m.length*t).addScaledVector(up,m.length*m.curl*t*t*.48);
     const den=n.dot(local.direction);if(Math.abs(den)<1e-7)continue;
     const s=n.dot(center.clone().sub(local.origin))/den;if(s<0)continue;
     const point=local.at(s,new T.Vector3()),d=point.clone().sub(center);
     const form=ribbonWidth(t,bias,taper);
     if(Math.abs(d.dot(side))>m.length*m.width*(.07+.93*form)*1.12||Math.abs(d.dot(tangent))>m.length*.09)continue;
     point.applyMatrix4(matrix);const distance=point.distanceTo(ray.origin);
     if(!nearest||distance<nearest.distance)nearest={point,distance,mark:m,materialId:m.materialId,normal:n.applyNormalMatrix(new T.Matrix3().getNormalMatrix(matrix)),partId:b.part.id,assetId:b.assetId,instanceId:b.id,bodyKey:owner?.key};
    }
   }
  }
  return nearest;
 }
 preview(marks,object,materials){
  if(!marks?.length){this.clearPreview();return;}
  if(this.ghost?.geometry.instanceCount!==marks.length || this.ghostDab!==(marks[0].kind==='dab')){
   this.clearPreview();
   this.ghostDab=marks[0].kind==='dab';
   this.ghost=new T.Mesh(geometry(marks.map(mark=>({mark})),materials),this.material);
   this.ghost.frustumCulled=false;this.ghost.matrixAutoUpdate=false;this.scene.add(this.ghost);
  }else{
   const attr=this.ghost.geometry.attributes;
   marks.forEach((m,i)=>{
    attr.axis.setXYZ(i,...m.axis);attr.markUp.setXYZ(i,...m.up);
    attr.profile.setXY(i,...markProfile(m));
    attr.style.setXYZW(i,m.length,m.width,m.curl,Number(m.kind==='dab'));
   });
   for(const key of ['axis','markUp','style','profile'])attr[key].needsUpdate=true;
  }
  object.updateWorldMatrix(true,false);this.ghost.matrix.copy(object.matrixWorld);this.ghost.matrixWorldNeedsUpdate=true;
 }
 clearPreview(){if(this.ghost){this.ghost.removeFromParent();this.ghost.geometry.dispose();this.ghost=null;}}
  drawShadows(renderer,shadowCamera){
   if(!this.batches.length)return;
   let any=false;
   for(const b of this.batches)if(b.mesh.visible){b.mesh.material=this.shadowMaterial;any=true;}
   if(any)renderer.render(this.scene,shadowCamera);
   for(const b of this.batches)b.mesh.material=this.material;
  }
  dispose(){this.clearPreview();this.clear();this.material.dispose();this.shadowMaterial.dispose();}
 }
