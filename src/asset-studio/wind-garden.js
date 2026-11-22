// A developmental snapshot of a single tillering grass. Dimensions are in metres.
// Shared crown vigour sets height potential; later-born shoots have had less time
// to elongate. Leaf rank controls deployment separately from the height of the stalk.
import {Euler, Quaternion, Vector3} from 'three';
import {Wetland} from './wetland.js';
import {part, stamp} from './model.js';
import {randomSequence} from './family.js';
import {brushFrame} from './gaussian-marks.js';
import {jointDefaults} from './physics-data.js';

export const GARDEN_SEED = 2187;
const tau = 2*Math.PI, up = new Vector3(0,1,0);
const clamp = x => Math.max(0, Math.min(1,x));
const smooth = x => clamp(x)**2*(3-2*clamp(x));
const centered = random => random()+random()-1;

function stemSection(id, name, start, direction, length, radius, parentId, stiffness, damping) {
  const rotation = new Quaternion().setFromUnitVectors(up,direction);
  // Overlap the rounded ends at the articulation, including when it bends.
  const rod = stamp('capsule','add',[0,length/2,0],[radius,length/2,radius],'reed',0);
  const section = part(name,[rod]);
  section.id = id;
  section.transform.position = start.toArray();
  section.transform.rotation = new Euler().setFromQuaternion(rotation).toArray().slice(0,3).map(x=>x*180/Math.PI);
  section.joint = {...jointDefaults(), parentId, anchor:start.toArray(), type:'flexure',
    looseness:0, stiffness, damping, breakForce:1250*(radius/.04)**3/Math.sqrt(length)};
  section.marks = [];
  return section;
}

function blade(section, id, y, azimuth, elevation, length, width, curl, flex, materialId='reed') {
  const radius = section.stamps[0].size[0], x=Math.cos(azimuth), z=Math.sin(azimuth);
  section.marks.push({id,kind:'ribbon',materialId,root:[radius*x,y,radius*z],
    ...brushFrame(new Vector3(x*Math.cos(elevation), Math.sin(elevation), z*Math.cos(elevation)),up),
    length,width,curl,flex,bias:.82,taper:.72});
}

function growShoot(asset, random, base, heading, age, vigour, tiller) {
  const maturity = smooth((age-.17)/.80);
  const height = (.47+2.40*maturity)*vigour*Math.exp(.085*centered(random));
  const radius = .030+.016*(height/2.5)**.72;
  const spread = .035+.32*(1-maturity)+.08*random();
  const axis = (angle,slope) => new Vector3(slope*Math.cos(angle),1,slope*Math.sin(angle)).normalize();
  const lowerDirection = axis(heading,spread);
  const upperDirection = axis(heading+.50*centered(random),spread+.065+.15*random());
  // Articulate at an actual leaf-bearing node. The blade sheath brackets
  // the node while the neighbouring internodes carry the bend.
  const leafCount = 4+Math.floor(3.8*maturity);
  const nodeAt=i=>.055+(.64+.12*(1-maturity))*((i+.45)/leafCount)**1.24;
  const jointRank=Math.round(leafCount*.68);
  const split=nodeAt(jointRank);
  const joint = base.clone().addScaledVector(lowerDirection,height*split);
  // Bending springs approximate EI/L. Each basal section also supports the
  // gravity moment of both segments. The upper internodes taper and yield first.
  const weightMoment = 360*Math.PI*radius**2*height**2*9.81*.5;
  const stiffness = weightMoment*2.8+16*(radius/.04)**4/height;
  const basal = stemSection('base-'+tiller,'Basal stem '+(tiller+1),base,lowerDirection,height*split,radius,
    'ground',stiffness,2.4*height);
  const upper = stemSection('tip-'+tiller,'Upper stem '+(tiller+1),joint,upperDirection,height*(1-split),radius*.84,
    basal.id,stiffness*.29,.94*height);
  asset.parts.push(basal,upper);

  // An alternate (two-ranked) leaf sequence drifts gradually around the culm.
  // Rank drives correlated traits: the middle blades are longest, the bottom
  // blades spread and droop, and the youngest upper blades are still furled.
  // Early blades stay close to the crown as the later internodes elongate.
  // Their overlapping arches give the tillers a common base even in profile.
  const basalCount=2+Math.round(1-maturity);
  for(let i=0;i<basalCount;i++){
    const angle=heading+(i-1)*1.92+.58*centered(random);
    blade(basal,'sheath-'+i,.035+.045*i,angle,.66+.34*random(),
      (.32+.27*random())*height**.48,.044+.012*random(),-.9,.86,
      i===0&&age>.82?'reed-husk':'reed-blade');
  }
  const twist=.24*centered(random);
  let azimuth = heading+.80*centered(random);
  for(let i=0;i<leafCount;i++){
    const rank=(i+.45)/leafCount;
    const node=nodeAt(i)+(i===jointRank?0:.018*centered(random));
    const bladeLength=height**.65*(.22+.31*Math.sin(Math.PI*rank))*(1+.11*centered(random));
    blade(node<split?basal:upper,'leaf-'+i,(node-(node<split?0:split))*height,azimuth,
      .25+.91*rank+.12*centered(random),bladeLength,.042+.016*Math.sin(Math.PI*rank),
      -.96+.64*rank,.76+.12*(1-rank),i===0&&age>.85?'reed-husk':'reed-blade');
    azimuth+=Math.PI+twist+.23*centered(random);
  }

  // Only shoots that have flowered carry a plume. Its branches shorten toward
  // the apex and share one axis with the last internode.
  const bloom = smooth((age-.73)/.22);
  const upperLength=height*(1-split);
  if(bloom<.9){
    blade(upper,'rolled-tip',upperLength-.05*height,azimuth,1.23,
      (.14+.08*(1-maturity))*height,.045,-.35,.74);
  }
  if(bloom>.07){
    const plumeLength=height*(.06+.13*bloom), top=height*(1-split);
    const branches=Math.ceil(8+16*bloom);
    for(let i=0;i<branches;i++){
      const rank=(i+.3*random())/branches;
      blade(upper,'spikelet-'+i,top-plumeLength*(1-rank),azimuth+i*2.39996+.24*centered(random),.76+.49*rank+.13*centered(random),
        Math.max(.04,plumeLength*(.20+.60*(1-rank))*(.86+.24*random())),.052+.012*random(),-.37,.45,'reed-husk');
    }
  }
}

