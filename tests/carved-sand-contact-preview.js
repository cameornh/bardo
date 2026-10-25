import {SandBed} from '../src/sand-lab/sand.js';
import {SandEditPolicy} from '../src/rtx-sand-lab/sand-edit-policy.js';
import {makeBody,resolveSandContacts,bodyDistance} from '../src/sand-lab/objects.js';
import {resolveCarvedSandContacts} from '../src/rtx-sand-lab/carved-sand-contacts.js';
import {resolveBodyTerrain,bodyContactPoints,integrateOrientation} from '../src/sand-lab/rigid-contacts.js';
import {BoundsGrid} from '../src/sand-lab/spatial-bounds.js';
const $=id=>document.getElementById(id);
$('run').onclick=()=>{
 const bed=new SandBed(33);bed.editPolicy=new SandEditPolicy();bed.base.fill(-.7);bed.wet.fill(.95);bed.memory.fill(.95);bed.update();
 const p={id:bed.nextId++,position:[0,1,0],velocity:[0,0,0],mass:4*Math.PI/3*.56,packing:.56,wet:.95,memory:.95,anchored:true};bed.parcels.push(p);bed.update();bed.carve([0,1.7,0],.8);
 const old=makeBody('rock','sphere',.18,[0,1.4,0]),b=makeBody('rock','sphere',.18,[0,2.5,0]),grid=new BoundsGrid();resolveSandContacts([p],[old],1/60);
 for(let i=0;i<480;i++){const h=1/120;resolveCarvedSandContacts(bed.parcels,[b],h,grid);b.velocity[1]-=9.81*h;for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*h;integrateOrientation(b,h);resolveBodyTerrain(b,q=>bed.distance(q),h);}
 const ctx=$('view').getContext('2d'),image=ctx.createImageData(660,320);
 for(let y=0;y<320;y++)for(let x=0;x<660;x++){
  const q=[((x%330)/330-.5)*2.6,2.65-y/320*2.8,0],body=x<330?old:b,sand=bed.distance(q)<=0,inside=bodyDistance(q,body)<=0;
  const color=inside?[166,179,190]:sand?[128,99,65]:[19,29,35],o=(y*660+x)*4;image.data.set([...color,255],o);
 }
 ctx.putImageData(image,0,0);ctx.fillStyle='#e8edf0';ctx.font='14px system-ui';ctx.fillText('Previous: uncarved sphere contact',12,22);ctx.fillText('Live: ball rests in carved bowl',342,22);
 const minimumDistance=Math.min(...bodyContactPoints(b).map(q=>bed.distance(q)));
 $('result').textContent=JSON.stringify({pass:b.position[1]>1.07&&b.position[1]<1.12&&minimumDistance>-.001,backend:'CPU rigid contacts',previousCenter:old.position,carvedBowlCenter:b.position,expectedRestHeight:1.08,minimumSurfaceDistance:minimumDistance,steps:480},null,2);
};
