// Continuous scale-space Gaussian LOD helpers for coastal vegetation:
// - 3x3 symmetric Jacobi eigensolver for moment-matched covariance ellipsoids
// - Per-unit non-bridging botanical proxy fitting with Beer-Lambert optical porosity
// - Inverse-Beer-Lambert perceptual alpha ramp & early gentle camera-speed coarsening
// - Unbounded HorizonStands generator matching species heights, tones, and guild aspects
import * as T from 'three';
import {markProfile,ribbonWidth} from './gaussian-marks.js';
import {reedPartMatrix} from './reed-stand.js';
import {COASTAL_SPECIES,SPECIES_BY_ID,speciesSuitability} from './coastal-flora.js';

export const HORIZON_TILE=54;
const LOG20=Math.log(20);
const clamp=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const GOLDEN_FRAC=0.6180339887498949;

// Fast rolling FNV-1a 32-bit hash of active (x,z) tile coordinates for camera-rotation-safe cache invalidation.
export function fnvTiles(list){
 let h=2166136261>>>0;
 for(let i=0;i<list.length;i++){
  const t=list[i];
  h=Math.imul(h^(t.x|0),16777619)>>>0;
  h=Math.imul(h^(t.z|0),16777619)>>>0;
 }
 return h>>>0;
}

// Inverse-Beer-Lambert fade curve so solitary lobes/crowns dissolve linearly in perceived alpha (95% -> 0%).
export function perceptualAlphaScale(t){
 if(t<=0)return 0;
 const u=Math.min(1,t);
 return -Math.log(Math.max(0.045,1-0.95*u))/LOG20;
}

// Early, gentle camera-speed-proportional coarsening factor (>= 1.0) affecting internal LOD transitions only.
export function cameraCoarseningFactor(speed){
 return 1+0.80*smooth((Math.max(0,speed)-0.6)/21.4);
}

// Canonical LOD distance thresholds synced with reedVertex GLSL.
export function lodRangesForMaxDist(maxRange=280){
 const treeF=clamp((maxRange-195)/175,0,1);
 return {
  treeF,
  dFineStart:7+5*treeF,
  d01Lo:14+10*treeF,
  d01Hi:24+16*treeF,
  d12Lo:38+26*treeF,
  d12Hi:64+40*treeF,
  tOutLo:maxRange*0.68,
  tOutHi:maxRange
 };
}

export function lodBlendWeights(dist,maxRange=280,speedScale=1){
 const r=lodRangesForMaxDist(maxRange);
 const eff=dist*Math.max(1,speedScale);
 const t01=smooth((eff-r.d01Lo)/(r.d01Hi-r.d01Lo));
 const t12=smooth((eff-r.d12Lo)/(r.d12Hi-r.d12Lo));
 const detail=1-smooth((eff-r.dFineStart)/(r.d01Lo-r.dFineStart));
 const tOut=perceptualAlphaScale(1-smooth((dist-r.tOutLo)/(r.tOutHi-r.tOutLo)));
 const horizonIn=perceptualAlphaScale(smooth((dist-220)/135));
 const horizonOut=perceptualAlphaScale(1-smooth((dist-760)/390));
 return {
  detail:(1-t01)*detail,
  lod0:1-t01,
  lod1:t01*(1-t12),
  lod2:t12*tOut,
  horizon:horizonIn*horizonOut
 };
}

// Deterministic predicate shared identically by LOD 0 and LOD 1 so primary core crowns match 1:1.
// Uniform survival ensures flowers/accents never outlive their supporting leaves and stems.
export function isPrimaryCoastalMark(mark,index){
 if(mark.id.startsWith('plate-')||mark.id.startsWith('buttress-')||mark.id.startsWith('areole-')||mark.id.startsWith('cladode-b-'))return false;
 if(mark.id.startsWith('cladode-')||mark.id.startsWith('husk-'))return true;
 const rank=(index*GOLDEN_FRAC)%1;
 return rank<0.56;
}

