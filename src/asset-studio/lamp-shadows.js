// Six perspective depth views per light share one sampler across all receivers.
import {DepthTexture,NearestFilter,PerspectiveCamera,UnsignedIntType,Vector3,WebGLRenderTarget} from 'three';
export const MAX_LAMPS=8;
const SIZE=160,NEAR=.025;
const axes=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export const lampShadowGLSL=`
uniform sampler2D studioLampAtlas;
uniform float studioLampRange[${MAX_LAMPS}];
uniform vec3 studioLampShadowOrigin[${MAX_LAMPS}];
float lampShadow(int index,vec3 point,vec3 n){
 float farZ=studioLampRange[index];if(farZ<=0.)return 1.;
 vec3 ray=point-studioLampShadowOrigin[index];
 ray+=n*(.002+length(ray)*.6/${SIZE}.);
 vec3 a=abs(ray);float face,z;vec2 uv;
 if(a.x>=max(a.y,a.z)){z=a.x;face=ray.x>0.?0.:1.;uv=vec2(ray.x>0.?-ray.z:ray.z,-ray.y);}
 else if(a.y>=a.z){z=a.y;face=ray.y>0.?2.:3.;uv=vec2(ray.x,ray.y>0.?ray.z:-ray.z);}
 else{z=a.z;face=ray.z>0.?4.:5.;uv=vec2(ray.z>0.?ray.x:-ray.x,-ray.y);}
 if(z<=${NEAR}||z>=farZ)return 1.;
 vec2 pixel=(uv/z*.5+.5)*${SIZE}.-.5,base=floor(pixel),f=fract(pixel);
 // Adjacent samples on a tilted receiver lie at different depths within a texel.
 float incidence=abs(dot(normalize(ray),n));
 float bias=.003+z*(.0015+1.5/${SIZE}.*(1.-incidence)/max(.2,incidence));
 float depth=farZ/(farZ-${NEAR})*(1.-${NEAR}/max(${NEAR},z-bias));
 float visibility=0.;
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){
  vec2 local=clamp(base+vec2(i,j),vec2(0.),vec2(${SIZE-1}.));
  vec2 address=(vec2(face,float(index))*${SIZE}.+local+.5)/vec2(${6*SIZE}.,${SIZE*MAX_LAMPS}.);
  float weight=(i==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y);
  visibility+=weight*step(depth,texture2D(studioLampAtlas,address).r);
 }
 return visibility;
}`;
export class LampShadows{
 constructor(){
  this.cam=new PerspectiveCamera(90,1,NEAR,64);this.look=new Vector3();this.slots=[];this.next=0;
 }
 update(view,casters){
  const u=view.shadowUniforms,lamps=view.activeLamps,count=lamps.length;
  if(!count){this.slots.length=0;return;}
  if(!this.atlas){
   this.atlas=new WebGLRenderTarget(SIZE*6,SIZE*MAX_LAMPS,{minFilter:NearestFilter,magFilter:NearestFilter});
   this.atlas.depthTexture=new DepthTexture(SIZE*6,SIZE*MAX_LAMPS,UnsignedIntType);
   this.atlas.scissorTest=true;
  }
  // Asset tracks and staging can move a blocker even with physics paused.
  view.assetScene.updateMatrixWorld(true);
  for(const group of view.groups.values())for(const part of group.children){
   if(!part.shadowPose?.equals(part.matrixWorld)||part.shadowVisible!==part.visible){
    part.shadowPose??=part.matrixWorld.clone();part.shadowPose.copy(part.matrixWorld);part.shadowVisible=part.visible;
    view.shadowRevision=(view.shadowRevision??0)+1;
   }
  }
  const revisions=view.shadowRevision??0,simTime=view.activePhysics?.time??-1;
  let chosen=-1;
  for(let k=0;k<count;k++){
   const i=(this.next+k)%count,slot=this.slots[i],lamp=lamps[i],p=u.studioLampPosition.value[i];
   const moved=!slot||slot.lamp!==lamp||slot.origin.distanceToSquared(p)>.000025;
   if(!slot||slot.lamp!==lamp)u.studioLampRange.value[i]=0;
   if(chosen<0&&(moved||slot.version!==revisions||slot.time!==simTime||view.gizmo.dragging))chosen=i;
  }
  this.slots.length=count;
  if(chosen<0)return;
  const i=chosen,lamp=lamps[i],p=u.studioLampPosition.value[i],cam=this.cam,renderer=view.renderer;
  const far=Math.max(12,Math.sqrt(p.w)*100),previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
  const visible=lamp.object.visible,priorEye=view.uniforms.cameraWorld.value;
  u.studioLampAtlas.value=casters.fallbackTex; // Avoid reading an attached depth texture.
  cam.far=far;cam.updateProjectionMatrix();cam.position.set(p.x,p.y,p.z);
  lamp.object.visible=false;
  try{
   for(let f=0;f<6;f++){
    const [x,y,z]=axes[f];cam.up.set(0,y?0:-1,y);
    cam.lookAt(this.look.set(x,y,z).add(cam.position));cam.updateMatrixWorld(true);
    view.uniforms.cameraWorld.value=cam.matrixWorld;
    this.atlas.viewport.set(f*SIZE,i*SIZE,SIZE,SIZE);this.atlas.scissor.copy(this.atlas.viewport);
    renderer.setRenderTarget(this.atlas);renderer.clear();renderer.autoClear=false;
    casters.drawCasters(view,cam,!!view.garden,Math.min(far,24),lamp.object);
   }
  }finally{
   lamp.object.visible=visible;view.uniforms.cameraWorld.value=priorEye;
   renderer.setRenderTarget(previous);renderer.autoClear=autoClear;
   u.studioLampAtlas.value=this.atlas.depthTexture;
  }
  u.studioLampShadowOrigin.value[i].copy(cam.position);
  u.studioLampRange.value[i]=far;
  this.slots[i]={lamp,origin:cam.position.clone(),time:simTime,version:revisions};
  this.next=(i+1)%count;
 }
 dispose(){this.atlas?.dispose();}
}
