import * as T from 'three';
import {ReedTransparency} from './reed-transparency.js';
import {waveHeight} from './wave-surface.js';
import {medium} from './water-optics.js';
import {REED_TILE} from './wetland.js';
import {SPECIES_BY_ID} from './coastal-flora.js';
import {
 HORIZON_TILE,
 cameraCoarseningFactor,
 fitCovarianceEllipsoids,
 fnvTiles,
 horizonStandsForCell,
 isPrimaryCoastalMark,
 lodRangesForMaxDist
} from './coastal-lod.js';
import {markProfile,ribbonWidth} from './gaussian-marks.js';
import {MAX_ACTIVE_CROWNS,instancedReed,crownTransform,plantedCrown,reedPartMatrix} from './reed-stand.js';

const fineEnd=18,nearEnd=52,farEnd=280;

function emptyLobeGeometry(){
 const g=new T.InstancedBufferGeometry();
 g.setIndex([]);
 for(const [key,n] of [['position',3],['along',3],['sideways',3],['quadLod',4],['tint',3],['foliageOptics',3],['skin',4],['leafRoot',4],['leafAxis',3]])
  g.setAttribute(key,new T.Float32BufferAttribute([],n));
 g.instanceCount=0;
 return g;
}

function horizonQuadGeometry(){
 const g=new T.InstancedBufferGeometry();
 g.setIndex([0,1,2,0,2,3]);
 const zeros3=new Float32Array(12),zeros4=new Float32Array(16),roots=new Float32Array(16).fill(-1);
 for(let i=0;i<4;i++){roots[i*4]=0;roots[i*4+1]=0;roots[i*4+2]=0;}
 g.setAttribute('position',new T.Float32BufferAttribute(zeros3,3));
 g.setAttribute('along',new T.Float32BufferAttribute([0,1,0,0,1,0,0,1,0,0,1,0],3));
 g.setAttribute('sideways',new T.Float32BufferAttribute([1,0,0,1,0,0,1,0,0,1,0,0],3));
 g.setAttribute('quadLod',new T.Float32BufferAttribute([-1,-1,0,0.82,1,-1,0,0.82,1,1,0,0.82,-1,1,0,0.82],4));
 g.setAttribute('tint',new T.Float32BufferAttribute([1,1,1,1,1,1,1,1,1,1,1,1],3));
 g.setAttribute('foliageOptics',new T.Float32BufferAttribute([0.26,0.85,0.80,0.26,0.85,0.80,0.26,0.85,0.80,0.26,0.85,0.80],3));
 g.setAttribute('skin',new T.Float32BufferAttribute(zeros4,4));
 g.setAttribute('leafRoot',new T.Float32BufferAttribute(roots,4));
 g.setAttribute('leafAxis',new T.Float32BufferAttribute(zeros3,3));
 g.instanceCount=0;
 return g;
}

function covarianceGeometry(asset,materials){
 const ellipsoids=fitCovarianceEllipsoids(asset,materials);
 if(!ellipsoids.length)return emptyLobeGeometry();
 const positions=[],axes=[],sides=[],quadLods=[],colors=[],optics=[],roots=[],hingeAxes=[],skins=[],indices=[];
 for(const e of ellipsoids){
  const first=positions.length/3;
  for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
   positions.push(...e.center);
   axes.push(...e.axis);
   sides.push(...e.width);
   quadLods.push(x,y,e.densityScale??1,e.soft);
   colors.push(...e.tint);
   optics.push(e.translucency,e.ao,e.thirdRatio);
   skins.push(0,0,0,0);
   roots.push(0,0,0,-1);
   hingeAxes.push(0,0,0);
  }
  indices.push(first,first+1,first+2,first,first+2,first+3);
 }
 const g=new T.InstancedBufferGeometry();g.setIndex(indices);
 for(const [key,data,n] of [['position',positions,3],['along',axes,3],['sideways',sides,3],['quadLod',quadLods,4],['tint',colors,3],['foliageOptics',optics,3],['skin',skins,4],['leafRoot',roots,4],['leafAxis',hingeAxes,3]])
  g.setAttribute(key,new T.Float32BufferAttribute(data,n));
 g.instanceCount=0;return g;
}