// 8-sweep Jacobi eigensolver for a 3x3 real symmetric matrix.
// Returns eigenvalues sorted descending (clamped >= 1e-6) and right-handed orthonormal eigenvectors.
export function eigenSymmetric3(c00,c01,c02,c11,c12,c22){
 const a=[c00,c01,c02,c01,c11,c12,c02,c12,c22];
 const v=[1,0,0,0,1,0,0,0,1];
 const pairs=[[0,1],[0,2],[1,2]];
 for(let sweep=0;sweep<8;sweep++){
  for(const [p,q] of pairs){
   const apq=a[p*3+q];
   if(Math.abs(apq)<1e-13)continue;
   const app=a[p*3+p],aqq=a[q*3+q];
   const tau=(aqq-app)/(2*apq);
   const t=tau>=0?1/(tau+Math.sqrt(1+tau*tau)):-1/(-tau+Math.sqrt(1+tau*tau));
   const c=1/Math.sqrt(1+t*t),s=t*c;
   for(let k=0;k<3;k++){
    if(k===p||k===q)continue;
    const akp=a[k*3+p],akq=a[k*3+q];
    a[k*3+p]=a[p*3+k]=c*akp-s*akq;
    a[k*3+q]=a[q*3+k]=s*akp+c*akq;
   }
   a[p*3+p]=c*c*app-2*s*c*apq+s*s*aqq;
   a[q*3+q]=s*s*app+2*s*c*apq+c*c*aqq;
   a[p*3+q]=a[q*3+p]=0;
   for(let k=0;k<3;k++){
    const vkp=v[k*3+p],vkq=v[k*3+q];
    v[k*3+p]=c*vkp-s*vkq;
    v[k*3+q]=s*vkp+c*vkq;
   }
  }
 }
 const cols=[0,1,2].map(j=>({val:Math.max(1e-6,a[j*3+j]),vec:[v[j],v[3+j],v[6+j]]})).sort((x,y)=>y.val-x.val);
 const v0=cols[0].vec,v1=cols[1].vec,v2=cols[2].vec;
 const cross=[v0[1]*v1[2]-v0[2]*v1[1],v0[2]*v1[0]-v0[0]*v1[2],v0[0]*v1[1]-v0[1]*v1[0]];
 if(cross[0]*v2[0]+cross[1]*v2[1]+cross[2]*v2[2]<0){v2[0]=-v2[0];v2[1]=-v2[1];v2[2]=-v2[2];}
 return {values:cols.map(c=>c.val),vectors:[v0,v1,v2]};
}

function outerScaled(vx,vy,vz,scale,out){
 out[0]+=vx*vx*scale;out[1]+=vx*vy*scale;out[2]+=vx*vz*scale;
 out[3]+=vy*vy*scale;out[4]+=vy*vz*scale;out[5]+=vz*vz*scale;
}

function fitItemCluster(items,{spreadScale=1.20,minRadius=0.04,maxRadius=Infinity,soft=0.58,crownTop=1.0,densityFloor=0.14,densityCeil=1.25,densityScaleOverride=null,aoOverride=null}={}){
 if(!items.length)return null;
 let wSum=0,areaSum=0,mx=0,my=0,mz=0,r=0,g=0,b=0,tr=0;
 for(const it of items){
  wSum+=it.w;
  areaSum+=it.area??it.w;
  mx+=it.x*it.w;my+=it.y*it.w;mz+=it.z*it.w;
  r+=it.r*it.w;g+=it.g*it.w;b+=it.b*it.w;tr+=it.trans*it.w;
 }
 if(wSum<=0)return null;
 mx/=wSum;my/=wSum;mz/=wSum;r/=wSum;g/=wSum;b/=wSum;tr/=wSum;
 const cov=[0,0,0,0,0,0];
 for(const it of items){
  const f=it.w/wSum;
  for(let k=0;k<6;k++)cov[k]+=it.cov[k]*f;
  outerScaled(it.x-mx,it.y-my,it.z-mz,f,cov);
 }
 const eig=eigenSymmetric3(cov[0],cov[1],cov[2],cov[3],cov[4],cov[5]);
 const s0=clamp(Math.sqrt(eig.values[0])*spreadScale,minRadius,maxRadius);
 const s1=clamp(Math.sqrt(eig.values[1])*spreadScale,minRadius*0.75,maxRadius);
 const s2=clamp(Math.sqrt(eig.values[2])*spreadScale,Math.max(0.012,minRadius*0.32),s1*0.92);
 const v0=eig.vectors[0],v1=eig.vectors[1];
 const thirdRatio=clamp(s2/s1,0.20,0.92);
 // Cauchy average projected ellipsoid area (2D shadow integral across views) calibrated against
 // Beer-Lambert ribbon transmittance so airy grass fans match LOD 1 optical area without blooming.
 const ellCross=Math.PI*(0.58*s0*s1+0.24*s0*s2+0.18*s1*s2);
 const fill=areaSum/Math.max(0.002,ellCross*1.40);
 const densityScale=densityScaleOverride??clamp(fill*0.80,densityFloor,densityCeil);
 const ao=aoOverride??(0.76+0.20*clamp(my/Math.max(0.25,crownTop),0,1));
 return {
  center:[mx,my,mz],
  axis:[v0[0]*s0,v0[1]*s0,v0[2]*s0],
  width:[v1[0]*s1,v1[1]*s1,v1[2]*s1],
  thirdRatio,
  tint:[r,g,b],
  translucency:tr,
  ao,
  soft,
  densityScale
 };
}

