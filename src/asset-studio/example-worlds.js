import {seedLibrary,transform} from './model.js';
import {GARDEN_SEED,populateWindGarden} from './wind-garden.js';
import {COASTAL_SPECIES} from './coastal-flora.js';
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
 {id:'fire',name:'Crosswind fire',guide:'Play to ignite one edge of the tinder. Turn the wind to bend the flame and watch the old smoke drift away. Wet the burning face to cool it. The second bundle starts damp.',
  create:()=>world('stone',4.5,7,place=>{
   place('billet',-.24,0,-.28,12,.88);place('tinder',-.39,.01,.17,-15,1.15);
   place('wick',.22,.01,.12,0,.8);place('tinder',.76,0,-.48,45,.93,'damp');
  }),start(sim){affect(sim,'damp','wet',2);affect(sim,'tinder','heat',1.9);}},
 {id:'char',name:'Burning under load',guide:'These two fibreboard cantilevers carry their own weight. Play to ignite the near support. Compare the weakened span with the cold one as the fire travels and the jointless material cracks.',
  create:()=>world('stone',.6,15,place=>{
   place('lath',-.72,0,.48);place('lath',-.72,0,-.56,0,1,'cold');
   place('pier',-.73,0,.48,0,1.015,'near-pier');place('pier',-.73,0,-.56,0,1.015,'far-pier');
  }),start(sim){affect(sim,'lath','heat',3);}},
 {id:'current',name:'Contact circuit',tool:'nudge',guide:'Play to connect the copper shoes across the graphite. Nudge the bridge away to open the circuit, then probe the voltage or the heat.',
  display:'charge',create:()=>world('porcelain',0,0,place=>{
   place('bridge',0,0,0);place('contact',-.682,0,0);place('contact',.682,0,0,180,1,'return');
  }),start(sim){affect(sim,'contact','positive',.75);affect(sim,'return','return');}},
 {id:'thaw',name:'Melting and absorption',guide:'Play to melt the wax seal and ice lens. Brine lands on a wicking pad. Use the moisture and liquid-fraction views to compare the materials.',
  framing:{direction:[.25,.72,1]},readout(sim){
   const core=sim.get('ice','body')?.field.sites.find(s=>s.core)?.core;
   if(core)return `Ice interior · ${(core.t-273.15).toFixed(1)} °C · ${Math.round(100*core.melt)}% melted`;
   return sim.matter.meltedParts.has('ice:body')?'Ice lens melted into water':'';
  },create:()=>world('stone',.6,20,(place,l)=>{
   l.materials.find(m=>m.id==='stone').color='#545f69';
   place('wax',-.70,0,.12);place('ice',.05,0,.40);place('sponge',.85,0,-.14);
   place('brine',.85,.63,-.14,0,.63);place('bowl',-.74,0,-.65,0,.60);
  }),start(sim){
   for(const [id,dose] of [['wax',316000],['ice',370000]])
    sim.materialWorld.heatVolumeOver(sim.get(id,'body'),id,dose,4);
  }},
 {id:'wetland',name:'Shell Island Beach',seed:GARDEN_SEED,framing:{direction:[.42,.42,.80],groundMargin:3.2},tool:'nudge',
  guide:'St. Andrews / Shell Island coastal transect. Use Transect view or orbit across Gulf surf, foredunes, swale ponds and scrub. Adjust Climate, Wind or Coastal field overlay; Play to nudge plants or disturb water.',
  readout(sim){
   const c=sim.sand?.landscape?.climate;
   const h=sim.sand?.landscape?.hydrology;
   if(!c||!h)return '';
   return `Climate · ${c.airTemperature.toFixed(0)} °C · RH ${Math.round(c.relativeHumidity*100)}% · VPD ${h.vpdKpa.toFixed(2)} kPa · Water lens +${h.lensHeight.toFixed(2)} m · ${COASTAL_SPECIES.length} coastal species`;
  },
  create:(_ground,seed=GARDEN_SEED)=>world('sand',6.8,65,(place,l)=>populateWindGarden(l,place,seed))},
 {id:'tidepool',name:'Floats and breakers',tool:'splash',guide:'Play to release the floats onto the waves. Raise the wind for breaking crests, spray and organic foam. Use the ground tools to lift or throw water.',
  create:()=>world('water',13,32,(place,l)=>{
   l.materials.find(m=>m.id==='water').organicLoad=.67;
   // The coloured ballast and cork are bonded stock; a normal wave should carry the whole float.
   for(const m of l.materials)if(['cork','clay','reed'].includes(m.id))m.adhesion=1.5e5;
   place('bobber',-.88,.30,.24);place('buoy',.25,.12,-.48);place('pumice',1.24,.26,.32,33);
  })},
 {id:'load',name:'Suspension and fracture',tool:'nudge',guide:'Play to drive the pendulum and load the notched timber. Drag a nudge across the chime to stretch its spring and swivel, or push the weighted end of the timber to fracture it.',
  create:()=>world('stone',0,0,(place,l)=>{
   // The notched timber supports its end weight until a player loads the tip.
   Object.assign(l.materials.find(m=>m.id==='wood'),{tensileStrength:1.2e6,yieldStress:2.4e6,adhesion:1.2e6});
   l.materials.find(m=>m.id==='bronze').adhesion=1.2e6;
   place('pendulum',-1.55,0,0);place('chime',-.28,0,-.22);place('cantilever',.46,0,.18);
   place('pier',-1.94,0,0,0,[1,2.35,1],'pendulum-pier');place('pier',-.64,0,-.22,0,[1,2.97,1],'chime-pier');
   place('pier',.43,0,.18,0,[1,1.61,1],'timber-pier');
  })},
 {id:'dew',name:'Humidity and condensation',tool:'field',guide:'Play to release water vapour beside the chilled copper. Probe the copper and the porous pad to follow surface moisture, then change the air humidity.',
  display:'moisture',create:()=>world('porcelain',.7,5,place=>{
   place('contact',.36,0,.26);place('vapour',.27,.45,.26);place('sponge',1.04,0,.28);
  }),start(sim){affect(sim,'contact','bulkCool',.035);}},
 {id:'runoff',name:'Viscosity and rebound',tool:'nudge',framing:{direction:[0,1,1],groundMargin:.95},guide:'Equal volumes fall from the same height. Blue brine spreads on the left, amber oil on the right. Compare their widths and the rebound of the two balls behind them.',
  readout(sim){
   const width=id=>((sim.matter.beds.get(id)?.spreadDiameter()??0)*100).toFixed(0);
   return `Pool spread · brine ${width('brine')} cm · oil ${width('oil')} cm`;
  },create:()=>world('porcelain',0,0,(place,l)=>{
   // Optical tracers make shallow films visible against one neutral, level plate.
   Object.assign(l.materials.find(m=>m.id==='brine'),{color:'#3194ef',absorption:92});
   Object.assign(l.materials.find(m=>m.id==='oil'),{color:'#e6aa38',absorption:28});
   place('brine',-1.25,.46,.66,0,1.18);place('oil',1.05,.46,.66,0,1.18);
   place('rubber-ball',-.90,1.45,-.68);place('china-ball',.78,1.45,-.68);
  })},
 {id:'deposition',name:'Dunes and vessels',tool:'nudge',guide:'Play to catch the sand in the bowl. Drag its rim to tip out the grains, then lift loose sand from the ground or increase the wind.',
  create:()=>world('sand',8,15,place=>{
   place('stoneware',-.36,0,.08,15,.45);place('bowl',.24,0,-.08,0,.43);
   place('sand',.23,.60,-.06,0,.34);
  })}
];