function crownGeometry(asset,materials,lod){
 if(lod===3)return horizonQuadGeometry();
 const coastalCrown=asset.parts.some(p=>p.marks?.length>1);
 if(lod===2&&coastalCrown)return covarianceGeometry(asset,materials);
 const coarse=lod===2;
 const positions=[],axes=[],sides=[],quadLods=[],colors=[],optics=[],roots=[],hingeAxes=[],skins=[],indices=[],secondaryIndices=[];
 const matMap=new Map(materials.map(m=>[m.id,m]));
 const color=id=>new T.Color(matMap.get(id)?.color??'#778349');

 // Estimate crown vertical span for subtle basal self-occlusion gradient without altering
 // single-segment diagnostic shapes (where crownSpan is tiny or single part).
 let crownTop=0.5;
 for(const p of asset.parts){
  const m=reedPartMatrix(p),stem=p.stamps[0],L=2*stem.size[1];
  const tip=new T.Vector3(0,L,0).applyMatrix4(m);
  crownTop=Math.max(crownTop,tip.y);
 }
 const useAO=coastalCrown;
 const useTint=useAO;

 for(const [index,p] of asset.parts.entries()){
  const m=reedPartMatrix(p),stem=p.stamps[0],length=2*stem.size[1];
  const children=asset.parts.filter(part=>part.joint?.parentId===p.id);
  const child=children.length===1?asset.parts.indexOf(children[0]):-1;
  const parent=asset.parts.findIndex(part=>part.id===p.joint?.parentId);
  function lobe(start,end,width,side,tint,hinge=null,translucency=0,thick=0.56,fadeAt=0,growTo=1){
   const y=hinge?.mount??(start.y+end.y)*.5;
   const atBase=parent>=0&&(child<0||y<length*.5),neighbor=atBase?parent:child;
   const distance=atBase?y:length-y;
   const blend=neighbor<0?0:.5*(1-Math.min(1,Math.max(0,distance/(.36*length))))**2;
   const from=start.clone().applyMatrix4(m),to=end.clone().applyMatrix4(m);
   const axis=to.clone().sub(from).multiplyScalar(coastalCrown?.54:.64);
   if(axis.lengthSq()<1e-9)return;
   const across=side.clone().transformDirection(m).multiplyScalar(width);
   const center=from.lerp(to,.5),first=positions.length/3;
   const ao=coastalCrown?(.72+.24*Math.min(1,Math.max(0,center.y/crownTop))):1.0;
   for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
    positions.push(...center.toArray());axes.push(...axis.toArray());sides.push(...across.toArray());
    roots.push(...(hinge?.root??[0,0,0]),hinge?.index??-1);hingeAxes.push(...(hinge?.side??[0,0,0]));
    skins.push(Math.max(0,neighbor),blend,atBase?index:Math.max(0,child),index);
    quadLods.push(x,y,fadeAt,growTo);colors.push(...tint.toArray());optics.push(translucency,ao,thick);
   }
   const target=coastalCrown&&lod===0&&fadeAt>0.005?secondaryIndices:indices;
   target.push(first,first+1,first+2,first,first+2,first+3);
  }
  const right=new T.Vector3(1,0,0),up=new T.Vector3(0,1,0);
  const cane=color(stem.materialId),basalTone=useTint?cane.clone().multiplyScalar(.82):cane;
  const isWoody=stem.materialId==='pine-bark'||stem.materialId==='scrub-bark'||stem.materialId==='palm-trunk';
  const sections=coastalCrown?(lod===1?(isWoody?2:3):(isWoody?4:5)):(coarse?2:lod===1?4:10);
  const stemBaseW=coastalCrown&&lod===1?(isWoody?1.06:1.18):1.0;
  const stemGrow=coastalCrown?(lod===0?(isWoody?1.06:1.18):lod===1?1.12:1.0):1.0;
  for(let k=0;k<sections;k++){
   const t=(k+.5)/sections;
   lobe(up.clone().multiplyScalar(length*k/sections),up.clone().multiplyScalar(length*(k+1)/sections),
    stem.size[0]*(isWoody?(.64-.05*t):(.57-.13*t))*stemBaseW,right,cane.clone().lerp(basalTone,(1-t)*.55),null,0,.56,0,stemGrow);
  }
  if(!lod)for(const mark of p.marks){
   if(!mark.id.startsWith('leaf-'))continue;
   const y=mark.root[1],r=stem.size[0];
   lobe(up.clone().multiplyScalar(Math.max(0,y-.42*r)),up.clone().multiplyScalar(y+.42*r),
    r*.72,right,cane.clone().lerp(basalTone,.35),null,0,.58,coastalCrown?0.35:0,1);
  }
  for(const [j,mark] of p.marks.entries()){
   const isDab=mark.kind==='dab';
   const spike=mark.id.startsWith('spikelet')||mark.id.startsWith('oat-')||mark.id.startsWith('panicle-');
   const isWoodyLeaf=mark.materialId==='oak-leaf'||mark.materialId==='pine-needle'||mark.materialId==='myrtle-leaf'||mark.materialId==='rosemary-needle';
   const primary=isPrimaryCoastalMark(mark,j);
   if(coastalCrown){
    if(lod===1&&!primary)continue;
   }else{
    if(coarse&&(spike?j%3!==0:j%2!==0)||lod===1&&spike&&j%2!==0)continue;
   }
   const secondaryFade=0.14+0.80*(((j*0.381966011+0.17)%1));
   const root=new T.Vector3(...mark.root),axis=new T.Vector3(...mark.axis),normal=new T.Vector3(...mark.up);
   const side=axis.clone().cross(normal).normalize(),profile=markProfile(mark),tint=color(mark.materialId);
   const markMat=matMap.get(mark.materialId);
   const rough=markMat?.roughness??0.7;
   const hinge={index:j,mount:root.y,root:root.clone().applyMatrix4(m).toArray(),side:side.clone().transformDirection(m).toArray()};
   if(isDab){
    const tangent=axis.clone().addScaledVector(normal,.48*mark.curl).normalize();
    const n=side.clone().cross(tangent).normalize();
    const tip=root.clone().addScaledVector(tangent,mark.length);
    const trans=coastalCrown?(rough<0.55?0.26:0.16):0.0;
    const baseScale=coastalCrown&&lod===1?1.08:0.76;
    const halfW=mark.length*mark.width*baseScale;
    const fadeAt=coastalCrown&&lod===0&&!primary?secondaryFade:0;
    const growTo=coastalCrown?(lod===0?(primary?1.42:1.0):1.18):1.0;
    lobe(root,tip,halfW,side,tint.clone().multiplyScalar(.96+.08*Math.cos(j*1.7)),hinge,trans,.58,fadeAt,growTo);
    if(!lod&&mark.width>.48){
     lobe(root,tip,halfW*.58,n,tint.clone().multiplyScalar(.92),hinge,trans,.58,coastalCrown?0.45:0,1);
    }
    continue;
   }
   const curve=t=>root.clone().addScaledVector(axis,mark.length*t).addScaledVector(normal,mark.length*mark.curl*.48*t*t);
   const narrowMark=isWoodyLeaf||mark.materialId==='rush-stem'||mark.id.startsWith('areole-')||mark.id.startsWith('plate-')||mark.id.startsWith('buttress-');
   const divisions=coastalCrown?(lod===1?(spike||isWoodyLeaf||narrowMark?1:2):(spike||isWoodyLeaf||narrowMark?2:3)):(coarse?2:spike?(lod?1:3):lod?5:9);
   const lanes=lod||spike||(coastalCrown&&narrowMark)?[0]:[-1,0,1];
   const ribbon=(t,lane)=>{
    const w=mark.length*mark.width*(.045+.955*ribbonWidth(t,...profile));
    return curve(t).addScaledVector(side,lane*.56*w).addScaledVector(normal,Math.abs(lane)*.14*w);
   };
   const trans=coastalCrown?(spike?0.52:(rough<0.60?0.36:0.46)):0.0;
   if(spike&&!lod){
    const grain=curve(.77),tip=curve(1);
    const spFade=coastalCrown?(primary?0.55:secondaryFade):0;
    lobe(grain,tip,mark.length*mark.width*.83,side,tint.clone().multiplyScalar(.74+.14*Math.cos(j*2.4)),hinge,trans,.56,spFade,1);
    lobe(tip,curve(1.16),mark.length*.008,side,tint.clone().lerp(cane,.24),hinge,trans,.56,spFade,1);
   }
   const singleLaneTarget=coastalCrown&&lod===1?1.56:1.0;
   const broadCenterMatch=0.56/0.31;
   for(let k=0;k<divisions;k++)for(const lane of lanes){
    const t=(k+.5)/divisions;
    const laneMult=lanes.length===1?(coastalCrown?.56*singleLaneTarget:.53):.31;
    const width=mark.length*mark.width*(.045+.955*ribbonWidth(t,...profile));
    const shade=tint.clone().multiplyScalar((.80+.20*t)*(lane<0?.84:lane>0?1.01:1.19));
    if(spike)shade.lerp(cane,.19*(1-t));
    const across=side.clone().addScaledVector(normal,lane*.22).normalize();
    let fadeAt=0,growTo=1;
    if(coastalCrown){
     if(lod===0){
      const isCenterPrimary=primary&&lane===0;
      if(isCenterPrimary){
       fadeAt=0;
       growTo=lanes.length===1?1.56:broadCenterMatch*1.48;
      }else{
       fadeAt=lane!==0?Math.min(0.88,0.22+0.36*(k/Math.max(1,divisions-1))):secondaryFade;
       growTo=1.0;
      }
     }else if(lod===1){
      fadeAt=0;
      growTo=1.18;
     }
    }
    lobe(ribbon(k/divisions,lane),ribbon((k+1)/divisions,lane),width*laneMult,across,shade,hinge,trans,.56,fadeAt,growTo);
   }
  }
 }
 const primaryCount=indices.length;
 const allIndices=secondaryIndices.length?indices.concat(secondaryIndices):indices;
 const g=new T.InstancedBufferGeometry();g.setIndex(allIndices);
 for(const [key,data,n] of [['position',positions,3],['along',axes,3],['sideways',sides,3],['quadLod',quadLods,4],['tint',colors,3],['foliageOptics',optics,3],['skin',skins,4],['leafRoot',roots,4],['leafAxis',hingeAxes,3]])
  g.setAttribute(key,new T.Float32BufferAttribute(data,n));
 g.userData.primaryIndexCount=coastalCrown&&lod===0?primaryCount:0;
 g.userData.fullIndexCount=allIndices.length;
 g.instanceCount=0;return g;
}