function splitAlongPrincipalAxis(items,targetK,opts){
 if(!items.length)return [];
 if(targetK<=1||items.length<4){const e=fitItemCluster(items,opts);return e?[e]:[];}
 let wSum=0,mx=0,my=0,mz=0;
 for(const it of items){wSum+=it.w;mx+=it.x*it.w;my+=it.y*it.w;mz+=it.z*it.w;}
 mx/=wSum;my/=wSum;mz/=wSum;
 const cov=[0,0,0,0,0,0];
 for(const it of items)outerScaled(it.x-mx,it.y-my,it.z-mz,it.w/wSum,cov);
 const v0=eigenSymmetric3(cov[0],cov[1],cov[2],cov[3],cov[4],cov[5]).vectors[0];
 const buckets=Array.from({length:targetK},()=>[]);
 const proj=items.map(it=>({it,p:(it.x-mx)*v0[0]+(it.y-my)*v0[1]+(it.z-mz)*v0[2]})).sort((a,b)=>a.p-b.p);
 const pMin=proj[0].p,pSpan=Math.max(1e-4,proj[proj.length-1].p-pMin);
 for(const entry of proj){
  const bi=Math.min(targetK-1,Math.floor(((entry.p-pMin)/pSpan)*targetK));
  buckets[bi].push(entry.it);
 }
 const out=[];
 for(const b of buckets){
  if(!b.length)continue;
  const e=fitItemCluster(b,opts);
  if(e)out.push(e);
 }
 return out;
}

function clusterSpread(items){
 if(items.length<=1)return 0;
 let wSum=0,mx=0,my=0,mz=0;
 for(const it of items){wSum+=it.w;mx+=it.x*it.w;my+=it.y*it.w;mz+=it.z*it.w;}
 mx/=wSum;my/=wSum;mz/=wSum;
 let maxD=0;
 for(const it of items){
  const d=Math.hypot(it.x-mx,it.y-my,it.z-mz);
  if(d>maxD)maxD=d;
 }
 return maxD;
}

