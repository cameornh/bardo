import {seedLibrary,transform} from './model.js';
import {familySampler,pickFamilyMember} from './family.js';
import {installCatalog} from './example-catalog.js';

const example=id=>'example-'+id;
function world(ground,speed,heading,arrange){
 const l=seedLibrary();l.assets=[];
 l.world={groundMaterialId:ground,wind:{speed,heading},instances:[]};installCatalog(l);
 const place=(id,x,y,z,yaw=0,scale=1,name=id)=>{
  const t=transform();t.position=[x,y,z];t.rotation[1]=yaw;t.scale=Array.isArray(scale)?scale:[scale,scale,scale];
  l.world.instances.push({id:name,assetId:example(id),transform:t});
 };
 arrange(place,l);
 return l;
}
function affect(sim,instance,tool,power=1,end=0){
 const site=sim.get(instance,'body')?.field.sites[end];
 if(site)sim.materialWorld.apply(site,tool,power);
}

export const exampleWorlds=[
 {id:'fire',name:'Crosswind fire',guide:'Play to ignite one edge of the tinder. Turn the wind to bend the flame and watch the old smoke drift away. The second bundle starts wet.',
  create:()=>world('stone',4.5,7,place=>{
   place('billet',-.24,0,-.28,12,.88);place('tinder',-.39,.01,.17,-15,1.15);
   place('wick',.22,.01,.12,0,.8);place('tinder',.76,0,-.48,45,.93,'damp');
  }),start(sim){affect(sim,'damp','wet',2);affect(sim,'tinder','heat',1.9);}},
 {id:'char',name:'Burning under load',guide:'These two fibreboard cantilevers carry their own weight. Play to ignite the near support. Compare the weakened span with the cold one as the fire travels and the jointless material cracks.',
  create:()=>world('stone',.6,15,place=>{
   place('lath',-.72,0,.48);place('lath',-.72,0,-.56,0,1,'cold');
   place('pier',-.73,0,.48,0,1.015,'near-pier');place('pier',-.73,0,-.56,0,1.015,'far-pier');
  }),start(sim){affect(sim,'lath','heat',3);}},
 {id:'current',name:'Contact circuit',guide:'Play to connect the copper shoes across the graphite. Nudge the bridge away to open the circuit, then probe the voltage or the heat.',
  display:'charge',create:()=>world('porcelain',0,0,place=>{
   place('bridge',0,0,0);place('contact',-.682,0,0);place('contact',.682,0,0,180,1,'return');
  }),start(sim){affect(sim,'contact','positive',.75);affect(sim,'return','return');}},
 {id:'thaw',name:'Melting and absorption',guide:'Play to melt the wax seal and ice lens. Brine lands on a wicking pad. Use the moisture and liquid-fraction views to compare the materials.',
  create:()=>world('stone',.6,20,place=>{
   place('wax',-.70,0,.12);place('ice',.15,0,-.31);place('sponge',.75,0,.27);
   place('brine',.75,.63,.27,0,.63);place('bowl',-.74,0,-.65,0,.60);
  }),start(sim){affect(sim,'wax','bulkHeat',.79);affect(sim,'ice','bulkHeat',1.04);}},
 {id:'wetland',name:'Wind garden',guide:'Play and change wind heading to bend the attached ribbons. Choose a grass in the family library to edit its shape or place a seeded variation.',
  create:()=>world('sand',8,-25,(place,l)=>{
   const f=l.families.find(f=>f.id===example('rushes'));
   const positions=[[-1.12,-.69],[-.15,-.91],[.94,-.65],[-.73,.36],[.42,.40],[1.52,.23]];
   for(const [i,[x,z]] of positions.entries()){
    const assetId=i<3?f.members[i].assetId:pickFamilyMember(f.members,11*i);
    const a=l.assets.find(a=>a.id===assetId),v=familySampler(a.variation,73+i);
    place(assetId.slice(8),x,0,z,v.twist,v.size,'tuft-'+i);
   }
  })},
 {id:'tidepool',name:'Floats and breakers',guide:'Play to release the floats onto the waves. Raise the wind for breaking crests, spray and organic foam. Use the ground tools to lift or throw water.',
  create:()=>world('water',13,32,(place,l)=>{
   l.materials.find(m=>m.id==='water').organicLoad=.67;
   place('bobber',-.88,.30,.24);place('buoy',.25,.12,-.48);place('pumice',1.24,.26,.32,33);
  })},
 {id:'load',name:'Suspension and fracture',guide:'Play to drive the pendulum and load the notched timber. Drag a nudge across the chime to stretch its spring and swivel, or push the weighted end of the timber to fracture it.',
  create:()=>world('stone',0,0,place=>{
   place('pendulum',-1.55,0,0);place('chime',-.28,0,-.22);place('cantilever',.46,0,.18);
   place('pier',-1.94,0,0,0,[1,2.35,1],'pendulum-pier');place('pier',-.64,0,-.22,0,[1,2.97,1],'chime-pier');
   place('pier',.43,0,.18,0,[1,1.61,1],'timber-pier');
  })},
 {id:'dew',name:'Humidity and condensation',guide:'Play to release water vapour beside the chilled copper. Probe the copper and the porous pad to follow surface moisture, then change the air humidity.',
  display:'moisture',create:()=>world('porcelain',.7,5,place=>{
   place('contact',.36,0,.26);place('vapour',.27,.45,.26);place('sponge',1.04,0,.28);
  }),start(sim){affect(sim,'contact','bulkCool',.035);}},
 {id:'runoff',name:'Viscosity and rebound',guide:'Play to drop brine and oil side by side on bronze. Compare their spread, then nudge the rubber and porcelain balls to compare rebound.',
  create:()=>world('bronze',0,0,place=>{
   place('brine',-1.1,.92,.50);place('oil',.75,.92,.50);
   place('rubber-ball',-.90,1.45,-.68);place('china-ball',.78,1.45,-.68);
  })},
 {id:'deposition',name:'Dunes and vessels',guide:'Play to drop the sand measure. Lift sand from the ground, drop it near the pottery and increase the wind to move the loose surface.',
  create:()=>world('sand',20,15,place=>{
   place('stoneware',-.78,0,.18,15);place('bowl',.54,0,-.18,0,.95);
   place('sand',.5,1.02,-.1,0,.76);
  })}
];