const reedVertex=`
 attribute vec3 along,sideways,tint,foliageOptics,leafAxis,growthPose;
 attribute vec4 quadLod,skin,leafRoot,site,siteTrait,siteSlope;
 uniform vec2 viewport,clipHeights;uniform float reedWindTime,lodSpeedScale;uniform vec4 horizonWind;uniform int reedWaterSide;uniform bool reedMirrorPass;uniform sampler2D poses,angles;
 varying vec2 gaussian;varying vec3 worldPoint;varying float coverageScale,reedDepth,vSoft;
 #if !defined(REED_RANGE_ONLY) && !defined(REED_LIGHT_VERT)
 varying vec3 dye,normalW,vOptics;varying float haze;
 #endif
 #ifdef REED_LIGHT_VERT
 varying vec3 vLit;
 #endif
 vec3 turn(vec3 v,float c,float s){return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
 vec3 rotateLeaf(vec3 v,float c,float s){return c*v+cross(leafAxis,v)*s+leafAxis*dot(leafAxis,v)*(1.-c);}
 mat3 basisAt(int row){return mat3(texelFetch(poses,ivec2(0,row),0).xyz,texelFetch(poses,ivec2(1,row),0).xyz,texelFetch(poses,ivec2(2,row),0).xyz);}
 float perceptualFade(float t){return t<=0.?0.:-log(max(.045,1.-.95*clamp(t,0.,1.)))/2.9957323;}
 void main(){
  float distanceToRoot=length(cameraPosition-site.xyz);
  #ifndef REED_RANGE_ONLY
   vec3 nW,dCol,optics;
  #endif
  #if REED_LOD == 3
   float tIn=perceptualFade(smoothstep(220.,355.,distanceToRoot));
   float tOut=perceptualFade(1.-smoothstep(760.,1150.,distanceToRoot));
   float hIntact=clamp(horizonWind.w,.22,1.);
   float effHalfH=growthPose.y*mix(.42,1.,hIntact);
   float effRadXZ=growthPose.x*mix(.58,1.,hIntact);
   float blend=tIn*tOut*max(.15,growthPose.z)*mix(.42,1.,hIntact);
   if(blend<=.001){gl_Position=vec4(2.,2.,2.,1.);return;}
   vec2 leanVec=vec2(siteSlope.x,siteSlope.y)+horizonWind.xy*horizonWind.z;
   vec3 world=site.xyz+vec3(horizonWind.x*horizonWind.z*effHalfH*.4,(effHalfH-growthPose.y)*.45,horizonWind.y*horizonWind.z*effHalfH*.4);
   vec3 axis=vec3(leanVec.x*effHalfH,effHalfH,leanVec.y*effHalfH);
   vec3 width=vec3(cos(site.w),0.,sin(site.w))*effRadXZ;
   vec3 third=normalize(cross(axis,width))*length(width)*siteSlope.z;
   float reach=3.*(length(axis)+length(width));
   if(reedWaterSide<0 && world.y-reach>clipHeights.y){gl_Position=vec4(2.,2.,2.,1.);return;}
   vSoft=clamp(siteSlope.w,.20,.94);
   #ifndef REED_RANGE_ONLY
    nW=normalize(mix(normalize(cross(width,axis)),vec3(0.,1.,0.),.35*vSoft));
    dCol=siteTrait.yzw;
    optics=vec3(.26,siteTrait.x,siteSlope.z);
   #endif
  #else
   if(reedWaterSide<0 && site.y>clipHeights.y+.65){gl_Position=vec4(2.,2.,2.,1.);return;}
   float maxRange=siteTrait.w>1.?siteTrait.w:${farEnd.toFixed(1)};
   float treeF=clamp((maxRange-195.)/175.,0.,1.);
   float effDist=distanceToRoot*max(1.,lodSpeedScale);
   float dFine=mix(7.,12.,treeF);
   float d01Lo=mix(14.,24.,treeF),d01Hi=mix(24.,40.,treeF);
   float d12Lo=mix(38.,64.,treeF),d12Hi=mix(64.,104.,treeF);
   float t01=smoothstep(d01Lo,d01Hi,effDist);
   float t12=smoothstep(d12Lo,d12Hi,effDist);
   float tOut=perceptualFade(1.-smoothstep(maxRange*.68,maxRange,distanceToRoot));
   float widthGrow=1.;
   #if REED_LOD == 0
    float detailProg=reedMirrorPass?1.:smoothstep(dFine,d01Lo,effDist);
    float fineVis=quadLod.z>.005?perceptualFade(1.-smoothstep(max(0.,quadLod.z-.24),min(1.,quadLod.z+.08),detailProg)):1.;
    if(quadLod.z<=.005)widthGrow=mix(1.,quadLod.w,detailProg);
    float blend=(1.-t01)*fineVis;
    vSoft=0.;
   #elif REED_LOD == 1
    widthGrow=mix(1.,quadLod.w,smoothstep(d01Hi,d12Lo,effDist));
    float blend=t01*(1.-t12);
    vSoft=.14*t12;
   #else
    float blend=t12*tOut*max(.08,quadLod.z);
    vSoft=quadLod.w;
   #endif
   if(blend<=.001){gl_Position=vec4(2.,2.,2.,1.);return;}
   vec3 world=position,axis=along,width=sideways*widthGrow;float size=growthPose.x;
   float c=cos(site.w),s=sin(site.w);
   #if REED_LOD < 2
    if(growthPose.y>=0.){
     int base=int(growthPose.y),row=base+int(skin.w);
     mat3 frame=basisAt(row);vec3 shift=texelFetch(poses,ivec2(3,row),0).xyz;
     if(skin.y>0.&&texelFetch(poses,ivec2(3,base+int(skin.z)),0).w>.5){
      int next=base+int(skin.x);
      frame=frame*(1.-skin.y)+basisAt(next)*skin.y;
      shift=mix(shift,texelFetch(poses,ivec2(3,next),0).xyz,skin.y);
     }
     if(leafRoot.w>=0.){
      float angle=texelFetch(angles,ivec2(int(leafRoot.w),row),0).r,co=cos(angle),si=sin(angle);
      world=leafRoot.xyz+rotateLeaf(position-leafRoot.xyz,co,si);axis=rotateLeaf(along,co,si);width=rotateLeaf(width,co,si);
     }
     world=frame*world+shift;axis=frame*axis;width=frame*width;
    }
    if(growthPose.z<.5){
     if(foliageOptics.y<.98){
      float seedA=fract(sin(dot(site.xz,vec2(127.1,311.7)))*43758.5453);
      float seedB=fract(seedA*17.31);
      float scaleXZ=.88+.24*seedA,scaleY=.90+.20*seedB;
      world.xz*=scaleXZ;axis.xz*=scaleXZ;width.xz*=scaleXZ;
      world.y*=scaleY;axis.y*=scaleY;width.y*=scaleY;
     }
     world=site.xyz+turn(world,c,s)*size;axis=turn(axis,c,s)*size;width=turn(width,c,s)*size;
     float relH=max(0.,world.y-site.y);
     if(siteSlope.w>.01){
      world.y+=((world.x-site.x)*siteSlope.x+(world.z-site.z)*siteSlope.y)*siteSlope.w;
     }
     float sway=.05*sin(reedWindTime*2.1+site.x*.45+site.z*.37);
     world.xz+=siteTrait.yz*(relH*relH*.13+relH*sway);
    }
   #else
    float intactF=clamp(growthPose.y,.14,1.);
    float hCollapse=clamp(growthPose.z,.22,1.);
    if(foliageOptics.y<.98){
     float seedA=fract(sin(dot(site.xz,vec2(127.1,311.7)))*43758.5453);
     float seedB=fract(seedA*17.31);
     float scaleXZ=.88+.24*seedA,scaleY=.90+.20*seedB;
     world.xz*=scaleXZ;axis.xz*=scaleXZ;width.xz*=scaleXZ;
     world.y*=scaleY;axis.y*=scaleY;width.y*=scaleY;
    }
    world.y*=hCollapse;axis.y*=hCollapse;width.y*=hCollapse;
    float radialF=mix(.52,1.,intactF);
    width.xz*=radialF;axis.xz*=radialF;
    world=site.xyz+turn(world,c,s)*size;axis=turn(axis,c,s)*size;width=turn(width,c,s)*size;
    float relH=max(0.,world.y-site.y);
    if(siteSlope.w>.01){
     world.y+=((world.x-site.x)*siteSlope.x+(world.z-site.z)*siteSlope.y)*siteSlope.w;
    }
    float sway=.05*sin(reedWindTime*2.1+site.x*.45+site.z*.37);
    world.xz+=siteTrait.yz*(relH*relH*.13+relH*(.22+sway));
    axis.xz+=siteTrait.yz*(.24*length(axis));
    blend*=mix(.34,1.,intactF);
   #endif
   vec3 third=normalize(cross(axis,width))*length(width)*foliageOptics.z;
   float reach=3.*(length(axis)+length(width));
   if(reedWaterSide<0 && world.y-reach>clipHeights.y){gl_Position=vec4(2.,2.,2.,1.);return;}
   if(reedMirrorPass && world.y+reach<clipHeights.x-.012){gl_Position=vec4(2.,2.,2.,1.);return;}
   #ifndef REED_RANGE_ONLY
    nW=normalize(cross(width,axis));
    #if REED_LOD == 2
     if(vSoft>.35){
      vec3 outUp=normalize(vec3(world.x-site.x,max(.35,world.y-site.y),world.z-site.z));
      nW=normalize(mix(nW,outUp,.55*vSoft));
     }
    #endif
    float vit=siteTrait.x>0.?siteTrait.x:1.;
    vec3 vitShift=mix(vec3(1.06,1.00,.84),vec3(.96,1.03,.97),clamp((vit-.7)/.45,0.,1.))*clamp(vit,.80,1.14);
    vec3 hueTint=vec3(1.+siteSlope.z*.55,1.+siteSlope.z*.20,1.-siteSlope.z*.60);
    dCol=tint*(abs(vit-1.)<.001?vec3(1.):vitShift)*hueTint;
    optics=foliageOptics;
   #endif
  #endif
  vec4 v=viewMatrix*vec4(world,1.);float z=-v.z;
  if(z<.035||any(greaterThan(abs(v.xy),(z+reach)/vec2(projectionMatrix[0][0],projectionMatrix[1][1])+reach))){
   gl_Position=vec4(2.,2.,2.,1.);return;
  }
  mat3 basis=mat3(viewMatrix)*mat3(axis,width,third);
  vec3 px=vec3(1.,0.,v.x/z)*basis*(.5*projectionMatrix[0][0]*viewport.x/z);
  vec3 py=vec3(0.,1.,v.y/z)*basis*(.5*projectionMatrix[1][1]*viewport.y/z);
  float xx=dot(px,px),yy=dot(py,py),xy=dot(px,py);
  float a=sqrt(xx+.24),b=xy/a;
  #ifdef CRISP_FOLIAGE
   float softC=clamp(vSoft,0.,1.);
   float kurtC=mix(.75,.04,softC);
   float cutC=mix(.045,.018,softC);
   float gBound=sqrt((-1.+sqrt(1.-8.*kurtC*log(cutC)))/(2.*kurtC))+.04;
   gaussian=quadLod.xy*gBound;
  #else
   gaussian=quadLod.xy*2.8;
  #endif
  float minor=sqrt(max(.005,yy+.24-b*b));
  vec2 off=vec2(a*gaussian.x,b*gaussian.x+minor*gaussian.y);
  // Conditional mean of the ellipsoid along the pixel ray. Its far end can
  // pass behind a solid even when the centre of a long blade is in front.
  worldPoint=world+mat3(axis,width,third)*(px*(gaussian.x/a)+(py-px*(b/a))*(gaussian.y/minor));
  vec4 clip=projectionMatrix*v;clip.xy+=off*2./viewport*clip.w;vec4 pointClip=projectionMatrix*viewMatrix*vec4(worldPoint,1.);
  reedDepth=pointClip.w;clip.z=pointClip.z/max(.03,reedDepth)*clip.w;gl_Position=clip;
  #ifdef CRISP_FOLIAGE
   float ewa=clamp(sqrt(max(0.,xx*yy-xy*xy)/max(.0001,(xx+.24)*(yy+.24)-xy*xy)),.07,1.);
   #ifndef REED_RANGE_ONLY
    float hazeV=1.-exp(-distanceToRoot*.00028);
   #endif
  #else
   float ewa=clamp(sqrt(max(0.,xx*yy-xy*xy)/max(.0001,(xx+.24)*(yy+.24)-xy*xy)),.16,1.);
   #ifndef REED_RANGE_ONLY
    float hazeV=optics.y>.99&&optics.x<.01?1.-exp(-distanceToRoot*.0014):1.-exp(-distanceToRoot*.00065);
   #endif
  #endif
  #ifdef REED_LIGHT_VERT
   vec3 nL=normalize(nW);
   vec3 sunD=normalize(sunDirection);
   vec3 viewDir=normalize(cameraPosition-worldPoint);
   vec3 nFace=faceforward(nL,-viewDir,nL);
   float ndl=max(0.,dot(nFace,sunD));
   float wrapLight=.5*dot(nL,sunD)+.5;
   float trans=optics.x,ao=optics.y;
   vec3 diffuseEnv=.5*(env(nL,1.)+env(-nL,1.))*ao;
   float backLit=pow(max(0.,dot(viewDir,-sunD)),2.4)*trans*(.45+.55*wrapLight);
   vec3 sunSpec=sunColor*pow(max(0.,dot(nFace,normalize(sunD+viewDir))),26.)*(.04+.08*(1.-trans));
   float sunOcc=mix(.32,1.,sampleSunShadow(worldPoint,nFace));
   vec3 lit=dCol*(diffuseEnv+sunColor*(ndl*(.34+.28*wrapLight)+backLit*.52)*sunOcc)+sunSpec*sunOcc;
   vLit=mix(lit,hazeColor,hazeV);
  #elif !defined(REED_RANGE_ONLY)
   normalW=nW;dye=dCol;vOptics=optics;haze=hazeV;
  #endif
  coverageScale=blend*smoothstep(.035,.08+reach,z)*ewa;
 }`;