function sampleMarkItems(mark,partMatrix,colorOf,roughOf,weightScale=1){
 const root=new T.Vector3(...mark.root),axis=new T.Vector3(...mark.axis),normal=new T.Vector3(...mark.up);
 const side=new T.Vector3().crossVectors(axis,normal).normalize();
 const profile=markProfile(mark);
 const isDab=mark.kind==='dab';
 const avgProf=ribbonWidth(0.5,...profile);
 const area=(isDab?1.45:1.10)*mark.length*mark.length*Math.max(0.04,mark.width*(isDab?1.0:avgProf));
 const mc=colorOf(mark.materialId),rough=roughOf(mark.materialId);
 const trans=rough<0.55?0.36:0.44;
 const ts=isDab?[0.50]:[0.20,0.55,0.85];
 const nSeg=ts.length;
 const segLen=mark.length/(nSeg*1.8);
 const out=[];
 const pos=new T.Vector3(),dir=new T.Vector3(),sWorld=new T.Vector3(),norm=new T.Vector3();
 for(const t of ts){
  const prof=isDab?1.0:(0.045+0.955*ribbonWidth(t,...profile));
  if(isDab){
   dir.copy(axis).addScaledVector(normal,0.48*mark.curl).normalize();
   pos.copy(root).addScaledVector(dir,mark.length*t).applyMatrix4(partMatrix);
   sWorld.copy(side).transformDirection(partMatrix);
   dir.transformDirection(partMatrix);
  }else{
   pos.copy(root).addScaledVector(axis,mark.length*t).addScaledVector(normal,mark.length*mark.curl*0.48*t*t).applyMatrix4(partMatrix);
   dir.copy(axis).addScaledVector(normal,mark.curl*0.96*t).normalize().transformDirection(partMatrix);
   sWorld.copy(side).transformDirection(partMatrix);
  }
  norm.crossVectors(dir,sWorld).normalize();
  const sigL=Math.max(0.015,segLen);
  const sigW=Math.max(0.012,(isDab?0.52:0.44)*mark.length*mark.width*prof);
  const sigT=isDab?sigW*0.45:Math.max(0.008,sigW*0.18);
  const cov=[0,0,0,0,0,0];
  outerScaled(dir.x,dir.y,dir.z,sigL*sigL,cov);
  outerScaled(sWorld.x,sWorld.y,sWorld.z,sigW*sigW,cov);
  outerScaled(norm.x,norm.y,norm.z,sigT*sigT,cov);
  out.push({
   x:pos.x,y:pos.y,z:pos.z,
   w:Math.max(0.002,(area/nSeg)*weightScale),
   area:area/nSeg,
   cov,r:mc.r,g:mc.g,b:mc.b,trans
  });
 }
 return out;
}

