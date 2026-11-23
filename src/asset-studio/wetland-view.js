import * as T from 'three';
import {wetlandGLSL,coastalFieldsGLSL} from './wetland.js';
import {reedFamily,instancedReed} from './reed-stand.js';
import {WetlandReeds} from './wetland-reeds.js';
import {CoastalPropsView} from './coastal-props.js';
import {CoastalEcologySim} from './coastal-ecology.js';
import {CoastalFaunaView} from './coastal-fauna.js';
import {reflectedSurfaceClip} from './wave-surface.js';
import {CELL} from './ground-tools.js';
import {SAND_SIDE,SAND_METRES} from './wind-sand.js';
import {coastalSkyMaterial,climateAtmosphere,DEFAULT_COASTAL_CLIMATE} from './coastal-climate.js';

function pchip1D(p0,p1,p2,p3,t){
 const d0=p1-p0,d1=p2-p1,d2=p3-p2;
 const m1=d0*d1>0?2*d0*d1/(d0+d1):0;
 const m2=d1*d2>0?2*d1*d2/(d1+d2):0;
 const t2=t*t,omt=1-t,omt2=omt*omt;
 return (1+2*t)*omt2*p1+t*omt2*m1+t2*(3-2*t)*p2+t2*(t-1)*m2;
}

function sampleSandPchip(sandTerrain,qi,qj,fx,fz){
 if(fx===0&&fz===0)return sandTerrain.node(qi,qj);
 const row=(r)=>pchip1D(
  sandTerrain.node(qi-1,qj+r),
  sandTerrain.node(qi,qj+r),
  sandTerrain.node(qi+1,qj+r),
  sandTerrain.node(qi+2,qj+r),
  fx
 );
 return pchip1D(row(-1),row(0),row(1),row(2),fz);
}

export function buildSandPatchGeometry(sandTerrain){
 const g=new T.BufferGeometry();
 if(!sandTerrain?.version)return g;
 const quadSet=new Set();
 const quads=[];
 const addQuad=(qi,qj)=>{
  const k=qi+','+qj;
  if(quadSet.has(k))return;
  quadSet.add(k);
  quads.push([qi,qj]);
 };
 if(sandTerrain.tiles?.size){
  for(const [key,tile] of sandTerrain.tiles){
   if(!tile?.heights)continue;
   const tz=tile.tz??(typeof key==='number'?Math.round(key/33554432):Number(key.split(',')[1]));
   const tx=tile.tx??(typeof key==='number'?key-tz*33554432:Number(key.split(',')[0]));
   const baseI=tx*SAND_SIDE,baseJ=tz*SAND_SIDE,heights=tile.heights;
   for(let lj=0;lj<SAND_SIDE;lj++){
    const rowOff=lj*SAND_SIDE,gj=baseJ+lj;
    for(let li=0;li<SAND_SIDE;li++){
     if(Math.abs(heights[rowOff+li])<=0.00015)continue;
     const gi=baseI+li;
     for(let dq=-2;dq<=1;dq++)for(let dp=-2;dp<=1;dp++)addQuad(gi+dp,gj+dq);
    }
   }
  }
 }else{
  const scan=(map)=>{
   if(!map)return;
   for(const [i,j] of map.values()){
    if(Math.abs(sandTerrain.node(i,j))<=0.00015)continue;
    for(let dq=-2;dq<=1;dq++)for(let dp=-2;dp<=1;dp++)addQuad(i+dp,j+dq);
   }
  };
  scan(sandTerrain.mobile);
  scan(sandTerrain.active);
 }
 if(!quads.length)return g;

 const SUB=3;
 const vertMap=new Map();
 const positions=[];
 const indices=[];
 const vertIdx=(si,sj)=>{
  const k=si+','+sj;
  let id=vertMap.get(k);
  if(id===undefined){
   id=positions.length/3;
   vertMap.set(k,id);
   const qi=Math.floor(si/SUB),qj=Math.floor(sj/SUB);
   const fx=(si-qi*SUB)/SUB,fz=(sj-qj*SUB)/SUB;
   const x=(si/SUB)*CELL,z=(sj/SUB)*CELL;
   positions.push(x,sampleSandPchip(sandTerrain,qi,qj,fx,fz),z);
  }
  return id;
 };
 for(const [qi,qj] of quads){
  const bx=qi*SUB,bz=qj*SUB;
  for(let sz=0;sz<SUB;sz++)for(let sx=0;sx<SUB;sx++){
   const v00=vertIdx(bx+sx,bz+sz);
   const v10=vertIdx(bx+sx+1,bz+sz);
   const v01=vertIdx(bx+sx,bz+sz+1);
   const v11=vertIdx(bx+sx+1,bz+sz+1);
   indices.push(v00,v01,v10,v10,v01,v11);
  }
 }
 g.setIndex(indices);
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 return g;
}