// Age is bounded; potential height varies multiplicatively, so short shoots
// are common inside a tall clump without producing arbitrarily tall outliers.
export function growCrown(id, name, seed, age, vigour) {
  const random=randomSequence(seed);
  const asset={id,name,spacing:.05,duration:3,parts:[]};
  const shoots=age>.79?3:2, rotation=random()*tau;
  for(let i=0;i<shoots;i++){
    const direction=rotation+i*tau/shoots+.42*centered(random);
    const reach=(i===0?.055:.14)+.06*random();
    const base=new Vector3(reach*Math.cos(direction),.015,reach*Math.sin(direction));
    growShoot(asset,random,base,direction,age-i*(.19+.08*random()),vigour,i);
  }
  return asset;
}

export function populateWindGarden(library,place,seed=GARDEN_SEED) {
  const random=randomSequence(seed), family=library.families.find(f=>f.id==='example-rushes');
  const oldIds=family.members.map(m=>m.assetId);
  library.assets=library.assets.filter(a=>!oldIds.includes(a.id));
  family.name='Reed clumps';family.members=[];
  const fibre=library.materials.find(m=>m.id==='reed');
  library.materials.push({...fibre,id:'reed-blade',name:'Reed blade',color:'#638040',roughness:.68},
    {...fibre,id:'reed-husk',name:'Reed husk',color:'#b5955c',roughness:.9});
  library.world.wind.turbulence=.8;
  const landscape=new Wetland(seed);
  const asset=growCrown('example-reed-clump','Reed clump',Math.floor(random()*4294967296),.96,1);
  library.assets.push(asset);family.members.push({assetId:asset.id,weight:1});
  library.world.wetlandSeed=landscape.seed;
  // Sample positions within a patch, with a little space between crowns.
  // Vary placement scale and orientation while keeping every reference editable.
  const crowns=[];
  for(let i=0;i<5;i++){
    let x,z,bestDistance=-Infinity;
    for(let attempt=0;attempt<24;attempt++){
      const angle=random()*tau, distance=Math.sqrt(random());
      const cx=2.65*distance*Math.cos(angle),cz=1.65*distance*Math.sin(angle);
      const clearance=crowns.reduce((min,p)=>Math.min(min,Math.hypot(cx-p.x,cz-p.z)),Infinity);
      const h=landscape.height(cx,cz);
      const score=Math.min(1.5,clearance)-2*Math.abs(h-.07);
      if(score>bestDistance){x=cx;z=cz;bestDistance=score;}
      if(clearance>1.24&&Math.abs(h-.07)<.18)break;
    }
    crowns.push({x,z});
    const size=.55+.53*(i+.2+.6*random())/5;
    place('reed-clump',x,landscape.height(x,z),z,random()*360,size,'crown-'+(i+1));
  }
}