// Moment-matched 3D covariance proxy builder for Tier 2 crowns.
// Fits per-morphological-unit proxies with Beer-Lambert optical porosity calibration
// so LOD 2 faithfully preserves LOD 1 silhouettes, aspect ratios, and colors without bridging empty gaps.
export function fitCovarianceEllipsoids(asset,materials){
 const matMap=new Map(materials.map(m=>[m.id,m]));
 const colorOf=id=>new T.Color(matMap.get(id)?.color??'#778349');
 const roughOf=id=>matMap.get(id)?.roughness??0.7;

 let crownTop=0.5;
 const trunkSegments=[];
 const unitMap=new Map();
 const pA=new T.Vector3(),pB=new T.Vector3(),mid=new T.Vector3(),dir=new T.Vector3(),side=new T.Vector3(),norm=new T.Vector3();

 const getUnit=key=>{
  let u=unitMap.get(key);
  if(!u){u={key,veg:[],plumes:[],blooms:[],isPad:false,isFan:false,isStolon:false,isShoot:false};unitMap.set(key,u);}
  return u;
 };

 for(const part of asset.parts){
  const m=reedPartMatrix(part),stem=part.stamps[0],L=2*stem.size[1],rStem=stem.size[0];
  pA.set(0,0,0).applyMatrix4(m);pB.set(0,L,0).applyMatrix4(m);
  crownTop=Math.max(crownTop,pA.y,pB.y);
  const isWoody=stem.materialId==='pine-bark'||stem.materialId==='scrub-bark'||stem.materialId==='palm-trunk';

  if(isWoody&&rStem>=0.085){
   mid.copy(pA).add(pB).multiplyScalar(0.5);
   dir.copy(pB).sub(pA);
   const span=Math.max(0.05,dir.length());
   dir.divideScalar(span);
   const ref=Math.abs(dir.y)<0.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0);
   side.crossVectors(dir,ref).normalize();
   norm.crossVectors(side,dir).normalize();
   const s0=span*0.49,s1=rStem*0.72,s2=rStem*0.72;
   const sc=colorOf(stem.materialId);
   trunkSegments.push({
    center:[mid.x,mid.y,mid.z],
    axis:[dir.x*s0,dir.y*s0,dir.z*s0],
    width:[side.x*s1,side.y*s1,side.z*s1],
    thirdRatio:clamp(s2/s1,0.22,0.92),
    tint:[sc.r,sc.g,sc.b],
    translucency:0.0,
    ao:0.80,
    soft:0.20,
    densityScale:1.0
   });
  }

  // Pair grass base-t + tip-t into unified shoots; group every other structural part individually
  const pid=part.id;
  let unitKey=pid;
  const isShoot=pid.startsWith('base-')||pid.startsWith('tip-');
  if(isShoot)unitKey='shoot-'+pid.slice(pid.indexOf('-')+1);
  const unit=getUnit(unitKey);
  if(isShoot)unit.isShoot=true;
  if(pid.startsWith('pad-'))unit.isPad=true;
  if(pid.startsWith('petiole-'))unit.isFan=true;
  if(pid.startsWith('stolon-'))unit.isStolon=true;

  // Contribute slender stem structure for herbaceous shoots, stolons, petioles, and shrub stems (without dwarfing foliage)
  const includeStem=(!isWoody&&rStem>0)||part.marks.some(mk=>mk.materialId==='myrtle-leaf'||mk.materialId==='rosemary-needle');
  if(includeStem&&L>0.08&&!pid.startsWith('pad-')&&pid!=='crown'){
   const sc=colorOf(stem.materialId);
   for(const t of [0.25,0.55,0.85]){
    mid.copy(pA).lerp(pB,t);
    dir.copy(pB).sub(pA).normalize();
    const ref=Math.abs(dir.y)<0.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0);
    side.crossVectors(dir,ref).normalize();
    norm.crossVectors(side,dir).normalize();
    const cov=[0,0,0,0,0,0];
    outerScaled(dir.x,dir.y,dir.z,(L*0.18)**2,cov);
    outerScaled(side.x,side.y,side.z,(rStem*0.65)**2,cov);
    outerScaled(norm.x,norm.y,norm.z,(rStem*0.65)**2,cov);
    const stemArea=(L/3)*rStem*1.1;
    unit.veg.push({
     x:mid.x,y:mid.y,z:mid.z,
     w:stemArea*(unit.isStolon?0.55:0.42),
     area:stemArea*0.6,
     cov,r:sc.r,g:sc.g,b:sc.b,trans:0.08
    });
   }
  }

  for(const mark of part.marks||[]){
   if(mark.id.startsWith('plate-')||mark.id.startsWith('buttress-')||mark.id.startsWith('areole-'))continue;
   const isPlume=mark.id.startsWith('spikelet')||mark.id.startsWith('oat-')||mark.id.startsWith('panicle-');
   const isBloom=mark.id.startsWith('bloom-')||mark.id.startsWith('ray-')||mark.id.startsWith('head-')||mark.id.startsWith('fruit-');
   if(isPlume){
    unit.plumes.push(...sampleMarkItems(mark,m,colorOf,roughOf,1.0));
   }else if(isBloom){
    unit.blooms.push(...sampleMarkItems(mark,m,colorOf,roughOf,0.72));
   }else{
    unit.veg.push(...sampleMarkItems(mark,m,colorOf,roughOf,1.0));
   }
   const rWorld=pA.fromArray(mark.root).addScaledVector(pB.fromArray(mark.axis),mark.length).applyMatrix4(m);
   crownTop=Math.max(crownTop,rWorld.y);
  }
 }

 const out=[...trunkSegments];
 const activeUnits=[...unitMap.values()].filter(u=>u.veg.length||u.plumes.length||u.blooms.length);
 const maxTotal=9;

 // Allocate subdivisions conservatively so total ellipsoids per species stays <= 9
 const vegCandidates=[];
 const extraElls=[];
 for(const u of activeUnits){
  let vegItems=u.veg;
  const vegArea=vegItems.reduce((s,it)=>s+it.area,0);
  const bloomArea=u.blooms.reduce((s,it)=>s+it.area,0);
  if(u.blooms.length){
   const bSpread=clusterSpread(u.blooms);
   if(bSpread<0.16&&bloomArea>=vegArea*0.10&&out.length+extraElls.length+activeUnits.length<maxTotal){
    const be=fitItemCluster(u.blooms,{spreadScale:1.52,minRadius:0.048,maxRadius:0.095,soft:0.46,crownTop,densityFloor:0.42,densityCeil:1.05});
    if(be)extraElls.push(be);
   }else if(!u.isStolon){
    for(const b of u.blooms)vegItems.push({...b,w:b.w*0.35});
   }
  }
  if(u.plumes.length){
   if(out.length+extraElls.length+activeUnits.length<=maxTotal){
    const pe=fitItemCluster(u.plumes,{spreadScale:1.12,minRadius:0.036,soft:0.52,crownTop,densityFloor:0.20,densityCeil:0.92});
    if(pe)extraElls.push(pe);
   }else{
    vegItems=[...vegItems,...u.plumes];
   }
  }
  if(vegItems.length)vegCandidates.push({u,vegItems});
 }

 let remBudget=Math.max(vegCandidates.length,maxTotal-out.length-extraElls.length);
 let splitsLeft=Math.max(0,remBudget-vegCandidates.length);
 for(const {u,vegItems} of vegCandidates){
  const wantSplit=splitsLeft>0&&(u.isFan||u.isStolon||u.isShoot||vegItems.length>=28)&&!u.isPad;
  const k=wantSplit?2:1;
  if(wantSplit)splitsLeft--;
  const opts={
   spreadScale:u.isPad?1.72:u.isStolon?1.44:u.isFan?1.26:u.isShoot?1.08:1.34,
   minRadius:0.032,
   soft:u.isPad?0.34:u.isShoot?0.50:0.58,
   crownTop,
   densityFloor:u.isPad?0.85:u.isShoot?0.17:0.18,
   densityCeil:u.isShoot?0.50:1.25
  };
  for(const ve of splitAlongPrincipalAxis(vegItems,k,opts)){
   if(out.length+extraElls.length<maxTotal)out.push(ve);
  }
 }
 for(const ee of extraElls)if(out.length<maxTotal)out.push(ee);
 return out;
}

