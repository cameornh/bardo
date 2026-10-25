// CPU-only editing soak. No WebGL context or full-scene shader compilation.
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeHeight,packSandShapes} from '../src/sand-lab/sand-shape.js';
import {SandEditPolicy} from '../src/rtx-sand-lab/sand-edit-policy.js';
const count=Number(process.argv[2]||400);
function run(live){
 const b=new SandBed(65);if(live)b.editPolicy=new SandEditPolicy();b.base.fill(-.7);b.wet.fill(.9);b.memory.fill(.9);
 b.optimizations={fastHeight:true,settlingIndex:true,broadphase:true,sandCache:true,windBatch:true,stressPruning:true,patchFloor:true};b.update();
 b.parcels.push({id:b.nextId++,mass:4*Math.PI/3*.65**3*.56,packing:.56,wet:.9,memory:.9,position:[0,.45,0],velocity:[0,0,0],anchored:true});b.update();
 const stock=b.totalMass(),edits=[],queries=[],rows=[];
 for(let i=0;i<count;i++){
  const a=i*2.3999632297,point=[Math.cos(a)*.44,.69+.12*Math.sin(i*1.7),Math.sin(a)*.44],start=performance.now();
  const ps=b.extract(point,.19,[0,0,0],true);
  // Place repeatedly in a small landing region; a separate numerical test
  // runs the dynamic settling. This isolates edit-history cost from water.
  for(const q of ps){q.held=false;q.anchored=true;q.position=[1.5+(i%5)*.06,shapeHeight(q)+.002,1+Math.floor(i%20/5)*.06];}b.update();edits.push(performance.now()-start);
  if((i+1)%20===0){const t=performance.now();for(let j=0;j<200;j++)b.distance([.8*Math.cos(j*2.4),.4,.8*Math.sin(j*2.4)]);queries.push(performance.now()-t);
   rows.push({edits:i+1,parcels:b.parcels.length,cuts:b.parcels.reduce((n,p)=>n+(p.cuts?.length||0),0),maxCuts:Math.max(0,...b.parcels.map(p=>p.cuts?.length||0)),last20EditMs:edits.slice(-20).reduce((a,b)=>a+b,0)/20,query200Ms:queries.at(-1),massError:b.totalMass()-stock});
  }
 }
 const sum=xs=>xs.reduce((a,b)=>a+b,0),sorted=edits.slice().sort((a,b)=>a-b);
 return {mode:live?'bounded live editing':'previous reference',edits:count,meanEditMs:sum(edits)/count,p95EditMs:sorted[Math.floor(sorted.length*.95)],lateMeanEditMs:sum(edits.slice(-100))/Math.min(100,count),meanQuery200Ms:sum(queries)/queries.length,shapeUploadBytes:packSandShapes(b.parcels).data.byteLength,policy:b.editPolicy,rows};
}
// Warm common math and allocation paths before timing either case.
run(true);const reference=run(false),live=run(true);
console.log(JSON.stringify({scope:'CPU sand edit + terrain-query benchmark; not whole-scene FPS or GPU throughput',reference,live,speedup:{meanEdits:reference.meanEditMs/live.meanEditMs,lateEdits:reference.lateMeanEditMs/live.lateMeanEditMs,queries:reference.meanQuery200Ms/live.meanQuery200Ms},shapeStorageReduction:1-live.shapeUploadBytes/reference.shapeUploadBytes},null,2));
