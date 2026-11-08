// CPU-only conservative repeated edit soak; never starts graphics.
import {writeFile} from 'node:fs/promises';
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeHeight} from '../src/sand-lab/sand-shape.js';
import {SandEditPolicy,EDIT_CUT_LIMIT} from '../src/rtx-sand-lab/sand-edit-policy.js';
import {LiveSandAirGeometry} from '../src/rtx-sand-lab/sand-cpu-queries.js';
const b=new SandBed(65);b.editPolicy=new SandEditPolicy();b.wet.fill(.8);b.memory.fill(.8);b.optimizations={fastHeight:true};b.update();
const stock=b.totalMass(),geometry=new LiveSandAirGeometry(b,[]),rows=[],count=5000;
for(let i=0;i<count;i++){
 const t=performance.now(),x=(i%7)*.1-1,z=2+(Math.floor(i/7)%7)*.1;
 const ps=b.extract([x,b.height(x,z),z],.065,[0,0,0],true);
 if(!ps.length)throw Error('Empty edit fixture');
 for(const p of ps){p.held=false;p.anchored=true;p.position=[x,b.height(x,z)+shapeHeight(p)+.001,z];}
 b.editPolicy.maintain(b);b.update();geometry.refresh();
 if(Math.abs(b.totalMass()-stock)>1e-8||b.parcels.some(p=>(p.cuts?.length||0)>EDIT_CUT_LIMIT))throw Error('Edit conservation/bounded history failed');
 rows.push({edit:i+1,ms:performance.now()-t,parcels:b.parcels.filter(p=>p.mass>0).length,treeNodes:geometry.tree.nodes.length,cuts:b.parcels.reduce((s,p)=>s+(p.cuts?.length||0),0)});
}
const chunks=[];for(let i=0;i<count;i+=500){const window=rows.slice(i,i+500),times=window.map(r=>r.ms).sort((a,b)=>a-b);chunks.push({edits:i+500,medianMs:times[250],p95Ms:times[475],maxParcels:Math.max(...window.map(r=>r.parcels)),maxTreeNodes:Math.max(...window.map(r=>r.treeNodes)),maxCuts:Math.max(...window.map(r=>r.cuts))});}
const result={pass:true,edits:count,scope:'Repeated grounded matching-material grab/place, exact stock conservation; raised/cut sculptures tested separately',massError:b.totalMass()-stock,returned:b.editPolicy.returned,chunks};
await writeFile(new URL('../tests/results/cpu-throughput-2026-11-07/edit-soak.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