// Precomputed linear RGB stand palette calibrated directly from COASTAL_SPECIES material colors.
const LIN=hex=>new T.Color(hex).toArray();
const PAL={
 pineBark:LIN('#6b4f3d'),
 palmBark:LIN('#847768'),
 pineCanopy:LIN('#2c4e2c'),
 oakScrub:LIN('#3d5a37'),
 rosemary:LIN('#4f6348'),
 myrtle:LIN('#576e3e'),
 palmetto:LIN('#466f4f'),
 cordgrass:LIN('#63823d'),
 seaOat:[0.62*LIN('#7c8f52')[0]+0.38*LIN('#dcc27e')[0],0.62*LIN('#7c8f52')[1]+0.38*LIN('#dcc27e')[1],0.62*LIN('#7c8f52')[2]+0.38*LIN('#dcc27e')[2]],
 panic:LIN('#5a867b'),
 reed:[0.70*LIN('#527839')[0]+0.30*LIN('#c4a86e')[0],0.70*LIN('#527839')[1]+0.30*LIN('#c4a86e')[1],0.70*LIN('#527839')[2]+0.30*LIN('#c4a86e')[2]],
 rush:LIN('#42543a')
};

function horizonHash(hx,hz,salt){
 let n=(Math.imul(hx,73856093)^Math.imul(hz,19349663)^salt)>>>0;
 n=Math.imul(n^(n>>>16),2246822519);
 n=Math.imul(n^(n>>>13),3266489917);
 return ((n^(n>>>16))>>>0)/4294967296;
}