export class WetlandReeds{
 constructor(view,lighting){
  this.poses=new T.DataTexture(new Float32Array(16),4,1,T.RGBAFormat,T.FloatType);
  this.angles=new T.DataTexture(new Float32Array(1),1,1,T.RedFormat,T.FloatType);
  this.uniforms={
   ...view.oceanView.uniforms,
   ...view.uniforms,
   sunDirection:view.uniforms.sunDirection??{value:new T.Vector3(-.6,1,.5).normalize()},
   sunColor:view.uniforms.sunColor??{value:new T.Color(1.1,1.02,.88)},
   hazeColor:view.uniforms.hazeColor??{value:new T.Color(.38,.45,.48)},
   coastalWater:view.oceanView.uniforms?.coastalWater??{value:new T.Vector4(0,10.5,0,0)},
   reedWindTime:{value:0},
   lodSpeedScale:{value:1},
   horizonWind:{value:new T.Vector4(0,0,0,1)},
   angles:{value:this.angles},
   poses:{value:this.poses},
   reedWaterSide:{value:0},
   reedUnderwater:{value:false},
   reedMirrorPass:{value:false}
  };
  this.frustum=new T.Frustum();this.vp=new T.Matrix4();this.bounds=new T.Box3();
  this.tiles=new Map();this.macroTiles=new Map();this.horizonTiles=new Map();
  this.disturbedSites=new Map();this._lastSandVersion=0;
  this.group=new T.Scene();
  const hasLightingSun=lighting.includes('sunDirection');
  this.transparency=new ReedTransparency(this.group,this.uniforms,reedVertex,waveHeight,lighting+medium+`
   uniform bool reedUnderwater;
   uniform vec3 hazeColor;
   ${hasLightingSun?'':'uniform vec3 sunDirection,sunColor;'}
   #ifdef REED_LIGHT_VERT
   varying vec3 vLit;
   vec3 reedLight(){
    return reedUnderwater?inWater(vLit,length(worldPoint-cameraPosition)):vLit;
   }
   #else
   varying vec3 vOptics;
   vec3 reedLight(){
    vec3 n=normalize(normalW);
    ${hasLightingSun?`
    vec3 sunD=normalize(sunDirection);
    vec3 viewDir=normalize(cameraPosition-worldPoint);
    vec3 nFace=faceforward(n,-viewDir,n);
    float ndl=max(0.,dot(nFace,sunD));
    float wrapLight=.5*dot(n,sunD)+.5;
    float trans=vOptics.x,ao=vOptics.y;
    vec3 diffuseEnv=.5*(env(n,1.)+env(-n,1.))*ao;
    float backLit=pow(max(0.,dot(viewDir,-sunD)),2.4)*trans*(.45+.55*wrapLight);
    vec3 sunSpec=sunColor*pow(max(0.,dot(nFace,normalize(sunD+viewDir))),26.)*(.04+.08*(1.-trans));
    float sunOcc=mix(.32,1.,sampleSunShadow(worldPoint,nFace));
    vec3 lit=dye*(diffuseEnv+sunColor*(ndl*(.34+.28*wrapLight)+backLit*.52)*sunOcc)+sunSpec*sunOcc;
    lit=mix(lit,hazeColor,haze);`:`
    vec3 lit=dye*(.5*(env(n,1.)+env(-n,1.))+.42+.32*abs(dot(n,normalize(vec3(-.6,1.,.5)))));
    lit=mix(lit,vec3(.38,.45,.48),haze);`}
    return reedUnderwater?inWater(lit,length(worldPoint-cameraPosition)):lit;
   }
   #endif`,hasLightingSun,hasLightingSun?lighting:'');
 }
 draw(renderer,camera,side,underwater=false,base=null,skipHorizon=false){
  this.uniforms.reedMirrorPass.value=!!skipHorizon;
  const saved=(side<0||skipHorizon)?[]:null;
  if(saved){
   const topWaveY=this.uniforms.clipHeights?.value?.y??0;
   for(const mesh of this.group.children){
    if(!mesh.visible)continue;
    const ud=mesh.userData,g=mesh.geometry;
    if(ud.horizon){
     mesh.visible=false;saved.push({mesh,visible:true});
    }else if(side<0){
     const maxWaterY=topWaveY+((ud.conform||0)>0?0.55:0.20);
     if(ud.rootYs&&ud.fullCount!==undefined){
      let lo=0,hi=ud.fullCount;
      while(lo<hi){
       const mid=(lo+hi)>>>1;
       if(ud.rootYs[mid]<=maxWaterY)lo=mid+1;
       else hi=mid;
      }
      if(lo===0){
       mesh.visible=false;saved.push({mesh,visible:true});
      }else if(lo<g.instanceCount){
       saved.push({mesh,instanceCount:g.instanceCount});
       g.instanceCount=lo;
      }
     }else if((ud.minRootY??-Infinity)>maxWaterY){
      mesh.visible=false;saved.push({mesh,visible:true});
     }
    }else if(skipHorizon&&ud.lod===0&&g.userData.primaryIndexCount>0&&g.drawRange.count>g.userData.primaryIndexCount){
     saved.push({mesh,drawCount:g.drawRange.count});
     g.setDrawRange(0,g.userData.primaryIndexCount);
    }
   }
  }
  try{
   this.transparency.draw(renderer,camera,side,underwater,base);
  }finally{
   this.uniforms.reedMirrorPass.value=false;
   if(saved){
    for(const s of saved){
     if(s.visible!==undefined)s.mesh.visible=s.visible;
     if(s.instanceCount!==undefined)s.mesh.geometry.instanceCount=s.instanceCount;
     if(s.drawCount!==undefined)s.mesh.geometry.setDrawRange(0,s.drawCount);
    }
   }
  }
 }
 configure(assets,materials,placements){
  this.clear();this.instances=placements;this.assets=assets;this.placed=placements.map(p=>plantedCrown(p,assets.findIndex(a=>a?.id===p.assetId)));
  this.placedSet=new Set(this.placed);
  this.markIndices=assets.map(a=>a?.parts.map(p=>new Map(p.marks.map((mark,i)=>[mark.id,i]))));
  const columns=Math.max(1,...assets.flatMap(a=>a?.parts.map(p=>p.marks.length)??[]));
  const rows=Math.max(1,this.placed.reduce((sum,site)=>sum+assets[site.variant].parts.length,0)+(MAX_ACTIVE_CROWNS+Math.max(3,assets.length*2))*Math.max(0,...assets.map(a=>a?.parts.length??0)));
  this.poses.dispose();this.poses.image={data:new Float32Array(rows*16),width:4,height:rows};this.poses.needsUpdate=true;
  this.angles.dispose();this.angles.image={data:new Float32Array(columns*rows),width:columns,height:rows};this.angles.needsUpdate=true;
  this.inverseParts=assets.map(a=>instancedReed(a)?a.parts.map(p=>reedPartMatrix(p).invert()):[]);
  this.speciesMeta=assets.map(a=>{
   if(!a?.parts?.length)return {specMax:farEnd,conform:0,ranges:lodRangesForMaxDist(farEnd),halfH:1,radius:2};
   const specMax=a.ecology?.maxRenderDist??farEnd;
   const conform=a.ecology?.conform??0;
   const ranges=lodRangesForMaxDist(specMax);
   let minY=Infinity,maxY=-Infinity,maxXZ=0.2;
   const p0=new T.Vector3(),p1=new T.Vector3(),rootV=new T.Vector3(),axisV=new T.Vector3();
   for(const p of a.parts){
    const m=reedPartMatrix(p),stem=p.stamps[0],L=2*stem.size[1];
    p0.set(0,0,0).applyMatrix4(m);p1.set(0,L,0).applyMatrix4(m);
    minY=Math.min(minY,p0.y,p1.y);maxY=Math.max(maxY,p0.y,p1.y);
    maxXZ=Math.max(maxXZ,Math.hypot(p0.x,p0.z),Math.hypot(p1.x,p1.z));
    for(const mk of p.marks||[]){
     rootV.fromArray(mk.root);axisV.fromArray(mk.axis);
     p0.copy(rootV).addScaledVector(axisV,mk.length).applyMatrix4(m);
     minY=Math.min(minY,p0.y);maxY=Math.max(maxY,p0.y);
     maxXZ=Math.max(maxXZ,Math.hypot(p0.x,p0.z));
    }
   }
   const halfH=(minY+maxY)*0.5;
   const radius=Math.hypot(maxXZ,(maxY-minY)*0.5)+0.35;
   return {specMax,conform,ranges,halfH,radius};
  });
  for(const [variant,a] of assets.entries()){
   if(!instancedReed(a))continue;
   const meta=this.speciesMeta[variant];
   for(let lod=0;lod<3;lod++){
    const geo=crownGeometry(a,materials,lod);
    const hasCoreSibling=lod===0&&geo.userData.primaryIndexCount>0&&geo.userData.primaryIndexCount<geo.userData.fullIndexCount;
    const mesh=new T.Mesh(geo,null);
    mesh.userData={variant,subVariant:0,hasSub:false,lod,hasCoreSibling,conform:meta.conform,activeVisible:true,minRootY:-Infinity,fullCount:0,rootYs:null};
    mesh.frustumCulled=false;this.group.add(mesh);
    if(hasCoreSibling){
     const coreGeo=geo.clone();
     coreGeo.setDrawRange(0,geo.userData.primaryIndexCount);
     coreGeo.userData.primaryIndexCount=geo.userData.primaryIndexCount;
     coreGeo.userData.fullIndexCount=geo.userData.primaryIndexCount;
     const coreMesh=new T.Mesh(coreGeo,null);
     coreMesh.userData={variant,subVariant:0,hasSub:false,lod:0,lod0Core:true,conform:meta.conform,activeVisible:true,minRootY:-Infinity,fullCount:0,rootYs:null};
     coreMesh.frustumCulled=false;this.group.add(coreMesh);
    }
   }
  }
  if(assets.some(a=>a?.ecology)){
   const horizonMesh=new T.Mesh(horizonQuadGeometry(),null);
   horizonMesh.userData={variant:-1,subVariant:0,hasSub:false,lod:3,horizon:true,activeVisible:false,minRootY:-Infinity};
   horizonMesh.frustumCulled=false;this.group.add(horizonMesh);
  }
 }
 uploadPoses(sim,camera){
  if(!sim){
   if(this.lastPhysics){this.filtered?.clear();this.lastPhysics=null;this.lastSimSteps=-1;this.lastTime=undefined;this.cachedSlots=null;this.cachedSlotsKey='';}
   this.emptySlots??=new Map();this.cachedSlotsKey='';return this.emptySlots;
  }
  const stand=sim.stand;
  const activeCount=stand?.active.size??0,parkedCount=stand?.parked.size??0;
  if(this.lastPhysics===sim&&this.lastSimSteps===sim.steps&&this.lastTime===sim.time&&
    this.lastActiveCount===activeCount&&this.lastParkedCount===parkedCount&&this.cachedSlots){
   return this.cachedSlots;
  }
  if(this.lastPhysics!==sim){this.filtered=new Map();this.lastPhysics=sim;this.lastTime=undefined;}
  this.filtered??=new Map();
  const dt=Math.max(0,sim.time-(this.lastTime??sim.time));
  this.lastTime=sim.time;this.lastSimSteps=sim.steps;this.lastActiveCount=activeCount;this.lastParkedCount=parkedCount;
  const alpha=-Math.expm1(-dt/.055);
  const slots=this.slotsMap??=new Map();slots.clear();
  const mat=this.poseMat??=new T.Matrix4(),tmpMat=this.poseTmpMat??=new T.Matrix4(),liveKeys=this.liveKeys??=new Set();liveKeys.clear();
  const states=this.poseStates??=[];states.length=0;
  if(stand?.samples)for(const s of stand.samples)states.push(s);
  if(stand?.active)for(const s of stand.active.values())states.push(s);
  if(stand?.parked)for(const s of stand.parked.values())if(Math.hypot(s.site.x-camera.x,s.site.z-camera.z)<farEnd+45)states.push(s);
  let rows=0;
  for(const state of states)rows+=this.assets[state.site.variant].parts.length;
  if(rows>this.poses.image.height)for(const tex of [this.poses,this.angles]){
   const channels=tex===this.poses?16:tex.image.width;
   tex.dispose();tex.image={width:tex.image.width,height:rows,data:new Float32Array(channels*rows)};
  }
  let count=0,slotsKey='';
  for(const state of states){
   const site=state.site,parts=this.assets[site.variant].parts,owner=state.inverse?stand.windWorld:sim;
   const sample=state.saved?stand.sample(site):null;
   slots.set(site.id,count);
   slotsKey+=(slotsKey?'|':'')+site.id+'='+count;
   for(const [j,p] of parts.entries()){
    const saved=state.saved?.get(p.id);
    const record=saved??(sample?stand.windWorld.get(sample.site.id,p.id):owner.get(site.id,p.id));
    const matrix=record?.matrix??reedPartMatrix(p);
    mat.multiplyMatrices(matrix,this.inverseParts[site.variant][j]);
    if(state.inverse)mat.premultiply(state.inverse);
    if(sample&&!saved){tmpMat.makeRotationY(site.yaw).scale(this.poseScaleTmp??=new T.Vector3().setScalar(site.size));this.poseScaleTmp.setScalar(site.size);tmpMat.makeRotationY(site.yaw).scale(this.poseScaleTmp).setPosition(site.x,site.y,site.z);mat.premultiply(sample.inverse).premultiply(tmpMat);}
    const key=site.id+':'+p.id,prior=this.filtered.get(key);
    if(prior)for(let i=0;i<16;i++)prior[i]+=(mat.elements[i]-prior[i])*alpha;
    const pose=prior??mat.elements;
    liveKeys.add(key);if(!prior)this.filtered.set(key,pose.slice());
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
  this.cachedSlots=slots;this.cachedSlotsKey=slotsKey;
  return slots;
 }
 resetDisturbances(){
  this.disturbedSites.clear();
  this.horizonTiles.clear();
  this._lastSandVersion=0;
  this._lastHorizonSandVersion=-1;
  this.signature=undefined;
 }
 _ensureDisturbed(site){
  let d=this.disturbedSites.get(site.id);
  if(!d){
   d={site,x:site.x,z:site.z,dy:0,vy:0,lx:0,lz:0,vlx:0,vlz:0,sleeping:false,uprooted:false};
   this.disturbedSites.set(site.id,d);
  }
  return d;
 }
 disturb(ev,land,sandTerrain=null){
  if(!ev||!land)return;
  const reach=ev.reach||1.4,rad=reach+1.6;
  const tx0=Math.floor((ev.point.x-rad)/REED_TILE),tx1=Math.floor((ev.point.x+rad)/REED_TILE);
  const tz0=Math.floor((ev.point.z-rad)/REED_TILE),tz1=Math.floor((ev.point.z+rad)/REED_TILE);
  const scanList=(list)=>{
   for(const s of list||[]){
    const dist=Math.hypot(s.x-ev.point.x,s.z-ev.point.z);
    if(dist>rad)continue;
    const d=this._ensureDisturbed(s);
    d.sleeping=false;
    if(ev.kind==='impulse'){
     const fall=Math.exp(-dist/Math.max(0.45,reach*0.45));
     const nx=dist>1e-4?(s.x-ev.point.x)/dist:0,nz=dist>1e-4?(s.z-ev.point.z)/dist:0;
     const kick=Math.min(3.2,Math.sqrt(Math.max(100,ev.force||1200)/900))*fall/Math.sqrt(Math.max(0.4,s.size||1));
     d.vlx+=nx*kick*4.2;d.vlz+=nz*kick*4.2;
     d.vy=Math.max(d.vy,0.45*kick);
    }
   }
  };
  scanList(this.placed);
  for(let tz=tz0;tz<=tz1;tz++)for(let tx=tx0;tx<=tx1;tx++){
   const key=tx+','+tz;let tile=this.tiles.get(key);
   if(!tile&&this.assets?.length){tile=land.crowns(tx,tz,this.assets).filter(c=>this.placed.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>1.1));this.tiles.set(key,tile);}
   scanList(tile);
  }
  this.signature=undefined;
 }
 stepDisturbed(dt,land,sandTerrain=null){
  if(sandTerrain&&sandTerrain.version!==this._lastSandVersion){
   this._lastSandVersion=sandTerrain.version;
   const check=(list)=>{
    for(const s of list||[]){
     if(Math.abs(sandTerrain.offset(s.x,s.z))>0.015){
      this._ensureDisturbed(s).sleeping=false;
     }
    }
   };
   check(this.visible);check(this.placed);
   for(const tile of this.macroTiles.values())check(tile);
  }
  if(!this.disturbedSites.size)return false;
  let moved=false;
  for(const d of this.disturbedSites.values()){
   if(d.sleeping)continue;
   const off=sandTerrain?sandTerrain.offset(d.x,d.z):0;
   d.vy-=9.81*dt;d.dy+=d.vy*dt;
   if(d.dy<=off){
    d.dy=off;
    d.vy=d.vy<-0.45?-d.vy*0.14:0;
   }
   let targetLx=0,targetLz=0;
   if(sandTerrain&&off<-0.075){
    d.uprooted=true;
    const gx=(sandTerrain.offset(d.x+0.25,d.z)-sandTerrain.offset(d.x-0.25,d.z))/0.5;
    const gz=(sandTerrain.offset(d.x,d.z+0.25)-sandTerrain.offset(d.x,d.z-0.25))/0.5;
    const gm=Math.hypot(gx,gz)||1;
    const lean=Math.min(0.45,(-off-0.07)*2.2);
    targetLx=(-gx/gm)*lean;targetLz=(-gz/gm)*lean;
   }
   const k=26,damp=6.5;
   d.vlx+=(-k*(d.lx-targetLx)-damp*d.vlx)*dt;
   d.vlz+=(-k*(d.lz-targetLz)-damp*d.vlz)*dt;
   d.lx+=d.vlx*dt;d.lz+=d.vlz*dt;
   if(d.vy===0&&Math.abs(d.dy-off)<1e-3&&Math.hypot(d.lx-targetLx,d.lz-targetLz)<0.008&&Math.hypot(d.vlx,d.vlz)<0.02){
    d.dy=off;d.lx=targetLx;d.lz=targetLz;d.vlx=0;d.vlz=0;d.sleeping=true;
   }
   moved=true;
  }
  return moved;
 }
 update(land,eye,wind,time,view,extDt=undefined,sandTerrain=undefined){
  const camera=eye.position,stand=view.activePhysics?.stand;
  const activeSand=sandTerrain!==undefined?sandTerrain:(view.activePhysics?.sandTerrain||null);
  if(!view.activePhysics&&this.disturbedSites.size>0)this.resetDisturbances();
  this.uniforms.reedWindTime.value=(time||0)*Math.min(1.6,(wind?.speed||0)/6.8);
  const now=typeof performance!=='undefined'?performance.now():0;
  const rawDt=this.lastFrameMs!==undefined?Math.min(0.12,Math.max(0.004,(now-this.lastFrameMs)*0.001)):0.016;
  const dt=extDt!==undefined?extDt:rawDt;
  this.lastFrameMs=now;
  if(this.stepDisturbed(dt,land,activeSand))this.signature=undefined;
  let instSpeed=0;
  if(this.prevCamPos){
   const moveDist=this.prevCamPos.distanceTo(camera);
   eye.getWorldDirection(this.currCamDir);
   const angCos=Math.max(-1,Math.min(1,this.prevCamDir.dot(this.currCamDir)));
   instSpeed=moveDist/dt+2.5*(Math.acos(angCos)/dt);
   this.prevCamDir.copy(this.currCamDir);
  }else{
   this.prevCamPos=new T.Vector3();
   this.prevCamDir=new T.Vector3();
   this.currCamDir=new T.Vector3();
   eye.getWorldDirection(this.prevCamDir);
   this.currCamDir.copy(this.prevCamDir);
  }
  this.prevCamPos.copy(camera);
  this.smoothSpeed=(this.smoothSpeed??0)+(instSpeed-(this.smoothSpeed??0))*(1-Math.exp(-dt/0.14));
  const speedScale=cameraCoarseningFactor(this.smoothSpeed);
  this.uniforms.lodSpeedScale.value=speedScale;

  let moved=false;
  for(const [i,site] of this.placed.entries()){
   const t=this.instances[i].transform,pos=t.position,yaw=t.rotation[1]*Math.PI/180;
   if(site.x!==pos[0]||site.y!==pos[1]||site.z!==pos[2]||site.yaw!==yaw||site.size!==t.scale[1]){
    [site.x,site.y,site.z]=pos;site.yaw=yaw;site.size=t.scale[1];moved=true;
   }
  }
  if(moved){this.tiles.clear();this.macroTiles.clear();this.horizonTiles.clear();this.signature=undefined;}
  const slots=this.uploadPoses(view.activePhysics,camera);
  const windDmgByVar=stand?.windDamageByVariant?.()??null;
  const wSpd=wind?.speed??0,wRad=((wind?.heading??0)*Math.PI)/180;
  let avgIntact=1;
  if(windDmgByVar?.length){
   let sumInt=0,nInt=0;
   for(const wd of windDmgByVar){if(wd){sumInt+=0.5*(wd.intactFrac+wd.heightScale);nInt++;}}
   if(nInt>0)avgIntact=Math.max(0.22,Math.min(1,sumInt/nInt));
  }
  this.uniforms.horizonWind.value.set(Math.cos(wRad),Math.sin(wRad),Math.min(0.45,Math.max(0,wSpd-3.5)*0.022),avgIntact);
  const speedBucket=Math.round(speedScale*10);
  const slotsKey=this.cachedSlotsKey??'';
  const dmgSig=(activeSand?.version??0)+','+(stand?.windWorld?.broken??0)+','+(stand?.persistentDamage?.size??0)+','+Math.round(wSpd*2)+','+Math.round((wind?.heading??0)/10);
  const climateKey=(land.climate?.precipitation??0)+','+(land.climate?.seaLevelOffset??0);
  eye.updateMatrixWorld();
  this.lastUpdateCam??=new T.Matrix4();
  this.lastUpdateProj??=new T.Matrix4();
  if(!moved&&this.signature!==undefined&&this.lastSpeedBucket===speedBucket&&this.lastSlotsKey===slotsKey&&
    this.lastDmgSig===dmgSig&&this.lastClimateKey===climateKey&&eye.matrixWorld.equals(this.lastUpdateCam)&&eye.projectionMatrix.equals(this.lastUpdateProj)){
   return;
  }
  this.lastUpdateCam.copy(eye.matrixWorld);
  this.lastUpdateProj.copy(eye.projectionMatrix);
  this.lastSpeedBucket=speedBucket;this.lastSlotsKey=slotsKey;this.lastDmgSig=dmgSig;this.lastClimateKey=climateKey;

  const cx=Math.floor(camera.x/REED_TILE),cz=Math.floor(camera.z/REED_TILE);
  this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse));
  const keep=[],macroKeep=[],horizonKeep=[],innerMax=120,macroMax=395,horizonMax=1180;
  const innerRad=Math.ceil((innerMax+6)/REED_TILE),outerRad=Math.ceil((macroMax+6)/REED_TILE);
  const hasMacro=this.assets.some(a=>(a?.ecology?.maxRenderDist??farEnd)>=150);
  const activeRad=hasMacro?outerRad:innerRad;
  if(camera.y<480&&camera.y>-macroMax)for(let j=-activeRad;j<=activeRad;j++)for(let i=-activeRad;i<=activeRad;i++){
   const x=cx+i,z=cz+j;
   this.bounds.min.set(x*REED_TILE-4,-6,z*REED_TILE-4);this.bounds.max.set((x+1)*REED_TILE+4,16,(z+1)*REED_TILE+4);
   const dist=this.bounds.distanceToPoint(camera);
   if(dist>macroMax||(dist>innerMax&&!hasMacro)||!this.frustum.intersectsBox(this.bounds))continue;
   const key=x+','+z;
   if(dist<=innerMax){
    let tile=this.tiles.get(key);
    if(!tile){tile=land.crowns(x,z,this.assets).filter(c=>this.placed.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>1.1));this.tiles.set(key,tile);}
    keep.push({x,z,key,tile});
   }else{
    let tile=this.macroTiles.get(key);
    if(!tile){
     const full=this.tiles.get(key)??land.crowns(x,z,this.assets);
     tile=full.filter(c=>(this.assets[c.variant]?.ecology?.maxRenderDist??farEnd)>=150&&this.placed.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>1.1));
     this.macroTiles.set(key,tile);
    }
    macroKeep.push({x,z,key,tile});
   }
  }
  const hasHorizonMesh=this.group.children.some(m=>m.userData.horizon);
  const hx0=Math.floor(camera.x/HORIZON_TILE),hz0=Math.floor(camera.z/HORIZON_TILE);
  const hRad=Math.ceil((horizonMax+12)/HORIZON_TILE);
  if(hasHorizonMesh&&typeof land.environment==='function'&&camera.y<950&&camera.y>-120){
   for(let j=-hRad;j<=hRad;j++)for(let i=-hRad;i<=hRad;i++){
    const x=hx0+i,z=hz0+j;
    this.bounds.min.set(x*HORIZON_TILE-4,-4,z*HORIZON_TILE-4);this.bounds.max.set((x+1)*HORIZON_TILE+4,18,(z+1)*HORIZON_TILE+4);
    const dist=this.bounds.distanceToPoint(camera);
    const farCorner=Math.hypot(Math.max(Math.abs(camera.x-(x+.5)*HORIZON_TILE)+HORIZON_TILE,0),Math.max(Math.abs(camera.z-(z+.5)*HORIZON_TILE)+HORIZON_TILE,0));
    if(dist>horizonMax||farCorner<210||!this.frustum.intersectsBox(this.bounds))continue;
    const key=x+','+z;
    let tile=this.horizonTiles.get(key);
    if(!tile){tile=horizonStandsForCell(land,x,z);this.horizonTiles.set(key,tile);}
    horizonKeep.push({x,z,key,tile});
   }
  }
  const dirQuant=[Math.round(this.currCamDir.x*16),Math.round(this.currCamDir.y*16),Math.round(this.currCamDir.z*16)].join(',');
  const signature=[camera.x,camera.y,camera.z].map(v=>Math.floor(v)).join(',')+'/'+dirQuant+'/'+fnvTiles(keep)+'/'+fnvTiles(macroKeep)+'/'+fnvTiles(horizonKeep)+'/'+speedBucket+'/'+slotsKey+'/'+dmgSig+'/'+climateKey;
  if(signature===this.signature)return;this.signature=signature;
  for(const key of this.tiles.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(cx-x)>innerRad||Math.abs(cz-z)>innerRad)this.tiles.delete(key);}
  for(const key of this.macroTiles.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(cx-x)>outerRad||Math.abs(cz-z)>outerRad)this.macroTiles.delete(key);}
  for(const key of this.horizonTiles.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(hx0-x)>hRad||Math.abs(hz0-z)>hRad)this.horizonTiles.delete(key);}

  const waterDatum=view.sea?.seaLevel??(land.climate?.seaLevelOffset||0);
  const sp=this.cullSphere??=new T.Sphere();
  const inView=(x,y,z,r,d)=>{
   if(d<15.)return true;
   const pad=r+Math.max(2.5,d*0.12);
   sp.center.set(x,y,z);sp.radius=pad;
   if(this.frustum.intersectsSphere(sp))return true;
   sp.center.set(x,2*waterDatum-y,z);
   return this.frustum.intersectsSphere(sp);
  };

  const nVariants=this.assets.length;
  const nearByVar=Array.from({length:nVariants},()=>[]);
  const macroByVar=Array.from({length:nVariants},()=>[]);
  const nearVisible=[...this.placed];
  for(const s of this.placed)if(nearByVar[s.variant])nearByVar[s.variant].push(s);
  for(const t of keep)for(const s of t.tile){
   nearVisible.push(s);
   if(nearByVar[s.variant])nearByVar[s.variant].push(s);
  }
  for(const t of macroKeep)for(const s of t.tile){
   if(macroByVar[s.variant])macroByVar[s.variant].push(s);
  }
  this.visible=nearVisible;

  for(const mesh of this.group.children){
   const {lod,variant,horizon,hasCoreSibling,lod0Core}=mesh.userData,g=mesh.geometry;
   if(horizon){
    const rows=[];
    for(const t of horizonKeep)for(const r of t.tile){
     const d=Math.hypot(r.x-camera.x,r.y-camera.y,r.z-camera.z);
     if(d>210&&d<1195&&inView(r.x,r.y,r.z,Math.max(r.radXZ,r.halfH)*1.45,d))rows.push(r);
    }
    if(!g.attributes.site||g.attributes.site.count<rows.length){
     const capacity=2**Math.ceil(Math.log2(Math.max(32,rows.length)));
     g.setAttribute('site',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
     g.setAttribute('growthPose',new T.InstancedBufferAttribute(new Float32Array(capacity*3),3));
     g.setAttribute('siteTrait',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
     g.setAttribute('siteSlope',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
     delete g._maxInstanceCount;
    }
    let minRootY=Infinity;
    const hasDist=this.disturbedSites.size>0;
    const sandVer=activeSand?.version??0;
    for(let j=0;j<rows.length;j++){
     const r=rows[j];
     let ry=r.y+(sandVer>0?activeSand.offset(r.x,r.z):0);
     let radXZ=r.radXZ,halfH=r.halfH,dens=r.density??0.65;
     if(hasDist){
      let nearestDist=6.25,uprootSum=0,dropDy=0;
      for(const d of this.disturbedSites.values()){
       const dist2=(d.x-r.x)*(d.x-r.x)+(d.z-r.z)*(d.z-r.z);
       if(dist2<nearestDist){
        nearestDist=dist2;dropDy=d.dy;
        if(d.uprooted)uprootSum=Math.max(uprootSum,0.55);
       }
      }
      if(nearestDist<6.25){
       ry=r.y+dropDy;
       if(uprootSum>0){halfH*=0.62;dens*=0.65;}
      }
     }
     if(ry<minRootY)minRootY=ry;
     g.attributes.site.setXYZW(j,r.x,ry,r.z,r.yaw);
     g.attributes.growthPose.setXYZ(j,radXZ,halfH,dens);
     g.attributes.siteTrait.setXYZW(j,r.ao,r.rgb[0],r.rgb[1],r.rgb[2]);
     g.attributes.siteSlope.setXYZW(j,r.leanX,r.leanZ,r.thickRatio,r.soft??0.88);
    }
    g.attributes.site.needsUpdate=g.attributes.growthPose.needsUpdate=g.attributes.siteTrait.needsUpdate=g.attributes.siteSlope.needsUpdate=true;
    g.instanceCount=rows.length;
    mesh.userData.activeVisible=rows.length>0;
    mesh.userData.minRootY=minRootY;
    mesh.visible=rows.length>0;
    continue;
   }
   const meta=this.speciesMeta[variant];
   const specMax=meta.specMax,conform=meta.conform,ranges=meta.ranges;
   const rows=[];let minDist=Infinity;
   const visit=s=>{
    const d=Math.hypot(s.x-camera.x,s.y-camera.y,s.z-camera.z);
    const eff=d*speedScale;
    if(lod===0){
     if(hasCoreSibling){if(eff>=ranges.d01Lo+1.5)return;}
     else if(lod0Core){if(eff<ranges.d01Lo+1.5||eff>=ranges.d01Hi+2.5)return;}
     else{if(eff>=ranges.d01Hi+2.5)return;}
    }
    else if(lod===1){if(eff<=ranges.d01Lo-2.5||eff>=ranges.d12Hi+2.5)return;}
    else{if(eff<=ranges.d12Lo-2.5||d>=specMax+2.5)return;}
    if(!this.placedSet.has(s)&&!inView(s.x,s.y+meta.halfH*s.size,s.z,meta.radius*s.size,d))return;
    if(d<minDist)minDist=d;
    rows.push(s);
   };
   for(const s of nearByVar[variant])visit(s);
   if(lod===2)for(const s of macroByVar[variant])visit(s);
   const sandVer=activeSand?.version??0;
   for(let j=0;j<rows.length;j++){
    const r=rows[j];
    const d=this.disturbedSites.get(r.id);
    const summary=stand?.crownSummary?.(r.id)??null;
    r._summary=summary;
    r._disturbed=d;
    r._sy=r.y+(d?d.dy:(summary?.dropY??(sandVer>0?activeSand.offset(r.x,r.z):0)));
   }
   if(rows.length>1)rows.sort((a,b)=>a._sy-b._sy);
   if(!g.attributes.site||g.attributes.site.count<rows.length){
    const capacity=2**Math.ceil(Math.log2(Math.max(16,rows.length)));
    g.setAttribute('site',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    g.setAttribute('growthPose',new T.InstancedBufferAttribute(new Float32Array(capacity*3),3));
    g.setAttribute('siteTrait',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    g.setAttribute('siteSlope',new T.InstancedBufferAttribute(new Float32Array(capacity*4),4));
    delete g._maxInstanceCount;
   }
   if(!mesh.userData.rootYs||mesh.userData.rootYs.length<rows.length){
    mesh.userData.rootYs=new Float32Array(Math.max(16,rows.length));
   }
   const rootYs=mesh.userData.rootYs;
   let minRootY=Infinity;
   const windDmg=windDmgByVar?.[variant]??null;
   for(let j=0;j<rows.length;j++){
    const r=rows[j];
    const d=r._disturbed;
    const summary=r._summary;
    const sy=r._sy;
    rootYs[j]=sy;
    if(sy<minRootY)minRootY=sy;
    g.attributes.site.setXYZW(j,r.x,sy,r.z,r.yaw);
    if(lod===2){
     const wExp=r._windExp??(r._windExp=(land.windExposure?land.windExposure(r.x,r.z):1.0));
     const expW=Math.max(0.35,Math.min(1.35,wExp));
     const wIntact=windDmg?1-(1-windDmg.intactFrac)*expW:1;
     const wHeight=windDmg?1-(1-windDmg.heightScale)*expW:1;
     const intactFrac=Math.max(0.14,Math.min(1.0,(summary?.intactFrac??1)*(d?.uprooted?0.65:1)*wIntact));
     const heightScale=Math.max(0.22,Math.min(1.0,(summary?.heightScale??1)*(d?.uprooted?0.72:1)*wHeight));
     const lx=(r.leanX??0)+(d?.lx??0)+(summary?.tiltX??0)+(windDmg?.leanX??0)*expW;
     const lz=(r.leanZ??0)+(d?.lz??0)+(summary?.tiltZ??0)+(windDmg?.leanZ??0)*expW;
     g.attributes.growthPose.setXYZ(j,r.size,intactFrac,heightScale);
     g.attributes.siteTrait.setXYZW(j,r.vitality??1,lx,lz,specMax);
    }else{
     const active=slots.has(r.id),sample=active?null:stand?.sample(r);
     g.attributes.growthPose.setXYZ(j,r.size,slots.get(active?r.id:sample?.site.id)??-1,Number(active));
     g.attributes.siteTrait.setXYZW(j,r.vitality??1,(r.leanX??0)+(d?.lx??0),(r.leanZ??0)+(d?.lz??0),specMax);
    }
    g.attributes.siteSlope.setXYZW(j,r.slopeX??0,r.slopeZ??0,r.hueShift??0,conform);
   }
   g.attributes.site.needsUpdate=g.attributes.growthPose.needsUpdate=g.attributes.siteTrait.needsUpdate=g.attributes.siteSlope.needsUpdate=true;
   g.instanceCount=rows.length;
   mesh.userData.fullCount=rows.length;
   if(g.userData.primaryIndexCount){
    if(lod0Core){
     g.setDrawRange(0,g.userData.primaryIndexCount);
    }else{
     g.setDrawRange(0,minDist*speedScale>=ranges.d01Lo?g.userData.primaryIndexCount:g.userData.fullIndexCount);
    }
   }
   mesh.userData.activeVisible=rows.length>0;
   mesh.userData.minRootY=minRootY;
   mesh.visible=rows.length>0;
  }
 }
 pick(ray,nearest,sim,includeMarks){
  const p=new T.Vector3(),q=new T.Vector3(),end=new T.Vector3(),start=new T.Vector3(),hit=new T.Vector3(),matrix=new T.Matrix4();
  for(const site of this.visible??[]){
   if(!this.inverseParts[site.variant]?.length)continue;
   const dOff=this.disturbedSites.get(site.id)?.dy??0;
   const effSite=dOff?{...site,y:site.y+dOff}:site;
   p.set(effSite.x,effSite.y+effSite.size,effSite.z);
   if(ray.distanceSqToPoint(p)>16*effSite.size*effSite.size&&!sim?.stand?.active.has(effSite.id)&&!sim?.stand?.parked.has(effSite.id))continue;
   const asset=this.assets[effSite.variant];
   for(const [j,part] of asset.parts.entries()){
    const r=sim?.get(effSite.id,part.id),s=part.stamps[0];
    if(sim?.stand)sim.stand.pose(effSite,part,matrix);
    else matrix.multiplyMatrices(crownTransform(effSite),reedPartMatrix(part));
    start.set(0,0,0).applyMatrix4(matrix);end.set(0,2*s.size[1],0).applyMatrix4(matrix);
    const d2=ray.distanceSqToSegment(start,end,hit,q);
    const accept=(d2,radius,mark=null)=>{
     if(d2>radius*radius)return;
     const distance=hit.distanceTo(ray.origin);if(nearest&&nearest.distance<=distance)return;
     nearest={point:hit.clone(),normal:hit.clone().sub(q).normalize(),distance,partId:part.id,mark,materialId:mark?.materialId??s.materialId,
      instanceId:effSite.id,reedSite:effSite,assetName:asset.name,assetId:this.placed.some(s=>s.id===effSite.id)?asset.id:undefined};
    };
    accept(d2,s.size[0]*effSite.size+.03);
    if(!includeMarks)continue;
    const sample=r?null:sim?.stand?.sample(effSite);
    const hinges=r?sim.paintedHinges.parts.get(r.key):sim?.stand?.parked.get(effSite.id)?.saved.get(part.id)?.hinges??sim?.stand?.windWorld?.paintedHinges.parts.get(sample?.site.id+':'+part.id);
    const transform=v=>v.applyMatrix4(matrix);
    for(const mark of part.marks){
     const root=new T.Vector3(...mark.root);
     if(ray.distanceSqToPoint(transform(start.copy(root)))>(1.8*mark.length*effSite.size)**2)continue;
     const angle=hinges?.find(h=>h.mark.id===mark.id)?.angle??0;
     const along=new T.Vector3(...mark.axis),up=new T.Vector3(...mark.up),side=along.clone().cross(up).normalize();
     along.applyAxisAngle(side,angle);up.applyAxisAngle(side,angle);
     if(mark.kind==='dab'){
      const tangent=along.clone().addScaledVector(up,.48*mark.curl).normalize();
      transform(end.copy(root).addScaledVector(tangent,mark.length));
      accept(ray.distanceSqToSegment(start,end,hit,q),Math.max(.025,effSite.size*mark.length*mark.width*.7),mark);
      continue;
     }
     const profile=markProfile(mark);
     for(let k=1;k<=4;k++){
      const t=k/4;
      transform(end.copy(root).addScaledVector(along,mark.length*t).addScaledVector(up,mark.length*mark.curl*.48*t*t));
      const width=effSite.size*mark.length*mark.width*ribbonWidth(t-.125,...profile);
      accept(ray.distanceSqToSegment(start,end,hit,q),Math.max(.015,width),mark);start.copy(end);
     }
    }
   }
  }
  return nearest;
 }
  clear(){for(const mesh of this.group.children)mesh.geometry.dispose();this.group.clear();this.tiles.clear();this.macroTiles?.clear();this.horizonTiles?.clear();this.visible=[];this.filtered?.clear();this.disturbedSites?.clear();this._lastSandVersion=0;this.signature=undefined;}
  drawShadows(renderer,shadowCamera){
   if(!this.group.children.length)return;
   if(!this.shadowMaterials){
    const mkShadow=(withSkin)=>new T.ShaderMaterial({
     uniforms:this.uniforms,
     colorWrite:false,depthWrite:true,depthTest:true,side:T.DoubleSide,
     vertexShader:`
      attribute vec3 along,sideways,foliageOptics,leafAxis,growthPose;
      attribute vec4 quadLod,skin,leafRoot,site,siteTrait,siteSlope;
      uniform float reedWindTime;
      uniform sampler2D poses,angles;
      varying vec2 vG;
      vec3 turn(vec3 v,float c,float s){return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
      vec3 rotateLeaf(vec3 v,float c,float s){return c*v+cross(leafAxis,v)*s+leafAxis*dot(leafAxis,v)*(1.-c);}
      mat3 basisAt(int row){return mat3(texelFetch(poses,ivec2(0,row),0).xyz,texelFetch(poses,ivec2(1,row),0).xyz,texelFetch(poses,ivec2(2,row),0).xyz);}
      void main(){
       vec3 world=position,axis=along,width=sideways;float size=growthPose.x;
       float c=cos(site.w),s=sin(site.w);
       ${withSkin?`if(growthPose.y>=0.){
        int base=int(growthPose.y),row=base+int(skin.w);
        mat3 frame=basisAt(row);vec3 shift=texelFetch(poses,ivec2(3,row),0).xyz;
        if(skin.y>0.&&texelFetch(poses,ivec2(3,base+int(skin.z)),0).w>.5){
         int next=base+int(skin.x);
         frame=frame*(1.-skin.y)+basisAt(next)*skin.y;
         shift=mix(shift,texelFetch(poses,ivec2(3,next),0).xyz,skin.y);
        }
        if(leafRoot.w>=0.){
         float angle=texelFetch(angles,ivec2(int(leafRoot.w),row),0).r,co=cos(angle),si=sin(angle);
         world=leafRoot.xyz+rotateLeaf(position-leafRoot.xyz,co,si);axis=rotateLeaf(along,co,si);width=rotateLeaf(width,co,si);
        }
        world=frame*world+shift;axis=frame*axis;width=frame*width;
       }`:''}
       if(growthPose.z<.5){
        if(foliageOptics.y<.98){
         float seedA=fract(sin(dot(site.xz,vec2(127.1,311.7)))*43758.5453);
         float seedB=fract(seedA*17.31);
         float scaleXZ=.88+.24*seedA,scaleY=.90+.20*seedB;
         world.xz*=scaleXZ;axis.xz*=scaleXZ;width.xz*=scaleXZ;
         world.y*=scaleY;axis.y*=scaleY;width.y*=scaleY;
        }
        world=site.xyz+turn(world,c,s)*size;axis=turn(axis,c,s)*size;width=turn(width,c,s)*size;
        float relH=max(0.,world.y-site.y);
        if(siteSlope.w>.01){
         world.y+=((world.x-site.x)*siteSlope.x+(world.z-site.z)*siteSlope.y)*siteSlope.w;
        }
        float sway=.05*sin(reedWindTime*2.1+site.x*.45+site.z*.37);
        world.xz+=siteTrait.yz*(relH*relH*.13+relH*sway);
       }
       vG=quadLod.xy*1.35;
       vec3 wPos=world+axis*vG.x+width*vG.y;
       gl_Position=projectionMatrix*viewMatrix*vec4(wPos,1.);
      }`,
     fragmentShader:'varying vec2 vG;void main(){if(dot(vG,vG)>1.45)discard;gl_FragColor=vec4(0.);}'
    });
    this.shadowMaterials=[mkShadow(true),mkShadow(false)];
   }
   const saved=[];
   for(const mesh of this.group.children){
    if(!mesh.visible)continue;
    if(mesh.userData.horizon){
     mesh.visible=false;saved.push({mesh,visible:true});
    }else if(mesh.geometry.instanceCount>0){
     const origMat=mesh.material;
     saved.push({mesh,mat:origMat});
     mesh.material=this.shadowMaterials[mesh.userData.lod<2?0:1];
    }
   }
   if(saved.some(s=>s.mat))renderer.render(this.group,shadowCamera);
   for(const s of saved){
    if(s.visible)s.mesh.visible=true;
    if(s.mat!==undefined)s.mesh.material=s.mat;
   }
  }
  dispose(){this.clear();this.poses.dispose();this.angles.dispose();this.transparency.dispose();this.shadowMaterials?.forEach(m=>m.dispose());this.group.removeFromParent();}
 }