export const COASTAL_OVERLAY_MODES = {
 natural: 0,
 moisture: 1,
 saltSpray: 2,
 windExposure: 3,
 sandMobility: 4,
 salinity: 5
};

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
 varying vec4 vCoastalA,vCoastalB;
 vec3 coastalFieldRamp(float t){
  vec3 c0=vec3(.12,.22,.62),c1=vec3(.14,.68,.62),c2=vec3(.88,.76,.22),c3=vec3(.85,.20,.14);
  t=clamp(t,0.,1.);
  if(t<.34)return mix(c0,c1,t/.34);
  if(t<.68)return mix(c1,c2,(t-.34)/.34);
  return mix(c2,c3,(t-.68)/.32);
 }`;

const lattice=`attribute vec2 gridStep;
 uniform vec2 landEye;vec2 landPoint(){vec2 cell=landEye/gridStep;return (floor(cell)+smoothstep(vec2(0.),vec2(1.),fract(cell)))*gridStep+position.xz;}`;

export class WetlandView{
 constructor(view,lighting){
  this.view=view;this.geometry=groundGrid();
  this.uniforms={
   ...view.groundMaterial.uniforms,
   ...Object.fromEntries(['height0','height1','height2','bandMix','rings','ringCount','ringAttenuation','clipWaves','clipHeights','clipFloor','seaLevel','coastalWater'].map(k=>[k,view.uniforms[k]])),
   survey:{value:new T.Vector2()},
   landEye:{value:new T.Vector2()},
   coastalClimateA:{value:new T.Vector4(0,0.44,0.42,1)},
   coastalClimateB:{value:new T.Vector4(1.2,0.422618,0.906308,1)},
   coastalOverlay:{value:0},
   causticTime:{value:0},
   sandPatchActive:{value:false}
  };
  this.skyUniforms={
   sunDirection:view.uniforms.sunDirection,
   sunColor:view.uniforms.sunColor,
   hazeColor:view.uniforms.hazeColor,
   skyZenith:{value:new T.Color(0.16,0.42,0.80)},
   skyHorizon:{value:new T.Color(0.58,0.76,0.85)},
   cloudCover:{value:0.15}
  };
  this.sky=new T.Mesh(new T.SphereGeometry(4000,32,16),coastalSkyMaterial(this.skyUniforms));
  this.sky.renderOrder=-1000;
  this.sky.frustumCulled=false;
  this.sky.visible=false;
  view.scene.add(this.sky);

  const bed=view.groundMaterial;
  const sandGradD=(SAND_METRES/SAND_SIDE*0.5).toFixed(5);
  const makeTerrainMaterial=(isPatch)=>new T.ShaderMaterial({uniforms:this.uniforms,
   ...(isPatch?{polygonOffset:true,polygonOffsetFactor:1.0,polygonOffsetUnits:1.0}:{}),
   vertexShader:(isPatch?'#define SAND_PATCH\n':'')+wetlandGLSL+coastalFieldsGLSL+habitat+(isPatch?'':lattice)+'uniform int coastalOverlay;uniform bool clipWaves;uniform vec2 clipHeights;varying vec2 duneSlope;\n'+bed.vertexShader
    .replace('worldPosition=(modelMatrix*vec4(position,1.)).xyz;',isPatch
     ? `vec2 p0=position.xz;
     float hBase=landHeight(p0);
     float pFade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p0));
     float h=hBase+(granular?(sandHeight(p0)+position.y)*pFade:0.);
     worldPosition=vec3(p0.x,h,p0.y);
     vec4 vPos=viewMatrix*vec4(worldPosition,1.);
     float vPad=4.;
     bool offScreen=(-vPos.z<-vPad)||(abs(vPos.x)>(max(0.,-vPos.z)+vPad)/projectionMatrix[0][0]+vPad);
     if((clipWaves&&h<clipHeights.x-.5)||offScreen){
      duneSlope=vec2(0.);
      vCoastalA=vec4(1.,1.,1.,0.);
      vCoastalB=vec4(0.,0.,0.,0.);
     }else{
      duneSlope=vec2(hBase-landHeight(p0+vec2(.3,0)),hBase-landHeight(p0+vec2(0,.3)))/.3;
      if(coastalOverlay==0&&h<coastalClimateA.x-.6){
       vCoastalA=vec4(1.,1.,1.,0.);
       vCoastalB=vec4(0.,0.,0.,landShoreDist(p0));
      }else{
       CoastalField cf=sampleCoastalField(p0,h,length(duneSlope));
       vCoastalA=vec4(cf.moisture,cf.salinity,cf.windExposure,cf.saltSpray);
       vCoastalB=vec4(cf.sandMobility,cf.organicMatter,cf.rosemaryInhibition,cf.d);
      }
     }
     standCover=0.;`
     : `vec2 p0=landPoint();float h=landHeight(p0);
     float flatten=smoothstep(500.,1400.,abs(cameraPosition.y))*smoothstep(1100.,2800.,length(p0-landEye));
     worldPosition=vec3(p0.x,h*(1.-flatten),p0.y);
     vec4 vPos=viewMatrix*vec4(worldPosition,1.);
     float vPad=max(gridStep.x,gridStep.y)*2.5+8.;
     bool offScreen=(-vPos.z<-vPad)||(abs(vPos.x)>(max(0.,-vPos.z)+vPad)/projectionMatrix[0][0]+vPad);
     if((clipWaves&&h<clipHeights.x-.5)||offScreen){
      duneSlope=vec2(0.);
      vCoastalA=vec4(1.,1.,1.,0.);
      vCoastalB=vec4(0.,0.,0.,0.);
     }else{
      duneSlope=vec2(h-landHeight(p0+vec2(.3,0)),h-landHeight(p0+vec2(0,.3)))/.3;
      if(coastalOverlay==0&&h<coastalClimateA.x-.6){
       vCoastalA=vec4(1.,1.,1.,0.);
       vCoastalB=vec4(0.,0.,0.,landShoreDist(p0));
      }else{
       CoastalField cf=sampleCoastalField(p0,h,length(duneSlope));
       vCoastalA=vec4(cf.moisture,cf.salinity,cf.windExposure,cf.saltSpray);
       vCoastalB=vec4(cf.sandMobility,cf.organicMatter,cf.rosemaryInhibition,cf.d);
      }
     }
     standCover=0.;`)
    .replace('if(granular){',isPatch?'if(false){':'if(granular){'),
   fragmentShader:(isPatch?'#define SAND_PATCH\n':'')+wetlandGLSL+reflectedSurfaceClip+habitat+'varying vec2 duneSlope;\nuniform vec4 coastalClimateA,coastalClimateB;\nuniform int coastalOverlay;\nuniform float causticTime;\nuniform bool sandPatchActive;\n'+bed.fragmentShader
    .replace(`if(granular){\n   const float d=${sandGradD};\n   float fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p.xz));\n   vec2 sSlope=vec2(sandHeight(p.xz-vec2(d,0))-sandHeight(p.xz+vec2(d,0)),sandHeight(p.xz-vec2(0,d))-sandHeight(p.xz+vec2(0,d)))/(2.*d);\n   vec2 lSlope=localSurface(p.xz).yz;\n   n=normalize(vec3((sSlope.x+lSlope.x)*fade,1.,(sSlope.y+lSlope.y)*fade));\n  }`,`vec2 sSlope=vec2(0.);float fade=0.;
  if(granular){
   fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p.xz));
   if(fade>.001){
    const float d=${sandGradD};
    sSlope=vec2(sandHeight(p.xz-vec2(d,0))-sandHeight(p.xz+vec2(d,0)),sandHeight(p.xz-vec2(0,d))-sandHeight(p.xz+vec2(0,d)))/(2.*d);
    vec2 lSlope=localSurface(p.xz).yz;
    n=normalize(vec3(lSlope.x*fade,1.,lSlope.y*fade));
   }
  }`)
    .replace('float lift=grainSurface(p,vec3(0,1,0),grain,n,base,cameraPosition-p);gl_FragDepth=reliefDepth(gl_FragCoord.z,p,prior,lift,projectionMatrix);',
     `float lift=0.;${isPatch?'gl_FragDepth=localEdited(p.xz,0)?gl_FragCoord.z:min(1.,gl_FragCoord.z+.0006*(1.-gl_FragCoord.z));':'gl_FragDepth=gl_FragCoord.z;'}`)
    .replace('vec3 prior=n;',`float span=clamp(max(length(dFdx(p.xz)),length(dFdy(p.xz))),0.0001,200.);
     ${isPatch?'if(!granular)discard;':'if(sandPatchActive&&granular&&localEdited(p.xz,0))discard;'}
     if(clipWaves&&belowReflector(p))discard;
     float farMix=${isPatch?'0.':'smoothstep(72.,180.,length(p.xz-cameraPosition.xz))'};
     float h=p.y;vec2 slope=duneSlope;
     if(farMix>0.&&!clipWaves){
      float exact=landHeight(p.xz),dx=clamp(span,.35,5.);
      slope=mix(slope,vec2(exact-landHeight(p.xz+vec2(dx,0)),exact-landHeight(p.xz+vec2(0,dx)))/dx,farMix);
      h=mix(h,exact,farMix);
     }
     float cfMoisture=vCoastalA.x,cfSalinity=vCoastalA.y,cfWindExposure=vCoastalA.z,cfSaltSpray=vCoastalA.w;
     float cfSandMobility=vCoastalB.x,cfOrganicMatter=vCoastalB.y,cfRosemaryInhibition=vCoastalB.z;
     vec3 prior=n;`)
    .replace('vec3 prior=n;',`
    float camDist=length(cameraPosition-p);
    n=normalize(vec3(slope.x+n.x/n.y,1.,slope.y+n.z/n.y));
    // Porous beach-sand van Genuchten (1980) capillary retention + wave-runup swash margin
    float dShore=vCoastalB.w;
    float tideFactor=max(.74+.26*exp(-max(0.,dShore)/24.),smoothstep(225.,270.,dShore));
    float localWT=coastalClimateA.x*tideFactor+coastalClimateA.y*(1.-exp(-max(0.,dShore)/42.));
    float swashMargin=.22*exp(-max(0.,dShore)/14.);
    float psi=max(0.,h-max(coastalClimateA.x*tideFactor+swashMargin,localWT));
    float alphaVG=1.65/max(.15,coastalClimateA.z);
    float Se=h<=coastalClimateA.x*tideFactor+.02?1.:pow(1.+pow(max(1e-6,alphaVG*psi),3.2),-.6875);
    // Gentle dry-only wind-drift wave bed contribution (never applied to submerged seafloor/swash)
    float sMod=fade*.18*smoothstep(.05,.45,cfSandMobility)*(1.-Se*.90)/(1.+camDist*.045);
    n=normalize(n+vec3(sSlope.x,0.,sSlope.y)*sMod);
    vec2 wSand=p.xz+survey;
    if(grain.x>0.){
     // Aperiodic multi-scale quartz sand relief with smooth footprint & asymptotic distance falloff
     float macroWash=.6*landNoise(wSand*.055+vec2(3.1,7.4))+.4*landNoise(vec2(wSand.x*.5+wSand.y*.866025,-wSand.x*.866025+wSand.y*.5)*.145-vec2(5.2,1.9));
     base*=.974+.052*macroWash;
     float mAA=1./(1.+span*2.2);
     if(mAA>.02){
      vec2 mP=vec2(wSand.x*.88295+wSand.y*.46947,-wSand.x*.46947+wSand.y*.88295)*.72;
      mP+=vec2(landNoise(wSand*.19)-.5,landNoise(wSand*.21+vec2(11.3,-4.7))-.5)*.65;
      float m0=landNoise(mP);
      float mx=landNoise(mP+vec2(.15,0.))-m0;
      float mz=landNoise(mP+vec2(0.,.15))-m0;
      vec2 mGrad=vec2(.88295*mx-.46947*mz,.46947*mx+.88295*mz)/.15;
      n=normalize(n-vec3(mGrad.x,0.,mGrad.y)*(.028*mAA*(1.-Se*.65)));
      base*=1.+(m0-.5)*.028*mAA;
     }
     float fAA=(1./(1.+span*24.0))*(1./(1.+(camDist/14.0)*(camDist/14.0)));
     if(fAA>.02){
      const float eps=.012;
      float q0=.52*landNoise(vec2(wSand.x*.83867+wSand.y*.54464,-wSand.x*.54464+wSand.y*.83867)*5.3)+.48*landNoise(vec2(-wSand.x*.39073+wSand.y*.92050,-wSand.x*.92050-wSand.y*.39073)*17.8);
      vec2 wX=wSand+vec2(eps,0.),wZ=wSand+vec2(0.,eps);
      float qx=.52*landNoise(vec2(wX.x*.83867+wX.y*.54464,-wX.x*.54464+wX.y*.83867)*5.3)+.48*landNoise(vec2(-wX.x*.39073+wX.y*.92050,-wX.x*.92050-wX.y*.39073)*17.8);
      float qz=.52*landNoise(vec2(wZ.x*.83867+wZ.y*.54464,-wZ.x*.54464+wZ.y*.83867)*5.3)+.48*landNoise(vec2(-wZ.x*.39073+wZ.y*.92050,-wZ.x*.92050-wZ.y*.39073)*17.8);
      vec2 qSlope=vec2(qx-q0,qz-q0)*.55*fAA*(1.-Se*.45);
      n=normalize(n-vec3(qSlope.x,0.,qSlope.y));
      base*=1.+(q0-.5)*.044*fAA*(1.-Se*.35);
     }
    }
    // Patchy, domain-warped aeolian quartz sand ripples modulated by sand mobility and dry exposure
    float ripPatch=smoothstep(.28,.80,landNoise(wSand*.085+vec2(4.1,-2.7)));
    float ripFade=(1./(1.+span*18.0))*(1./(1.+(camDist/26.0)*(camDist/26.0)))*smoothstep(.06,.40,cfSandMobility)*(1.-Se*.88)*ripPatch;
    if(ripFade>.003){
     float wAlong=dot(p.xz,coastalClimateB.yz);
     float ripplePhase=wAlong*22.+(landNoise(wSand*.55)-.5)*4.5;
     float ripSlope=cos(ripplePhase)*.020*ripFade;
     n=normalize(n+vec3(coastalClimateB.yz.x,0.,coastalClimateB.yz.y)*ripSlope);
    }
    // Twomey / Lekner-Dorf internal-reflection wet sand darkening
    base*=mix(vec3(1.),vec3(.47,.43,.36),pow(Se,.78)*.88);
    float seepFilm=smoothstep(.70,.96,Se);
    // Wave-sorted & wind-deflated heavy-mineral ilmenite/rutile streaks along foreshore berm
    float hmZone=smoothstep(-1.5,2.5,dShore)*(1.-smoothstep(22.,44.,dShore));
    if(hmZone>.005){
     float alongW=dot(wSand,vec2(.906308,-.422618));
     float streak=smoothstep(.64,.90,landNoise(vec2(alongW*.18,dShore*.72+sin(alongW*.14)*.85)));
     float fineSpeck=smoothstep(.76,.95,landNoise(wSand*15.));
     float hmAA=1./(1.+span*26.0);
     float microDark=hmZone*(streak*.042+hmAA*fineSpeck*.038*(.4+.6*streak+.3*cfSandMobility));
     base*=1.-microDark;
    }
    // Organic humus accumulation in sheltered wet swales and scrub litter
    base=mix(base,vec3(.24,.23,.16),cfOrganicMatter*.42);
    // Bleached white quartz sand in allelopathic Florida rosemary balds
    base=mix(base,vec3(.93,.90,.83),cfRosemaryInhibition*.34*(1.-Se*.8));
    // Emergent distant guild cover beyond HorizonStands (>420 m) with nebkha patch modulation and canopy micro-normal relief
    float remote=smoothstep(420.,980.,length(cameraPosition-p));
    if(remote>.001){
     vec2 wCoord=p.xz+survey;
     float wA=dot(wCoord,coastalClimateB.yz),wC=-wCoord.x*coastalClimateB.z+wCoord.y*coastalClimateB.y;
     float farPatch=smoothstep(.16,.80,.62*landNoise(vec2(wA/24.+3.7,wC/18.-5.1))+.38*landNoise(vec2(wA/8.5-7.3,wC/6.5+11.4)));
     float reedCover=smoothstep(-.48,-.05,h)*(1.-smoothstep(.15,.65,h))*smoothstep(.45,.82,cfMoisture)*(1.-smoothstep(.35,.65,cfSalinity))*(.55+.75*farPatch);
     float foreduneCover=smoothstep(16.,22.,dShore)*smoothstep(.45,1.25,h)*(1.-smoothstep(4.5,6.2,h))*smoothstep(.12,.55,cfSaltSpray)*(1.-cfRosemaryInhibition*.8)*(.35+1.15*farPatch);
     float scrubCover=smoothstep(48.,64.,dShore)*smoothstep(.65,1.55,h)*(1.-smoothstep(.18,.52,cfSandMobility))*(1.-smoothstep(.25,.52,cfSaltSpray))*(.70+.85*farPatch);
     vec3 guildTint=(vec3(.15,.20,.08)*reedCover+vec3(.34,.36,.18)*foreduneCover+vec3(.12,.20,.10)*scrubCover)/max(.001,reedCover+foreduneCover+scrubCover);
     float canopyTex=landNoise(wCoord/3.5);
     float totalCover=clamp((reedCover*.78+foreduneCover*.56+scrubCover*.88)*smoothstep(.14,.70,landNoise(wCoord/9.))*(.74+.42*canopyTex),0.,1.);
     base=mix(base,guildTint*(.82+.34*canopyTex),totalCover*.90*remote);
     float canopyBump=(landNoise(wCoord/2.4+vec2(.4,.0))-landNoise(wCoord/2.4-vec2(.4,.0)));
     float canopyBumpZ=(landNoise(wCoord/2.4+vec2(.0,.4))-landNoise(wCoord/2.4-vec2(.0,.4)));
     n=normalize(n+vec3(canopyBump,0.,canopyBumpZ)*(.45*remote*totalCover));
    }
    vec3 prior=n;`)
    .replace('vec2 finish=groundFinish(p.xz);',`if(farMix>0.){
      vec3 ray=p-cameraPosition;float delta=0.;
      if(abs(ray.y)>.06)delta=clamp((h-p.y)/ray.y,-.05,.12);
      vec3 at=mix(vec3(p.x,h,p.z),p+delta*ray,smoothstep(500.,1400.,abs(cameraPosition.y)));
      vec4 d=projectionMatrix*viewMatrix*vec4(at,1.);
      gl_FragDepth=clamp(.5+.5*d.z/d.w,0.,1.);
     }vec2 finish=groundFinish(p.xz);`)
    .replace('props.x=mix(props.x,min(props.x,.13),wet*.84);',`
     props.x=mix(props.x,min(props.x,.13),wet*.84);
     props.x=mix(props.x,.09,seepFilm*.92);`)
    .replace('vec3 lit=shade(base,n,p,props);',`
     float sunVis=sampleSunShadow(p,n);
     vec3 lit=shadeLit(base,n,p,props,sunVis);
     float subDepth=coastalClimateA.x-p.y;
     if(subDepth>.01&&sunDirection.y>.05&&sunVis>.02){
      float cFade=exp(-subDepth*.72)*smoothstep(.01,.14,subDepth)*smoothstep(32.,6.,length(cameraPosition-p));
      if(cFade>.005){
       vec2 uvC=p.xz*2.3+vec2(causticTime*.38,-causticTime*.27);
       float w1=abs(sin(uvC.x+sin(uvC.y*1.4+causticTime*.8))+.55*sin(uvC.y*1.3-cos(uvC.x*1.1-causticTime*.65)));
       float w2=abs(cos(uvC.x*1.65-uvC.y*.9+causticTime*.72)+.5*cos(uvC.y*1.8+sin(uvC.x*.85+causticTime*.5)));
       float cBand=pow(1.-clamp(min(w1,w2)*.55,0.,1.),3.5);
       lit+=base*sunColor*(cBand*cFade*sunVis*.42);
      }
     }
     vec3 vDir=normalize(cameraPosition-p);
     float fWet=.02+.98*pow(1.-max(0.,dot(n,vDir)),5.);
     lit=mix(lit,env(reflect(-vDir,n),props.x),seepFilm*fWet*.68);`)
    .replace('gl_FragColor=vec4(mix(lit,hazeColor,1.-exp(-length(cameraPosition-p)*.003)),1.);',`
     if(coastalOverlay>0){
      float v=coastalOverlay==1?cfMoisture:coastalOverlay==2?clamp(cfSaltSpray/1.3,0.,1.):coastalOverlay==3?clamp((cfWindExposure-.28)/1.3,0.,1.):coastalOverlay==4?clamp(cfSandMobility/1.4,0.,1.):cfSalinity;
      float contour=1.-smoothstep(.015,.045,abs(fract(h*2.)-.5));
      lit=mix(lit,coastalFieldRamp(v)*(.85-.32*contour),.82);
     }
     gl_FragColor=vec4(mix(lit,hazeColor,1.-exp(-length(cameraPosition-p)*.00028)),1.);`)});
  this.terrain=makeTerrainMaterial(false);
  this.sandPatchTerrain=makeTerrainMaterial(true);
  this.sandPatch=new T.Mesh(new T.BufferGeometry(),this.sandPatchTerrain);
  this.sandPatch.frustumCulled=false;
  this.sandPatch.visible=false;
  this._sandPatchVersion=-1;
  view.scene.add(this.sandPatch);
  this.reeds=new WetlandReeds(view,lighting);
  this.props=new CoastalPropsView(view,lighting);
  this.ecology=new CoastalEcologySim();
  this.fauna=new CoastalFaunaView(view,lighting);
  this._lastSimClock=undefined;
  this._faunaSeed=undefined;
 }

 setOverlay(mode='natural'){
  this.uniforms.coastalOverlay.value=COASTAL_OVERLAY_MODES[mode]??0;
 }

 setClimate(climate=DEFAULT_COASTAL_CLIMATE,atm=null){
  const a=atm??climateAtmosphere(climate);
  const c=a.climate,h=a.hydrology;
  const rad=c.prevailingWindHeading*Math.PI/180;
  this.uniforms.coastalClimateA.value.set(c.seaLevelOffset,h.lensHeight,h.capillaryFringe,h.saltScale);
  this.uniforms.coastalClimateB.value.set(h.moistureIndex,Math.cos(rad),Math.sin(rad),h.sandScale);
  this.skyUniforms.skyZenith.value.setRGB(...a.skyZenith);
  this.skyUniforms.skyHorizon.value.setRGB(...a.skyHorizon);
  this.skyUniforms.cloudCover.value=c.cloudCover;
 }

 configure(land,library){
  this.land=land;this.uniforms.survey.value.set(land.x,land.z);
  const climate=library.world.climate??land.climate;
  this.setClimate(climate,climateAtmosphere(climate,land.sandMaterial));
  const assets=reedFamily(library);
  const placed=library.world.instances.filter(i=>assets.some(a=>instancedReed(a)&&a.id===i.assetId));
  this.reeds.configure(assets,library.materials,placed);
  for(const s of this.reeds.placed){
   const y=land.height(s.x,s.z);
   s.slopeX=(land.height(s.x+0.4,s.z)-y)/0.4;
   s.slopeZ=(land.height(s.x,s.z+0.4)-y)/0.4;
  }
  this.props.configure();
  if(this._faunaSeed!==land.seed){
   this.ecology.reset(land.seed);
   this.fauna.configure(land);
   this._lastSimClock=undefined;
   this._faunaSeed=land.seed;
  }
  this.fauna.syncPlaced(library,land);
  for(const i of placed)this.view.groups.get(i.id).visible=false;
 }

 syncPlacedFauna(library){
  if(this.land)this.fauna.syncPlaced(library,this.land);
 }

 disturbFauna(x,y,z,kind='vibration',intensity=1,radius=4.5,vx=0,vz=0){
  return this.fauna.sim.emitStimulus(x,y,z,kind,intensity,radius,vx,0,vz);
 }

 updateSandPatch(sandTerrain,granular){
  if(!granular||!sandTerrain?.version){
   if(this.sandPatch.visible)this.sandPatch.visible=false;
   this.uniforms.sandPatchActive.value=false;
   if(this._sandPatchVersion!==-1){
    this._sandPatchVersion=-1;
    this.sandPatch.geometry.dispose();
    this.sandPatch.geometry=new T.BufferGeometry();
   }
   return;
  }
  if(sandTerrain.version!==this._sandPatchVersion){
   this._sandPatchVersion=sandTerrain.version;
   const nextGeo=buildSandPatchGeometry(sandTerrain);
   this.sandPatch.geometry.dispose();
   this.sandPatch.geometry=nextGeo;
  }
  const hasGeo=Boolean(this.sandPatch.geometry.index?.count);
  this.sandPatch.visible=hasGeo;
  this.uniforms.sandPatchActive.value=hasGeo;
 }

 onGroundDisturb(ev,physics=null){
  if(!ev||!this.land)return;
  const st=physics?.sandTerrain||null;
  this.props.disturb?.(ev,this.land,st);
  this.reeds.disturb?.(ev,this.land,st);
  const intens=ev.kind==='impulse'?Math.min(1.6,0.55+(ev.force||0)/3500):0.85;
  this.disturbFauna(ev.point.x,ev.point.y,ev.point.z,'vibration',intens,Math.max(4.5,(ev.reach||1.4)*2.2));
 }

 resetDisturbances(){
  this.props.resetDisturbances?.();
  this.reeds.resetDisturbances?.();
  this.updateSandPatch(null,false);
 }

 update(view,wind,time){
  const near=Math.max(.03,(Math.abs(view.camera.position.y)-9)*.012);
  if(view.camera.near!==near){view.camera.near=near;view.camera.updateProjectionMatrix();}
  this.uniforms.landEye.value.set(view.camera.position.x,view.camera.position.z);
  const simClock=view.activePhysics?view.activePhysics.time:(view.sea?.time??(typeof performance!=='undefined'?performance.now()*.001:time));
  this.uniforms.causticTime.value=simClock;
  const rawDt=this._lastSimClock===undefined?.016:(simClock-this._lastSimClock);
  this._lastSimClock=simClock;
  const dt=rawDt>0?Math.min(.08,rawDt):.016;
  const sandTerrain=view.activePhysics?.sandTerrain||null;
  this.updateSandPatch(sandTerrain,!!view.groundMaterial.uniforms.granular?.value);
  this.reeds.update(this.land,view.camera,wind,time,view,dt,sandTerrain);
  this.props.update(this.land,view.camera,dt,sandTerrain);
  this.ecology.advanceRealSeconds(dt,this.land.climate,wind);
  this.fauna.update(this.land,view.camera,wind,view.sea,dt,this.ecology,view.activePhysics);
  this.fauna.animatePlaced(view,this.land,view.sea,wind);
 }

 dispose(){
  this.sky.removeFromParent();
  this.sky.geometry.dispose();
  this.sky.material.dispose();
  this.geometry.dispose();
  this.terrain.dispose();
  this.sandPatch.removeFromParent();
  this.sandPatch.geometry.dispose();
  this.sandPatchTerrain.dispose();
  this.reeds.dispose();
  this.props.dispose();
  this.fauna.dispose();
 }
}