// Deterministic 3D far-distance vegetation stand ellipsoids across 54x54 m tiles (active ~220–1150 m).
// Matches true ecological zonation, heights, and aspect ratios of Tier 2 crowns (zero flat discs).
export function horizonStandsForCell(land,hx,hz){
 if(!land||typeof land.environment!=='function')return [];
 const out=[];
 const sea=land.climate?.seaLevelOffset??0;
 const slashSpec=SPECIES_BY_ID.get('slash-pine');
 const sandPineSpec=SPECIES_BY_ID.get('sand-pine');
 const palmSpec=SPECIES_BY_ID.get('cabbage-palm');
 const oakSpec=SPECIES_BY_ID.get('sand-live-oak');
 const myrtleSpec=SPECIES_BY_ID.get('wax-myrtle');
 const rosemarySpec=SPECIES_BY_ID.get('rosemary');
 const palmettoSpec=SPECIES_BY_ID.get('saw-palmetto');
 const reedSpec=SPECIES_BY_ID.get('coastal-reed');
 const cordgrassSpec=SPECIES_BY_ID.get('smooth-cordgrass');
 const rushSpec=SPECIES_BY_ID.get('needlerush');
 const oatSpec=SPECIES_BY_ID.get('sea-oats');
 const panicSpec=SPECIES_BY_ID.get('bitter-panic');

 const sub=9,step=HORIZON_TILE/sub;
 for(let sz=0;sz<sub;sz++)for(let sx=0;sx<sub;sx++){
  const idx=sz*sub+sx;
  const rx=horizonHash(hx,hz,(land.seed+idx*97+11)>>>0);
  const rz=horizonHash(hx,hz,(land.seed+idx*193+29)>>>0);
  const rt=horizonHash(hx,hz,(land.seed+idx*311+53)>>>0);
  const rv=horizonHash(hx,hz,(land.seed+idx*419+79)>>>0);
  const rk=horizonHash(hx,hz,(land.seed+idx*547+101)>>>0);
  const px=hx*HORIZON_TILE+(sx+0.12+0.76*rx)*step;
  const pz=hz*HORIZON_TILE+(sz+0.12+0.76*rz)*step;
  const y=land.height(px,pz);
  const d=land.shoreDistance(px,pz);
  if(y<sea-0.38||d<16.0)continue;
  const env=land.environment(px,pz,y);
  const patch=typeof land.nebkhaPatch==='function'?land.nebkhaPatch(px,pz):0.5;
  const yaw=rt*Math.PI*2;

  const wSlash=speciesSuitability(slashSpec,env)*(0.85+1.65*patch);
  const wSandPine=speciesSuitability(sandPineSpec,env)*(0.85+1.65*patch);
  const wPalm=palmSpec?speciesSuitability(palmSpec,env)*(0.85+1.65*patch):0;
  const wOak=speciesSuitability(oakSpec,env)*(0.85+1.65*patch);
  const wMyrtle=speciesSuitability(myrtleSpec,env)*(0.55+0.90*patch);
  const wRose=speciesSuitability(rosemarySpec,env)*0.70;
  const wPalmScrub=speciesSuitability(palmettoSpec,env)*(0.35+0.85*patch);
  const wReed=speciesSuitability(reedSpec,env)*(0.55+0.75*patch);
  const wCord=cordgrassSpec?speciesSuitability(cordgrassSpec,env)*(0.55+0.75*patch):0;
  const wRush=speciesSuitability(rushSpec,env)*(0.55+0.75*patch);
  const wOat=speciesSuitability(oatSpec,env)*(0.25+1.35*patch);
  const wPanic=speciesSuitability(panicSpec,env)*(0.25+1.35*patch);

  const cands=[
   ['slash',wSlash],['sand-pine',wSandPine],['cabbage-palm',wPalm],['oak',wOak],['myrtle',wMyrtle],
   ['rosemary',wRose],['palmetto',wPalmScrub],['reed',wReed],['cordgrass',wCord],['rush',wRush],
   ['oat',wOat],['panic',wPanic]
  ];
  let total=0,bestW=0;
  for(const [,w] of cands){total+=w;if(w>bestW)bestW=w;}
  if(total<=1e-4||rk>=Math.min(0.95,bestW*1.35))continue;

  let pick=rt*total,guild=cands[0][0];
  for(const [id,w] of cands){pick-=w;if(pick<=0){guild=id;break;}}

  if(guild==='slash'){
   const hScale=7.8+2.8*rv;
   const rCanopy=1.85+0.80*rx;
   const halfH=1.35+0.55*rz;
   out.push({x:px,y:y+hScale*0.38,z:pz,yaw,radXZ:0.20+0.05*rz,halfH:hScale*0.38,leanX:env.windDirX*0.04,leanZ:env.windDirZ*0.04,rgb:PAL.pineBark,ao:0.80,thickRatio:0.90,density:0.85,soft:0.24});
   out.push({x:px+env.windDirX*0.25,y:y+hScale*0.82,z:pz+env.windDirZ*0.25,yaw,radXZ:rCanopy,halfH,leanX:env.windDirX*0.06,leanZ:env.windDirZ*0.06,rgb:PAL.pineCanopy,ao:0.94,thickRatio:0.84,density:0.78,soft:0.86});
  }else if(guild==='sand-pine'){
   const hScale=5.2+2.4*rv;
   out.push({x:px,y:y+hScale*0.34,z:pz,yaw,radXZ:0.17+0.04*rz,halfH:hScale*0.35,leanX:env.windDirX*0.08,leanZ:env.windDirZ*0.08,rgb:PAL.pineBark,ao:0.78,thickRatio:0.90,density:0.80,soft:0.24});
   out.push({x:px+env.windDirX*0.3,y:y+hScale*0.66,z:pz+env.windDirZ*0.3,yaw,radXZ:1.60+0.75*rx,halfH:1.25+0.55*rz,leanX:env.windDirX*0.10,leanZ:env.windDirZ*0.10,rgb:PAL.pineCanopy,ao:0.92,thickRatio:0.84,density:0.76,soft:0.86});
  }else if(guild==='cabbage-palm'){
   const hScale=5.2+2.0*rv;
   out.push({x:px,y:y+hScale*0.42,z:pz,yaw,radXZ:0.16+0.04*rz,halfH:hScale*0.42,leanX:env.windDirX*0.05,leanZ:env.windDirZ*0.05,rgb:PAL.palmBark,ao:0.82,thickRatio:0.92,density:0.84,soft:0.22});
   out.push({x:px+env.windDirX*0.18,y:y+hScale*0.88,z:pz+env.windDirZ*0.18,yaw,radXZ:1.45+0.45*rx,halfH:0.95+0.35*rz,leanX:env.windDirX*0.08,leanZ:env.windDirZ*0.08,rgb:PAL.palmetto,ao:0.93,thickRatio:0.86,density:0.78,soft:0.84});
  }else if(guild==='oak'){
   out.push({x:px+env.windDirX*0.3,y:y+1.65+0.75*rv,z:pz+env.windDirZ*0.3,yaw,radXZ:1.70+0.75*rx,halfH:1.15+0.48*rz,leanX:env.windDirX*0.14,leanZ:env.windDirZ*0.14,rgb:PAL.oakScrub,ao:0.90,thickRatio:0.86,density:0.76,soft:0.86});
  }else if(guild==='myrtle'||guild==='rosemary'||guild==='palmetto'){
   const rgb=guild==='myrtle'?PAL.myrtle:guild==='rosemary'?PAL.rosemary:PAL.palmetto;
   const radXZ=1.05+0.55*rx;
   const halfH=0.72+0.45*rz;
   out.push({x:px,y:y+halfH*1.05,z:pz,yaw,radXZ,halfH,leanX:env.windDirX*0.10,leanZ:env.windDirZ*0.10,rgb,ao:0.90,thickRatio:0.84,density:0.68,soft:0.86});
  }else if(guild==='reed'||guild==='rush'||guild==='cordgrass'){
   const rgb=guild==='reed'?PAL.reed:guild==='cordgrass'?PAL.cordgrass:PAL.rush;
   const radXZ=0.95+0.50*rx;
   const halfH=0.85+0.45*rz;
   out.push({x:px,y:y+halfH*0.95,z:pz,yaw,radXZ,halfH,leanX:env.windDirX*0.12,leanZ:env.windDirZ*0.12,rgb,ao:0.88,thickRatio:0.84,density:0.56,soft:0.88});
  }else{
   const rgb=guild==='panic'?PAL.panic:PAL.seaOat;
   const radXZ=0.90+0.48*rx;
   const halfH=0.62+0.34*rz;
   out.push({x:px,y:y+halfH*0.95,z:pz,yaw,radXZ,halfH,leanX:env.windDirX*0.16,leanZ:env.windDirZ*0.16,rgb,ao:0.92,thickRatio:0.86,density:0.50,soft:0.88});
  }
 }
 return out;
}
